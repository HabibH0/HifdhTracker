import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { nav } from '../lib/nav.js';
import { pageMeta, ayahLabel, rangeLabel } from '../lib/quran.js';
import { MISTAKE_TYPES } from '../lib/session.js';
import { MushafPage, WordGlyph } from '../components/MushafPage.jsx';
import { Button, IconButton, Pressable, spring } from '../components/ui.jsx';
import { Icon } from '../components/Icons.jsx';
import { preload } from '../lib/mushaf.js';

/**
 * pages     [{ n, ayahIds? }] — the section being revised (ayahIds limit what can be tapped)
 * current   page the reciter is on
 * marks     [{ page, ayahId, pos }] already logged this session
 * highlight ayahId to tint (targeted practice)
 * quickAyah offers a one-tap "log at this āyah" shortcut
 * onSave    ({ page, ayahId, pos, type }) => void
 */
export default function MistakeLogger({ pages, current, marks = [], highlight, quickAyah, onSave, title }) {
  const single = pages.length === 1;
  const [step, setStep] = useState(single ? 'page' : 'grid');
  const [page, setPage] = useState(current);
  const [sel, setSel] = useState(null);
  const [type, setType] = useState(null);
  const info = pages.find(p => p.n === page);

  const dim = useMemo(() => {
    if (!info?.ayahIds) return null;
    const allowed = new Set(info.ayahIds);
    return new Set(pageMeta(page).ayahs.filter(a => !allowed.has(a)));
  }, [page, info]);
  const wordMarks = useMemo(() => new Map(marks.filter(m => m.page === page && m.pos).map(m => [`${m.ayahId}:${m.pos}`, 1])), [marks, page]);
  const ayahMarks = useMemo(() => new Map(marks.filter(m => m.page === page && m.ayahId && !m.pos).map(m => [m.ayahId, 1])), [marks, page]);
  const counts = useMemo(() => marks.reduce((acc, m) => ({ ...acc, [m.page]: (acc[m.page] ?? 0) + 1 }), {}), [marks]);

  const save = (m = sel) => { onSave({ page, ayahId: m?.ayahId ?? null, pos: m?.pos ?? null, type }); nav.pop(); };
  const choose = n => { setPage(n); setSel(null); setStep('page'); };

  return (
    <div className="layer">
      <div className="topbar">
        <IconButton icon={step === 'page' && !single ? 'chevronLeft' : 'close'} label="Back" onClick={() => (step === 'page' && !single ? (setStep('grid'), setSel(null)) : nav.pop())} />
        <div className="title stack" style={{ gap: 0 }}>
          <span>{step === 'grid' ? 'Where was the mistake?' : title ?? `Page ${page}`}</span>
          <span className="tiny" style={{ fontWeight: 400 }}>{step === 'grid' ? 'Choose the page' : 'Tap the word, or the āyah number'}</span>
        </div>
        {step === 'page' ? <Pressable className="link" style={{ width: 64, justifyContent: 'flex-end', paddingRight: 6, fontSize: 13 }} onClick={() => save(null)}>Whole page</Pressable> : <span className="spacer" />}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {step === 'grid' ? (
          <motion.div key="grid" className="scroll pad" initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }} transition={{ duration: 0.2 }}>
            <Pressable className="card" onClick={() => choose(current)} onPointerDown={() => preload(current)}
              style={{ width: '100%', padding: 16, display: 'flex', alignItems: 'center', gap: 14, border: '1.5px solid var(--pri)', marginTop: 4 }}>
              <div style={{ width: 52, height: 52, borderRadius: 14, background: 'var(--pri)', color: 'var(--pri-ink)', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 18 }} className="num">{current}</div>
              <div className="grow" style={{ textAlign: 'left' }}><div className="h3">Current page</div><div className="tiny">{rangeLabel(pages.find(p => p.n === current)?.ayahIds ?? pageMeta(current).ayahs)}</div></div>
              <Icon name="chevronRight" size={18} style={{ color: 'var(--ink-3)' }} />
            </Pressable>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginTop: 16, paddingBottom: 24 }}>
              {pages.map(p => (
                <motion.button key={p.n} whileTap={{ scale: 0.92 }} onClick={() => choose(p.n)} onPointerDown={() => preload(p.n)}
                  style={{ height: 64, borderRadius: 16, background: p.n === current ? 'var(--pri-soft)' : 'var(--card)', border: `1.5px solid ${p.n === current ? 'var(--pri)' : 'var(--line-2)'}`, fontWeight: 600, fontSize: 17, position: 'relative' }} className="num">
                  {p.n}
                  {counts[p.n] > 0 && <span style={{ position: 'absolute', top: 6, right: 8, minWidth: 16, height: 16, borderRadius: 8, background: 'var(--mark)', color: '#fff', fontSize: 10, fontWeight: 700, display: 'grid', placeItems: 'center', padding: '0 4px' }}>{counts[p.n]}</span>}
                </motion.button>
              ))}
            </div>
          </motion.div>
        ) : (
          <motion.div key={`page-${page}`} className="grow stack" style={{ minHeight: 0 }} initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 30 }} transition={{ duration: 0.2 }}>
            <div className="grow" style={{ minHeight: 0, padding: '0 8px 8px', position: 'relative' }} onClick={() => setSel(null)}>
              <div style={{ position: 'absolute', inset: '0 8px 8px', background: 'var(--paper)', borderRadius: 18, border: '1px solid var(--line)' }} />
              <div style={{ position: 'absolute', inset: '8px 12px 16px' }}>
                <MushafPage n={page} dimAyahs={dim} selected={sel} wordMarks={wordMarks} ayahMarks={ayahMarks} highlight={highlight ? new Set([highlight]) : null} onWord={w => { setSel(w); }} />
              </div>
            </div>
            <AnimatePresence>
              {(sel || quickAyah) && (
                <motion.div key="panel" initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 60, opacity: 0 }} transition={spring}
                  style={{ background: 'var(--card)', borderTop: '1px solid var(--line)', borderRadius: '22px 22px 0 0', boxShadow: 'var(--shadow-lg)', padding: '14px 0 calc(var(--safe-b) + 14px)' }}>
                  {sel ? (
                    <>
                      <div className="row-flex pad" style={{ gap: 12 }}>
                        <div style={{ minWidth: 56, height: 56, borderRadius: 14, background: 'var(--paper)', border: '1px solid var(--line)', display: 'grid', placeItems: 'center', padding: '0 8px' }}>
                          <WordGlyph page={page} glyph={sel.glyph} size={sel.isEnd ? 30 : 34} />
                        </div>
                        <div className="grow">
                          <div className="h3">{sel.isEnd ? `Āyah ${sel.ayahId}` : `Word ${sel.pos}`}</div>
                          <div className="tiny">{ayahLabel(sel.ayahId)} · page {page}</div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '14px 20px 2px' }}>
                        {MISTAKE_TYPES.map(t => (
                          <button key={t.value} className={`chip ${type === t.value ? 'on' : ''}`} style={{ flexShrink: 0 }} onClick={() => setType(type === t.value ? null : t.value)}>{t.label}</button>
                        ))}
                      </div>
                      <div className="pad" style={{ marginTop: 12 }}><Button size="lg" block onClick={() => save()}><Icon name="flag" size={18} />Save mistake</Button></div>
                    </>
                  ) : (
                    <div className="pad"><Button variant="secondary" size="lg" block onClick={() => save({ ayahId: quickAyah, pos: null })}>Log at āyah {quickAyah}</Button></div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
