// Deterministic merge of revision-engine event logs from several devices.
//
// Every device (and the server) holds a set of event records:
//   { id, occurredAt, type, body, deviceId, config? }
// where `body` is the engine event without its positional `id` and `config` is attached to
// `initialized` records only. Given the same set of records, canonicalize() produces the same
// engine event list everywhere, so every replica converges on identical state:
//
//  1. Order by (occurredAt, id). IDs are time-ordered per device, so a device's own events keep
//     their creation order; ties across devices break by ID.
//  2. Drop content duplicates (the same revision session recorded twice, e.g. after importing an
//     old backup), keeping the earliest.
//  3. The earliest `initialized` record is the base. Later ones (another device that started
//     offline) become `memorized_material_added`, so their inventory is kept, not duplicated.
//  4. Renumber engine IDs event-1…event-N in that order.
//
// buildEngine() then replays through the unchanged RevisionEngine. If a replay throws (two
// devices made incompatible offline changes, e.g. both advanced the same strengthening stage),
// the offending events are set aside as conflicts — deterministically, so every replica sets
// aside the same ones — and the rest still apply.

export function compareRecords(a, b) {
  if (a.occurredAt !== b.occurredAt) return a.occurredAt < b.occurredAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}

function contentKey(record) {
  const b = record.body;
  if ((record.type === 'revision' || record.type === 'strengthening_session') && b.sessionId) return `${record.type}:${b.sessionId}`;
  if (record.type === 'initialized') return `initialized:${record.id}`;
  return `${record.type}:${stable(b)}`;
}

/** @returns {{ config: object|null, entries: Array<{ uid: string, event: object }> , duplicates: string[] }} */
export function canonicalize(records) {
  const sorted = records.filter(r => !r.deletedAt).sort(compareRecords);
  const base = sorted.find(r => r.type === 'initialized') ?? null;
  const seen = new Set(), entries = [], duplicates = [];
  for (const r of sorted) {
    if (!base) break;
    if (compareRecords(r, base) < 0) { duplicates.push(r.id); continue; } // cannot precede initialization
    let body = r.body;
    if (r.type === 'initialized' && r !== base) {
      const ayahIds = body.memorizedAyahIds ?? [];
      if (!ayahIds.length) { duplicates.push(r.id); continue; }
      body = { type: 'memorized_material_added', occurredAt: body.occurredAt, ayahIds: [...ayahIds], strengths: { ...(body.strengths ?? {}) } };
    }
    const key = contentKey(r);
    if (seen.has(key)) { duplicates.push(r.id); continue; }
    seen.add(key);
    entries.push({ uid: r.id, event: { ...body, id: `event-${entries.length + 1}` } });
  }
  return { config: base?.config ?? null, entries, duplicates };
}

const renumber = entries => entries.map((e, i) => ({ uid: e.uid, event: { ...e.event, id: `event-${i + 1}` } }));

/**
 * Replay records into a RevisionEngine without ever throwing on a bad merge.
 *  RevisionEngine  the engine class (import from src/index.js)
 *  metadata        layout metadata (shared/layout.js)
 *  makeStore(doc)  returns an engine store whose load() yields doc (metadata may be added)
 *  fallbackConfig  used if no initialized record carries a config
 * @returns {{ engine, acceptedUids: string[], conflicts: string[], duplicates: string[] } | null}
 */
export function buildEngine({ RevisionEngine, records, metadata, makeStore, fallbackConfig = {} }) {
  const { config, entries, duplicates } = canonicalize(records);
  if (!entries.length) return null;
  const header = { schemaVersion: 1, config: config ?? fallbackConfig };
  const construct = list => new RevisionEngine({ store: makeStore({ ...header, metadata, version: list.length, events: list.map(e => e.event) }) });
  try {
    return { engine: construct(entries), acceptedUids: entries.map(e => e.uid), conflicts: [], duplicates };
  } catch {
    // Slow path, only after an incompatible merge: find exactly which events cannot apply.
  }
  const accepted = [entries[0]], conflicts = [];
  let probe = construct(accepted);
  for (const entry of entries.slice(1)) {
    const event = { ...entry.event, id: `event-${accepted.length + 1}` };
    try {
      probe.events.push(event);
      probe._apply(event);
      accepted.push({ uid: entry.uid, event });
    } catch {
      conflicts.push(entry.uid);
      probe = construct(renumber(accepted));
    }
  }
  const final = renumber(accepted);
  return { engine: construct(final), acceptedUids: final.map(e => e.uid), conflicts, duplicates };
}

/** Last-writer-wins ordering for mutable records: updatedAt, then deviceId. An equal revision
 *  can only come from the same write on the same device, so the existing copy is kept. */
export function revOf(record) {
  return `${record.updatedAt ?? ''}|${record.deviceId ?? ''}`;
}
export function lwwNewer(incoming, existing) {
  return !existing || revOf(incoming) > revOf(existing);
}
