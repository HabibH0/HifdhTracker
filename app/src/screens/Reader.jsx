import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useApp, getState, setLastPage, mutate, nowIso, newId, addWordMarks, setSessionMeta, today } from '../lib/store.js';
import { nav, useNav } from '../lib/nav.js';
import { PAGE_COUNT, pageMeta, pageSurahs, ayahLabel, pageId } from '../lib/quran.js';
import { MISTAKE_TYPES, contextOf, mistakeLabel } from '../lib/session.js';
import { groupInfo, pageMarks, pageStrength, troublesome } from '../lib/stats.js';
import { MushafPage, WordGlyph } from '../components/MushafPage.jsx';
import { Button, IconButton, Tag, spring } from '../components/ui.jsx';
import { preload } from '../lib/mushaf.js';

const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });

function WordSheet({ w, close }) {
  const { engine, wordMarks } = getState();
  const [type, setType] = useState(null);
  const page = engine.state.pages[pageId(w.page)];
  const memorized = page.memorizedAyahIds.includes(w.ayahId);
  const mistakes = engine.state.mistakes.filter(m => m.ayahId === w.ayahId);
  const wordHits = w.pos ? wordMarks.filter(m => m.ayahId === w.ayahId && m.pos === w.pos) : [];
  const trouble = troublesome().find(t => t.ayahId === w.ayahId);
  const log = () => {
    const sessionId = newId('s');
    mutate(e => e.recordRevision({ sessionId, occurredAt: nowIso(), activity: 'memory', purpose: 'targeted', pages: [{ pageId: pageId(w.page), scope: 'ayah', ayahIds: contextOf(w.page, w.ayahId), accuracy: 'good', fluency: 'hesitant', mistakes: [{ ayahId: w.ayahId, ...(type ? { type } : {}) }] }] }));
    addWordMarks([{ page: w.page, ayahId: w.ayahId, pos: w.pos, type, sessionId, date: today() }]);
    setSessionMeta(sessionId, { title: `Mistake · ${w.ayahId}`, kind: 'targeted', subtitle: `Page ${w.page}` });
    close();
    nav.toast(`Mistake logged · ${w.ayahId}`, 'flag');
  };
  return (
    <div className="stack gap-12">
      <div className="row-flex" style={{ gap: 14 }}>
        <div style={{ minWidth: 64, height: 64, borderRadius: 16, background: 'var(--paper)', border: '1px solid var(--line)', display: 'grid', placeItems: 'center', padding: '0 10px' }}>
          <WordGlyph page={w.page} glyph={w.glyph} size={w.isEnd ? 34 : 40} />
        </div>
        <div className="grow">
          <h2 style={{ margin: 0 }}>{w.isEnd ? `Āyah ${w.ayahId}` : `Word ${w.pos}`}</h2>
          <div className="small">{ayahLabel(w.ayahId)} · page {w.page}</div>
        </div>
      </div>
      {(mistakes.length > 0 || wordHits.length > 0) ? (
        <div className="card list">
          {trouble && <div className="row"><Tag tone={trouble.troublesome ? 'amber' : 'green'}>{trouble.troublesome ? 'Weak point' : 'Resolved'}</Tag><span className="small grow">{trouble.troublesome ? `${trouble.cleanSessions} of 3 clean sessions` : 'Cleared after three clean sessions'}</span></div>}
          <div className="row"><span className="grow small">Mistakes on this āyah</span><span className="num" style={{ fontWeight: 600 }}>{mistakes.length}</span></div>
          {w.pos && <div className="row"><span className="grow small">Marked on this word</span><span className="num" style={{ fontWeight: 600 }}>{wordHits.length}</span></div>}
          {mistakes.length > 0 && <div className="row"><span className="grow small">Last mistake</span><span className="small">{dateFmt.format(new Date(mistakes.at(-1).occurredAt))}{mistakes.at(-1).type ? ` · ${mistakeLabel(mistakes.at(-1).type)}` : ''}</span></div>}
        </div>
      ) : <p className="small" style={{ margin: 0 }}>No mistakes recorded here.</p>}
      {memorized ? (
        <>
          <div className="section-title" style={{ margin: '6px 2px 0' }}><h3>Log a mistake from recitation</h3></div>
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', margin: '0 -20px', padding: '0 20px' }}>
            {MISTAKE_TYPES.map(t => <button key={t.value} className={`chip ${type === t.value ? 'on' : ''}`} style={{ flexShrink: 0 }} onClick={() => setType(type === t.value ? null : t.value)}>{t.label}</button>)}
          </div>
          <Button size="lg" block onClick={log}>Save mistake</Button>
        </>
      ) : <p className="small" style={{ margin: 0 }}>This āyah isn’t in your memorized material.</p>}
      <div style={{ height: 2 }} />
    </div>
  );
}

export default function Reader({ page: initial, highlight }) {
  const { settings } = useApp();
  const [[n, dir], setPage] = useState([initial, 0]);
  const [sel, setSel] = useState(null);
  const dragging = useRef(false);
  const strength = pageStrength()[n - 1];
  const marks = settings.showMarkers ? pageMarks(n) : null;
  const surahs = pageSurahs(n);
  const hl = useMemo(() => (highlight ? new Set([highlight]) : null), [highlight]);

  useEffect(() => { setLastPage(n); preload(n + 1); preload(n - 1); }, [n]);
  const go = d => { const next = n + d; if (next < 1 || next > PAGE_COUNT) return; setSel(null); setPage([next, d]); };

  const onWord = w => {
    if (dragging.current) return;
    setSel(w);
    nav.openSheet(close => <WordSheet w={w} close={close} />);
  };
  const { sheet } = useNav();
  useEffect(() => { if (!sheet) setSel(null); }, [sheet]);

  return (
    <div className="layer" style={{ background: 'var(--paper)' }}>
      <div className="topbar" style={{ background: 'var(--paper)' }}>
        <IconButton icon="chevronLeft" onClick={() => nav.pop()} label="Back" />
        <div className="title stack" style={{ gap: 0 }}>
          <span className="num">Page {n}</span>
          <span className="tiny" style={{ fontWeight: 400 }}>Juz {pageMeta(n).juz} · {surahs.map(s => s.en).join(' · ')}</span>
        </div>
        <span style={{ width: 44, display: 'grid', placeItems: 'center' }} title={groupInfo(strength.group).label}>
          <span className="dot" style={{ width: 10, height: 10, background: groupInfo(strength.group).color }} />
        </span>
      </div>
      <div className="grow" style={{ position: 'relative', overflow: 'hidden' }}>
        <AnimatePresence initial={false} custom={dir}>
          <motion.div key={n} custom={dir} style={{ position: 'absolute', inset: '4px 10px 8px', touchAction: 'pan-y' }}
            variants={{ enter: d => ({ x: d > 0 ? '-105%' : d < 0 ? '105%' : 0, opacity: d ? 1 : 0 }), center: { x: 0, opacity: 1 }, exit: d => ({ x: d > 0 ? '105%' : '-105%', opacity: 1 }) }}
            initial="enter" animate="center" exit="exit" transition={spring}
            drag="x" dragConstraints={{ left: 0, right: 0 }} dragElastic={0.35}
            onDragStart={() => { dragging.current = true; }}
            onDragEnd={(e, info) => { setTimeout(() => { dragging.current = false; }, 60); if (info.offset.x > 70 || info.velocity.x > 500) go(1); else if (info.offset.x < -70 || info.velocity.x < -500) go(-1); }}>
            <MushafPage n={n} selected={sel?.page === n ? sel : null} wordMarks={marks?.words} ayahMarks={marks?.ayahs} highlight={hl} onWord={onWord} />
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="row-flex" style={{ padding: '6px 16px calc(var(--safe-b) + 12px)', gap: 10 }}>
        <IconButton icon="chevronLeft" label="Next page" onClick={() => go(1)} />
        <input type="range" min={1} max={PAGE_COUNT} value={n} dir="rtl" onChange={e => { const v = +e.target.value; setSel(null); setPage([v, v > n ? 1 : -1]); }}
          style={{ flex: 1, accentColor: 'var(--pri)' }} aria-label="Page" />
        <IconButton icon="chevronRight" label="Previous page" onClick={() => go(-1)} />
      </div>
    </div>
  );
}

