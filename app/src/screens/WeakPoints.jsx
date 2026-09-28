import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useApp, today, timeZone } from '../lib/store.js';
import { calendarDay } from '@engine/time.js';
import { nav } from '../lib/nav.js';
import { weakPoints, troublesome } from '../lib/stats.js';
import { mistakeLabel } from '../lib/session.js';
import { AyahGlyphs } from '../components/MushafPage.jsx';
import { Pressable, Segmented, Tag, TopBar, softSpring } from '../components/ui.jsx';
import { Icon } from '../components/Icons.jsx';
import { openReader } from './MushafTab.jsx';

const ago = iso => {
  if (!iso) return '';
  const d = Math.round((Date.parse(today()) - Date.parse(calendarDay(iso, timeZone()))) / 86400000);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
};

export default function WeakPoints() {
  useApp();
  const [sort, setSort] = useState('frequency');
  const items = [...weakPoints()].sort((a, b) => (sort === 'frequency' ? b.count - a.count || b.sessions - a.sessions : (b.last ?? '').localeCompare(a.last ?? '')));
  const resolved = troublesome().filter(t => !t.troublesome).length;
  const max = Math.max(1, ...items.map(i => i.count));
  return (
    <div className="layer">
      <TopBar title="Weak points" onBack={() => nav.pop()} />
      <div className="scroll pad" style={{ paddingBottom: 'calc(var(--safe-b) + 24px)' }}>
        <h1 className="h2">Areas to focus on</h1>
        <p className="sub" style={{ margin: '4px 0 16px' }}>{items.length ? `${items.length} active${resolved ? ` · ${resolved} resolved` : ''}` : 'Nothing recurring right now.'}</p>
        {items.length > 0 && <Segmented light value={sort} onChange={setSort} options={[{ value: 'frequency', label: 'By frequency' }, { value: 'recency', label: 'By recency' }]} />}
        <div className="stack gap-12" style={{ marginTop: 16 }}>
          <AnimatePresence initial={false}>
            {items.map(item => (
              <motion.div key={item.ayahId} layout transition={softSpring} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                <Pressable className="card" style={{ width: '100%', textAlign: 'left', padding: 16, display: 'block' }} onClick={() => openReader(item.page, { highlight: item.ayahId })}>
                  <div className="row-flex" style={{ justifyContent: 'space-between' }}>
                    <div>
                      <div className="h3">{item.label}</div>
                      <div className="tiny">Page {item.page}{item.last ? ` · last mistake ${ago(item.last)}` : ''}</div>
                    </div>
                    <Tag tone={item.kind === 'recurring' ? 'amber' : 'grey'}>{item.kind === 'recurring' ? 'Recurring' : 'Recent'}</Tag>
                  </div>
                  <div style={{ margin: '10px 0', padding: '4px 10px', borderRadius: 10, background: 'var(--paper)', border: '1px solid var(--line)' }}>
                    <AyahGlyphs page={item.page} ayahId={item.ayahId} size={21} />
                  </div>
                  <div className="row-flex" style={{ gap: 10 }}>
                    <div className="grow" style={{ height: 6, borderRadius: 3, background: 'var(--line)' }}>
                      <motion.div initial={{ width: 0 }} animate={{ width: `${(item.count / max) * 100}%` }} transition={{ duration: 0.6, ease: 'easeOut' }} style={{ height: '100%', borderRadius: 3, background: 'var(--st-weak)' }} />
                    </div>
                    <span className="tiny num" style={{ whiteSpace: 'nowrap' }}>{item.count} mistake{item.count === 1 ? '' : 's'} · 30 days</span>
                  </div>
                  <div className="small" style={{ marginTop: 8 }}>{item.why}</div>
                  {item.kind === 'recurring' && (
                    <div className="row-flex tiny" style={{ gap: 6, marginTop: 6 }}>
                      {[0, 1, 2].map(i => <span key={i} className="dot" style={{ width: 7, height: 7, background: i < item.cleanSessions ? 'var(--pri)' : 'var(--line-2)' }} />)}
                      <span>{item.cleanSessions} of 3 clean sessions to clear</span>
                    </div>
                  )}
                  {(item.words.length > 0 || item.types.length > 0) && (
                    <div className="chips" style={{ marginTop: 10, gap: 6 }}>
                      {item.words.slice(0, 3).map(w => <Tag key={w.pos} tone="grey">Word {w.pos} ×{w.count}</Tag>)}
                      {item.types.slice(0, 3).map(t => <Tag key={t} tone="grey">{mistakeLabel(t)}</Tag>)}
                    </div>
                  )}
                  <div className="link" style={{ marginTop: 12 }}><Icon name="book" size={16} />&nbsp;Open in Mushaf</div>
                </Pressable>
              </motion.div>
            ))}
          </AnimatePresence>
          {!items.length && (
            <div className="card pad-card center" style={{ flexDirection: 'column', gap: 10, padding: 30, textAlign: 'center' }}>
              <div style={{ width: 48, height: 48, borderRadius: 24, background: 'var(--pri-soft)', color: 'var(--pri-soft-ink)', display: 'grid', placeItems: 'center' }}><Icon name="check" size={24} /></div>
              <div className="sub">Recurring mistakes will show here, with exactly where they happen.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

