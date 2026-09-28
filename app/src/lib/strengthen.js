// Choosing which half-juz to strengthen. The engine allows one active cycle and picks the
// weakest section itself; this lets the reciter start a specific one now, or queue it to start
// the day after the current cycle graduates (ahead of the engine's own choice).
import { calendarDay } from '@engine/time.js';
import { getState, mutate, nowIso, setSettings, timeZone, today } from './store.js';

export const activeCycle = engine => engine?.state.cycles.find(c => c.status === 'active') ?? null;
export const strengthenQueue = () => getState().settings.strengthenQueue ?? [];

const hasMaterial = (engine, halfJuzId) =>
  engine.metadata.pages.some(p => p.halfJuzId === halfJuzId && engine.state.pages[p.id].memorizedAyahIds.length);

export function strengthenNow(halfJuzId) {
  mutate(e => e.startStrengtheningCycle({ halfJuzId, occurredAt: nowIso() }));
  unqueueStrengthen(halfJuzId);
}

export function queueStrengthen(halfJuzId) {
  const queue = strengthenQueue();
  if (!queue.includes(halfJuzId)) setSettings({ strengthenQueue: [...queue, halfJuzId] });
}

export function unqueueStrengthen(halfJuzId) {
  const queue = strengthenQueue();
  if (queue.includes(halfJuzId)) setSettings({ strengthenQueue: queue.filter(h => h !== halfJuzId) });
}

/** Start the first queued section once nothing is being strengthened and today's cycle work is done. */
export function startQueuedIfReady() {
  const { engine } = getState();
  if (!engine || activeCycle(engine)) return null;
  const queue = strengthenQueue().filter(h => hasMaterial(engine, h));
  if (!queue.length) return null;
  // A section that graduated today keeps today for itself; the next one begins tomorrow.
  const day = today(), tz = timeZone();
  if (engine.state.cycles.some(c => c.graduatedAt && calendarDay(c.graduatedAt, tz) === day)) return null;
  const next = queue[0];
  try {
    strengthenNow(next);
    return next;
  } catch (error) {
    console.warn('Could not start queued strengthening', error);
    unqueueStrengthen(next);
    return null;
  }
}
