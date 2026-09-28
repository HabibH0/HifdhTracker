import { calendarDay, addDays } from '@engine/time.js';
import { derived, getState, nowIso, timeZone, today } from './store.js';
import { PAGES, pageId, hizbId, juzId, HIZB_PAGES, JUZ_PAGES, pageOfAyah, ayahLabel } from './quran.js';

export const GROUPS = [
  { id: 'strong', label: 'Strong', color: 'var(--st-strong)' },
  { id: 'recent', label: 'Recently strengthened', color: 'var(--st-recent)' },
  { id: 'developing', label: 'Developing', color: 'var(--st-dev)' },
  { id: 'weak', label: 'Weak', color: 'var(--st-weak)' },
  { id: 'relearning', label: 'Relearning', color: 'var(--st-relearn)' },
];
export const NONE = { id: 'none', label: 'Not memorized', color: 'var(--st-none)' };
export const groupInfo = id => GROUPS.find(g => g.id === id) ?? NONE;
const RANK = { relearning: 0, weak: 1, developing: 2, recent: 3, strong: 4 };

export function groupOf(state) {
  if (state === 'strong' || state === 'very_strong') return 'strong';
  if (state === 'recently_strengthened') return 'recent';
  if (state === 'weak' || state === 'very_weak') return 'weak';
  if (state === 'relearning') return 'relearning';
  if (state === 'developing') return 'developing';
  return 'none';
}

/** Per page: { group, state, stability, coverage } — index = page - 1 */
export function pageStrength() {
  return derived('pages', engine => PAGES.map(p => {
    const s = engine.state.pages[pageId(p.p)];
    return { n: p.p, group: groupOf(s.state), state: s.state, stability: s.stabilityDays, coverage: s.coverage, next: s.nextReviewAt, last: s.lastActiveRecallAt };
  }));
}

export function halfStrength() {
  return derived('halves', engine => {
    const at = nowIso();
    return HIZB_PAGES.map((pages, i) => {
      const id = hizbId(i + 1);
      const h = engine.getHalfJuzState(id, at);
      const known = pages.filter(n => engine.state.pages[pageId(n)].memorizedAyahIds.length);
      const risks = known.map(n => engine.getForgettingRisk(pageId(n), at));
      return {
        hizb: i + 1, pages, known, group: groupOf(h.state), state: h.state, coverage: h.coverage,
        maxRisk: risks.length ? Math.max(...risks.map(r => r.riskRatio)) : 0,
        overdue: risks.filter(r => r.riskRatio > 1.1).length, weakest: h.weakestPages?.slice(0, 3) ?? [],
      };
    });
  });
}

export function juzStrength() {
  return derived('juz', () => {
    const halves = halfStrength();
    return JUZ_PAGES.map((pages, i) => {
      const hs = halves.slice(i * 2, i * 2 + 2).filter(h => h.known.length);
      const known = hs.reduce((n, h) => n + h.known.length, 0);
      const group = hs.length ? hs.map(h => h.group).sort((a, b) => (RANK[a] ?? 9) - (RANK[b] ?? 9))[0] : 'none';
      return { juz: i + 1, pages, known, fraction: known / pages.length, group, halves: halves.slice(i * 2, i * 2 + 2) };
    });
  });
}

export function groupCounts() {
  const counts = Object.fromEntries(GROUPS.map(g => [g.id, 0]));
  for (const p of pageStrength()) if (p.group !== 'none') counts[p.group]++;
  return counts;
}

export function atRisk(limit = 4) {
  return halfStrength()
    .filter(h => h.known.length && (h.maxRisk >= 0.85 || h.group === 'weak' || h.group === 'relearning'))
    .sort((a, b) => (RANK[a.group] ?? 9) - (RANK[b.group] ?? 9) || b.maxRisk - a.maxRisk)
    .slice(0, limit);
}

// ---- History
export function sessions() {
  return derived('sessions', engine => engine.getRevisionHistory().sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)));
}

const KIND = { strengthening: 'strengthen', early_retention: 'retention', ordinary: 'review', targeted: 'targeted', maintenance: 'maintenance' };
export function sessionKind(s) { return getState().sessionMeta[s.sessionId]?.kind ?? KIND[s.purpose] ?? 'review'; }
export function isSpacedSuccess(r) {
  return r.firstActiveRecallOfDay && r.elapsedDays >= 1 && r.recallQuality >= 0.72 && r.accuracy !== 'failed';
}

export function rangeStart(range) {
  const t = today();
  if (range === 'all') return '0000-00-00';
  return addDays(t, -({ '7d': 6, '30d': 29, '90d': 89 }[range]));
}

export function summary(range) {
  return derived(`summary:${range}`, () => {
    const tz = timeZone(), start = rangeStart(range);
    const list = sessions().filter(s => calendarDay(s.occurredAt, tz) >= start);
    const minutes = list.reduce((n, s) => n + (s.actualDurationMinutes ?? 0), 0);
    const spaced = list.reduce((n, s) => n + s.reviews.filter(isSpacedSuccess).length, 0);
    const pagesRevised = list.reduce((n, s) => n + s.reviews.filter(r => r.scope !== 'ayah').length, 0);
    const mistakes = list.reduce((n, s) => n + s.mistakes.length, 0);
    const days = new Set(list.map(s => calendarDay(s.occurredAt, tz))).size;
    return { sessions: list.length, minutes: Math.round(minutes), spaced, pagesRevised, mistakes, days };
  });
}

/** Buckets for charts: daily for ≤30 days, weekly beyond. */
export function series(range) {
  return derived(`series:${range}`, () => {
    const tz = timeZone(), t = today();
    const all = sessions();
    const first = all.length ? calendarDay(all.at(-1).occurredAt, tz) : t;
    const start = range === 'all' ? first : rangeStart(range);
    const weekly = range === '90d' || range === 'all';
    const step = weekly ? 7 : 1;
    const buckets = [];
    for (let d = start; d <= t; d = addDays(d, step)) buckets.push({ start: d, end: addDays(d, step - 1), minutes: 0, mistakes: 0, pages: 0 });
    for (const s of all) {
      const day = calendarDay(s.occurredAt, tz);
      const b = buckets.find(x => day >= x.start && day <= x.end);
      if (!b) continue;
      b.minutes += s.actualDurationMinutes ?? 0;
      b.mistakes += s.mistakes.length;
      b.pages += s.reviews.filter(r => r.scope !== 'ayah').length;
    }
    for (const b of buckets) { b.minutes = Math.round(b.minutes); b.rate = b.pages ? (b.mistakes / b.pages) * 10 : null; }
    return { buckets, weekly };
  });
}

export function troublesome() {
  return derived('trouble', engine => engine.getTroublesomeAyat(nowIso(), { includeResolved: true }));
}

/** Weak points: repeated-mistake ayat plus recent single mistakes still being checked. */
export function weakPoints() {
  return derived('weak', engine => {
    const at = nowIso(), tz = timeZone(), t = today();
    const window = addDays(t, -30);
    const active = engine.getTroublesomeAyat(at);
    const byAyah = new Map();
    const marks = getState().wordMarks;
    const recentMistakes = engine.state.mistakes.filter(m => m.ayahId && m.date >= window);
    const touch = (ayahId, patch) => byAyah.set(ayahId, { ...(byAyah.get(ayahId) ?? {}), ...patch });
    for (const a of active) touch(a.ayahId, { ayahId: a.ayahId, kind: 'recurring', cleanSessions: a.cleanSessions, why: `Mistakes in ${a.mistakeSessionIds.length} sessions${a.recentMistakeSessions >= 3 ? ' within 30 days' : ', including back-to-back'}` });
    for (const p of Object.values(engine.state.pages)) {
      if (!p.targetedRepair) continue;
      for (const ayahId of p.repairAyahIds) if (!byAyah.has(ayahId)) touch(ayahId, { ayahId, kind: 'recent', why: 'Recent mistake — being checked' });
    }
    return [...byAyah.values()].map(item => {
      const ms = recentMistakes.filter(m => m.ayahId === item.ayahId);
      const last = engine.state.mistakes.filter(m => m.ayahId === item.ayahId).map(m => m.occurredAt).sort().at(-1) ?? null;
      const words = new Map();
      for (const m of marks) if (m.ayahId === item.ayahId && m.pos) words.set(m.pos, [...(words.get(m.pos) ?? []), m]);
      return {
        ...item, page: pageOfAyah(item.ayahId), label: ayahLabel(item.ayahId),
        count: ms.length, sessions: new Set(ms.map(m => m.sessionId)).size, last,
        types: [...new Set(ms.map(m => m.type).filter(Boolean))],
        words: [...words].map(([pos, list]) => ({ pos, count: list.length })).sort((a, b) => b.count - a.count),
      };
    });
  });
}

/** Mistake markers for a page (reader + logger): word dots and ayah rings. */
export function pageMarks(n) {
  const { wordMarks } = getState();
  return derived(`marks:${n}:${wordMarks.length}`, engine => {
    const since = addDays(today(), -90);
    const words = new Map(), ayahs = new Map();
    const pageAyahs = new Set(PAGES[n - 1].ayahs);
    for (const m of wordMarks) if (m.page === n && m.pos && m.date >= since) words.set(`${m.ayahId}:${m.pos}`, (words.get(`${m.ayahId}:${m.pos}`) ?? 0) + 1);
    for (const m of engine.state.mistakes) if (m.ayahId && pageAyahs.has(m.ayahId) && m.date >= since) ayahs.set(m.ayahId, (ayahs.get(m.ayahId) ?? 0) + 1);
    return { words, ayahs };
  });
}

export { juzId };
