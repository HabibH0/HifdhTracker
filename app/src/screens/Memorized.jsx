import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useApp, mutate, nowIso } from '../lib/store.js';
import { nav } from '../lib/nav.js';
import { JUZ_PAGES, pageId } from '../lib/quran.js';
import { Button, IconButton, TopBar } from '../components/ui.jsx';
import MaterialPicker, { emptySelection, selectionSummary, summaryLabel, toEngineSelection } from '../components/MaterialPicker.jsx';
import SectionRater, { selectionSections, strengthMap } from '../components/SectionRater.jsx';

export default function Memorized() {
  const { engine, version } = useApp();
  const [sel, setSel] = useState(emptySelection);
  const [step, setStep] = useState('pick');
  const [ratings, setRatings] = useState({});

  const { known, inventory, completeJuz } = useMemo(() => {
    const inv = engine.getMemorizedMaterial();
    return {
      inventory: inv,
      known: new Set(inv.ayahIds),
      completeJuz: JUZ_PAGES.filter(pages => pages.every(n => engine.state.pages[pageId(n)].coverage === 'complete')).length,
    };
  }, [engine, version]);
  const summary = useMemo(() => selectionSummary(sel, known), [sel, known]);
  const sections = useMemo(() => selectionSections(sel, known), [sel, known]);
  const rated = sections.length > 0 && sections.every(s => ratings[s.hizb]);

  const add = () => {
    try {
      mutate(e => e.addMemorizedMaterial({ occurredAt: nowIso(), initialStrength: strengthMap(sections, ratings), selection: toEngineSelection(sel) }));
      const relearning = sections.filter(s => ratings[s.hizb] === 'very_weak').length;
      setSel(emptySelection()); setRatings({}); setStep('pick');
      nav.toast(relearning ? `Added · ${relearning} section${relearning === 1 ? '' : 's'} queued for strengthening` : 'Added to your plan');
    } catch (err) { nav.toast(err.message, 'alert'); }
  };

  return (
    <div className="layer">
      <AnimatePresence mode="popLayout" initial={false}>
        {step === 'pick' ? (
          <motion.div key="pick" className="layer" initial={{ x: -40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -40, opacity: 0 }} transition={{ duration: 0.2 }}>
            <TopBar title="Memorized material" onBack={() => nav.pop()} />
            <div className="scroll pad" style={{ paddingBottom: 24 }}>
              <div className="card pad-card row-flex" style={{ gap: 16, marginBottom: 16 }}>
                <div className="num" style={{ fontFamily: 'var(--serif)', fontSize: 34, lineHeight: 1 }}>{inventory.totalTrackedPages}</div>
                <div className="grow">
                  <div className="label" style={{ fontWeight: 600 }}>pages memorized</div>
                  <div className="tiny">{completeJuz} complete juz{inventory.partialPages ? ` · ${inventory.partialPages} partial page${inventory.partialPages === 1 ? '' : 's'}` : ''} · {inventory.ayahIds.length} āyāt</div>
                </div>
              </div>
              <MaterialPicker value={sel} onChange={setSel} known={known} />
              <p className="tiny" style={{ marginTop: 14 }}>Shaded items are already memorized; a bar shows partly memorized ones.</p>
            </div>
            <AnimatePresence>
              {summary.ayat > 0 && (
                <motion.div className="footer border" initial={{ y: 80 }} animate={{ y: 0 }} exit={{ y: 80 }}>
                  <Button size="lg" block onClick={() => setStep('rate')}>Continue · {summaryLabel(summary)}</Button>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        ) : (
          <motion.div key="rate" className="layer" initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }} transition={{ duration: 0.2 }}>
            <div className="topbar">
              <IconButton icon="chevronLeft" label="Back" onClick={() => setStep('pick')} />
              <div className="title">Rate new material</div>
              <span className="spacer" />
            </div>
            <div className="pad" style={{ paddingBottom: 12 }}>
              <p className="sub" style={{ margin: 0 }}>Relearning sections go through the 3-day strengthening cycle first. Your existing history is kept.</p>
            </div>
            <div className="scroll pad" style={{ paddingBottom: 16 }}>
              <SectionRater sections={sections} ratings={ratings} onChange={setRatings} />
            </div>
            <div className="footer border">
              <Button size="lg" block disabled={!rated} onClick={add}>{rated ? `Add ${summaryLabel(summary)}` : `Rate ${sections.filter(s => !ratings[s.hizb]).length} more`}</Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
