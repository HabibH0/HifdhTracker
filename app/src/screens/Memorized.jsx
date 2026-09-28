import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useApp, mutate, nowIso } from '../lib/store.js';
import { nav } from '../lib/nav.js';
import { JUZ_PAGES, pageId } from '../lib/quran.js';
import { Button, TopBar } from '../components/ui.jsx';
import MaterialPicker, { emptySelection, selectionSummary, summaryLabel, toEngineSelection } from '../components/MaterialPicker.jsx';
import { STRENGTHS } from './Onboarding.jsx';

export default function Memorized() {
  const { engine, version } = useApp();
  const [sel, setSel] = useState(emptySelection);

  const { known, inventory, completeJuz } = useMemo(() => {
    const inv = engine.getMemorizedMaterial();
    return {
      inventory: inv,
      known: new Set(inv.ayahIds),
      completeJuz: JUZ_PAGES.filter(pages => pages.every(n => engine.state.pages[pageId(n)].coverage === 'complete')).length,
    };
  }, [engine, version]);
  const summary = useMemo(() => selectionSummary(sel, known), [sel, known]);

  const add = () => nav.openSheet(close => (
    <div className="stack gap-12">
      <h2>How well do you know it?</h2>
      <p className="sub" style={{ margin: 0 }}>{summaryLabel(summary)}. Your existing history is kept; only the new material starts here.</p>
      {STRENGTHS.map(s => (
        <Button key={s.value} variant="secondary" size="lg" block style={{ justifyContent: 'space-between' }} onClick={() => {
          try {
            mutate(e => e.addMemorizedMaterial({ occurredAt: nowIso(), initialStrength: s.value, selection: toEngineSelection(sel) }));
            close(); setSel(emptySelection());
            nav.toast('Added to your plan');
          } catch (err) { nav.toast(err.message, 'alert'); }
        }}>
          <span>{s.label}</span><span className="tiny" style={{ fontWeight: 400 }}>{s.sub}</span>
        </Button>
      ))}
      <div style={{ height: 4 }} />
    </div>
  ));

  return (
    <div className="layer">
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
            <Button size="lg" block onClick={add}>Add {summaryLabel(summary)}</Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
