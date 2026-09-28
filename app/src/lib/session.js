import { getState, mutate, nowIso, newId, saveActiveSession, clearActiveSession, logDayTask, addWordMarks, setSessionMeta, today } from './store.js';
import { pageId, rangeLabel } from './quran.js';
import { relativeDay } from './plan.js';

const good = a => a === 'good' || a === 'perfect';
export const MAX_TARGETED = 3; // engine default strengthening.maxTargetedRepetitions

export const ACCURACY = [
  { value: 'failed', label: 'Failed' },
  { value: 'difficult', label: 'Difficult' },
  { value: 'good', label: 'Good' },
  { value: 'perfect', label: 'Perfect' },
];
export const FLUENCY = [
  { value: 'hesitant', label: 'Hesitant' },
  { value: 'mostly_fluent', label: 'Mostly fluent' },
  { value: 'automatic', label: 'Automatic' },
];
export const MISTAKE_TYPES = [
  { value: 'hesitation', label: 'Hesitation' },
  { value: 'wrong_word', label: 'Wrong word' },
  { value: 'omitted_text', label: 'Omitted / forgot' },
  { value: 'needed_prompting', label: 'Prompt needed' },
  { value: 'lost_continuation', label: 'Lost continuation' },
  { value: 'confused_with_similar_passage', label: 'Similar passage' },
  { value: 'major_breakdown', label: 'Major breakdown' },
];
export const mistakeLabel = v => MISTAKE_TYPES.find(t => t.value === v)?.label ?? 'Mistake';

// ---- Timer (pausable; persisted inside the draft so closing the app keeps it)
export const elapsedMs = s => (s?.timer ? s.timer.acc + (s.timer.since ? Date.now() - s.timer.since : 0) : 0);
export const pauseTimer = s => (s.timer.since ? { ...s, timer: { acc: elapsedMs(s), since: null } } : s);
export const resumeTimer = s => (s.timer.since ? s : { ...s, timer: { acc: s.timer.acc, since: Date.now() } });

export function createSession(task) {
  return {
    id: newId('draft'), sessionId: newId('s'), date: today(), taskKey: task.key, kind: task.kind, task,
    phase: 'intro', passIndex: 0, pageIndex: 0, current: {}, steps: [], repair: null, targetedCounts: {},
    marks: [], ratings: null, attempts: [], timer: { acc: 0, since: null }, result: null,
  };
}

export function update(session, patch) {
  const next = typeof patch === 'function' ? patch(session) : { ...session, ...patch };
  saveActiveSession(next);
  return next;
}

export function begin(session) {
  return update(session, s => resumeTimer({ ...s, phase: s.kind === 'targeted' ? 'targeted' : 'pass', pageIndex: 0 }));
}

export function addMistake(session, page, { ayahId, pos, type }) {
  return update(session, s => ({
    ...s, current: { ...s.current, [page]: [...(s.current[page] ?? []), { id: newId('m'), ayahId: ayahId ?? null, pos: pos ?? null, type: type ?? null }] },
  }));
}
export function removeMistake(session, page, id) {
  return update(session, s => ({ ...s, current: { ...s.current, [page]: (s.current[page] ?? []).filter(m => m.id !== id) } }));
}

const memorizedOn = n => getState().engine.state.pages[pageId(n)].memorizedAyahIds;

/** Neighbouring memorized ayat on the same page: a valid ayah-scope repair attempt. */
export function contextOf(n, ayahId) {
  const known = memorizedOn(n), i = known.indexOf(ayahId);
  return i < 0 ? [ayahId] : known.slice(Math.max(0, i - 1), i + 2);
}

/** What must be repaired after a strengthening pass, mirroring the engine's stage rules. */
export function repairTargets(reviews, stage) {
  const targets = [];
  for (const r of reviews) {
    const n = +r.pageId.slice(1);
    const pageLevel = !good(r.accuracy) || (stage === 2 && r.fluency === 'hesitant') || r.mistakes.some(m => !m.ayahId);
    if (pageLevel) {
      targets.push({ id: `${n}:page`, page: n, ayahId: null, why: !good(r.accuracy) ? `Recall was ${r.accuracy}` : r.fluency === 'hesitant' && stage === 2 ? 'Hesitant recall' : 'Mistake on this page', fluency: r.fluency, attempts: 0, resolved: false });
      continue;
    }
    for (const ayahId of [...new Set(r.mistakes.map(m => m.ayahId))]) {
      const types = r.mistakes.filter(m => m.ayahId === ayahId).map(m => m.type).filter(Boolean);
      targets.push({ id: `${n}:${ayahId}`, page: n, ayahId, ayahIds: contextOf(n, ayahId), why: types.length ? types.map(t => mistakeLabel(t)).join(', ') : 'Mistake logged', fluency: r.fluency, attempts: 0, resolved: false });
    }
  }
  return targets;
}

/** Turn a pass rating (+ optional per-page overrides) into engine page reviews. */
export function passReviews(session, rating, randomAccess) {
  return session.task.pages.map(p => {
    const mistakes = session.current[p.n] ?? [];
    const own = rating.perPage?.[p.n] ?? {};
    let accuracy = own.accuracy ?? rating.accuracy;
    if (accuracy === 'perfect' && mistakes.length) accuracy = 'good'; // a pass with logged mistakes is not perfect
    const review = { pageId: pageId(p.n), accuracy, fluency: own.fluency ?? rating.fluency, mistakes: mistakes.map(m => ({ ayahId: m.ayahId, ...(m.type ? { type: m.type } : {}) })) };
    if (session.kind === 'retention') review.activity = 'tested';
    else if (p.startAyahId && randomAccess && session.kind !== 'strengthen') review.activity = 'random_start';
    return review;
  });
}

export function finishPass(session, rating) {
  const { settings } = getState();
  const reviews = passReviews(session, rating, settings.randomAccess);
  const marks = session.task.pages.flatMap(p => (session.current[p.n] ?? []).filter(m => m.ayahId).map(m => ({ page: p.n, ayahId: m.ayahId, pos: m.pos, type: m.type })));
  let s = { ...session, steps: [...session.steps, { kind: 'pass', reviews }], marks: [...session.marks, ...marks], lastPass: { reviews, mistakes: reviews.reduce((n, r) => n + r.mistakes.length, 0) }, ratings: null };
  if (session.kind === 'strengthen') {
    const targets = repairTargets(reviews, session.task.stage);
    if (targets.length) return update(s, { ...s, phase: 'repair', repair: { targets, beforePass: session.passIndex + 1 < session.task.passes } });
    if (session.passIndex + 1 < session.task.passes) return update(s, { ...s, phase: 'pass', passIndex: session.passIndex + 1, pageIndex: 0, current: {} });
  }
  return submit(s);
}

/** One targeted repetition during strengthening repair. */
export function repairAttempt(session, target, clean) {
  const count = session.targetedCounts[target.page] ?? 0;
  if (count >= MAX_TARGETED) return session;
  const fluency = clean ? (target.fluency === 'automatic' ? 'automatic' : 'mostly_fluent') : 'hesitant';
  const review = target.ayahId
    ? { pageId: pageId(target.page), scope: 'ayah', ayahIds: target.ayahIds, accuracy: 'good', fluency, mistakes: clean ? [] : [{ ayahId: target.ayahId }] }
    : { pageId: pageId(target.page), accuracy: clean ? 'good' : 'difficult', fluency, mistakes: [] };
  const steps = [...session.steps];
  if (steps.at(-1)?.kind === 'targeted') steps[steps.length - 1] = { kind: 'targeted', reviews: [...steps.at(-1).reviews, review] };
  else steps.push({ kind: 'targeted', reviews: [review] });
  const targets = session.repair.targets.map(t => (t.id === target.id ? { ...t, attempts: t.attempts + 1, resolved: clean } : t));
  return update(session, { ...session, steps, targetedCounts: { ...session.targetedCounts, [target.page]: count + 1 }, repair: { ...session.repair, targets } });
}

export function continueAfterRepair(session) {
  if (session.passIndex + 1 < session.task.passes) return update(session, { ...session, phase: 'pass', passIndex: session.passIndex + 1, pageIndex: 0, current: {}, repair: null });
  return submit(session);
}

/** Targeted-weakness practice: each attempt is a real observation in one session. */
export function targetedAttempt(session, target, clean, mistake) {
  const review = target.ayahId
    ? { pageId: target.pageId, scope: 'ayah', ayahIds: target.ayahIds, accuracy: 'good', fluency: clean ? 'mostly_fluent' : 'hesitant', mistakes: clean ? [] : [{ ayahId: mistake?.ayahId ?? target.ayahId, ...(mistake?.type ? { type: mistake.type } : {}) }] }
    : { pageId: target.pageId, accuracy: clean ? 'good' : 'difficult', fluency: clean ? 'mostly_fluent' : 'hesitant', mistakes: mistake?.ayahId ? [{ ayahId: mistake.ayahId, ...(mistake.type ? { type: mistake.type } : {}) }] : [] };
  const marks = !clean && mistake?.ayahId ? [{ page: target.page, ayahId: mistake.ayahId, pos: mistake.pos ?? null, type: mistake.type ?? null }] : [];
  return update(session, { ...session, attempts: [...session.attempts, { targetId: target.id, clean, review }], marks: [...session.marks, ...marks] });
}

function durationMinutes(session) {
  return Math.round(elapsedMs(session) / 6000) / 10;
}

export function submit(session) {
  const s = pauseTimer(session);
  const { engine } = getState();
  const minutes = durationMinutes(s);
  const occurredAt = nowIso();
  const task = s.task;
  let result;
  if (s.kind === 'strengthen') {
    const recorded = mutate(e => e.recordStrengtheningSession({ sessionId: s.sessionId, occurredAt, halfJuzId: task.halfJuzId, actualDurationMinutes: minutes, steps: s.steps }));
    result = { strengthening: recorded.strengtheningResult };
  } else if (s.kind === 'targeted') {
    if (!s.attempts.length) throw new Error('Nothing recorded yet');
    mutate(e => e.recordRevision({ sessionId: s.sessionId, occurredAt, activity: 'memory', purpose: 'targeted', actualDurationMinutes: minutes, pages: s.attempts.map(a => a.review) }));
    const cleaned = new Set(s.attempts.filter(a => a.clean).map(a => a.targetId));
    const stillWeak = new Set(s.attempts.filter(a => !a.clean && !cleaned.has(a.targetId)).map(a => a.targetId));
    result = { cleaned: cleaned.size, stillWeak: stillWeak.size };
  } else {
    const pages = s.steps.at(-1).reviews;
    mutate(e => e.recordRevision({ sessionId: s.sessionId, occurredAt, activity: s.kind === 'retention' ? 'tested' : 'memory', purpose: task.purpose, actualDurationMinutes: minutes, pages }));
    result = {};
  }
  const mistakes = s.kind === 'targeted' ? s.attempts.filter(a => !a.clean).length : s.steps.filter(st => st.kind === 'pass').reduce((n, st) => n + st.reviews.reduce((m, r) => m + r.mistakes.length, 0), 0);
  result = { ...result, ...outcome(s, engine), minutes, mistakes, pages: task.pages.length };
  addWordMarks(s.marks.map(m => ({ ...m, sessionId: s.sessionId, date: today() })));
  setSessionMeta(s.sessionId, { title: task.title, kind: s.kind, subtitle: task.subtitle });
  logDayTask({ key: task.key, kind: s.kind, title: task.title, subtitle: task.subtitle, minutes: task.minutes, actualMinutes: Math.max(1, Math.round(minutes)), sessionId: s.sessionId, mistakes, fraction: task.fraction, headline: result.headline });
  return update(s, { ...s, phase: 'complete', result });
}

function outcome(s, engine) {
  const task = s.task;
  if (s.kind === 'strengthen') {
    const r = engine.state.sessions[s.sessionId].strengtheningResult;
    if (r.passed && r.stage < 3) return { passed: true, headline: `Day ${r.stage} complete`, next: `Day ${r.stage + 1} of this section is ${relativeDay(nextDay())}.` };
    if (r.passed) return { passed: true, headline: 'Section strengthened', next: 'Early retention checks begin in 2 days, then 4, then 7.' };
    return { passed: false, headline: `Day ${r.stage} needs another go`, reasons: r.reasons.map(reasonText), next: 'You can repeat it whenever you’re ready — progress so far is kept.' };
  }
  if (s.kind === 'targeted') return { passed: true, headline: 'Practice recorded', next: 'Weak points clear after three clean sessions.' };
  const pages = task.pages.map(p => engine.state.pages[pageId(p.n)]);
  const cycleNow = pages.some(p => p.state === 'relearning');
  if (cycleNow) return { passed: false, headline: 'Returned to strengthening', next: 'This section slipped, so it will be rebuilt over three days starting with your next plan.' };
  if (s.kind === 'retention') {
    const ret = engine.getStrengtheningState(engine.pageMetadata.get(pageId(task.pages[0].n)).halfJuzId).retention.at(-1);
    const last = ret?.history.at(-1);
    if (ret?.status === 'complete') return { passed: true, headline: 'Retention confirmed', next: 'All three early checks passed. It now joins regular spaced review.' };
    if (last && !last.passed) return { passed: false, headline: 'Check not passed', next: 'It will be checked again tomorrow.' };
    return { passed: true, headline: `Check ${ret?.successes ?? task.checkNumber} of 3 passed`, next: ret ? `Next check ${relativeDay(ret.nextReviewAt)}.` : '' };
  }
  const next = pages.map(p => p.nextReviewAt).sort()[0];
  const repair = pages.some(p => p.targetedRepair);
  return { passed: true, headline: s.kind === 'maintenance' ? 'Maintenance complete' : 'Review complete', next: `${repair ? 'Mistakes go to targeted practice. ' : ''}Next review ${relativeDay(next)}.` };
}

function nextDay() {
  const d = new Date(`${today()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function reasonText(r) {
  return {
    complete_passes_required: 'Both passes need to cover every page.',
    targeted_repetition_required_before_second_pass: 'Mistakes from the first pass need repair before the second.',
    reliable_recall_required: 'Every page needs Good or Perfect recall.',
    unresolved_mistakes_or_hesitation: 'Some mistakes weren’t repaired cleanly.',
    targeted_repetition_required: 'Every problem needs a clean targeted repetition.',
    insufficient_fluency: 'At least 70% of pages need to be fluent.',
    insufficient_automatic_recall: 'Day 3 needs 80% of pages automatic, the rest fluent.',
  }[r] ?? r;
}

export function discard() { clearActiveSession(); }

export const pageRange = p => (p.ayahIds?.length ? rangeLabel(p.ayahIds) : '');
