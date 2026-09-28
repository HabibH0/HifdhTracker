import { calendarDay } from '@engine/time.js';
import { capacityToday, dayTasks, derived, nowIso, timeZone, today } from './store.js';
import { halfLabel, hizbNum, juzNum, pageNum, pagesLabel, compressPages, rangeLabel, ayahLabel, pageOfAyah } from './quran.js';

const countPages = nums => `${nums.length} page${nums.length === 1 ? '' : 's'} · ${compressPages(nums)}`;

export const TASK_TYPES = {
  strengthen: { label: 'Strengthen', tone: 'green', icon: 'layers' },
  retention: { label: 'Due review', tone: 'blue', icon: 'refresh' },
  review: { label: 'Due review', tone: 'blue', icon: 'refresh' },
  targeted: { label: 'Targeted weaknesses', tone: 'amber', icon: 'target' },
  maintenance: { label: 'Maintenance', tone: 'gold', icon: 'leaf' },
};

const mins = n => Math.max(1, Math.round(n));
// Calendar days, not 24-hour spans: something revised at 6am yesterday was "yesterday".
function lastRevised(iso) {
  const diff = Math.round((Date.parse(today()) - Date.parse(calendarDay(iso, timeZone()))) / 86400000);
  return diff <= 0 ? 'Last revised today' : diff === 1 ? 'Last revised yesterday' : `Last revised ${diff} days ago`;
}
const agoIso = days => new Date(Date.parse(nowIso()) - days * 86400000).toISOString();

function pageInfo(engine, passage, randomTests = []) {
  const starts = new Map(randomTests.map(t => [t.pageId, t.startAyahId]));
  return passage.pages.map(p => ({ n: pageNum(p.pageId), ayahIds: p.ayahIds, coverage: p.coverage, startAyahId: starts.get(p.pageId) ?? null }));
}

function strengthenTask(engine, item) {
  const hizb = hizbNum(item.halfJuzId), nums = item.pageIds.map(pageNum);
  const partial = item.coverage === 'partial';
  return {
    key: `strengthen:${item.halfJuzId}`, kind: 'strengthen',
    title: halfLabel(hizb), subtitle: pagesLabel(nums) + (partial ? ' · memorized portion' : ''),
    status: item.requiresStart ? 'New section · Day 1 of 3' : `Day ${item.stage} of 3`,
    minutes: mins(item.estimatedMinutes), stage: item.stage, requiresStart: item.requiresStart,
    halfJuzId: item.halfJuzId, passes: item.requiredPasses, purpose: 'strengthening', activity: 'memory',
    pages: pageInfo(engine, item.passage), range: rangeLabel(item.passage.ayahIds),
  };
}

function retentionTask(engine, item) {
  const nums = item.pageIds.map(pageNum);
  return {
    key: `retention:${item.halfJuzId}`, kind: 'retention',
    title: halfLabel(hizbNum(item.halfJuzId)), subtitle: pagesLabel(nums),
    status: `Early retention review · check ${item.checkNumber} of 3`,
    minutes: mins(item.estimatedMinutes), passes: 1, purpose: 'early_retention', activity: 'tested',
    pages: pageInfo(engine, item.passage), range: rangeLabel(item.passage.ayahIds), checkNumber: item.checkNumber,
  };
}

function reviewTask(engine, due) {
  // One sitting, recited in Mushaf order; the engine's priority decided what is included.
  const items = [...due].sort((a, b) => pageNum(a.pageId) - pageNum(b.pageId));
  const pageIds = items.map(i => i.pageId), nums = pageIds.map(pageNum);
  const juzList = [...new Set(items.map(i => juzNum(i.juzId)))];
  const passage = { pages: items.flatMap(i => i.passage.pages) };
  const recall = Math.max(...items.map(i => i.risk.daysSinceLastActiveRecall));
  const provisional = items.every(i => i.risk.provisional);
  const overdue = items.some(i => i.reason === 'high_risk' || i.reason === 'overdue');
  return {
    key: 'review', kind: 'review',
    title: `Juz ${compressPages(juzList)}`, subtitle: nums.length > 1 ? countPages(nums) : pagesLabel(nums),
    status: provisional ? 'First review since you added it' : overdue ? `Overdue · ${lastRevised(agoIso(recall)).toLowerCase()}` : lastRevised(agoIso(recall)),
    minutes: mins(items.reduce((s, i) => s + i.estimatedMinutes, 0)), passes: 1, purpose: 'ordinary', activity: 'memory',
    pages: pageInfo(engine, passage, items.flatMap(i => i.randomAccessTests ?? [])),
    range: rangeLabel(items.flatMap(i => i.ayahIds)), overdue,
  };
}

function targetedTask(engine, items) {
  const known = engine.state.pages;
  const targets = items.map((item, index) => {
    const pageId = item.pageIds.find(id => known[id].memorizedAyahIds.length) ?? item.pageIds[0];
    const page = known[pageId];
    let ayahIds;
    if (item.ayahId) {
      // Context stays on this page and within memorized ayat, so it forms a valid ayah-scope attempt.
      const onPage = page.memorizedAyahIds, i = onPage.indexOf(item.ayahId);
      ayahIds = onPage.slice(Math.max(0, i - 1), i + 2);
    }
    return {
      id: `${item.kind}:${item.ayahId ?? pageId}:${index}`, kind: item.kind, pageId, page: pageNum(pageId),
      ayahId: item.ayahId ?? null, ayahIds: ayahIds ?? null,
      label: item.ayahId ? ayahLabel(item.ayahId) : `Page ${pageNum(pageId)}`,
      context: item.ayahId ? rangeLabel(ayahIds) : rangeLabel(page.memorizedAyahIds),
      why: item.kind === 'troublesome_ayah' ? `Repeated mistakes · ${item.cleanSessionsRemaining} clean session${item.cleanSessionsRemaining === 1 ? '' : 's'} to clear` : item.kind === 'weak_page' ? 'Weak recall on the whole page' : 'Recent mistake to check',
      minutes: item.estimatedMinutes,
    };
  });
  const ayat = targets.filter(t => t.ayahId).length, pages = targets.length - ayat;
  const parts = [ayat && `${ayat} āyah${ayat === 1 ? '' : 's'}`.replace('āyahs', 'āyāt'), pages && `${pages} page${pages === 1 ? '' : 's'}`].filter(Boolean);
  const repeated = items.some(i => i.kind === 'troublesome_ayah');
  return {
    key: 'targeted', kind: 'targeted', title: parts.join(' · '),
    subtitle: [...new Set(targets.map(t => t.page))].length > 3 ? `${new Set(targets.map(t => t.page)).size} pages` : pagesLabel([...new Set(targets.map(t => t.page))]),
    status: repeated ? 'Recurring weak points' : 'Mistakes from recent revision',
    minutes: mins(items.reduce((s, i) => s + i.estimatedMinutes, 0)), purpose: 'targeted', activity: 'memory', targets,
    pages: [...new Set(targets.map(t => t.page))].map(n => ({ n })),
  };
}

function maintenanceTask(engine, items) {
  // The planner spreads about one juz of maintenance across the least-recently maintained juz;
  // the reciter experiences it as one sitting.
  const pageIds = items.flatMap(i => i.pageIds), nums = pageIds.map(pageNum);
  const oldest = items.map(i => i.lastRevisedAt).filter(Boolean).sort()[0];
  const juz = items.map(i => juzNum(i.juzId));
  const whole = items.length === 1 && items[0].fractionOfJuz >= 0.95;
  return {
    key: `maintenance:${items.map(i => i.juzId).join('+')}`, kind: 'maintenance',
    title: `Juz ${compressPages(juz)}`, subtitle: whole ? pagesLabel(nums) : countPages(nums),
    status: oldest ? lastRevised(oldest) : 'Keeping strong material fresh',
    minutes: mins(items.reduce((s, i) => s + i.estimatedMinutes, 0)), passes: 1, purpose: 'maintenance', activity: 'memory',
    fraction: items.reduce((s, i) => s + i.fractionOfJuz, 0),
    pages: pageInfo(engine, { pages: items.flatMap(i => i.passage.pages) }, items.flatMap(i => i.randomAccessTests ?? [])),
    range: rangeLabel(items.flatMap(i => i.passage.ayahIds)),
  };
}

/** Today = completed tasks (logged) + the engine's current view of what remains. */
export function todayPlan() {
  const capacity = capacityToday();
  return derived(`today:${capacity}:${dayTasks().length}`, engine => {
    const plan = engine.generateDailyPlan(nowIso(), capacity);
    const done = dayTasks();
    const pending = [];
    for (const item of plan.strengthen) pending.push(strengthenTask(engine, item));
    for (const item of plan.dueReviews) if (item.kind === 'early_retention') pending.push(retentionTask(engine, item));
    const spaced = plan.dueReviews.filter(i => i.kind !== 'early_retention');
    if (spaced.length) pending.push(reviewTask(engine, spaced));
    if (plan.targetedWeaknesses.length) pending.push(targetedTask(engine, plan.targetedWeaknesses));
    // The planner rotates to the next juz once one is maintained; one juz a day is the target.
    const maintained = done.filter(t => t.kind === 'maintenance').reduce((s, t) => s + (t.fraction ?? 1), 0);
    if (maintained < 0.95 && plan.maintenance.length) pending.push(maintenanceTask(engine, plan.maintenance));
    const doneKeys = new Set(done.map(t => t.key));
    for (const task of pending) if (doneKeys.has(task.key)) task.key += ':again';
    const deferred = plan.deferredItems.filter(d => d.reason !== 'later_calendar_day_required').map(d => ({
      kind: d.kind, safe: d.safeToPostpone, minutes: Math.round(d.estimatedMinutes),
      label: d.kind === 'strengthening' ? `Strengthen ${halfLabel(hizbNum(d.halfJuzId))}` : d.kind === 'maintenance' ? `Maintenance · Juz ${juzNum(d.juzId)}` : d.kind === 'early_retention' ? `Retention check · ${halfLabel(hizbNum(d.halfJuzId))}` : d.ayahId ? `Targeted · ${ayahLabel(d.ayahId)}` : `Review · page ${d.pageIds?.map(pageNum).join(', ')}`,
    }));
    const nextStage = plan.deferredItems.find(d => d.reason === 'later_calendar_day_required');
    const pendingMinutes = pending.reduce((s, t) => s + t.minutes, 0);
    return { date: plan.date, capacity, pending, done, deferred, nextStage, pendingMinutes, doneMinutes: done.reduce((s, t) => s + (t.actualMinutes ?? t.minutes), 0) };
  });
}

export function relativeDay(day) {
  const t = today();
  const diff = Math.round((Date.parse(day) - Date.parse(t)) / 86400000);
  if (diff <= 0) return 'today';
  if (diff === 1) return 'tomorrow';
  if (diff < 7) return `in ${diff} days`;
  if (diff < 14) return 'in about a week';
  if (diff < 45) return `in about ${Math.round(diff / 7)} weeks`;
  return `in about ${Math.round(diff / 30)} months`;
}

export { calendarDay, timeZone, pageOfAyah };
