import { useState } from 'react';
import { motion } from 'framer-motion';
import { useApp } from '../lib/store.js';
import { nav } from '../lib/nav.js';
import { SURAHS, JUZ_PAGES, halfLabel, pagesLabel, pageSurahs, PAGE_COUNT } from '../lib/quran.js';
import { GROUPS, NONE, groupInfo, juzStrength, pageStrength } from '../lib/stats.js';
import { Button, Pressable, Segmented, Tag, Stagger, staggerItem } from '../components/ui.jsx';
import { Icon, Star } from '../components/Icons.jsx';
import { preload } from '../lib/mushaf.js';
import { activeCycle, queueStrengthen, strengthenNow, unqueueStrengthen } from '../lib/strengthen.js';
import { confirmSheet } from '../components/ui.jsx';

function StrengthenControl({ hizb, known }) {
  const { engine, settings } = useApp();
  if (!known) return null;
  const id = `h${hizb}`, label = halfLabel(hizb), cycle = activeCycle(engine);
  const queue = settings.strengthenQueue ?? [];
  if (cycle?.halfJuzId === id) return <Tag tone="green" icon="layers">Strengthening · Day {cycle.stage} of 3</Tag>;
  if (queue.includes(id)) return (
    <div className="row-flex" style={{ justifyContent: 'space-between' }}>
      <Tag tone="blue" icon="layers">Queued · {queue.indexOf(id) + 1} of {queue.length}</Tag>
      <button className="link" onClick={() => unqueueStrengthen(id)}>Remove</button>
    </div>
  );
  if (cycle) return <Button variant="secondary" size="sm" block onClick={() => { queueStrengthen(id); nav.toast(`${label} queued for strengthening`, 'layers'); }}>Strengthen next</Button>;
  return <Button variant="soft" size="sm" block onClick={() => confirmSheet({
    title: `Strengthen ${label}?`, body: 'It goes through the 3-day cycle starting today. Once started it can’t be cancelled, and no other section starts until it finishes.',
    confirm: 'Start today', tone: 'primary',
    onConfirm: () => { try { strengthenNow(id); nav.toast('Added to today’s plan · Day 1 of 3', 'layers'); } catch (e) { nav.toast(e.message, 'alert'); } },
  })}><Icon name="layers" size={16} />Strengthen now</Button>;
}

export const tint = (color, pct = 22) => `color-mix(in srgb, ${color} ${pct}%, var(--card))`;
const pad3 = n => String(n).padStart(3, '0');

export function Legend({ none = true }) {
  return (
    <div className="legend">
      {[...GROUPS, ...(none ? [NONE] : [])].map(g => <span key={g.id}><i style={{ background: g.color }} />{g.label}</span>)}
    </div>
  );
}

export function openReader(page, extra = {}) {
  preload(page);
  nav.push('reader', { page, ...extra });
}

export function juzSheet(j) {
  nav.openSheet(close => {
    const juz = juzStrength()[j - 1], pages = pageStrength();
    const g = groupInfo(juz.group);
    return (
      <div className="stack gap-12">
        <div className="row-flex" style={{ justifyContent: 'space-between' }}>
          <h2>Juz {j}</h2>
          <Tag tone="grey"><i className="dot" style={{ background: g.color, width: 7, height: 7 }} />{juz.known ? g.label : 'Not memorized'}</Tag>
        </div>
        <div className="small" style={{ marginTop: -8 }}>{pagesLabel(juz.pages)} · {pageSurahs(juz.pages[0])[0].en} – {pageSurahs(juz.pages.at(-1)).at(-1).en}</div>
        {juz.halves.map(h => {
          const hg = groupInfo(h.group);
          return (
            <div key={h.hizb} className="card pad-card stack gap-8">
              <div className="row-flex" style={{ justifyContent: 'space-between' }}>
                <span className="h3" style={{ fontSize: 15 }}>{halfLabel(h.hizb).split(' · ')[1]}</span>
                <span className="tiny">{h.known.length ? `${hg.label}${h.coverage === 'partial' ? ` · ${h.known.length}/${h.pages.length} pages` : ''}` : 'Not memorized'}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', gap: 4 }}>
                {h.pages.map(n => (
                  <motion.button key={n} whileTap={{ scale: 0.9 }} onClick={() => { close(); setTimeout(() => openReader(n), 200); }}
                    style={{ aspectRatio: '0.72', borderRadius: 5, background: groupInfo(pages[n - 1].group).color, opacity: pages[n - 1].group === 'none' ? 1 : 0.92, fontSize: 9.5, color: pages[n - 1].group === 'none' ? 'var(--ink-3)' : '#fff', fontWeight: 600 }} className="num" aria-label={`Page ${n}`}>
                    {n}
                  </motion.button>
                ))}
              </div>
              {h.overdue > 0 && <div className="tiny" style={{ color: 'var(--amber-ink)' }}>{h.overdue} page{h.overdue === 1 ? '' : 's'} overdue for review</div>}
              <StrengthenControl hizb={h.hizb} known={h.known.length > 0} />
            </div>
          );
        })}
        <Button size="lg" block onClick={() => { close(); setTimeout(() => openReader(juz.pages[0]), 200); }}><Icon name="book" size={18} />Open Juz {j}</Button>
        {!juz.known && <Button variant="ghost" block onClick={() => { close(); setTimeout(() => nav.push('memorized'), 200); }}>Add to memorized material</Button>}
        <div style={{ height: 4 }} />
      </div>
    );
  });
}

function JuzGrid() {
  const juz = juzStrength();
  return (
    <Stagger style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }} delay={0.012}>
      {juz.map(j => {
        const g = groupInfo(j.group);
        return (
          <motion.button key={j.juz} variants={staggerItem} whileTap={{ scale: 0.92 }} onClick={() => juzSheet(j.juz)}
            style={{ aspectRatio: '1', borderRadius: 16, position: 'relative', overflow: 'hidden', background: j.known ? tint(g.color, 26) : 'var(--card)', border: `1.5px solid ${j.known ? tint(g.color, 55) : 'var(--line)'}`, color: 'var(--ink)' }}>
            <span className="num" style={{ fontSize: 18, fontWeight: 600, position: 'relative' }}>{j.juz}</span>
            {j.known > 0 && j.fraction < 1 && <span style={{ position: 'absolute', left: 8, right: 8, bottom: 7, height: 3, borderRadius: 2, background: 'var(--line-2)' }}><span style={{ display: 'block', height: '100%', width: `${j.fraction * 100}%`, background: g.color, borderRadius: 2 }} /></span>}
          </motion.button>
        );
      })}
    </Stagger>
  );
}

function SurahList() {
  const pages = pageStrength();
  return (
    <div className="card list" style={{ overflow: 'hidden' }}>
      {SURAHS.map(s => {
        const range = pages.slice(s.pages[0] - 1, s.pages[1]);
        const known = range.filter(p => p.group !== 'none').length;
        return (
          <button key={s.n} className="row" onClick={() => openReader(s.pages[0])} onPointerDown={() => preload(s.pages[0])}>
            <span style={{ position: 'relative', width: 34, height: 34, display: 'grid', placeItems: 'center', color: 'var(--gold)', flexShrink: 0 }}>
              <Star size={34} stroke={1.3} style={{ position: 'absolute' }} />
              <span className="num" style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ink-2)' }}>{s.n}</span>
            </span>
            <span className="grow">
              <span className="label" style={{ display: 'block' }}>{s.en}</span>
              <span className="tiny">{s.meaning} · {s.verses} āyāt{known ? ` · ${known === range.length ? 'memorized' : `${known}/${range.length} pages memorized`}` : ''}</span>
            </span>
            <span style={{ fontFamily: 'surahnames', fontSize: 30, lineHeight: 1, color: 'var(--ink)', direction: 'ltr' }}>{pad3(s.n)}</span>
          </button>
        );
      })}
    </div>
  );
}

function PageMap() {
  const pages = pageStrength();
  const [jump, setJump] = useState('');
  return (
    <div className="stack gap-12">
      <form className="row-flex" style={{ gap: 8 }} onSubmit={e => { e.preventDefault(); const n = +jump; if (n >= 1 && n <= PAGE_COUNT) openReader(n); }}>
        <input value={jump} onChange={e => setJump(e.target.value.replace(/\D/g, '').slice(0, 3))} inputMode="numeric" placeholder="Go to page (1–604)"
          style={{ flex: 1, height: 46, borderRadius: 14, border: '1px solid var(--line-2)', background: 'var(--card)', padding: '0 14px', outline: 'none' }} />
        <Button size="sm" type="submit" style={{ height: 46 }} disabled={!(+jump >= 1 && +jump <= PAGE_COUNT)}>Open</Button>
      </form>
      <div className="card pad-card stack" style={{ gap: 5 }}>
        {JUZ_PAGES.map((list, i) => (
          <div key={i} className="row-flex" style={{ gap: 6 }}>
            <span className="tiny num" style={{ width: 18, textAlign: 'right' }}>{i + 1}</span>
            <div className="grow" style={{ display: 'grid', gridTemplateColumns: 'repeat(23, 1fr)', gap: 2 }}>
              {list.map(n => (
                <button key={n} onClick={() => openReader(n)} aria-label={`Page ${n}`} style={{ aspectRatio: '0.75', borderRadius: 2.5, background: groupInfo(pages[n - 1].group).color }} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function MushafTab() {
  const { lastPage } = useApp();
  const [view, setView] = useState('juz');
  return (
    <div className="scroll tab-scroll">
      <div className="row-flex" style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <h1 className="h1">Mushaf</h1>
          <div className="small" style={{ marginTop: 4 }}>Madinah Mushaf · 604 pages</div>
        </div>
        <Pressable className="card" onClick={() => openReader(lastPage)} style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="book" size={18} style={{ color: 'var(--pri-soft-ink)' }} />
          <span className="stack" style={{ textAlign: 'left' }}><span className="tiny">Continue</span><span className="num" style={{ fontSize: 14, fontWeight: 600 }}>Page {lastPage}</span></span>
        </Pressable>
      </div>
      <div style={{ margin: '18px 0 16px' }}>
        <Segmented value={view} onChange={setView} options={[{ value: 'juz', label: 'Juz' }, { value: 'surah', label: 'Surah' }, { value: 'page', label: 'Pages' }]} />
      </div>
      <motion.div key={view} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
        {view === 'juz' && <JuzGrid />}
        {view === 'surah' && <SurahList />}
        {view === 'page' && <PageMap />}
        {view !== 'surah' && <div style={{ marginTop: 16 }}><Legend /></div>}
      </motion.div>
    </div>
  );
}
