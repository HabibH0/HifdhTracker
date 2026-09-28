import { RevisionEngine } from '../src/index.js';

// Deliberately synthetic: tests must not masquerade as authoritative Qur'an metadata.
export function metadata({ halves = 4, pagesPerHalf = 5 } = {}) {
  const ayat = [], pages = [];
  for (let h = 1; h <= halves; h++) for (let p = 1; p <= pagesPerHalf; p++) {
    const index = (h - 1) * pagesPerHalf + p;
    const ayahIds = [1, 2].map(offset => `ayah-${index * 2 + offset}`);
    ayat.push(...ayahIds.map((id, i) => ({ id, surah: 1, ayah: index * 2 + i + 1 })));
    pages.push({ id: `page-${h}-${p}`, halfJuzId: `half-${h}`, juzId: `juz-${Math.ceil(h / 2)}`, ayahIds });
  }
  return { layoutId: 'synthetic-test-layout', ayat, pages };
}
export const timestamp = (day, hour = '12:00') => `2026-01-${String(day).padStart(2, '0')}T${hour}:00Z`;
export function makeEngine(options = {}) {
  const layout = options.metadata ?? metadata();
  return new RevisionEngine({ metadata: layout, initializedAt: timestamp(1), memorized: { pageIds: (layout.pages ?? []).map(p => p.id) }, ...options });
}
let nextId = 0;
export function review(engine, { day = 2, at, pageIds = ['page-1-1'], accuracy = 'perfect', fluency = 'automatic', activity = 'memory', purpose = 'ordinary', pages, ...other } = {}) {
  return engine.recordRevision({ sessionId: `session-${++nextId}`, occurredAt: at ?? timestamp(day), activity, purpose, pages: pages ?? pageIds.map(pageId => ({ pageId, accuracy, fluency })), ...other });
}
export function strengthen(engine, day, { accuracy = 'perfect', fluency = 'automatic', pageIds = engine.getStrengtheningState().activeCycle?.pageIds ?? engine._halfPages('half-1'), steps, ...other } = {}) {
  const pass = () => ({ kind: 'pass', reviews: pageIds.map(pageId => ({ pageId, accuracy, fluency })) });
  return engine.recordStrengtheningSession({ sessionId: `session-${++nextId}`, occurredAt: timestamp(day), halfJuzId: 'half-1', steps: steps ?? [pass(), pass()], ...other });
}
export function graduate(engine) {
  engine.startStrengtheningCycle({ halfJuzId: 'half-1', occurredAt: timestamp(1) });
  strengthen(engine, 1); strengthen(engine, 2); strengthen(engine, 3);
  return engine._halfPages('half-1');
}
