import { useSyncExternalStore } from 'react';
import { RevisionEngine } from '@engine/index.js';
import { calendarDay } from '@engine/time.js';
import * as db from './storage.js';
import { engineMetadata, LAYOUT_ID } from './quran.js';
import { LocalRepo, openEngine, createEngineIn, isRepoKey } from './syncCore.js';
import { uuidv7 } from '../../../shared/ids.js';

const METADATA = engineMetadata();

export const DEFAULT_SETTINGS = {
  capacity: 60,
  randomAccess: true,
  showMarkers: true,
  theme: 'system',
  reminder: { on: false, time: '07:00' },
  todayCapacity: null, // { date, minutes } — a one-day override from the Today screen
};

// All user data lives in a LocalRepo (IndexedDB-backed): engine events plus word marks,
// session labels, completed day tasks and settings. Every write lands there first and is
// flagged unsynced; lib/cloud.js uploads it when an account is signed in and online.
let repo = null;
let changeListener = () => {};
export const onLocalChange = fn => { changeListener = fn; };
export const getRepo = () => repo;
const persist = (puts, deletes) => db.writeMany(puts, deletes);
const localChanged = () => changeListener();

let state = {
  status: 'loading', // loading | onboarding | restoring | ready | error
  engine: null,
  conflicts: [],
  version: 0,
  settings: DEFAULT_SETTINGS,
  dayTaskList: [],
  wordMarks: [],
  sessionMeta: {},
  activeSession: null,
  lastPage: 1,
  offline: { done: 0, total: 0, complete: false },
  sync: { status: 'local', enabled: false, account: null, pending: 0, lastSyncAt: null, message: null },
  error: null,
};
const listeners = new Set();
const emit = () => listeners.forEach(l => l());
function set(patch) { state = { ...state, ...patch }; emit(); }
export const getState = () => state;
const subscribe = l => (listeners.add(l), () => listeners.delete(l));
export function useApp() { return useSyncExternalStore(subscribe, getState); }

// ---- Time: writes must be chronological, so never go behind the latest event.
export function nowIso() {
  const t = new Date().toISOString();
  const latest = state.engine?.events.at(-1).occurredAt;
  return latest && latest > t ? latest : t;
}
export const timeZone = () => state.engine?.config.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
export const today = () => calendarDay(nowIso(), timeZone());

// ---- Derived-value cache keyed by engine version (plan, stats and page states are pure).
const cache = new Map();
export function derived(key, fn) {
  const k = `${key}|${state.version}|${today()}`;
  if (!cache.has(k)) {
    if (cache.size > 60) cache.clear();
    cache.set(k, fn(state.engine));
  }
  return cache.get(k);
}

function slices() {
  const settings = { ...DEFAULT_SETTINGS, ...(repo.get('settings', 'app') ?? {}) };
  applyTheme(settings.theme);
  return {
    settings,
    wordMarks: repo.list('wordMarks'),
    sessionMeta: Object.fromEntries(repo.entries('sessionMeta')),
    dayTaskList: repo.list('dayTasks'),
  };
}

function openLocalEngine() {
  return openEngine({ RevisionEngine, repo, metadata: METADATA, onCommit: localChanged });
}

/** Convert data saved before cloud sync existed into repository records (once). */
function migrateLegacy(all) {
  const legacy = ['engine', 'dayLog', 'wordMarks', 'sessionMeta', 'settings'].filter(k => k in all);
  if (!legacy.length) return;
  if (all.engine?.events?.length && !repo.hasEvents()) {
    if (all.engine.metadata && all.engine.metadata.layoutId !== LAYOUT_ID) throw new Error('Saved data uses a different Mushaf layout');
    repo.importEvents(all.engine.events.map(({ id, ...body }) => ({
      id: uuidv7(Date.parse(body.occurredAt)), occurredAt: body.occurredAt, type: body.type, body,
      ...(body.type === 'initialized' ? { config: all.engine.config } : {}),
    })));
  }
  if (Array.isArray(all.wordMarks)) for (const m of all.wordMarks) repo.put('wordMarks', uuidv7(), m);
  if (all.sessionMeta && typeof all.sessionMeta === 'object') for (const [id, m] of Object.entries(all.sessionMeta)) repo.put('sessionMeta', id, m);
  if (all.dayLog?.date) for (const t of all.dayLog.tasks ?? []) repo.put('dayTasks', t.sessionId, { ...t, date: all.dayLog.date });
  if (all.settings && !repo.get('settings', 'app')) repo.put('settings', 'app', all.settings);
  repo.flush();
  for (const k of legacy) db.remove(k);
}

export async function boot() {
  try {
    const all = await db.loadAll();
    repo = new LocalRepo({ entries: Object.fromEntries(Object.entries(all).filter(([k]) => isRepoKey(k))), write: persist });
    migrateLegacy(all);
    const { engine, conflicts } = openLocalEngine();
    set({
      status: engine ? 'ready' : 'onboarding',
      engine, conflicts, version: 1, ...slices(),
      activeSession: all.activeSession ?? null,
      lastPage: all.lastPage ?? 1,
    });
    db.requestPersistence();
  } catch (error) {
    console.error(error);
    set({ status: 'error', error: String(error.message ?? error) });
  }
}

export function createEngine({ memorized, initialStrength, capacity, initializedAt }) {
  const engine = createEngineIn({
    RevisionEngine, repo, metadata: METADATA, onCommit: localChanged,
    initializedAt: initializedAt ?? new Date().toISOString(),
    memorized, initialStrength,
    config: { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
  });
  if (capacity) repo.put('settings', 'app', { ...state.settings, capacity });
  set({ engine, conflicts: [], status: 'ready', version: state.version + 1, ...slices() });
  localChanged();
  return engine;
}

/** Run an engine write; every screen re-derives from the bumped version. */
export function mutate(fn) {
  const result = fn(state.engine);
  set({ version: state.version + 1 });
  return result;
}

/** After a sync pulled changes: rebuild the engine from all devices' events if needed. */
export function reloadFromRepo({ eventsAdded = 0, collections = new Set() } = {}) {
  const patch = {};
  if (eventsAdded) {
    const { engine, conflicts } = openLocalEngine();
    Object.assign(patch, { engine, conflicts, version: state.version + 1 });
    if (engine && (state.status === 'onboarding' || state.status === 'restoring')) patch.status = 'ready';
  }
  if (eventsAdded || collections.size) Object.assign(patch, slices());
  if (Object.keys(patch).length) set(patch);
}

/** "Use account data only": discard this device's revision data before pulling the account. */
export function replaceLocalData() {
  repo.clearData();
  repo.flush();
  set({ engine: null, conflicts: [], status: 'restoring', version: state.version + 1, activeSession: null, ...slices() });
  db.remove('activeSession');
}
export function setStatus(status) { set({ status }); }
export function setSyncState(sync) { set({ sync: { ...state.sync, ...sync } }); }

export function setSettings(patch) {
  repo.put('settings', 'app', { ...state.settings, ...patch });
  set(slices());
  localChanged();
}

export function capacityToday() {
  const s = state.settings;
  return s.todayCapacity?.date === today() ? s.todayCapacity.minutes : s.capacity;
}

export function dayTasks() {
  const t = today();
  return state.dayTaskList.filter(x => x.date === t).sort((a, b) => (a.completedAt ?? '').localeCompare(b.completedAt ?? ''));
}
export function logDayTask(task) {
  repo.put('dayTasks', task.sessionId, { ...task, date: today(), completedAt: new Date().toISOString() });
  set({ dayTaskList: repo.list('dayTasks') });
  localChanged();
}

export function addWordMarks(marks) {
  if (!marks.length) return;
  for (const m of marks) repo.put('wordMarks', uuidv7(), m);
  set({ wordMarks: repo.list('wordMarks') });
  localChanged();
}

export function setSessionMeta(sessionId, meta) {
  repo.put('sessionMeta', sessionId, meta);
  set({ sessionMeta: Object.fromEntries(repo.entries('sessionMeta')) });
  localChanged();
}

// Device-local only: an in-progress session draft and the last Mushaf page.
let draftTimer;
export function saveActiveSession(draft) {
  set({ activeSession: draft });
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => (draft ? db.put('activeSession', draft) : db.remove('activeSession')), 250);
}
export function clearActiveSession() {
  clearTimeout(draftTimer);
  db.remove('activeSession');
  set({ activeSession: null });
}

export function setLastPage(n) {
  if (state.lastPage === n) return;
  db.put('lastPage', n);
  set({ lastPage: n });
}

export function setOffline(offline) { set({ offline }); }

// ---- Backup (same format as the cloud /export, so either can be restored)
export function exportBackup() {
  const { snapshot, ...engineDoc } = state.engine.exportData();
  return {
    app: 'hifdh-revision', format: 2, source: 'device', exportedAt: new Date().toISOString(),
    engine: engineDoc,
    eventRecords: repo.eventRecords().map(({ synced, ...r }) => r),
    wordMarks: repo.records('wordMarks'), sessionMeta: repo.records('sessionMeta'), dayTasks: repo.records('dayTasks'),
    settings: repo.records('settings').find(r => r.id === 'app') ?? null,
  };
}

export async function importBackup(json) {
  if (json?.app !== 'hifdh-revision' || !json.engine?.events) throw new Error('This file is not a Hifdh backup');
  if (json.engine.metadata?.layoutId !== LAYOUT_ID) throw new Error('Backup uses a different Mushaf layout');
  const records = Array.isArray(json.eventRecords) && json.eventRecords.length
    ? json.eventRecords
    : json.engine.events.map(({ id, ...body }) => ({ id: uuidv7(Date.parse(body.occurredAt)), occurredAt: body.occurredAt, type: body.type, body, ...(body.type === 'initialized' ? { config: json.engine.config } : {}) }));
  // Validate by replaying into a scratch repository before touching real data.
  const scratch = new LocalRepo({ write: () => {} });
  scratch.importEvents(records);
  if (!openEngine({ RevisionEngine, repo: scratch, metadata: METADATA }).engine) throw new Error('The backup contains no revision history');

  repo.clearData();
  repo.importEvents(records);
  const each = (list, fn) => (Array.isArray(list) ? list : []).forEach(fn);
  if (json.format >= 2) {
    each(json.wordMarks, r => !r.deletedAt && repo.put('wordMarks', r.id, r.data));
    each(json.sessionMeta, r => !r.deletedAt && repo.put('sessionMeta', r.id, r.data));
    each(json.dayTasks, r => !r.deletedAt && repo.put('dayTasks', r.id, r.data));
    if (json.settings?.data) repo.put('settings', 'app', json.settings.data);
  } else {
    each(json.wordMarks, m => repo.put('wordMarks', uuidv7(), m));
    for (const [id, m] of Object.entries(json.sessionMeta ?? {})) repo.put('sessionMeta', id, m);
    if (json.settings) repo.put('settings', 'app', json.settings);
  }
  repo.flush();
  const { engine, conflicts } = openLocalEngine();
  clearActiveSession();
  set({ engine, conflicts, status: 'ready', version: state.version + 1, ...slices() });
  localChanged();
}

/** Erase everything on this device (the cloud copy, if any, is untouched). */
export async function resetAll() {
  await db.clearAll();
  repo = new LocalRepo({ write: persist });
  set({ engine: null, conflicts: [], status: 'onboarding', activeSession: null, version: state.version + 1, ...slices() });
  localChanged();
}

// ---- Theme
const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
function applyTheme(theme) {
  const dark = theme === 'dark' || (theme === 'system' && media?.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  // "System" keeps each meta's own colour (matched to its media query); an explicit Light/Dark
  // choice paints the bar the same way whatever the phone's appearance is.
  for (const meta of document.querySelectorAll('meta[name=theme-color]')) {
    const own = meta.media.includes('dark') ? '#111613' : '#F6F2E8';
    meta.setAttribute('content', theme === 'system' ? own : dark ? '#111613' : '#F6F2E8');
  }
}
media?.addEventListener?.('change', () => applyTheme(state.settings.theme));

export const newId = prefix => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
