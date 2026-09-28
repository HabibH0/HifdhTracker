import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createEngine, getState } from '../lib/store.js';
import { api } from '../lib/api.js';
import { AccountForm } from './Account.jsx';
import { seedDemo } from '../lib/demo.js';
import MaterialPicker, { emptySelection, selectionSummary, summaryLabel, toEngineSelection } from '../components/MaterialPicker.jsx';
import { Button, IconButton, OptionGrid, spring } from '../components/ui.jsx';
import { Star, StarPattern } from '../components/Icons.jsx';

export const STRENGTHS = [
  { value: 'weak', label: 'Needs work', sub: 'Frequent slips; I need prompting' },
  { value: 'medium', label: 'Fairly solid', sub: 'Some mistakes, mostly recalled' },
  { value: 'strong', label: 'Strong', sub: 'I recite it confidently' },
];
export const CAPACITIES = [
  { value: 30, label: '30 min', sub: 'Light' },
  { value: 60, label: '60 min', sub: 'Standard' },
  { value: 90, label: '90 min', sub: 'Extended' },
  { value: 120, label: '120 min', sub: 'Intensive' },
];


const slide = { enter: d => ({ x: d > 0 ? 60 : -60, opacity: 0 }), center: { x: 0, opacity: 1 }, exit: d => ({ x: d > 0 ? -60 : 60, opacity: 0 }) };

export default function Onboarding() {
  const [[step, dir], setStep] = useState([0, 1]);
  const [sel, setSel] = useState(emptySelection);
  const [strength, setStrength] = useState(null);
  const [capacity, setCapacity] = useState(60);
  const [busy, setBusy] = useState(false);
  const summary = useMemo(() => selectionSummary(sel), [sel]);
  const pages = summary.ayat;
  const go = to => setStep([to, to > step ? 1 : -1]);

  const finish = () => {
    setBusy(true);
    setTimeout(() => createEngine({ memorized: toEngineSelection(sel), initialStrength: strength, capacity }), 30);
  };
  const demo = () => { setBusy(true); setTimeout(() => seedDemo(), 60); };

  return (
    <div className="layer">
      <AnimatePresence mode="popLayout" custom={dir} initial={false}>
        <motion.div key={step} className="layer" custom={dir} variants={slide} initial="enter" animate="center" exit="exit" transition={spring}>
          {step === 0 && (
            <>
              <div style={{ position: 'absolute', inset: 0, color: 'var(--pri)' }}><StarPattern opacity={0.07} /></div>
              <div className="grow stack pad" style={{ justifyContent: 'center', position: 'relative', gap: 18, paddingTop: 'var(--safe-t)' }}>
                <motion.div initial={{ rotate: -45, scale: 0.6, opacity: 0 }} animate={{ rotate: 0, scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 120, damping: 14, delay: 0.1 }} style={{ color: 'var(--pri)' }}>
                  <Star size={64} stroke={2.4} />
                </motion.div>
                <h1 className="h1" style={{ fontSize: 38 }}>Keep what you’ve memorized, strong.</h1>
                <p className="sub" style={{ margin: 0, fontSize: 16.5, lineHeight: 1.5 }}>Recite from your own mushaf. Each day you’ll get a clear revision plan, log mistakes in seconds, and tomorrow’s plan adapts on its own.</p>
              </div>
              <div className="footer" style={{ position: 'relative' }}>
                <Button size="lg" block onClick={() => go(1)} disabled={busy}>Get started</Button>
                {api.enabled && <Button variant="secondary" size="lg" block onClick={() => go(10)} disabled={busy}>I already have an account</Button>}
                <Button variant="ghost" block onClick={demo} disabled={busy}>{busy ? 'Preparing sample data…' : 'Explore with sample data'}</Button>
              </div>
            </>
          )}
          {step === 10 && (
            <>
              <div className="topbar"><IconButton icon="chevronLeft" onClick={() => go(0)} label="Back" /><div className="title" /><span className="spacer" /></div>
              <div className="scroll pad" style={{ paddingBottom: 24 }}>
                <h1 className="h2" style={{ marginBottom: 6 }}>Welcome back</h1>
                <p className="sub" style={{ margin: '0 0 18px' }}>Sign in to bring your revision history onto this device.</p>
                <AccountForm onDone={() => { if (!getState().engine) go(1); }} />
              </div>
            </>
          )}
          {step === 1 && (
            <>
              <div className="topbar"><IconButton icon="chevronLeft" onClick={() => go(0)} label="Back" /><div className="title" /><span className="spacer" /></div>
              <div className="pad stack gap-12" style={{ paddingBottom: 12 }}>
                <h1 className="h2">What have you memorized?</h1>
                <p className="sub" style={{ margin: 0 }}>Only this is scheduled. You can add more at any time.</p>
              </div>
              <div className="scroll pad" style={{ paddingBottom: 16 }}>
                <MaterialPicker value={sel} onChange={setSel} />
              </div>
              <div className="footer border">
                <div className="row-flex small" style={{ justifyContent: 'center', minHeight: 20 }}>
                  <AnimatePresence mode="wait"><motion.span key={summaryLabel(summary)} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}>{pages ? `${summaryLabel(summary)} selected` : 'Select by juz, surah, page or āyah'}</motion.span></AnimatePresence>
                </div>
                <Button size="lg" block disabled={!pages} onClick={() => go(2)}>Continue</Button>
              </div>
            </>
          )}
          {step === 2 && (
            <>
              <div className="topbar"><IconButton icon="chevronLeft" onClick={() => go(1)} label="Back" /><div className="title" /><span className="spacer" /></div>
              <div className="pad stack gap-12 grow">
                <h1 className="h2">How well do you know it right now?</h1>
                <p className="sub" style={{ margin: '0 0 8px' }}>A starting point only — your actual revisions quickly take over.</p>
                <div className="stack gap-8">
                  {STRENGTHS.map(s => (
                    <motion.button key={s.value} whileTap={{ scale: 0.98 }} onClick={() => setStrength(s.value)} className={`opt ${strength === s.value ? 'on' : ''}`} style={{ alignItems: 'flex-start', padding: '14px 18px', minHeight: 70 }}>
                      <span style={{ fontSize: 16 }}>{s.label}</span><span className="opt-sub" style={{ fontSize: 13.5 }}>{s.sub}</span>
                    </motion.button>
                  ))}
                </div>
              </div>
              <div className="footer"><Button size="lg" block disabled={!strength} onClick={() => go(3)}>Continue</Button></div>
            </>
          )}
          {step === 3 && (
            <>
              <div className="topbar"><IconButton icon="chevronLeft" onClick={() => go(2)} label="Back" /><div className="title" /><span className="spacer" /></div>
              <div className="pad stack gap-12 grow">
                <h1 className="h2">How much time most days?</h1>
                <p className="sub" style={{ margin: '0 0 8px' }}>You can change it for any single day from the Today screen.</p>
                <OptionGrid columns={2} options={CAPACITIES} value={capacity} onChange={setCapacity} />
              </div>
              <div className="footer"><Button size="lg" block onClick={finish} disabled={busy}>{busy ? 'Building your plan…' : 'Build my plan'}</Button></div>
            </>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
