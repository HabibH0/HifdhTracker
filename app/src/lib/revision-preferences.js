/** User-chosen routines are separate from measured memory strength. */
export function assignSections(settings, halfJuzIds, mode) {
  if (!['relearn', 'maintenance', 'automatic'].includes(mode)) throw new Error('Unknown revision routine');
  const ids = [...new Set(halfJuzIds)];
  const queue = settings.strengthenQueue ?? [];
  const maintenance = settings.maintenanceHalfJuzIds ?? [];
  return {
    strengthenQueue: mode === 'relearn' ? [...queue, ...ids.filter(id => !queue.includes(id))] : queue.filter(id => !ids.includes(id)),
    maintenanceHalfJuzIds: mode === 'maintenance' ? [...maintenance, ...ids.filter(id => !maintenance.includes(id))] : maintenance.filter(id => !ids.includes(id)),
  };
}

export function moveQueuedSection(queue, id, direction) {
  const next = [...queue], from = next.indexOf(id), to = from + direction;
  if (from < 0 || to < 0 || to >= next.length) return next;
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}
