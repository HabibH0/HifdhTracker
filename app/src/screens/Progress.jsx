import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useApp } from '../lib/store.js';
import { nav } from '../lib/nav.js';
import { halfLabel, JUZ_PAGES } from '../lib/quran.js';
import { GROUPS, groupCounts, groupInfo, juzStrength, pageStrength, atRisk, summary, series, sessions, troublesome, weakPoints } from '../lib/stats.js';
import { Pressable, Segmented } from '../components/ui.jsx';
import { Icon } from '../components/Icons.jsx';
import { juzSheet, tint, openReader, Legend } from './MushafTab.jsx';
import { SessionRow } from './History.jsx';

const md = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const wd = new Intl.DateTimeFormat('en-GB', { weekday: 'narrow' });
const d = s => new Date(`${s}T12:00:00`);
const hm = m => (m >= 600 ? `${Math.round(m / 60)}h` : m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);

function Card({ title, right, children, onClick }) {
  return (
    <motion.div className="card pad-card" initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-20px' }} transition={{ duration: 0.35, ease: 'easeOut' }} style={{ marginTop: 12 }}>
      <div className="row-flex" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <h3 className="h3" style={{ fontSize: 15 }}>{title}</h3>
        {right ?? (onClick && <button className="link" onClick={onClick}>See all<Icon name="chevronRight" size={15} /></button>)}
      </div>
      {children}
    </motion.div>
  );
}

function StrengthBar() {
  const counts = groupCounts();
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const [pick, setPick] = useState(null);
  return (
    <>
      <div className="row-flex" style={{ alignItems: 'baseline', gap: 6, marginBottom: 10 }}>
        <span className="num" style={{ fontFamily: 'var(--serif)', fontSize: 30, lineHeight: 1 }}>{total}</span>
        <span className="small">pages memorized</span>
      </div>
      <div style={{ display: 'flex', gap: 2, height: 14, borderRadius: 7, overflow: 'hidden', background: 'var(--line)' }}>
        {GROUPS.filter(g => counts[g.id]).map((g, i) => (
          <motion.button key={g.id} initial={{ flexGrow: 0 }} animate={{ flexGrow: counts[g.id] }} transition={{ duration: 0.7, delay: i * 0.05, ease: 'easeOut' }}
            onClick={() => setPick(pick === g.id ? null : g.id)} aria-label={`${g.label}: ${counts[g.id]} pages`}
            style={{ flexBasis: 0, background: g.color, opacity: pick && pick !== g.id ? 0.35 : 1, transition: 'opacity .2s' }} />
        ))}
      </div>
      <div className="stack" style={{ marginTop: 12, gap: 8 }}>
        {GROUPS.map(g => (
          <button key={g.id} onClick={() => setPick(pick === g.id ? null : g.id)} className="row-flex small" style={{ gap: 10, opacity: pick && pick !== g.id ? 0.45 : 1, transition: 'opacity .2s' }}>
            <i style={{ width: 10, height: 10, borderRadius: 3, background: g.color, display: 'inline-block' }} />
            <span className="grow" style={{ textAlign: 'left', color: 'var(--ink)' }}>{g.label}</span>
            <span className="num" style={{ fontWeight: 600, color: 'var(--ink)' }}>{counts[g.id]}</span>
            <span className="tiny num" style={{ width: 36, textAlign: 'right' }}>{total ? Math.round((counts[g.id] / total) * 100) : 0}%</span>
          </button>
        ))}
      </div>
    </>
  );
}

function JuzOverview() {
  const [mode, setMode] = useState('juz');
  const juz = juzStrength(), pages = pageStrength();
  return (
    <>
      <div style={{ marginBottom: 12 }}><Segmented light value={mode} onChange={setMode} options={[{ value: 'juz', label: '30 juz' }, { value: 'pages', label: '604 pages' }]} /></div>
      <AnimatePresence mode="wait" initial={false}>
        {mode === 'juz' ? (
          <motion.div key="j" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 6 }}>
            {juz.map(j => {
              const g = groupInfo(j.group);
              return (
                <motion.button key={j.juz} whileTap={{ scale: 0.9 }} onClick={() => juzSheet(j.juz)} className="num"
                  style={{ aspectRatio: '1', borderRadius: 11, fontSize: 13.5, fontWeight: 600, background: j.known ? tint(g.color, 30) : 'var(--card-2)', border: `1px solid ${j.known ? tint(g.color, 60) : 'var(--line)'}`, color: j.known ? 'var(--ink)' : 'var(--ink-3)' }}>
                  {j.juz}
                </motion.button>
              );
            })}
          </motion.div>
        ) : (
          <motion.div key="p" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="stack" style={{ gap: 3 }}>
            {JUZ_PAGES.map((list, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: 'repeat(23, 1fr)', gap: 2 }}>
                {list.map(n => <button key={n} onClick={() => openReader(n)} aria-label={`Page ${n}`} style={{ height: 8, borderRadius: 2, background: groupInfo(pages[n - 1].group).color }} />)}
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
      <div style={{ marginTop: 12 }}><Legend /></div>
    </>
  );
}

function BarChart({ buckets, weekly, goal }) {
  const [pick, setPick] = useState(null);
  const W = 320, H = 130, top = 16, bottom = 18;
  const max = Math.max(goal ?? 0, ...buckets.map(b => b.minutes), 1) * 1.1;
  const n = buckets.length, gap = n > 20 ? 2 : 6, bw = (W - gap * (n - 1)) / n;
  const y = v => top + (H - top - bottom) * (1 - v / max);
  const label = (b, i) => (weekly ? (i % Math.ceil(n / 5) === 0 ? md.format(d(b.start)) : '') : n <= 7 ? wd.format(d(b.start)) : i % 5 === 0 ? md.format(d(b.start)) : '');
  const sel = pick != null ? buckets[pick] : null;
  return (
    <div style={{ position: 'relative' }}>
      <div className="tiny" style={{ minHeight: 18, color: sel ? 'var(--ink)' : undefined }}>{sel ? `${weekly ? `Week of ${md.format(d(sel.start))}` : md.format(d(sel.start))}: ${sel.minutes} min` : `Minutes per ${weekly ? 'week' : 'day'}`}</div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ overflow: 'visible' }}>
        <line x1="0" x2={W} y1={H - bottom} y2={H - bottom} stroke="var(--line-2)" />
        {goal ? <>
          <line x1="0" x2={W} y1={y(goal)} y2={y(goal)} stroke="var(--ink-3)" strokeDasharray="3 4" strokeWidth="1" />
          <text x={W} y={y(goal) - 4} textAnchor="end" fontSize="10" fill="var(--ink-3)">Goal</text>
        </> : null}
        {buckets.map((b, i) => {
          const h = Math.max(0, H - bottom - y(b.minutes));
          return (
            <g key={b.start} onClick={() => setPick(pick === i ? null : i)} style={{ cursor: 'pointer' }}>
              <rect x={i * (bw + gap)} y={top} width={bw} height={H - top - bottom} fill="transparent" />
              {b.minutes > 0 && (
                <motion.path initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} transition={{ duration: 0.5, delay: i * 0.012, ease: 'easeOut' }} style={{ transformOrigin: `0 ${H - bottom}px`, transformBox: 'view-box' }}
                  d={roundedTop(i * (bw + gap), H - bottom - h, bw, h, Math.min(4, bw / 2))} fill={pick == null || pick === i ? 'var(--pri)' : 'var(--pri-soft)'} />
              )}
              <text x={i * (bw + gap) + bw / 2} y={H - 4} textAnchor={n <= 7 ? 'middle' : 'start'} fontSize="10" fill="var(--ink-3)">{label(b, i)}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
function roundedTop(x, y, w, h, r) {
  r = Math.min(r, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function LineChart({ buckets, weekly }) {
  const pts = buckets.map((b, i) => ({ i, v: b.rate, b })).filter(p => p.v != null);
  const [pick, setPick] = useState(null);
  if (pts.length < 2) return <div className="small">Needs a few more sessions to show a trend.</div>;
  const W = 320, H = 110, top = 10, bottom = 16, n = buckets.length;
  const max = Math.max(...pts.map(p => p.v), 1) * 1.15;
  const x = i => (n === 1 ? W / 2 : (i / (n - 1)) * W), y = v => top + (H - top - bottom) * (1 - v / max);
  const path = pts.map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
  const half = Math.floor(pts.length / 2);
  const avg = a => a.reduce((s, p) => s + p.v, 0) / (a.length || 1);
  const before = avg(pts.slice(0, half)), after = avg(pts.slice(half));
  const change = before ? Math.round(((after - before) / before) * 100) : 0;
  const sel = pick != null ? pts[pick] : pts.at(-1);
  return (
    <>
      <div className="row-flex" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
        <span className="tiny">{pick != null ? `${weekly ? 'Week of ' : ''}${md.format(d(sel.b.start))}: ${sel.v.toFixed(1)} per 10 pages` : 'Mistakes per 10 pages revised'}</span>
        {before > 0 && <span className="row-flex small num" style={{ gap: 3, fontWeight: 600, color: change <= 0 ? 'var(--pri-soft-ink)' : 'var(--amber-ink)' }}>
          <Icon name={change <= 0 ? 'arrowDown' : 'arrowUp'} size={14} stroke={2.4} />{Math.abs(change)}%
        </span>}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ overflow: 'visible' }}
        onClick={e => { const r = e.currentTarget.getBoundingClientRect(); const px = ((e.clientX - r.left) / r.width) * W; let best = 0; pts.forEach((p, k) => { if (Math.abs(x(p.i) - px) < Math.abs(x(pts[best].i) - px)) best = k; }); setPick(best === pick ? null : best); }}>
        <line x1="0" x2={W} y1={H - bottom} y2={H - bottom} stroke="var(--line-2)" />
        <motion.path d={path} fill="none" stroke="var(--st-weak)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.9, ease: 'easeOut' }} />
        <circle cx={x(sel.i)} cy={y(sel.v)} r="5" fill="var(--st-weak)" stroke="var(--card)" strokeWidth="2" />
        {pick != null && <line x1={x(sel.i)} x2={x(sel.i)} y1={top} y2={H - bottom} stroke="var(--line-2)" />}
        <text x="0" y={H - 3} fontSize="10" fill="var(--ink-3)">{md.format(d(buckets[0].start))}</text>
        <text x={W} y={H - 3} fontSize="10" fill="var(--ink-3)" textAnchor="end">{md.format(d(buckets.at(-1).start))}</text>
      </svg>
    </>
  );
}

export default function Progress() {
  const { settings, sessionMeta } = useApp();
  const [range, setRange] = useState('30d');
  const s = summary(range), sr = series(range);
  const risk = atRisk();
  const trouble = troublesome();
  const active = weakPoints();
  const resolved = trouble.filter(t => !t.troublesome).length;
  const recent = sessions().slice(0, 4);
  const goal = sr.weekly ? settings.capacity * 7 : settings.capacity;

  return (
    <div className="scroll tab-scroll">
      <h1 className="h1">Your progress</h1>
      <div style={{ margin: '18px 0 4px' }}>
        <Segmented value={range} onChange={setRange} options={[{ value: '7d', label: '7 days' }, { value: '30d', label: '30 days' }, { value: '90d', label: '3 months' }, { value: 'all', label: 'All time' }]} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 12 }}>
        {[[hm(s.minutes), 'revised'], [s.days, s.days === 1 ? 'day active' : 'days active'], [s.spaced, 'successful reviews']].map(([v, l]) => (
          <motion.div key={l} className="card" style={{ padding: '14px 10px' }} layout>
            <AnimatePresence mode="wait"><motion.div key={`${v}`} className="num" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.15 }} style={{ fontFamily: 'var(--serif)', fontSize: 23, lineHeight: 1.1, whiteSpace: 'nowrap' }}>{v}</motion.div></AnimatePresence>
            <div className="tiny" style={{ marginTop: 4, lineHeight: 1.25 }}>{l}</div>
          </motion.div>
        ))}
      </div>

      <Card title="Memorization strength"><StrengthBar /></Card>
      <Card title="Hifdh by juz"><JuzOverview /></Card>

      {risk.length > 0 && (
        <Card title="Needs attention">
          <div className="list" style={{ margin: '0 -16px -8px' }}>
            {risk.map(h => {
              const g = groupInfo(h.group);
              return (
                <Pressable key={h.hizb} className="row" onClick={() => juzSheet(Math.ceil(h.hizb / 2))}>
                  <span className="dot" style={{ width: 10, height: 10, background: g.color }} />
                  <span className="grow"><span className="label" style={{ display: 'block' }}>{halfLabel(h.hizb)}</span>
                    <span className="tiny">{g.label}{h.overdue ? ` · ${h.overdue} page${h.overdue === 1 ? '' : 's'} overdue` : h.maxRisk >= 0.85 ? ' · due for review' : ''}</span></span>
                  <Icon name="chevronRight" size={16} style={{ color: 'var(--ink-3)' }} />
                </Pressable>
              );
            })}
          </div>
        </Card>
      )}

      <Card title="Weak points" onClick={() => nav.push('weakPoints')}>
        <div className="row-flex" style={{ gap: 10 }}>
          {[[active.length, 'active', 'var(--st-weak)'], [resolved, 'resolved', 'var(--st-strong)']].map(([v, l, c]) => (
            <Pressable key={l} className="inset grow" style={{ padding: 12, textAlign: 'left' }} onClick={() => nav.push('weakPoints')}>
              <div className="row-flex" style={{ gap: 8 }}><span className="dot" style={{ background: c }} /><span className="num" style={{ fontSize: 22, fontFamily: 'var(--serif)' }}>{v}</span></div>
              <div className="tiny">{l === 'active' ? 'being targeted' : 'troublesome āyāt resolved'}</div>
            </Pressable>
          ))}
        </div>
      </Card>

      <Card title="Revision consistency"><BarChart buckets={sr.buckets} weekly={sr.weekly} goal={goal} /></Card>
      <Card title="Mistakes trend"><LineChart buckets={sr.buckets} weekly={sr.weekly} /></Card>

      <Card title="Recent revision" onClick={recent.length ? () => nav.push('history') : undefined}>
        {recent.length ? <div className="list" style={{ margin: '-4px -16px -8px' }}>{recent.map(x => <SessionRow key={x.sessionId} s={x} meta={sessionMeta} />)}</div> : <div className="small">Your sessions will appear here.</div>}
      </Card>
    </div>
  );
}
