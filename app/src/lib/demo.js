// "Explore with sample data": replays ~4 weeks of plausible revision through the real engine,
// following its own daily plans. Only the user's *history* is simulated — never Qur'anic text.
import { createEngine, addWordMarks, setSessionMeta, getState, mutate } from './store.js';
import { juzNum, halfLabel, hizbNum, pageNum, pagesLabel } from './quran.js';
import { contextOf } from './session.js';

function rng(seed) {
  return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function seedDemo() {
  const DAYS = 26, rand = rng(1447);
  const pick = arr => arr[Math.floor(rand() * arr.length)];
  const localAt = (offsetDays, h, m) => { const d = new Date(); d.setDate(d.getDate() - offsetDays); d.setHours(h, m, 0, 0); return d; };
  const engine = createEngine({ memorized: { juzIds: ['j27', 'j28', 'j29', 'j30'], surahs: [18] }, initialStrength: 'medium', capacity: 60, initializedAt: localAt(DAYS, 5, 0).toISOString() });
  // A few "sticky" ayat that keep tripping the reciter, so weak points emerge naturally.
  const hotspots = ['67:14', '56:66', '78:26', '75:22', '18:47', '89:18'];
  const marks = [];
  let n = 0;
  const id = () => `demo-${++n}`;
  const mistakesFor = (pageId, ayahIds, chance) => {
    const out = [];
    for (const a of ayahIds) if (hotspots.includes(a) && rand() < 0.65) out.push({ ayahId: a, type: pick(['wrong_word', 'hesitation', 'confused_with_similar_passage', 'omitted_text']) });
    if (rand() < chance) out.push({ ayahId: pick(ayahIds), type: pick(['hesitation', 'wrong_word', 'needed_prompting', null]) });
    return out.map(m => ({ ayahId: m.ayahId, ...(m.type ? { type: m.type } : {}) }));
  };
  const note = (sessionId, title, kind, subtitle, reviews, at) => {
    setSessionMeta(sessionId, { title, kind, subtitle });
    for (const r of reviews) for (const m of r.mistakes) if (m.ayahId) marks.push({ page: pageNum(r.pageId), ayahId: m.ayahId, pos: 1 + Math.floor(rand() * 3), type: m.type ?? null, sessionId, date: at.slice(0, 10) });
  };

  for (let day = DAYS - 1; day >= 1; day--) {
    if (rand() < 0.1) continue; // the occasional missed day
    let t = localAt(day, 5, 40 + Math.floor(rand() * 30)).getTime();
    const at = () => new Date(t).toISOString();
    const known = id => engine.state.pages[id].memorizedAyahIds;
    const plan = engine.generateDailyPlan(at(), 60);
    const spend = mins => { t += Math.round(mins * (0.85 + rand() * 0.4) * 60000); return Math.round(mins * 10) / 10; };
    try {
      for (const item of plan.strengthen) {
        const stage = item.stage, sessionId = id();
        const pass = p => ({ kind: 'pass', reviews: item.pageIds.map(pid => {
          const mistakes = p === 1 ? mistakesFor(pid, known(pid), 0.18) : [];
          const accuracy = mistakes.length ? 'good' : rand() < 0.3 ? 'perfect' : 'good';
          const fluency = stage === 3 || p === 2 ? (rand() < 0.88 ? 'automatic' : 'mostly_fluent') : rand() < 0.2 ? 'hesitant' : 'mostly_fluent';
          return { pageId: pid, accuracy, fluency: stage === 2 && p === 1 && fluency === 'hesitant' ? 'mostly_fluent' : fluency, mistakes };
        }) });
        const first = pass(1), steps = [first];
        const repairs = first.reviews.flatMap(r => [...new Set(r.mistakes.map(m => m.ayahId))].map(a => ({ pageId: r.pageId, scope: 'ayah', ayahIds: contextOf(pageNum(r.pageId), a), accuracy: 'good', fluency: 'mostly_fluent', mistakes: [] })));
        if (repairs.length) steps.push({ kind: 'targeted', reviews: repairs });
        steps.push(pass(2));
        engine.recordStrengtheningSession({ sessionId, occurredAt: at(), halfJuzId: item.halfJuzId, actualDurationMinutes: spend(item.estimatedMinutes), steps });
        note(sessionId, halfLabel(hizbNum(item.halfJuzId)), 'strengthen', pagesLabel(item.pageIds.map(pageNum)), first.reviews, at());
      }
      const spaced = plan.dueReviews.filter(d => d.kind !== 'early_retention');
      for (const item of plan.dueReviews.filter(d => d.kind === 'early_retention')) {
        const sessionId = id();
        const pages = item.pageIds.map(pid => ({ pageId: pid, accuracy: rand() < 0.9 ? 'good' : 'perfect', fluency: rand() < 0.6 ? 'automatic' : 'mostly_fluent', mistakes: [] }));
        engine.recordRevision({ sessionId, occurredAt: at(), activity: 'tested', purpose: 'early_retention', actualDurationMinutes: spend(item.estimatedMinutes), pages });
        note(sessionId, halfLabel(hizbNum(item.halfJuzId)), 'retention', pagesLabel(item.pageIds.map(pageNum)), pages, at());
      }
      if (spaced.length) {
        const sessionId = id();
        const pages = spaced.map(item => {
          const mistakes = mistakesFor(item.pageId, known(item.pageId), 0.12);
          return { pageId: item.pageId, accuracy: rand() < 0.07 ? 'difficult' : mistakes.length || rand() < 0.5 ? 'good' : 'perfect', fluency: rand() < 0.2 ? 'hesitant' : rand() < 0.6 ? 'mostly_fluent' : 'automatic', mistakes };
        });
        engine.recordRevision({ sessionId, occurredAt: at(), activity: 'memory', purpose: 'ordinary', actualDurationMinutes: spend(spaced.reduce((s, i) => s + i.estimatedMinutes, 0)), pages });
        note(sessionId, `Juz ${juzNum(spaced[0].juzId)}`, 'review', pagesLabel(spaced.map(i => pageNum(i.pageId))), pages, at());
      }
      if (plan.targetedWeaknesses.length && rand() < 0.8) {
        const sessionId = id();
        const pages = plan.targetedWeaknesses.map(item => {
          const pid = item.pageIds.find(p => known(p).length);
          const clean = rand() < (hotspots.includes(item.ayahId) ? 0.45 : 0.85);
          return item.ayahId
            ? { pageId: pid, scope: 'ayah', ayahIds: contextOf(pageNum(pid), item.ayahId), accuracy: 'good', fluency: clean ? 'mostly_fluent' : 'hesitant', mistakes: clean ? [] : [{ ayahId: item.ayahId, type: 'hesitation' }] }
            : { pageId: pid, accuracy: clean ? 'good' : 'difficult', fluency: 'mostly_fluent', mistakes: [] };
        });
        engine.recordRevision({ sessionId, occurredAt: at(), activity: 'memory', purpose: 'targeted', actualDurationMinutes: spend(plan.targetedWeaknesses.reduce((s, i) => s + i.estimatedMinutes, 0)), pages });
        note(sessionId, `${pages.length} weak point${pages.length === 1 ? '' : 's'}`, 'targeted', '', pages, at());
      }
      for (const item of plan.maintenance) {
        if (rand() < 0.15) continue;
        const sessionId = id();
        const pages = item.pageIds.map(pid => {
          const mistakes = mistakesFor(pid, known(pid), 0.06);
          return { pageId: pid, accuracy: mistakes.length ? 'good' : rand() < 0.45 ? 'perfect' : 'good', fluency: rand() < 0.65 ? 'automatic' : 'mostly_fluent', mistakes };
        });
        engine.recordRevision({ sessionId, occurredAt: at(), activity: 'memory', purpose: 'maintenance', actualDurationMinutes: spend(item.estimatedMinutes), pages });
        note(sessionId, `Juz ${juzNum(item.juzId)}`, 'maintenance', pagesLabel(item.pageIds.map(pageNum)), pages, at());
      }
    } catch (error) {
      console.warn('Sample day skipped:', error.message);
    }
  }
  addWordMarks(marks);
  mutate(() => {});
  return getState().engine;
}
