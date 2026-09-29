import { addDays, calendarDay, stableHash } from './time.js';

const strong = state => state === 'strong' || state === 'very_strong';
const rounded = n => Math.round(n * 1e6) / 1e6;

function activityFor(engine, pageIds, day, at) {
  const eligible = pageIds.filter(id => {
    const page = engine.getPageState(id);
    return strong(page.state) && !engine._recentFailures(page, at);
  });
  const randomAccess = eligible.filter(id => stableHash(`${engine.metadata.layoutId}:${day}:${id}`) / 2 ** 32 < engine.config.maintenance.randomAccessFraction).map(pageId => {
    const page = { ayahIds: engine._page(pageId).memorizedAyahIds };
    const links = engine.getConfusionLinks().filter(link => link.ayahIds.some(id => page.ayahIds.includes(id)));
    const choice = stableHash(`start:${day}:${pageId}`);
    const ayahId = links.length ? links[choice % links.length].ayahIds.find(id => page.ayahIds.includes(id)) : page.ayahIds[choice % page.ayahIds.length];
    return { pageId, activity: 'random_start', startAyahId: ayahId, mode: links.length ? 'known_confusion_point' : 'random_ayah', completePageRecallRequiredForStability: engine._page(pageId).coverage === 'complete', completeMemorizedPortionRequiredForStability: true, ayahIds: [...page.ayahIds] };
  });
  return { activity: 'memory', randomAccessTests: randomAccess };
}

function contextFor(engine, ayahId, known) {
  const ayat = engine.metadata.ayat, index = ayat.findIndex(a => a.id === ayahId), config = engine.config.targeting;
  let from = index, to = index;
  while (from > 0 && index - from < config.contextAyahsBefore && known.has(ayat[from - 1].id)) from--;
  while (to < ayat.length - 1 && to - index < config.contextAyahsAfter && known.has(ayat[to + 1].id)) to++;
  return { startAyahId: ayat[from].id, endAyahId: ayat[to].id, instruction: 'Recall the mistake location with its surrounding memorized ayat, staying within material you know, until one clean recall proves the transition.' };
}

export function buildDailyPlan(engine, at, capacity, preferences = {}) {
  const maintenanceHalves = new Set(preferences.maintenanceHalfJuzIds ?? []);
  const queuedHalves = new Set(preferences.strengthenQueue ?? []);
  const config = engine.config, day = calendarDay(at, config.timeZone);
  const capacityMinutes = typeof capacity === 'string' ? config.capacityMinutes[capacity] : capacity;
  if (!Number.isFinite(capacityMinutes) || capacityMinutes < 0) throw new Error('Capacity must be a known preset or a nonnegative number of minutes');
  const plan = { date: day, capacityMinutes, completedDurationMinutes: 0, remainingCapacityMinutes: 0, strengthen: [], dueReviews: [], targetedWeaknesses: [], maintenance: [], dailyReviews: [], totalEstimatedDurationMinutes: 0, deferredItems: [] };
  const known = new Set(engine.getMemorizedMaterial().ayahIds);
  const completed = new Set();
  const reviewedOutsideStrengthening = new Set();
  let completedReviewMinutes = 0;
  for (const session of Object.values(engine.state.sessions)) if (calendarDay(session.occurredAt, config.timeZone) === day) {
    plan.completedDurationMinutes += session.actualDurationMinutes ?? session.reviews.reduce((sum, r) => sum + (engine._isCompleteReview(r) ? Math.min(config.durations.activePageMinutes, Math.max(config.durations.minimumPartialPageMinutes, config.durations.activePageMinutes * r.ayahIds.length / engine.pageMetadata.get(r.pageId).ayahIds.length)) : config.durations.targetedAyahMinutes), 0);
    for (const r of session.reviews) if (config.activities[r.activity].active && engine._isCompleteReview(r) && r.coverageVersion === engine._page(r.pageId).coverageVersion) {
      completed.add(r.pageId);
      if (!['strengthening', 'targeted'].includes(session.purpose) && !reviewedOutsideStrengthening.has(r.pageId)) {
        reviewedOutsideStrengthening.add(r.pageId);
        // Count completed coverage, rather than speed, so finishing quickly doesn't create extra tasks.
        completedReviewMinutes += engine._pageMinutes(r.pageId);
      }
    }
  }
  plan.completedDurationMinutes = rounded(plan.completedDurationMinutes);
  plan.remainingCapacityMinutes = Math.max(0, rounded(capacityMinutes - plan.completedDurationMinutes));
  const selected = new Set(), dueItems = engine.getDueReviews(at), allDue = new Set(dueItems.map(p => p.pageId));
  const add = (section, item, { allowOverlap = false, waitUntil = null } = {}) => {
    const ids = item.pageIds ?? [];
    if (!allowOverlap && ids.some(id => selected.has(id))) return false;
    item.estimatedMinutes = rounded(item.estimatedMinutes);
    if (waitUntil || plan.totalEstimatedDurationMinutes + item.estimatedMinutes > plan.remainingCapacityMinutes + 1e-9) {
      const urgent = item.mandatory || item.protected || item.risk?.riskRatio > config.risk.overdue;
      plan.deferredItems.push({ ...item, section, reason: waitUntil ? 'later_calendar_day_required' : 'daily_capacity_reached', safeToPostpone: waitUntil ? true : !urgent, postponementReason: waitUntil ? `The next stage must occur on or after ${waitUntil}; a same-day stage would not prove spaced retention.` : urgent ? 'Capacity is exhausted. This item remains important and is not safe to postpone without increased forgetting risk; it will be ranked again next time.' : item.kind === 'maintenance' ? 'This is preventive maintenance; higher-priority work uses today’s capacity. Risk will be recalculated next time.' : 'Lower-priority work was selected for deferral within the daily limit; this is not a guarantee against forgetting. Risk will be recalculated next time.' });
      return false;
    }
    plan[section].push(item);
    plan.totalEstimatedDurationMinutes = rounded(plan.totalEstimatedDurationMinutes + item.estimatedMinutes);
    for (const id of ids) selected.add(id);
    return true;
  };

  const cycle = engine._activeCycle();
  const allTroublesome = engine.getTroublesomeAyat(at);
  const candidate = cycle ?? engine.selectNextStrengthening(at, preferences);
  const strengthenItem = candidate && (() => {
    const troublesome = allTroublesome.filter(a => a.pageIds.some(id => candidate.pageIds.includes(id)));
    const targetedPageIds = candidate.pageIds.filter(id => engine._page(id).targetedRepair || engine._page(id).stabilityDays < config.states.weakBelow);
    const targetMinutes = candidate.stage < 3 ? targetedPageIds.reduce((sum, id) => sum + engine._pageMinutes(id, true), 0) + troublesome.length * config.durations.targetedAyahMinutes : 0;
    return { kind: 'strengthening', halfJuzId: candidate.halfJuzId, pageIds: [...candidate.pageIds], passage: engine._passage(candidate.pageIds), coverage: engine.getHalfJuzState(candidate.halfJuzId, at).coverage, stage: candidate.stage, cycleId: cycle?.id ?? null, requiresStart: !cycle, protected: !!cycle, requiredPasses: config.strengthening.requiredPasses, targetedPageIds: candidate.stage < 3 ? targetedPageIds : [], targetedAyahIds: candidate.stage < 3 ? troublesome.map(a => a.ayahId) : [], targetedPrescription: { until: 'one_clean_good_or_perfect_recall', maximumRepetitionsPerPage: config.strengthening.maxTargetedRepetitions }, instructions: candidate.stage === 1 ? ['Complete one active-recall pass of the prescribed memorized material.', 'Target difficult, failed or mistaken pages/ayat until clean, up to the session limit.', 'Complete a second active-recall pass; repair any remaining mistakes.'] : candidate.stage === 2 ? ['Complete two active-recall passes of the prescribed memorized material.', 'Target errors and hesitation until clean.'] : ['Complete two active-recall passes of the prescribed memorized material with automatic, confident recall.'], activity: 'memory', estimatedMinutes: candidate.pageIds.reduce((sum, id) => sum + engine._pageMinutes(id), 0) * config.strengthening.requiredPasses + targetMinutes };
  })();
  if (cycle) add('strengthen', strengthenItem, { allowOverlap: true, waitUntil: cycle.lastPassedDay && day <= cycle.lastPassedDay ? addDays(cycle.lastPassedDay, 1) : null });

  for (const retention of Object.values(engine.state.retention).filter(r => r.status === 'pending' && r.nextReviewAt <= day).sort((a, b) => a.nextReviewAt.localeCompare(b.nextReviewAt) || a.halfJuzId.localeCompare(b.halfJuzId))) {
    // Keep these complete: partial reviews cannot establish section-level retention.
    if (retention.pageIds.every(id => completed.has(id))) continue;
    const risks = retention.pageIds.map(id => engine.getForgettingRisk(id, at));
    add('dueReviews', { kind: 'early_retention', halfJuzId: retention.halfJuzId, pageIds: [...retention.pageIds], passage: engine._passage(retention.pageIds), reason: 'mandatory_early_retention', mandatory: true, checkNumber: retention.successes + 1, risk: risks.sort((a, b) => b.riskRatio - a.riskRatio)[0], activity: 'tested', estimatedMinutes: retention.pageIds.reduce((sum, id) => sum + engine._pageMinutes(id), 0) });
  }

  // Starting a cycle is optional, so mandatory retention is reserved first.
  if (!cycle && strengthenItem) add('strengthen', strengthenItem);

  const ordinary = dueItems.filter(item => !item.mandatory && !completed.has(item.pageId));
  for (const group of [ordinary.filter(p => p.risk.riskRatio > config.risk.overdue), ordinary.filter(p => p.risk.riskRatio <= config.risk.overdue)]) {
    for (const item of group) {
      const prescription = activityFor(engine, [item.pageId], day, at);
      add('dueReviews', { ...item, kind: 'spaced_review', pageIds: [item.pageId], passage: engine._passage([item.pageId]), ...prescription, estimatedMinutes: engine._pageMinutes(item.pageId) + prescription.randomAccessTests.length * config.durations.randomStartExtraMinutes });
    }
  }

  const troublesome = allTroublesome, targetedAyahsByPage = new Set();
  for (const item of troublesome) {
    const pageIds = item.pageIds.filter(id => !engine._cycleForPage(id));
    if (!pageIds.length) continue;
    pageIds.forEach(id => targetedAyahsByPage.add(id));
    const cleanToday = Object.values(engine.state.sessions).some(s => calendarDay(s.occurredAt, config.timeZone) === day && s.reviews.some(r => config.activities[r.activity].active && r.ayahIds.includes(item.ayahId) && ['good', 'perfect'].includes(r.accuracy)) && !engine.state.mistakes.some(m => m.sessionId === s.sessionId && (m.ayahId === item.ayahId || (m.ayahId === null && pageIds.includes(m.pageId)))));
    if (cleanToday) continue;
    add('targetedWeaknesses', { kind: 'troublesome_ayah', ayahId: item.ayahId, pageIds, reason: item.reason, cleanSessionsRemaining: Math.max(0, config.mistakes.cleanSessionsToResolve - item.cleanSessions), activity: 'memory', prescribedRepetitions: { until: 'one_clean_active_recall', cleanRecallsRequired: config.targeting.cleanRecallsRequired }, context: contextFor(engine, item.ayahId, known), estimatedMinutes: config.durations.targetedAyahMinutes }, { allowOverlap: true });
  }
  for (const meta of engine.metadata.pages) if (engine._page(meta.id).targetedRepair && !engine._cycleForPage(meta.id) && !completed.has(meta.id)) {
    const page = engine._page(meta.id);
    const prescription = { reason: 'isolated_error_or_weak_recall', activity: 'memory', prescribedRepetitions: { until: 'one_clean_active_recall', cleanRecallsRequired: config.targeting.cleanRecallsRequired } };
    if (page.needsFullPageRepair && !targetedAyahsByPage.has(meta.id)) add('targetedWeaknesses', { ...prescription, kind: 'weak_page', pageIds: [meta.id], passage: engine._passage([meta.id]), ayahIds: [...page.repairAyahIds], estimatedMinutes: engine._pageMinutes(meta.id, true) });
    else for (const ayahId of page.repairAyahIds.filter(id => !troublesome.some(t => t.ayahId === id))) {
      add('targetedWeaknesses', { ...prescription, kind: 'weak_ayah', ayahId, pageIds: [meta.id], context: contextFor(engine, ayahId, known), estimatedMinutes: config.durations.targetedAyahMinutes }, { allowOverlap: true });
    }
  }

  const maintenance = engine.juzIds.map(juzId => {
    const all = engine.metadata.pages.filter(p => p.juzId === juzId);
    const pageIds = all.filter(p => engine._page(p.id).memorizedAyahIds.length && (strong(engine._pageState(engine._page(p.id))) || maintenanceHalves.has(p.halfJuzId)) && !queuedHalves.has(p.halfJuzId) && !engine._cycleForPage(p.id) && !engine._retentionForPage(p.id) && !allDue.has(p.id) && !selected.has(p.id) && !completed.has(p.id) && !engine._page(p.id).targetedRepair).map(p => p.id);
    pageIds.sort((a, b) => (engine._page(a).lastRevisedAt ?? '').localeCompare(engine._page(b).lastRevisedAt ?? '') || engine.getForgettingRisk(b, at).riskRatio - engine.getForgettingRisk(a, at).riskRatio || a.localeCompare(b));
    const lastMaintenanceAt = engine.state.maintenance[juzId] ?? engine.state.initializedAt;
    const lastRevisedAt = pageIds.map(id => engine._page(id).lastRevisedAt ?? engine._page(id).enrolledAt).sort()[0] ?? at;
    const risk = pageIds.map(id => engine.getForgettingRisk(id, at)).sort((a, b) => b.riskRatio - a.riskRatio)[0];
    return { juzId, pageIds, fractionOfJuz: pageIds.reduce((sum, id) => sum + engine._pageFraction(id), 0) / all.length, lastMaintenanceAt, lastRevisedAt, firstReview: pageIds.every(id => !engine._page(id).lastActiveRecallAt), risk };
  }).filter(j => j.pageIds.length).sort((a, b) => a.lastMaintenanceAt.localeCompare(b.lastMaintenanceAt) || a.lastRevisedAt.localeCompare(b.lastRevisedAt) || b.risk.riskRatio - a.risk.riskRatio || a.juzId.localeCompare(b.juzId));
  let maintained = 0;
  for (const item of maintenance) {
    if (maintained + 1e-9 >= config.maintenance.targetJuzPerDay) break;
    const juzPageCount = engine.metadata.pages.filter(p => p.juzId === item.juzId).length;
    const pageIds = []; let selectedFraction = 0, selectedMinutes = 0;
    const availableMinutes = plan.remainingCapacityMinutes - plan.totalEstimatedDurationMinutes;
    for (const id of item.pageIds) {
      const fraction = engine._pageFraction(id) / juzPageCount;
      if (maintained + selectedFraction + fraction > config.maintenance.targetJuzPerDay + 1e-9) break;
      const minutes = engine._pageMinutes(id) + activityFor(engine, [id], day, at).randomAccessTests.length * config.durations.randomStartExtraMinutes;
      if (maintenanceHalves.size && selectedMinutes + minutes > availableMinutes + 1e-9) continue;
      pageIds.push(id); selectedFraction += fraction;
      selectedMinutes += minutes;
    }
    if (!pageIds.length && availableMinutes < Math.min(...item.pageIds.map(id => engine._pageMinutes(id)))) {
      add('maintenance', { ...item, kind: 'maintenance', estimatedMinutes: item.pageIds.reduce((sum, id) => sum + engine._pageMinutes(id), 0) });
      continue;
    }
    if (!pageIds.length) continue;
    const prescription = activityFor(engine, pageIds, day, at);
    if (add('maintenance', { ...item, pageIds, passage: engine._passage(pageIds), fractionOfJuz: rounded(selectedFraction), kind: 'maintenance', reason: 'fair_rotation_of_strong_material', ...prescription, estimatedMinutes: pageIds.reduce((sum, id) => sum + engine._pageMinutes(id), 0) + prescription.randomAccessTests.length * config.durations.randomStartExtraMinutes })) maintained += selectedFraction;
  }

  // Keep a regular review alongside strengthening, even before developing material becomes due.
  // Mandatory checks keep their gaps; already selected/completed pages cannot be assigned twice.
  const plannedReviewMinutes = [...plan.dueReviews, ...plan.maintenance].reduce((sum, item) => sum + item.estimatedMinutes, 0);
  let dailyBudget = Math.max(0, Math.min(config.dailyReview.targetMinutes - completedReviewMinutes - plannedReviewMinutes, plan.remainingCapacityMinutes - plan.totalEstimatedDurationMinutes));
  const candidates = engine._knownPages().filter(meta => !selected.has(meta.id) && !completed.has(meta.id) && !allDue.has(meta.id) && !candidate?.pageIds.includes(meta.id) && !engine._cycleForPage(meta.id) && !engine._retentionForPage(meta.id)).map((meta, order) => ({ meta, order, page: engine._page(meta.id), risk: engine.getForgettingRisk(meta.id, at) }));
  candidates.sort((a, b) => (a.page.lastActiveRecallAt ?? '').localeCompare(b.page.lastActiveRecallAt ?? '') || a.page.enrolledAt.localeCompare(b.page.enrolledAt) || b.risk.priority - a.risk.priority || a.page.nextReviewAt.localeCompare(b.page.nextReviewAt) || a.order - b.order);
  for (const { meta, page, risk } of candidates) {
    if (dailyBudget <= 0) break;
    const prescription = activityFor(engine, [meta.id], day, at);
    const estimatedMinutes = rounded(engine._pageMinutes(meta.id) + prescription.randomAccessTests.length * config.durations.randomStartExtraMinutes);
    if (estimatedMinutes > dailyBudget + 1e-9) continue;
    if (add('dailyReviews', { kind: 'daily_review', pageId: meta.id, pageIds: [meta.id], halfJuzId: meta.halfJuzId, juzId: meta.juzId, passage: engine._passage([meta.id]), ayahIds: [...page.memorizedAyahIds], risk, nextReviewAt: page.nextReviewAt, reason: page.lastActiveRecallAt ? 'daily_rotation' : 'initial_verification', ...prescription, estimatedMinutes })) dailyBudget = rounded(dailyBudget - estimatedMinutes);
  }
  return plan;
}
