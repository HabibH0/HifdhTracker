// Choosing which half-juz to strengthen. The engine allows one active cycle and picks the
// weakest section itself; this lets the reciter start a specific one now, or queue it to start
// the day after the current cycle graduates (ahead of the engine's own choice).
import { calendarDay } from '@engine/time.js';
import { getState, mutate, nowIso, setSettings, timeZone, today } from './store.js';
import { assignSections } from './revision-preferences.js';
import { resolveMemorizedSelection } from '@engine/inventory.js';

export function assignRevisionMaterial(selection, mode) {
  const { engine, settings } = getState();
  const ayat = new Set(resolveMemorizedSelection(engine.metadata, selection));
  const ids = [...new Set(engine.metadata.pages.filter(p => p.ayahIds.some(a => ayat.has(a))).map(p => p.halfJuzId))];
  const active = activeCycle(engine)?.halfJuzId;
  if (mode === 'maintenance' && ids.includes(active)) throw new Error('Finish the active relearning cycle before moving that section to maintenance.');
  mutate(e => e.addMemorizedMaterial({ selection, occurredAt: nowIso(), initialStrength: mode === 'relearn' ? 'very_weak' : 'strong' }));
  setSettings(assignSections(settings, ids.filter(id => id !== active), mode));
  return ids;
}

export const activeCycle = engine => engine?.state.cycles.find(c => c.status === 'active') ?? null;
export const strengthenQueue = () => getState().settings.strengthenQueue ?? [];

const hasMaterial = (engine, halfJuzId) =>
  engine.metadata.pages.some(p => p.halfJuzId === halfJuzId && engine.state.pages[p.id].memorizedAyahIds.length);

export function strengthenNow(halfJuzId) {
  mutate(e => e.startStrengtheningCycle({ halfJuzId, occurredAt: nowIso() }));
  unqueueStrengthen(halfJuzId);
}

export function queueStrengthen(halfJuzId) {
  setSettings(assignSections(getState().settings, [halfJuzId], 'relearn'));
}

export function unqueueStrengthen(halfJuzId) {
  const queue = strengthenQueue();
  if (queue.includes(halfJuzId)) setSettings({ strengthenQueue: queue.filter(h => h !== halfJuzId) });
}

/** Start the first queued section once nothing is being strengthened and today's cycle work is done. */
export function startQueuedIfReady() {
  const { engine, activeSession } = getState();
  if (!engine || activeCycle(engine)) return null;
  if (activeSession?.kind === 'strengthen' && !['intro', 'complete'].includes(activeSession.phase)) return null;
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
    return null;
  }
}
