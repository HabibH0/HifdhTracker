import { motion, AnimatePresence } from 'framer-motion';
import { useApp } from '../lib/store.js';
import { nav } from '../lib/nav.js';
import { syncNow } from '../lib/cloud.js';
import { Button, Pressable } from './ui.jsx';
import { Icon } from './Icons.jsx';

export function ago(iso) {
  if (!iso) return 'never';
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** What the user needs to know, in a few words. */
export function describe(sync) {
  const n = sync.pending;
  switch (sync.status) {
    case 'syncing': return { icon: 'cloudUp', label: 'Syncing', tone: 'var(--pri-soft-ink)', detail: 'Uploading and checking for changes…', spin: true };
    case 'offline': return { icon: 'cloudOff', label: 'Offline', tone: 'var(--ink-3)', detail: n ? `${n} change${n === 1 ? '' : 's'} saved on this device will sync when you’re back online.` : 'Everything is saved on this device.' };
    case 'error': return { icon: 'alert', label: 'Sync paused', tone: 'var(--amber-ink)', detail: `${sync.message ?? 'The server could not be reached.'} Your revision is saved on this device; retrying automatically.` };
    case 'signed_out': return { icon: 'cloud', label: 'Not syncing', tone: 'var(--ink-3)', detail: sync.message ?? 'Sign in to keep a copy in the cloud and sync your devices.' };
    case 'local': return { icon: 'cloud', label: 'On this device', tone: 'var(--ink-3)', detail: 'Cloud sync is not configured for this version of the app.' };
    default:
      if (n) return { icon: 'cloudUp', label: `${n} to sync`, tone: 'var(--ink-3)', detail: `${n} change${n === 1 ? '' : 's'} saved here, uploading shortly.` };
      return { icon: 'cloudCheck', label: 'Synced', tone: 'var(--pri-soft-ink)', detail: `Up to date · last synced ${ago(sync.lastSyncAt)}.` };
  }
}

export function syncSheet() {
  nav.openSheet(close => {
    const Content = () => {
      const { sync, conflicts } = useApp();
      const d = describe(sync);
      return (
        <div className="stack gap-12">
          <div className="row-flex" style={{ gap: 12 }}>
            <span style={{ width: 44, height: 44, borderRadius: 14, display: 'grid', placeItems: 'center', background: 'var(--card-2)', color: d.tone }}>
              <Icon name={d.icon} size={24} className={d.spin ? 'pulse' : ''} />
            </span>
            <div className="grow"><h2 style={{ margin: 0 }}>{d.label}</h2>{sync.account && <div className="small">Signed in as {sync.account.username}</div>}</div>
          </div>
          <p className="sub" style={{ margin: 0 }}>{d.detail}</p>
          {sync.account && (
            <div className="card list">
              <div className="row"><span className="grow small">Last synced</span><span className="small">{ago(sync.lastSyncAt)}</span></div>
              <div className="row"><span className="grow small">Waiting to upload</span><span className="small num">{sync.pending}</span></div>
              {conflicts.length > 0 && <div className="row"><span className="grow small">Set aside after merging</span><span className="small num" style={{ color: 'var(--amber-ink)' }}>{conflicts.length}</span></div>}
            </div>
          )}
          {conflicts.length > 0 && <p className="tiny" style={{ margin: 0 }}>Two devices recorded incompatible changes while offline. The later ones were set aside so your history stays consistent; they remain in your backups.</p>}
          {sync.account && <Button size="lg" block disabled={sync.status === 'syncing'} onClick={() => syncNow()}>{sync.status === 'syncing' ? 'Syncing…' : 'Sync now'}</Button>}
          {!sync.account && sync.enabled && <Button size="lg" block onClick={() => { close(); setTimeout(() => nav.push('account'), 200); }}>Sign in or create an account</Button>}
          <div style={{ height: 4 }} />
        </div>
      );
    };
    return <Content />;
  });
}

/** Small status pill for the Today header; hidden when sync isn't in use. */
export function SyncBadge() {
  const { sync } = useApp();
  if (sync.status === 'local' || (sync.status === 'signed_out' && !sync.message)) return null;
  const d = describe(sync);
  return (
    <Pressable onClick={syncSheet} aria-label={`Sync status: ${d.label}`} className="row-flex"
      style={{ gap: 6, padding: '5px 10px 5px 8px', borderRadius: 20, background: 'var(--card)', border: '1px solid var(--line)', color: d.tone, fontSize: 12.5, fontWeight: 600 }}>
      <Icon name={d.icon} size={17} className={d.spin ? 'pulse' : ''} />
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={d.label} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.15 }}>{d.label}</motion.span>
      </AnimatePresence>
    </Pressable>
  );
}
