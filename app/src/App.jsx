import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { boot, useApp } from './lib/store.js';
import { nav, useNav } from './lib/nav.js';
import { ensureOffline, loadSurahNames } from './lib/mushaf.js';
import { Icon, Star } from './components/Icons.jsx';
import { SheetHost, ToastHost, spring } from './components/ui.jsx';
import Onboarding from './screens/Onboarding.jsx';
import Today from './screens/Today.jsx';
import MushafTab from './screens/MushafTab.jsx';
import Progress from './screens/Progress.jsx';
import Settings from './screens/Settings.jsx';
import Session from './screens/Session.jsx';
import MistakeLogger from './screens/MistakeLogger.jsx';
import Reader from './screens/Reader.jsx';
import WeakPoints from './screens/WeakPoints.jsx';
import Memorized from './screens/Memorized.jsx';
import RevisionSections from './screens/RevisionSections.jsx';
import SessionMistakes from './screens/SessionMistakes.jsx';
import History from './screens/History.jsx';
import Account from './screens/Account.jsx';
import { startSync, syncNow } from './lib/cloud.js';
import { startQueuedIfReady } from './lib/strengthen.js';
import { setStatus } from './lib/store.js';
import { Button } from './components/ui.jsx';
import { useReminder } from './lib/reminder.js';

const TABS = [
  { id: 'today', label: 'Today', icon: 'home', C: Today },
  { id: 'mushaf', label: 'Mushaf', icon: 'book', C: MushafTab },
  { id: 'progress', label: 'Progress', icon: 'chart', C: Progress },
  { id: 'settings', label: 'Settings', icon: 'gear', C: Settings },
];
const ROUTES = { session: Session, sessionMistakes: SessionMistakes, logMistake: MistakeLogger, reader: Reader, weakPoints: WeakPoints, memorized: Memorized, revisionSections: RevisionSections, history: History, account: Account };

const variants = {
  push: { initial: { x: '100%' }, animate: { x: 0 }, exit: { x: '100%' }, covered: { x: '-22%' } },
  modal: { initial: { y: '100%' }, animate: { y: 0 }, exit: { y: '100%' }, covered: { y: 0, scale: 0.96 } },
  fade: { initial: { opacity: 0, scale: 1.02 }, animate: { opacity: 1, scale: 1 }, exit: { opacity: 0 }, covered: { opacity: 1 } },
};

function TabBar({ tab }) {
  return (
    <nav className="tabbar">
      {TABS.map(t => (
        <button key={t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => nav.setTab(t.id)} aria-current={tab === t.id ? 'page' : undefined}>
          {tab === t.id && <motion.span layoutId="tab-pill" className="pill" transition={spring} />}
          <Icon name={t.icon} stroke={tab === t.id ? 2.1 : 1.8} />
          {t.label}
        </button>
      ))}
    </nav>
  );
}

function Shell() {
  const { tab, visited, stack } = useNav();
  const topMode = stack.at(-1)?.mode;
  useReminder();
  const { version, settings } = useApp();
  useEffect(() => { startQueuedIfReady(); }, [version, settings.strengthenQueue]);
  return (
    <>
      <motion.div className="layer" style={{ zIndex: 1 }} animate={stack.length && topMode === 'push' ? { x: '-22%' } : stack.length && topMode === 'modal' ? { scale: 0.96 } : { x: 0, scale: 1 }} transition={spring}>
        {TABS.filter(t => visited[t.id]).map(({ id, C }) => (
          <motion.div key={id} className="layer" initial={false} animate={{ opacity: tab === id ? 1 : 0, y: tab === id ? 0 : 10 }} transition={{ duration: 0.2, ease: 'easeOut' }}
            style={{ zIndex: tab === id ? 2 : 1, pointerEvents: tab === id ? 'auto' : 'none', visibility: undefined }} aria-hidden={tab !== id}>
            <C active={tab === id} />
          </motion.div>
        ))}
        <TabBar tab={tab} />
        <AnimatePresence>{stack.length > 0 && <motion.div key="dim" className="backdrop" style={{ zIndex: 20 }} initial={{ opacity: 0 }} animate={{ opacity: 0.35 }} exit={{ opacity: 0 }} />}</AnimatePresence>
      </motion.div>
      <AnimatePresence initial={false}>
        {stack.map((entry, i) => {
          const C = ROUTES[entry.type], v = variants[entry.mode] ?? variants.push, covered = i < stack.length - 1;
          return (
            <motion.div key={entry.id} className="layer" style={{ zIndex: 30 + i, boxShadow: '-10px 0 30px rgba(0,0,0,.06)' }}
              initial={v.initial} animate={covered ? v.covered : v.animate} exit={v.exit} transition={spring}>
              <C {...entry.props} top={!covered} />
            </motion.div>
          );
        })}
      </AnimatePresence>
    </>
  );
}

function Splash() {
  return (
    <div className="layer center" style={{ flexDirection: 'column', gap: 14, color: 'var(--pri)' }}>
      <motion.div animate={{ rotate: 45 }} transition={{ duration: 1.6, ease: 'easeInOut', repeat: Infinity, repeatType: 'reverse' }}><Star size={46} stroke={3} /></motion.div>
    </div>
  );
}

function Restoring({ sync }) {
  const stuck = sync.status === 'offline' || sync.status === 'error';
  return (
    <div className="layer center pad" style={{ flexDirection: 'column', gap: 16, textAlign: 'center' }}>
      <motion.div style={{ color: 'var(--pri)' }} animate={{ rotate: stuck ? 0 : 360 }} transition={{ duration: 6, ease: 'linear', repeat: stuck ? 0 : Infinity }}><Star size={46} stroke={2.4} /></motion.div>
      <h1 className="h2">{stuck ? 'Can’t reach your account' : 'Restoring your revision history…'}</h1>
      <p className="sub" style={{ margin: 0, maxWidth: 300 }}>{stuck ? 'Connect to the internet to bring your history onto this device.' : 'This only takes a moment.'}</p>
      {stuck && <div className="stack gap-8" style={{ width: '100%', maxWidth: 320 }}>
        <Button size="lg" block onClick={() => syncNow()}>Try again</Button>
        <Button variant="ghost" block onClick={() => setStatus('onboarding')}>Set up this device instead</Button>
      </div>}
    </div>
  );
}

export default function App() {
  const app = useApp();
  useEffect(() => { boot(); loadSurahNames(); }, []);
  useEffect(() => { if (app.status === 'ready') ensureOffline(); }, [app.status]);
  useEffect(() => { if (app.status !== 'loading' && app.status !== 'error') startSync(); }, [app.status]);
  return (
    <div className="app">
      <AnimatePresence initial={false}>
        <motion.div key={app.status} className="layer" style={{ zIndex: app.status === 'loading' ? 0 : 1 }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.2 } }} transition={{ duration: 0.3 }}>
          {app.status === 'loading' && <Splash />}
          {app.status === 'error' && <div className="layer center pad" style={{ textAlign: 'center' }}><p className="sub">Couldn’t open your data: {app.error}</p></div>}
          {app.status === 'onboarding' && <Onboarding />}
          {app.status === 'restoring' && <Restoring sync={app.sync} />}
          {app.status === 'ready' && <Shell />}
        </motion.div>
      </AnimatePresence>
      <SheetHost />
      <ToastHost />
    </div>
  );
}
