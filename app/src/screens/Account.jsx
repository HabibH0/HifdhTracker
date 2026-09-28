import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { nav } from '../lib/nav.js';
import { completeLogin, login, register } from '../lib/cloud.js';
import { NetworkError } from '../lib/apiClient.js';
import { Button, IconButton, Segmented, TopBar } from '../components/ui.jsx';
import { Icon, Star } from '../components/Icons.jsx';

function chooseMerge(res) {
  return new Promise(resolve => {
    nav.openSheet(close => (
      <div className="stack gap-12">
        <h2>This device already has revision history</h2>
        <p className="sub" style={{ margin: 0 }}>Your account “{res.user.username}” has history too. How should they come together?</p>
        <Button size="lg" block onClick={() => { close(); resolve('combine'); }}>Combine both</Button>
        <Button variant="secondary" size="lg" block onClick={() => { close(); resolve('replace'); }}>Use my account’s data only</Button>
        <p className="tiny" style={{ margin: 0 }}>“Use my account’s data only” removes this device’s history. Export a backup from Settings first if you might need it.</p>
        <Button variant="ghost" block onClick={() => { close(); resolve(null); }}>Cancel</Button>
        <div style={{ height: 4 }} />
      </div>
    ));
  });
}

/** Sign in / create account. onDone({ registered, restored }) after the account is attached. */
export function AccountForm({ onDone, initialMode = 'signin' }) {
  const [mode, setMode] = useState(initialMode);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const valid = username.trim().length >= 3 && password.length >= (mode === 'register' ? 8 : 1);

  const submit = async e => {
    e.preventDefault();
    if (!valid || busy) return;
    setError(null);
    try {
      if (mode === 'register') {
        setBusy('Creating your account…');
        await register(username.trim(), password);
        onDone?.({ registered: true });
      } else {
        setBusy('Signing in…');
        const { res, needsChoice } = await login(username.trim(), password);
        const choice = needsChoice ? await chooseMerge(res) : 'combine';
        if (!choice) { setBusy(null); return; }
        setBusy(res.hasData ? 'Restoring your revision history…' : 'Signing in…');
        await completeLogin(res, choice);
        onDone?.({ restored: res.hasData });
      }
    } catch (err) {
      setError(err instanceof NetworkError ? 'You’re offline. Revision still works — sign in when you’re connected.' : err.message);
      setBusy(null);
    }
  };

  return (
    <form className="stack gap-12" onSubmit={submit} autoComplete="on">
      <Segmented light value={mode} onChange={m => { setMode(m); setError(null); }} options={[{ value: 'signin', label: 'Sign in' }, { value: 'register', label: 'Create account' }]} />
      <label className="stack gap-4">
        <span className="tiny">Username</span>
        <input className="field" value={username} onChange={e => setUsername(e.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false}
          autoComplete="username" name="username" maxLength={32} placeholder="e.g. aisha" />
      </label>
      <label className="stack gap-4">
        <span className="tiny">Password{mode === 'register' ? ' · at least 8 characters' : ''}</span>
        <div style={{ position: 'relative' }}>
          <input className="field" type={show ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'} name="password" maxLength={256} style={{ paddingRight: 52 }} />
          <span style={{ position: 'absolute', right: 4, top: 3 }}><IconButton type="button" icon={show ? 'eyeOff' : 'eye'} size={20} label={show ? 'Hide password' : 'Show password'} onClick={() => setShow(!show)} /></span>
        </div>
      </label>
      <AnimatePresence>
        {error && <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="small" role="alert" style={{ color: 'var(--danger)' }}>{error}</motion.div>}
      </AnimatePresence>
      <Button size="lg" block type="submit" disabled={!valid || !!busy}>{busy ?? (mode === 'register' ? 'Create account' : 'Sign in')}</Button>
      {mode === 'register' && <p className="tiny" style={{ margin: 0 }}>No email needed. There’s no password reset, so keep your password somewhere safe.</p>}
    </form>
  );
}

export default function Account() {
  return (
    <div className="layer">
      <TopBar title="Account" onBack={() => nav.pop()} />
      <div className="scroll pad" style={{ paddingBottom: 'calc(var(--safe-b) + 24px)' }}>
        <div className="stack" style={{ alignItems: 'flex-start', gap: 10, margin: '4px 0 20px' }}>
          <span style={{ color: 'var(--pri)' }}><Star size={40} stroke={2.2} /></span>
          <h1 className="h2">Sync across your devices</h1>
          <p className="sub" style={{ margin: 0 }}>Your revision always works offline on this device. An account keeps a copy in the cloud and brings your phone and tablet in step.</p>
        </div>
        <AccountForm onDone={({ registered }) => { nav.pop(); nav.toast(registered ? 'Account created · syncing' : 'Signed in · syncing', 'cloudCheck'); }} />
        <div className="row-flex tiny" style={{ gap: 8, marginTop: 20 }}><Icon name="shield" size={16} />Passwords are stored only as secure hashes.</div>
      </div>
    </div>
  );
}
