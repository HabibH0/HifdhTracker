import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { JUZ_PAGES, HIZB_PAGES, PAGES, SURAHS, pageSurahs } from '../lib/quran.js';
import { Button, IconButton, Segmented } from './ui.jsx';
import { Icon } from './Icons.jsx';

/** Selection of newly memorized material, at any granularity the engine accepts. */
export const emptySelection = () => ({ juz: new Set(), surahs: new Set(), pages: new Set(), ranges: [] });

export function toEngineSelection(sel) {
  return {
    juzIds: [...sel.juz].map(j => `j${j}`),
    surahs: [...sel.surahs],
    pageIds: [...sel.pages].map(p => `p${p}`),
    ayahRanges: sel.ranges.map(r => ({ fromAyahId: `${r.s}:${r.from}`, toAyahId: `${r.s}:${r.to}` })),
  };
}

/** Ayat the selection would newly add, given what is already known. */
export function freshAyat(sel, known = new Set()) {
  const ayat = new Set();
  for (const j of sel.juz) for (const p of JUZ_PAGES[j - 1]) PAGES[p - 1].ayahs.forEach(a => ayat.add(a));
  for (const p of sel.pages) PAGES[p - 1].ayahs.forEach(a => ayat.add(a));
  for (const s of sel.surahs) for (let a = 1; a <= SURAHS[s - 1].verses; a++) ayat.add(`${s}:${a}`);
  for (const r of sel.ranges) for (let a = r.from; a <= r.to; a++) ayat.add(`${r.s}:${a}`);
  return new Set([...ayat].filter(a => !known.has(a)));
}

export function selectionSummary(sel, known = new Set()) {
  const fresh = freshAyat(sel, known);
  const pages = PAGES.filter(p => p.ayahs.some(a => fresh.has(a))).length;
  return { ayat: fresh.size, pages };
}

export function summaryLabel({ ayat, pages }) {
  if (!ayat) return '';
  const a = `${ayat} āyah${ayat === 1 ? '' : 's'}`.replace('āyahs', 'āyāt');
  return `${pages} page${pages === 1 ? '' : 's'} · ${a}`;
}

const pageKnown = (p, known) => {
  const list = PAGES[p - 1].ayahs, k = list.filter(a => known.has(a)).length;
  return k === 0 ? 0 : k === list.length ? 1 : k / list.length;
};

function Tile({ label, sub, on, fraction = 0, onClick, height = 52 }) {
  const full = fraction >= 1;
  return (
    <motion.button whileTap={{ scale: 0.92 }} disabled={full} onClick={onClick}
      style={{ height, borderRadius: 14, fontWeight: 600, fontSize: 16, position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1,
        background: on ? 'var(--pri)' : full ? 'var(--pri-soft)' : 'var(--card)', color: on ? 'var(--pri-ink)' : full ? 'var(--pri-soft-ink)' : 'var(--ink)',
        border: `1.5px solid ${on ? 'var(--pri)' : full ? 'transparent' : 'var(--line-2)'}`, transition: 'background .18s, color .18s, border-color .18s' }}>
      {fraction > 0 && !full && !on && <span style={{ position: 'absolute', left: 0, bottom: 0, height: 4, width: `${fraction * 100}%`, background: 'var(--pri-soft-ink)', opacity: 0.5 }} />}
      <span className="num" style={{ position: 'relative' }}>{label}</span>
      {sub && <span style={{ position: 'relative', fontSize: 10, fontWeight: 500, opacity: 0.7, maxWidth: '92%' }} className="ellipsis">{sub}</span>}
    </motion.button>
  );
}

function JuzMode({ sel, toggle, known }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
      {JUZ_PAGES.map((pages, i) => {
        const frac = pages.reduce((s, p) => s + pageKnown(p, known), 0) / pages.length;
        return <Tile key={i} label={i + 1} on={sel.juz.has(i + 1)} fraction={frac} onClick={() => toggle('juz', i + 1)} />;
      })}
    </div>
  );
}

function SurahMode({ sel, toggle, known }) {
  return (
    <div className="card list" style={{ overflow: 'hidden' }}>
      {SURAHS.map(s => {
        let k = 0;
        for (let a = 1; a <= s.verses; a++) if (known.has(`${s.n}:${a}`)) k++;
        const have = k === s.verses, on = sel.surahs.has(s.n);
        return (
          <button key={s.n} className="row" style={{ minHeight: 52, opacity: have ? 0.55 : 1 }} disabled={have} onClick={() => toggle('surahs', s.n)}>
            <span className="tiny num" style={{ width: 26, textAlign: 'right' }}>{s.n}</span>
            <span className="grow">
              <span className="label" style={{ display: 'block' }}>{s.en}</span>
              <span className="tiny">{s.verses} āyāt · p. {s.pages[0]}{s.pages[1] !== s.pages[0] ? `–${s.pages[1]}` : ''}{k && !have ? ` · ${k} memorized` : ''}</span>
            </span>
            <span style={{ width: 26, height: 26, borderRadius: 8, display: 'grid', placeItems: 'center', background: on || have ? 'var(--pri)' : 'transparent', border: `1.5px solid ${on || have ? 'var(--pri)' : 'var(--line-2)'}`, color: 'var(--pri-ink)' }}>
              {(on || have) && <Icon name="check" size={16} stroke={2.6} />}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function PageMode({ sel, toggle, setPages, known }) {
  const [juz, setJuz] = useState(() => {
    const firstOpen = JUZ_PAGES.findIndex(pages => pages.some(p => pageKnown(p, known) < 1));
    return firstOpen < 0 ? 30 : firstOpen + 1;
  });
  const halves = [juz * 2 - 1, juz * 2];
  const selectHalf = h => {
    const open = HIZB_PAGES[h - 1].filter(p => pageKnown(p, known) < 1);
    const all = open.every(p => sel.pages.has(p));
    setPages(prev => { const next = new Set(prev); open.forEach(p => (all ? next.delete(p) : next.add(p))); return next; });
  };
  return (
    <div className="stack gap-12">
      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', margin: '0 -20px', padding: '2px 20px' }}>
        {JUZ_PAGES.map((_, i) => (
          <button key={i} className={`chip ${juz === i + 1 ? 'on' : ''}`} style={{ flexShrink: 0, minWidth: 64, justifyContent: 'center' }} onClick={() => setJuz(i + 1)}>Juz {i + 1}</button>
        ))}
      </div>
      <div className="row-flex" style={{ gap: 8 }}>
        {halves.map((h, k) => {
          const open = HIZB_PAGES[h - 1].filter(p => pageKnown(p, known) < 1);
          const all = open.length > 0 && open.every(p => sel.pages.has(p));
          return <Button key={h} variant={all ? 'primary' : 'secondary'} size="sm" className="grow" style={{ height: 42 }} disabled={!open.length} onClick={() => selectHalf(h)}>{k ? 'Second half' : 'First half'}</Button>;
        })}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
        {JUZ_PAGES[juz - 1].map(p => <Tile key={p} label={p} sub={pageSurahs(p)[0].en} height={58} on={sel.pages.has(p)} fraction={pageKnown(p, known)} onClick={() => toggle('pages', p)} />)}
      </div>
    </div>
  );
}

function knownRanges(s, known) {
  const out = [];
  for (let a = 1; a <= SURAHS[s - 1].verses; a++) {
    if (!known.has(`${s}:${a}`)) continue;
    let b = a;
    while (b + 1 <= SURAHS[s - 1].verses && known.has(`${s}:${b + 1}`)) b++;
    out.push(a === b ? `${a}` : `${a}–${b}`);
    a = b;
  }
  return out;
}

function Stepper({ label, value, min, max, onChange }) {
  const clamp = v => Math.min(max, Math.max(min, v || min));
  return (
    <div className="grow stack gap-4">
      <span className="tiny">{label}</span>
      <div className="row-flex" style={{ gap: 4, background: 'var(--card)', border: '1px solid var(--line-2)', borderRadius: 14, padding: 3 }}>
        <IconButton icon="minus" size={18} label={`${label} down`} onClick={() => onChange(clamp(value - 1))} />
        <input inputMode="numeric" value={value} onChange={e => onChange(clamp(+e.target.value.replace(/\D/g, '')))}
          style={{ width: '100%', minWidth: 0, textAlign: 'center', border: 0, background: 'transparent', fontWeight: 600, fontSize: 17, outline: 'none' }} />
        <IconButton icon="plus" size={18} label={`${label} up`} onClick={() => onChange(clamp(value + 1))} />
      </div>
    </div>
  );
}

function AyahMode({ sel, setRanges, known }) {
  const [s, setS] = useState(() => (SURAHS.find(x => !knownRanges(x.n, known).join('').includes(`1–${x.verses}`)) ?? SURAHS[0]).n);
  const surah = SURAHS[s - 1];
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(Math.min(5, surah.verses));
  const pick = n => { setS(n); setFrom(1); setTo(Math.min(5, SURAHS[n - 1].verses)); };
  const have = knownRanges(s, known);
  const add = () => { setRanges(prev => [...prev, { s, from: Math.min(from, to), to: Math.max(from, to) }]); setFrom(Math.min(Math.max(from, to) + 1, surah.verses)); setTo(Math.min(Math.max(from, to) + 5, surah.verses)); };
  return (
    <div className="stack gap-12">
      <div className="stack gap-4">
        <span className="tiny">Surah</span>
        <select value={s} onChange={e => pick(+e.target.value)}
          style={{ height: 50, borderRadius: 14, border: '1px solid var(--line-2)', background: 'var(--card)', padding: '0 12px', fontWeight: 600 }}>
          {SURAHS.map(x => <option key={x.n} value={x.n}>{x.n}. {x.en} ({x.verses})</option>)}
        </select>
        {have.length > 0 && <span className="tiny">Already memorized: {have.join(', ')}</span>}
      </div>
      <div className="row-flex" style={{ gap: 10 }}>
        <Stepper label="From āyah" value={from} min={1} max={surah.verses} onChange={setFrom} />
        <Stepper label="To āyah" value={to} min={1} max={surah.verses} onChange={setTo} />
      </div>
      <Button variant="soft" size="lg" block onClick={add}><Icon name="plus" size={18} />Add {surah.en} {s}:{Math.min(from, to)}{from !== to ? `–${Math.max(from, to)}` : ''}</Button>
      <AnimatePresence initial={false}>
        {sel.ranges.map((r, i) => (
          <motion.div key={`${r.s}:${r.from}:${r.to}:${i}`} layout initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }} className="card row" style={{ minHeight: 48 }}>
            <Icon name="check" size={18} style={{ color: 'var(--pri-soft-ink)' }} />
            <span className="grow label">{SURAHS[r.s - 1].en} {r.s}:{r.from}{r.to !== r.from ? `–${r.to}` : ''}</span>
            <IconButton icon="close" size={18} label="Remove" onClick={() => setRanges(prev => prev.filter((_, k) => k !== i))} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/**
 * value/onChange: selection from emptySelection(); known: Set of already-memorized ayahIds.
 */
export default function MaterialPicker({ value, onChange, known = new Set() }) {
  const [mode, setMode] = useState('juz');
  const toggle = (key, v) => onChange(prev => { const next = new Set(prev[key]); next.has(v) ? next.delete(v) : next.add(v); return { ...prev, [key]: next }; });
  const setPages = fn => onChange(prev => ({ ...prev, pages: fn(prev.pages) }));
  const setRanges = fn => onChange(prev => ({ ...prev, ranges: fn(prev.ranges) }));
  const props = { sel: value, toggle, known, setPages, setRanges };
  return (
    <div className="stack gap-12">
      <Segmented light value={mode} onChange={setMode} options={[{ value: 'juz', label: 'Juz' }, { value: 'surah', label: 'Surah' }, { value: 'page', label: 'Pages' }, { value: 'ayah', label: 'Āyāt' }]} />
      <motion.div key={mode} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}>
        {mode === 'juz' && <JuzMode {...props} />}
        {mode === 'surah' && <SurahMode {...props} />}
        {mode === 'page' && <PageMode {...props} />}
        {mode === 'ayah' && <AyahMode {...props} />}
      </motion.div>
    </div>
  );
}

