// Offline-first local repository and sync loop. Pure JavaScript: the app backs it with
// IndexedDB, the tests with a Map.
//
// Everything is saved locally first and flagged `synced: false`. syncOnce() uploads pending
// records in batches, acknowledges what the server accepted, applies newer server changes,
// and advances a cursor. Failures leave local data untouched; the next attempt resends.
//
// Records
//   events       immutable engine events { id, occurredAt, type, body, deviceId, config? }
//   wordMarks, sessionMeta, dayTasks, settings
//                mutable { id, data, updatedAt, deviceId, deletedAt } (last writer wins)
import { uuidv7 } from '../../../shared/ids.js';
import { buildEngine, compareRecords, lwwNewer } from '../../../shared/merge.js';

/**
 * The engine's store contract (sync load/save) backed by the repository: every commit's new
 * events become pending event records. The engine itself is unchanged.
 */
export class EngineStore {
  constructor({ repo, doc = null, metadata, onCommit = () => {} }) {
    Object.assign(this, { repo, doc, metadata, onCommit });
    this.known = doc?.events.length ?? 0;
    this.version = doc?.version ?? 0;
  }
  load() { return this.doc ? { ...this.doc, metadata: this.metadata } : null; }
  save(document, expectedVersion) {
    if (this.version !== expectedVersion) throw new Error('Concurrent update; reload the app');
    this.repo.recordEngineEvents(document.events.slice(this.known), document.config);
    this.known = document.events.length;
    this.version = document.version;
    this.onCommit();
  }
}

/** Replay the repository's events (from every device) into an engine. */
export function openEngine({ RevisionEngine, repo, metadata, onCommit }) {
  const result = buildEngine({ RevisionEngine, records: repo.eventRecords(), metadata, makeStore: doc => new EngineStore({ repo, doc, metadata, onCommit }) });
  return result ?? { engine: null, conflicts: [], duplicates: [], acceptedUids: [] };
}

export function createEngineIn({ RevisionEngine, repo, metadata, onCommit, ...options }) {
  return new RevisionEngine({ ...options, metadata, store: new EngineStore({ repo, metadata, onCommit }) });
}

export const COLLECTIONS = ['wordMarks', 'sessionMeta', 'dayTasks', 'settings'];
const PREFIX = { events: 'ev:', wordMarks: 'wm:', sessionMeta: 'sm:', dayTasks: 'dt:', settings: 'st:' };
export const META_KEY = 'sync:meta';
export const isRepoKey = key => key === META_KEY || Object.values(PREFIX).some(p => key.startsWith(p));

const wireEvent = ({ synced, ...r }) => r;
const wireRecord = ({ synced, ...r }) => r;

export class LocalRepo {
  /**
   * entries  key/value pairs previously persisted (from IndexedDB)
   * write    (puts: [key, value][], deletes: key[]) => void — persistence sink, batched per tick
   */
  constructor({ entries = {}, write = () => {}, now = () => Date.now() } = {}) {
    this.writeSink = write;
    this.now = now;
    this.events = new Map();
    this.col = Object.fromEntries(COLLECTIONS.map(n => [n, new Map()]));
    this.queue = new Map();
    for (const [key, value] of Object.entries(entries)) {
      if (key.startsWith(PREFIX.events)) this.events.set(value.id, value);
      else for (const name of COLLECTIONS) if (key.startsWith(PREFIX[name])) this.col[name].set(value.id, value);
    }
    this.meta = { deviceId: null, cursor: '0', token: null, account: null, boundUserId: null, lastSyncAt: null, ...(entries[META_KEY] ?? {}) };
    if (!this.meta.deviceId) { this.meta.deviceId = uuidv7(); this.#persistMeta(); }
  }

  // ---- persistence (coalesced into one write per tick)
  #stage(key, value) {
    this.queue.set(key, value);
    if (this.queue.size === 1) queueMicrotask(() => this.flush());
  }
  flush() {
    if (!this.queue.size) return;
    const puts = [], deletes = [];
    for (const [k, v] of this.queue) (v === undefined ? deletes : puts).push(v === undefined ? k : [k, v]);
    this.queue.clear();
    this.writeSink(puts, deletes);
  }
  #persistEvent(r) { this.#stage(PREFIX.events + r.id, r); }
  #persistRecord(name, r) { this.#stage(PREFIX[name] + r.id, r); }
  #persistMeta() { this.#stage(META_KEY, { ...this.meta }); }
  #iso(minAfter) {
    const t = new Date(this.now()).toISOString();
    // A local edit must supersede the version it replaces even if the clock went backwards.
    return minAfter && t <= minAfter ? new Date(Date.parse(minAfter) + 1).toISOString() : t;
  }

  // ---- engine events
  /** Record events the engine just committed (in commit order). */
  recordEngineEvents(events, config) {
    for (const { id, ...body } of events) {
      const r = { id: uuidv7(), occurredAt: body.occurredAt, type: body.type, body, deviceId: this.meta.deviceId, synced: false };
      if (body.type === 'initialized' && config) r.config = config;
      this.events.set(r.id, r);
      this.#persistEvent(r);
    }
  }
  eventRecords() { return [...this.events.values()]; }
  hasEvents() { return this.events.size > 0; }

  /** Import already-identified records (backup restore, legacy migration). */
  importEvents(records, { synced = false } = {}) {
    for (const r of records) {
      if (this.events.has(r.id)) continue;
      const rec = { id: r.id, occurredAt: r.occurredAt, type: r.type, body: r.body, deviceId: r.deviceId ?? this.meta.deviceId, synced, ...(r.config ? { config: r.config } : {}) };
      this.events.set(rec.id, rec);
      this.#persistEvent(rec);
    }
  }

  // ---- mutable collections
  get(name, id) { const r = this.col[name].get(id); return r && !r.deletedAt ? r.data : undefined; }
  entries(name) { return [...this.col[name].values()].filter(r => !r.deletedAt).map(r => [r.id, r.data]); }
  records(name) { return [...this.col[name].values()].map(({ synced, ...r }) => r); }
  list(name) { return [...this.col[name].values()].filter(r => !r.deletedAt).map(r => r.data); }
  put(name, id, data) {
    const prev = this.col[name].get(id);
    const r = { id, data, updatedAt: this.#iso(prev?.updatedAt), deviceId: this.meta.deviceId, deletedAt: null, synced: false };
    this.col[name].set(id, r);
    this.#persistRecord(name, r);
    return r;
  }
  remove(name, id) {
    const prev = this.col[name].get(id);
    if (!prev || prev.deletedAt) return;
    const at = this.#iso(prev.updatedAt);
    const r = { ...prev, updatedAt: at, deletedAt: at, deviceId: this.meta.deviceId, synced: false };
    this.col[name].set(id, r);
    this.#persistRecord(name, r);
  }

  // ---- sync bookkeeping
  pendingCount() {
    let n = 0;
    for (const r of this.events.values()) if (!r.synced) n++;
    for (const name of COLLECTIONS) for (const r of this.col[name].values()) if (!r.synced) n++;
    return n;
  }
  hasPending() { return this.pendingCount() > 0; }

  /** The next batch to upload, oldest events first. */
  pending(limit = 400) {
    const events = [...this.events.values()].filter(r => !r.synced).sort(compareRecords).slice(0, limit).map(wireEvent);
    const changes = { events };
    let room = Math.max(0, limit * 2);
    for (const name of COLLECTIONS) {
      changes[name] = [...this.col[name].values()].filter(r => !r.synced).slice(0, room).map(wireRecord);
      room -= changes[name].length;
    }
    return changes;
  }

  /** Mark what the server stored. A record edited again since it was sent stays pending. */
  applyAck(sent, acked = {}) {
    const ackedEvents = new Set(acked.events ?? []);
    for (const e of sent.events) {
      const r = this.events.get(e.id);
      if (r && ackedEvents.has(e.id) && !r.synced) { r.synced = true; this.#persistEvent(r); }
    }
    for (const name of COLLECTIONS) {
      const ids = new Set(acked[name] ?? []);
      for (const s of sent[name] ?? []) {
        const r = this.col[name].get(s.id);
        if (r && ids.has(s.id) && !r.synced && r.updatedAt === s.updatedAt && r.deviceId === s.deviceId) { r.synced = true; this.#persistRecord(name, r); }
      }
    }
  }

  /** Apply server changes (and overrides). Returns what changed locally. */
  applyRemote(changes = {}) {
    const out = { events: 0, collections: new Set() };
    for (const e of changes.events ?? []) {
      if (this.events.has(e.id)) { const r = this.events.get(e.id); if (!r.synced) { r.synced = true; this.#persistEvent(r); } continue; }
      const r = { id: e.id, occurredAt: e.occurredAt, type: e.type, body: e.body, deviceId: e.deviceId, synced: true, ...(e.config ? { config: e.config } : {}) };
      this.events.set(r.id, r);
      this.#persistEvent(r);
      out.events++;
    }
    for (const name of COLLECTIONS) {
      for (const incoming of changes[name] ?? []) {
        const local = this.col[name].get(incoming.id);
        if (local && !lwwNewer(incoming, local)) {
          // Same revision as ours: the server has it, so ours is synced.
          if (!local.synced && local.updatedAt === incoming.updatedAt && local.deviceId === incoming.deviceId) { local.synced = true; this.#persistRecord(name, local); }
          continue;
        }
        const r = { ...incoming, synced: true };
        this.col[name].set(r.id, r);
        this.#persistRecord(name, r);
        out.collections.add(name);
      }
    }
    return out;
  }

  setCursor(cursor) { this.meta.cursor = cursor; this.#persistMeta(); }
  setMeta(patch) { Object.assign(this.meta, patch); this.#persistMeta(); }

  /**
   * Attach this device to an account. Data from another account (or never uploaded) is
   * re-marked pending so a "combine" really uploads it; same-account re-login keeps the cursor.
   */
  bindAccount({ user, token }) {
    const sameUser = this.meta.boundUserId === user.id;
    if (!sameUser) {
      for (const r of this.events.values()) if (r.synced) { r.synced = false; this.#persistEvent(r); }
      for (const name of COLLECTIONS) for (const r of this.col[name].values()) if (r.synced) { r.synced = false; this.#persistRecord(name, r); }
    }
    this.setMeta({ token, account: { id: user.id, username: user.username }, boundUserId: user.id, cursor: sameUser ? this.meta.cursor : '0', lastError: null });
  }
  signOut() { this.setMeta({ token: null, account: null }); }

  /** Drop all revision data (keeps the device identity). */
  clearData() {
    for (const id of this.events.keys()) this.#stage(PREFIX.events + id, undefined);
    for (const name of COLLECTIONS) for (const id of this.col[name].keys()) this.#stage(PREFIX[name] + id, undefined);
    this.events.clear();
    for (const name of COLLECTIONS) this.col[name].clear();
    this.setMeta({ cursor: '0' });
  }
}

/**
 * Upload pending changes and download newer ones until both sides are caught up.
 * Throws ApiError/NetworkError; nothing local is lost or half-applied when it does.
 */
export async function syncOnce(repo, api, { batch = 400, maxRounds = 500 } = {}) {
  if (!repo.meta.token) return { status: 'signed_out', eventsAdded: 0, collections: new Set() };
  let eventsAdded = 0, pushed = 0;
  const collections = new Set();
  for (let round = 0; round < maxRounds; round++) {
    const sent = repo.pending(batch);
    const count = sent.events.length + COLLECTIONS.reduce((n, c) => n + sent[c].length, 0);
    const res = await api.sync(repo.meta.token, { cursor: repo.meta.cursor, deviceId: repo.meta.deviceId, changes: sent });
    repo.applyAck(sent, res.acked);
    const overrides = repo.applyRemote(res.overrides);
    const pulled = repo.applyRemote(res.changes);
    repo.setCursor(res.cursor);
    pushed += count;
    eventsAdded += pulled.events + overrides.events;
    for (const c of [...pulled.collections, ...overrides.collections]) collections.add(c);
    if (!res.hasMore && !repo.hasPending()) break;
    if (!res.hasMore && count === 0) break; // nothing sendable remains (e.g. edited mid-flight); next run
  }
  repo.setMeta({ lastSyncAt: new Date(repo.now()).toISOString(), lastError: null });
  repo.flush();
  return { status: 'synced', eventsAdded, pushed, collections };
}
