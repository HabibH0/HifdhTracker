import { useState } from 'react';
import { useApp, setSettings } from '../lib/store.js';
import { nav } from '../lib/nav.js';
import { halfLabel, hizbNum, pageNum, pagesLabel } from '../lib/quran.js';
import { activeCycle, assignRevisionMaterial } from '../lib/strengthen.js';
import { assignSections, moveQueuedSection } from '../lib/revision-preferences.js';
import MaterialPicker, { emptySelection, selectionSummary, summaryLabel, toEngineSelection } from '../components/MaterialPicker.jsx';
import { Button, IconButton, Tag, TopBar } from '../components/ui.jsx';

export default function RevisionSections() {
  const { engine, settings } = useApp();
  const [mode, setMode] = useState(null);
  const [selection, setSelection] = useState(emptySelection);
  const summary = selectionSummary(selection);
  const cycle = activeCycle(engine);
  const queue = settings.strengthenQueue ?? [];
  const maintenance = settings.maintenanceHalfJuzIds ?? [];
  const label = id => halfLabel(hizbNum(id));
  const knownPages = id => engine.metadata.pages.filter(p => p.halfJuzId === id && engine.state.pages[p.id].memorizedAyahIds.length).map(p => pageNum(p.id));
  const choose = kind => { setSelection(emptySelection()); setMode(kind); };
  const add = () => {
    try {
      assignRevisionMaterial(toEngineSelection(selection), mode);
      setMode(null);
      nav.toast(mode === 'relearn' ? 'Added to relearning queue' : 'Added to maintenance');
    } catch (error) { nav.toast(error.message, 'alert'); }
  };
  const remove = id => setSettings(assignSections(settings, [id], 'automatic'));
  return <div className="layer">
    <TopBar title={mode ? mode === 'relearn' ? 'Add to relearning' : 'Add to maintenance' : 'Manage revision'} onBack={() => mode ? setMode(null) : nav.pop()} />
    {mode ? <>
      <div className="scroll pad" style={{ paddingBottom: 20 }}>
        <p className="sub">{mode === 'relearn' ? 'Choose material you want to rebuild through the three-stage cycle.' : 'Choose strong material you already know and want to keep in regular rotation.'} You can select existing or newly added material.</p>
        <p className="tiny">Sections are grouped by half-juz. For partly memorized sections, only the material you have added is revised.</p>
        <MaterialPicker value={selection} onChange={setSelection} />
      </div>
      <div className="footer border"><Button size="lg" block disabled={!summary.ayat} onClick={add}>Add{summary.ayat ? ` · ${summaryLabel(summary)}` : ' material'}</Button></div>
    </> : <div className="scroll pad" style={{ paddingBottom: 'calc(var(--safe-b) + 24px)' }}>
      <p className="sub">Choose what to rebuild and what to maintain. Your daily plan fits both around due reviews and your available time.</p>
      {cycle && <div className="card pad-card stack gap-8">
        <Tag tone="green">Relearning now · Stage {cycle.stage} of 3</Tag>
        <h3>{label(cycle.halfJuzId)}</h3>
        <div className="tiny">{pagesLabel(cycle.pageIds.map(pageNum))} · The next queued section starts after this cycle finishes.</div>
      </div>}
      <div className="section-title"><h3>Relearning queue</h3><span className="tiny">{queue.length} waiting</span></div>
      <div className="stack gap-8">
        {!queue.length && <p className="small">Add sections in the order you want to relearn them.</p>}
        {queue.map((id, i) => <div className="card pad-card row-flex" key={id} style={{ gap: 8 }}>
          <div className="grow"><div className="label">{i + 1}. {label(id)}</div><div className="tiny">{pagesLabel(knownPages(id))}</div></div>
          <IconButton icon="arrowUp" label={`Move ${label(id)} earlier`} disabled={i === 0} onClick={() => setSettings({ strengthenQueue: moveQueuedSection(queue, id, -1) })} />
          <IconButton icon="close" label={`Remove ${label(id)} from queue`} onClick={() => remove(id)} />
        </div>)}
        <Button variant="secondary" block onClick={() => choose('relearn')}>Add sections to relearn</Button>
      </div>
      <div className="section-title"><h3>Maintenance</h3><span className="tiny">{maintenance.length} sections</span></div>
      <p className="small">These enter regular review immediately, even while the app is still learning your strength. Actual recall continues to determine review timing and any repairs.</p>
      <div className="stack gap-8">
        {maintenance.map(id => <div className="card pad-card row-flex" key={id} style={{ gap: 8 }}>
          <div className="grow"><div className="label">{label(id)}</div><div className="tiny">{pagesLabel(knownPages(id))}{cycle?.halfJuzId === id ? ' · Currently needs relearning' : ''}</div></div>
          <IconButton icon="close" label={`Remove ${label(id)} from maintenance`} onClick={() => remove(id)} />
        </div>)}
        <Button variant="secondary" block onClick={() => choose('maintenance')}>Add strong sections to maintain</Button>
      </div>
      <p className="tiny" style={{ marginTop: 18 }}>Removing a section from these lists returns it to automatic scheduling. Your memorized material and revision history are kept.</p>
    </div>}
  </div>;
}
