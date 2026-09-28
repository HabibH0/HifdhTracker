import { useRef } from 'react';
import { motion } from 'framer-motion';
import { useApp, setSettings, exportBackup, importBackup, resetAll } from '../lib/store.js';
import { nav } from '../lib/nav.js';
import { ensureOffline } from '../lib/mushaf.js';
import { downloadCloudBackup, logout, syncNow } from '../lib/cloud.js';
import { ago, describe, syncSheet } from '../components/SyncStatus.jsx';
import { Pressable, Segmented, Toggle, confirmSheet } from '../components/ui.jsx';
import { Icon, Star } from '../components/Icons.jsx';

function Section({ title, children }) {
  return (
    <>
      <div className="section-title"><h3>{title}</h3></div>
      <div className="card list" style={{ overflow: 'hidden' }}>{children}</div>
    </>
  );
}

function Row({ icon, label, sub, value, onClick, children, danger }) {
  const C = onClick ? Pressable : 'div';
  return (
    <C className="row" onClick={onClick} style={{ color: danger ? 'var(--danger)' : undefined }}>
      {icon && <Icon name={icon} size={20} style={{ color: danger ? 'var(--danger)' : 'var(--ink-3)', flexShrink: 0 }} />}
      <span className="grow">
        <span className="label" style={{ display: 'block' }}>{label}</span>
        {sub && <span className="tiny" style={{ display: 'block' }}>{sub}</span>}
      </span>
      {value != null && <span className="value">{value}</span>}
      {children}
      {onClick && !children && <Icon name="chevronRight" size={16} style={{ color: 'var(--ink-3)' }} />}
    </C>
  );
}

export default function Settings() {
  const { settings, engine, offline, sync } = useApp();
  const status = describe(sync);
  const file = useRef(null);
  const inventory = engine.getMemorizedMaterial();
  const pct = offline.total ? Math.round((offline.done / offline.total) * 100) : 0;

  const saveJson = (data, name) => {
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${name}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const exportData = () => { saveJson(exportBackup(), 'hifdh-backup'); nav.toast('Backup saved'); };
  const cloudBackup = async () => {
    try { saveJson(await downloadCloudBackup(), 'hifdh-cloud-backup'); nav.toast('Cloud backup saved'); }
    catch (err) { nav.toast(err.message, 'alert'); }
  };
  const restore = async e => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const json = JSON.parse(await f.text());
      confirmSheet({ title: 'Restore this backup?', body: 'It replaces everything currently on this device.', confirm: 'Restore', onConfirm: async () => {
        try { await importBackup(json); nav.toast('Backup restored'); } catch (err) { nav.toast(err.message, 'alert'); }
      } });
    } catch { nav.toast('That file couldn’t be read', 'alert'); }
  };
  const reminder = async on => {
    if (on && typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
      const p = await Notification.requestPermission();
      if (p !== 'granted') { nav.toast('Notifications are blocked for this app', 'alert'); return; }
    }
    setSettings({ reminder: { ...settings.reminder, on } });
  };

  return (
    <div className="scroll tab-scroll">
      <h1 className="h1">Settings</h1>

      {sync.enabled && (
        <Section title="Account & sync">
          {sync.account ? (
            <>
              <Row icon="user" label={sync.account.username} sub={`${status.label} · last synced ${ago(sync.lastSyncAt)}`} onClick={syncSheet}>
                <Icon name={status.icon} size={20} className={status.spin ? 'pulse' : ''} style={{ color: status.tone }} />
              </Row>
              <Row icon="refresh" label="Sync now" sub={sync.pending ? `${sync.pending} change${sync.pending === 1 ? '' : 's'} waiting to upload` : undefined} onClick={() => syncNow()} />
              <Row icon="download" label="Download cloud backup" sub="Everything stored in your account" onClick={cloudBackup} />
              <Row icon="logout" label="Sign out" onClick={() => confirmSheet({ title: 'Sign out?', body: 'Your revision stays on this device and keeps working. Syncing stops until you sign in again.', confirm: 'Sign out', onConfirm: () => logout().then(() => nav.toast('Signed out', 'logout')) })} />
            </>
          ) : (
            <Row icon="cloud" label="Sign in to sync" sub={sync.message ?? 'Keep a copy in the cloud and use more than one device'} onClick={() => nav.push('account')} />
          )}
        </Section>
      )}

      <Section title="Revision">
        <div className="row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10, paddingTop: 14, paddingBottom: 14 }}>
          <div className="row-flex" style={{ justifyContent: 'space-between' }}><span className="label">Daily revision time</span><span className="tiny">default</span></div>
          <Segmented value={settings.capacity} onChange={v => setSettings({ capacity: v, todayCapacity: null })} options={[30, 60, 90, 120].map(v => ({ value: v, label: `${v} min` }))} />
        </div>
        <Row icon="sparkle" label="Random-access testing" sub="Some reviews begin from a random āyah"><Toggle on={settings.randomAccess} onChange={v => setSettings({ randomAccess: v })} label="Random-access testing" /></Row>
        <Row icon="layers" label="Memorized material" value={`${inventory.totalTrackedPages} pages`} onClick={() => nav.push('memorized')} />
      </Section>

      <Section title="Mushaf">
        <Row icon="book" label="Edition" sub="King Fahd Complex · QCF V2 via Quran Foundation" value="Madinah 604" />
        <Row icon="flag" label="Show mistake markers" sub="Subtle dots under words you’ve slipped on"><Toggle on={settings.showMarkers} onChange={v => setSettings({ showMarkers: v })} label="Show mistake markers" /></Row>
        <Row icon={offline.complete ? 'shield' : 'download'} label="Available offline" sub={offline.complete ? 'All 604 pages stored on this device' : offline.total ? `Saving pages… ${pct}%` : 'Stored as you open pages'} onClick={offline.complete ? undefined : () => ensureOffline()}>
          {!offline.complete && offline.total > 0 && (
            <span style={{ width: 54, height: 6, borderRadius: 3, background: 'var(--line)', overflow: 'hidden' }}><motion.span animate={{ width: `${pct}%` }} style={{ display: 'block', height: '100%', background: 'var(--pri)' }} /></span>
          )}
          {offline.complete && <Icon name="check" size={18} style={{ color: 'var(--pri-soft-ink)' }} />}
        </Row>
      </Section>

      <Section title="Notifications">
        <Row icon="bell" label="Daily reminder"><Toggle on={settings.reminder.on} onChange={reminder} label="Daily reminder" /></Row>
        {settings.reminder.on && (
          <Row icon="clock" label="Reminder time">
            <input type="time" value={settings.reminder.time} onChange={e => setSettings({ reminder: { ...settings.reminder, time: e.target.value || '07:00' } })}
              style={{ border: '1px solid var(--line-2)', borderRadius: 10, background: 'var(--card-2)', padding: '6px 8px', color: 'var(--ink)' }} />
          </Row>
        )}
      </Section>

      <Section title="Appearance">
        <div className="row" style={{ paddingTop: 14, paddingBottom: 14 }}>
          <div className="grow"><Segmented light value={settings.theme} onChange={v => setSettings({ theme: v })} options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} /></div>
        </div>
      </Section>

      <Section title="Data">
        <Row icon="shield" label="Stored on this device" sub={sync.account ? 'Works fully offline; synced to your account when online.' : 'Works fully offline. Nothing is uploaded.'} />
        <Row icon="download" label="Export backup" sub="Save a copy of all your history" onClick={exportData} />
        <Row icon="upload" label="Restore from backup" onClick={() => file.current?.click()} />
        <Row icon="trash" label="Erase this device" danger onClick={() => confirmSheet({ title: 'Erase this device?', body: sync.account ? 'All revision data on this device is erased and you’re signed out. Your cloud copy is kept; sign in again to restore it.' : 'All revision history, mistakes and settings on this device will be erased. Export a backup first if you might need it.', confirm: 'Erase this device', onConfirm: async () => { if (sync.account) await logout(); await resetAll(); } })} />
        <input ref={file} type="file" accept="application/json,.json" hidden onChange={restore} />
      </Section>

      <Section title="About">
        <Row label="Version" value="1.0.0" />
        <Row label="Qur’an text" sub="Glyphs and layout are the official QCF V2 page fonts, stored locally. No text is generated." />
      </Section>

      <div className="stack" style={{ alignItems: 'center', gap: 8, marginTop: 28, color: 'var(--gold)' }}>
        <Star size={26} stroke={1.6} />
        <div className="small" style={{ textAlign: 'center', maxWidth: 240 }}>May Allah make it easy and beneficial.</div>
      </div>
    </div>
  );
}
