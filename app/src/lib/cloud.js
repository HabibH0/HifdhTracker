// Cloud sync scheduling and account actions. Revision never waits on any of this: every write
// is already saved locally, and a failed sync simply retries later with backoff.
import { api } from './api.js';
import { ApiError, NetworkError } from './apiClient.js';
import { syncOnce } from './syncCore.js';
import { getRepo, getState, onLocalChange, reloadFromRepo, replaceLocalData, setStatus, setSyncState } from './store.js';

let timer = null, running = null, failures = 0, started = false;

function snapshot(extra = {}) {
  const repo = getRepo();
  return {
    enabled: api.enabled,
    account: repo?.meta.account ?? null,
    pending: repo?.pendingCount() ?? 0,
    lastSyncAt: repo?.meta.lastSyncAt ?? null,
    ...extra,
  };
}
/** status: local (no API configured) | signed_out | idle | syncing | synced | offline | error */
export function refreshSyncState(extra = {}) {
  const repo = getRepo(), current = getState().sync.status;
  let status = extra.status;
  if (!status) {
    if (!api.enabled) status = 'local';
    else if (!repo?.meta.token) status = 'signed_out';
    else status = ['local', 'signed_out'].includes(current) ? (repo.meta.lastSyncAt ? 'synced' : 'idle') : current;
  }
  setSyncState(snapshot({ ...extra, status }));
}

export function scheduleSync(delay = 4000) {
  clearTimeout(timer);
  if (!api.enabled || !getRepo()?.meta.token) return refreshSyncState();
  timer = setTimeout(syncNow, delay);
}

export function syncNow() {
  if (running) return running;
  const repo = getRepo();
  clearTimeout(timer);
  if (!api.enabled || !repo?.meta.token) { refreshSyncState(); return Promise.resolve(); }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) { setSyncState(snapshot({ status: 'offline', message: null })); return Promise.resolve(); }
  setSyncState(snapshot({ status: 'syncing' }));
  running = (async () => {
    try {
      const result = await syncOnce(repo, api);
      failures = 0;
      reloadFromRepo(result);
      setSyncState(snapshot({ status: 'synced', message: null, conflicts: getState().conflicts.length }));
      if (repo.hasPending()) scheduleSync(1000);
    } catch (error) {
      failures++;
      if (error instanceof ApiError && error.status === 401) {
        repo.signOut();
        setSyncState(snapshot({ status: 'signed_out', message: 'Your session ended. Sign in again to keep syncing.' }));
        return;
      }
      const offline = error instanceof NetworkError;
      setSyncState(snapshot({ status: offline ? 'offline' : 'error', message: offline ? null : error.message }));
      timer = setTimeout(syncNow, Math.min(10 * 60000, 15000 * 2 ** Math.min(failures - 1, 6)));
    } finally {
      running = null;
      if (getState().status === 'restoring' && getState().engine) setStatus('ready');
    }
  })();
  return running;
}

export function startSync() {
  if (started) return;
  started = true;
  onLocalChange(() => { setSyncState(snapshot()); scheduleSync(); });
  window.addEventListener('online', () => syncNow());
  window.addEventListener('offline', () => setSyncState(snapshot({ status: 'offline', message: null })));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
  setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 5 * 60000);
  refreshSyncState();
  syncNow();
}

// ---- Accounts
export async function register(username, password) {
  const res = await api.register(username, password);
  getRepo().bindAccount(res);
  refreshSyncState({ status: 'syncing', message: null });
  syncNow();
  return res;
}

/** Sign in. When both this device and the account hold revision data the caller chooses how to combine them. */
export async function login(username, password) {
  const res = await api.login(username, password);
  const repo = getRepo();
  const localData = repo.hasEvents() && repo.meta.boundUserId !== res.user.id;
  return { res, needsChoice: localData && res.hasData };
}

/** mode: 'combine' merges both histories; 'replace' discards this device's data first. */
export async function completeLogin(res, mode = 'combine') {
  if (mode === 'replace') replaceLocalData();
  else if (!getRepo().hasEvents() && res.hasData) setStatus(getState().status === 'onboarding' ? 'onboarding' : 'restoring');
  getRepo().bindAccount(res);
  refreshSyncState({ status: 'syncing', message: null });
  await syncNow();
}

export async function logout() {
  const repo = getRepo(), token = repo.meta.token;
  repo.signOut();
  refreshSyncState({ status: 'signed_out', message: null });
  try { await api.logout(token); } catch { /* the token is gone locally either way */ }
}

export async function downloadCloudBackup() {
  const repo = getRepo();
  return api.exportData(repo.meta.token);
}
