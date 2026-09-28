import { HttpError } from './auth.js';
import { lwwNewer, revOf, canonicalize } from '../../shared/merge.js';
import { isRecordId } from '../../shared/ids.js';
import { METADATA, eventRecordFromRow, replay } from './projections.js';

export const ENGINE_EVENT_TYPES = ['initialized', 'memorized_material_added', 'strengthening_started', 'revision', 'strengthening_session', 'mistake'];
export const PAGE_SIZE = 500;
const MAX = { events: 1000, records: 2000, eventBytes: 256 * 1024, recordBytes: 32 * 1024 };

// Mutable (last-writer-wins) collections: wire name -> table.
export const COLLECTIONS = {
  wordMarks: { table: 'word_marks', extra: d => ({ session_id: str(d.sessionId), page: int(d.page), ayah_id: str(d.ayahId), word_position: int(d.pos), mistake_type: str(d.type), marked_on: day(d.date) }), extraTypes: { session_id: 'text', page: 'integer', ayah_id: 'text', word_position: 'integer', mistake_type: 'text', marked_on: 'date' } },
  sessionMeta: { table: 'session_labels' },
  dayTasks: { table: 'day_tasks', extra: d => ({ task_date: day(d.date) }), extraTypes: { task_date: 'date' } },
  settings: { table: 'settings' },
};

const str = v => (typeof v === 'string' ? v.slice(0, 200) : null);
const int = v => (Number.isInteger(v) ? v : null);
const day = v => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const bytes = v => JSON.stringify(v).length;
const bad = message => new HttpError(400, 'invalid_sync', message);

function validateEvent(e) {
  if (!e || typeof e !== 'object' || !isRecordId(e.id)) throw bad('Event id is invalid.');
  if (!ENGINE_EVENT_TYPES.includes(e.type)) throw bad(`Unknown event type ${e.type}.`);
  const body = e.body;
  if (!body || typeof body !== 'object' || Array.isArray(body) || body.type !== e.type || body.occurredAt !== e.occurredAt || !ISO.test(e.occurredAt)) throw bad('Event body does not match its header.');
  if ('id' in body) throw bad('Event body must not carry a positional id.');
  if (typeof e.deviceId !== 'string' || !e.deviceId || e.deviceId.length > 64) throw bad('deviceId is required.');
  if (e.config != null && (e.type !== 'initialized' || typeof e.config !== 'object')) throw bad('Only initialized events carry configuration.');
  if (bytes(e) > MAX.eventBytes) throw bad('Event is too large.');
  return { id: e.id, occurred_at: e.occurredAt, type: e.type, body, config: e.config ?? null, device_id: e.deviceId };
}

function validateRecord(r, now) {
  if (!r || typeof r !== 'object' || !isRecordId(r.id)) throw bad('Record id is invalid.');
  if (typeof r.updatedAt !== 'string' || !ISO.test(r.updatedAt)) throw bad('updatedAt must be an ISO timestamp.');
  if (typeof r.deviceId !== 'string' || !r.deviceId || r.deviceId.length > 64) throw bad('deviceId is required.');
  if (!r.data || typeof r.data !== 'object' || Array.isArray(r.data) || bytes(r.data) > MAX.recordBytes) throw bad('Record data is invalid.');
  if (r.deletedAt != null && (typeof r.deletedAt !== 'string' || !ISO.test(r.deletedAt))) throw bad('deletedAt must be an ISO timestamp.');
  // A device clock far in the future would otherwise win every conflict forever.
  const limit = new Date(now + 5 * 60000).toISOString();
  const clamped = r.updatedAt > limit;
  return { record: { id: r.id, data: r.data, updatedAt: clamped ? new Date(now).toISOString() : r.updatedAt, deviceId: r.deviceId, deletedAt: r.deletedAt ?? null }, clamped };
}

export function parseSyncRequest(input) {
  if (!input || typeof input !== 'object') throw bad('Expected a JSON object.');
  const cursor = input.cursor == null ? '0' : String(input.cursor);
  if (!/^\d{1,19}$/.test(cursor)) throw bad('cursor is invalid.');
  const changes = input.changes ?? {};
  const events = changes.events ?? [];
  if (!Array.isArray(events) || events.length > MAX.events) throw bad(`Send at most ${MAX.events} events per request.`);
  const now = Date.now();
  const collections = {};
  for (const name of Object.keys(COLLECTIONS)) {
    const list = changes[name] ?? [];
    if (!Array.isArray(list) || list.length > MAX.records) throw bad(`Send at most ${MAX.records} ${name} per request.`);
    collections[name] = list.map(r => validateRecord(r, now));
  }
  const limit = Math.min(PAGE_SIZE, Math.max(1, Number.isInteger(input.limit) ? input.limit : PAGE_SIZE));
  return { cursor, events: events.map(validateEvent), collections, limit };
}

const toWire = row => ({ id: row.id, data: row.data, updatedAt: row.rev.slice(0, row.rev.lastIndexOf('|')), deviceId: row.device_id, deletedAt: row.deleted_at ? new Date(row.deleted_at).toISOString() : null });
const eventWire = row => ({ id: row.id, occurredAt: row.body.occurredAt, type: row.type, body: row.body, deviceId: row.device_id, ...(row.config ? { config: row.config } : {}) });

async function upsertCollection(q, userId, spec, records) {
  const extraTypes = spec.extraTypes ?? {};
  const extraCols = Object.keys(extraTypes);
  const rows = records.map(r => ({
    id: r.id, data: r.data, rev: revOf(r), device_id: r.deviceId, updated_at: r.updatedAt, deleted_at: r.deletedAt,
    ...(spec.extra ? spec.extra(r.data) : {}),
  }));
  const defs = ['id text', 'data jsonb', 'rev text', 'device_id text', 'updated_at timestamptz', 'deleted_at timestamptz', ...extraCols.map(c => `${c} ${extraTypes[c]}`)].join(', ');
  const cols = ['data', 'rev', 'device_id', 'updated_at', 'deleted_at', ...extraCols];
  await q.query(
    `insert into ${spec.table} (user_id, id, ${cols.join(', ')})
     select $1, x.id, ${cols.map(c => `x.${c}`).join(', ')} from jsonb_to_recordset($2::jsonb) as x(${defs})
     on conflict (user_id, id) do update set ${cols.map(c => `${c} = excluded.${c}`).join(', ')}, server_seq = nextval('sync_seq')`,
    [userId, JSON.stringify(rows)]);
}

async function pull(q, userId, cursor, limit, exclude) {
  const found = [];
  const ev = await q.query(`select id, type, body, config, device_id, server_seq::text as seq from revision_events where user_id = $1 and server_seq > $2::bigint order by server_seq limit $3`, [userId, cursor, limit + 1]);
  for (const row of ev.rows) found.push({ name: 'events', seq: BigInt(row.seq), row });
  for (const [name, spec] of Object.entries(COLLECTIONS)) {
    const { rows } = await q.query(`select id, data, rev, device_id, deleted_at, server_seq::text as seq from ${spec.table} where user_id = $1 and server_seq > $2::bigint order by server_seq limit $3`, [userId, cursor, limit + 1]);
    for (const row of rows) found.push({ name, seq: BigInt(row.seq), row });
  }
  found.sort((a, b) => (a.seq < b.seq ? -1 : a.seq > b.seq ? 1 : 0));
  const page = found.slice(0, limit);
  const changes = { events: [], ...Object.fromEntries(Object.keys(COLLECTIONS).map(n => [n, []])) };
  for (const { name, row } of page) {
    if (exclude.has(`${name}:${row.id}`)) continue; // written by this very request; the device has it
    changes[name].push(name === 'events' ? eventWire(row) : toWire(row));
  }
  return { changes, cursor: page.length ? page.at(-1).seq.toString() : cursor, hasMore: found.length > limit };
}

/**
 * Push this device's changes, then pull everything newer than its cursor.
 * Events are immutable: re-sending one is a no-op. Mutable records resolve last-writer-wins;
 * when the server's copy wins, it is returned in `overrides` so the device adopts it.
 */
export async function handleSync(db, userId, input) {
  const req = parseSyncRequest(input);
  return db.tx(async q => {
    await q.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [userId]);
    const acked = { events: [] }, overrides = {}, exclude = new Set();
    let insertedEvents = 0;
    if (req.events.length) {
      const { rows } = await q.query(
        `insert into revision_events (user_id, id, occurred_at, type, body, config, device_id)
         select $1, x.id, x.occurred_at, x.type, x.body, x.config, x.device_id
           from jsonb_to_recordset($2::jsonb) as x(id text, occurred_at timestamptz, type text, body jsonb, config jsonb, device_id text)
         on conflict (user_id, id) do nothing returning id`, [userId, JSON.stringify(req.events)]);
      insertedEvents = rows.length;
      for (const e of req.events) { acked.events.push(e.id); exclude.add(`events:${e.id}`); }
    }
    for (const [name, spec] of Object.entries(COLLECTIONS)) {
      const incoming = req.collections[name];
      acked[name] = incoming.map(x => x.record.id);
      overrides[name] = [];
      if (!incoming.length) continue;
      const { rows } = await q.query(`select id, data, rev, device_id, deleted_at from ${spec.table} where user_id = $1 and id = any($2::text[])`, [userId, incoming.map(x => x.record.id)]);
      const existing = new Map(rows.map(r => [r.id, toWire(r)]));
      const winners = new Map();
      for (const { record, clamped } of incoming) {
        const current = winners.get(record.id) ?? existing.get(record.id);
        if (lwwNewer(record, current)) { winners.set(record.id, record); if (clamped) overrides[name].push(record); }
      }
      for (const { record } of incoming) if (!winners.has(record.id)) overrides[name].push(existing.get(record.id));
      if (winners.size) await upsertCollection(q, userId, spec, [...winners.values()]);
      for (const id of winners.keys()) exclude.add(`${name}:${id}`);
    }
    const pulled = await pull(q, userId, req.cursor, req.limit, exclude);
    return { acked, overrides, ...pulled, insertedEvents, serverTime: new Date().toISOString() };
  });
}

export async function hasCloudData(db, userId) {
  const { rows } = await db.query('select exists(select 1 from revision_events where user_id = $1) as has', [userId]);
  return rows[0].has;
}

/** Everything the account holds, in a format the app can import as a backup. */
export async function exportAccount(db, user) {
  const q = (sql) => db.query(sql, [user.userId]).then(r => r.rows);
  const events = await q('select id, type, body, config, device_id from revision_events where user_id = $1 order by occurred_at, id');
  const records = events.map(eventRecordFromRow);
  const result = records.length ? replay(records) : null;
  const canonical = records.length ? canonicalize(records) : { entries: [], config: null };
  const rec = async name => (await q(`select id, data, rev, device_id, deleted_at from ${COLLECTIONS[name].table} where user_id = $1 and deleted_at is null order by id`)).map(toWire);
  const settings = (await rec('settings')).find(r => r.id === 'app');
  const table = async name => (await q(`select * from ${name} where user_id = $1 and deleted_at is null order by id`)).map(({ user_id, ...row }) => row);
  return {
    app: 'hifdh-revision', format: 2, source: 'cloud', exportedAt: new Date().toISOString(),
    account: { username: user.username },
    engine: result ? { ...result.engine.exportData(), snapshot: undefined } : { schemaVersion: 1, version: 0, config: canonical.config, metadata: METADATA, events: [] },
    eventRecords: events.map(eventWire),
    conflicts: result?.conflicts ?? [],
    wordMarks: await rec('wordMarks'),
    sessionMeta: await rec('sessionMeta'),
    dayTasks: await rec('dayTasks'),
    settings: settings ?? null,
    cloud: {
      memorizedMaterial: await table('memorized_material'),
      pageStates: await table('page_states'),
      strengtheningCycles: await table('strengthening_cycles'),
      revisionSessions: await table('revision_sessions'),
      mistakes: await table('mistakes'),
    },
  };
}
