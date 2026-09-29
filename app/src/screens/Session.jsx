import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useApp, getState, clearActiveSession } from '../lib/store.js';
import { nav } from '../lib/nav.js';
import { TASK_TYPES, sessionPracticeTask } from '../lib/plan.js';
import { MistakeList } from './SessionMistakes.jsx';
import { rangeLabel, ayahLabel } from '../lib/quran.js';
import {
  ACCURACY, FLUENCY, MAX_TARGETED, addMistakes, begin, continueAfterRepair, elapsedMs, finishPass, mistakeLabel,
  pauseTimer, removeMistake, repairAttempt, resumeTimer, targetedAttempt, update, submit,
} from '../lib/session.js';
import { Button, CheckBurst, IconButton, OptionGrid, Pressable, Ring, Tag, TopBar, confirmSheet, softSpring, spring } from '../components/ui.jsx';
import { Icon } from '../components/Icons.jsx';
import { AyahGlyphs } from '../components/MushafPage.jsx';

const fmt = ms => { const t = Math.floor(ms / 1000), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`; };
function useTick(on) {
  const [, set] = useState(0);
  useEffect(() => { if (!on) return; const t = setInterval(() => set(x => x + 1), 1000); return () => clearInterval(t); }, [on]);
}

/** System back / close: never lose a session silently. Returns false to keep the screen. */
export function requestLeave() {
  const s = getState().activeSession;
  if (!s || s.phase === 'intro') { clearActiveSession(); nav.pop(); return true; }
  if (s.phase === 'complete') { clearActiveSession(); nav.pop(); return true; }
  confirmSheet({
    title: 'Leave this session?', body: 'You can pick it up again from Today. Nothing is recorded until you finish.',
    confirm: 'Keep it for later', tone: 'primary', cancel: 'Discard session',
    onConfirm: () => { update(s, pauseTimer(s)); nav.pop(); },
    onCancel: () => { clearActiveSession(); nav.pop(); },
  });
  return false;
}

const instructions = (s) => {
  const t = s.task, n = t.pages.length;
  if (s.kind === 'strengthen') return [
    [`Recite all ${n} page${n === 1 ? '' : 's'} from memory, start to finish.`, 'Log each mistake as it happens — tap the word on the page.', 'Repair each mistake until it’s clean, then recite everything again.'],
    ['Recite the section twice from memory.', 'Repair any mistake or hesitation until it’s clean.', 'Aim for fluent recall on most pages.'],
    ['Recite the section twice from memory.', 'Aim for automatic recall — no pauses to think.', 'Repair anything that slips before you finish.'],
  ][t.stage - 1];
  if (s.kind === 'retention') return ['Recite the whole section once, from memory.', 'This confirms it is holding after strengthening.'];
  if (s.kind === 'targeted') return ['Recite each weak point with the āyah before and after it.', 'Mark it clean once it flows without a mistake.'];
  const random = t.pages.some(p => p.startAyahId) && getState().settings.randomAccess;
  return ['Recite each page from memory.', 'Log mistakes as they happen; they become targeted practice.', ...(random ? ['Some pages start from a random āyah — you’ll see where.'] : [])];
};

function StageTrack({ stage }) {
  return (
    <div className="row-flex" style={{ gap: 6, width: '100%' }}>
      {[1, 2, 3].map(d => (
        <div key={d} className="grow stack" style={{ gap: 6 }}>
          <motion.div initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ delay: 0.1 * d, ...softSpring }} style={{ transformOrigin: 'left', height: 6, borderRadius: 3, background: d < stage ? 'var(--pri)' : d === stage ? 'var(--pri-2)' : 'var(--line-2)', opacity: d === stage ? 0.75 : 1 }} />
          <span className="tiny" style={{ color: d === stage ? 'var(--ink)' : undefined, fontWeight: d === stage ? 600 : 400 }}>Day {d}</span>
        </div>
      ))}
    </div>
  );
}

function Intro({ s }) {
  const t = s.task, type = TASK_TYPES[s.kind];
  const passes = t.passes ?? 1;
  return (
    <>
      <TopBar onBack={requestLeave} backIcon="close" />
      <div className="scroll pad" style={{ paddingBottom: 12 }}>
        <div className="stack" style={{ alignItems: 'center', textAlign: 'center', gap: 8, paddingTop: 4 }}>
          <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={spring} style={{ width: 58, height: 58, borderRadius: 18, display: 'grid', placeItems: 'center', background: `var(--${type.tone === 'green' ? 'pri' : type.tone}-soft)`, color: `var(--${type.tone === 'green' ? 'pri-soft' : type.tone}-ink)` }}>
            <Icon name={type.icon} size={28} />
          </motion.div>
          <Tag tone={type.tone}>{type.label}{s.kind === 'strengthen' ? ` · Day ${t.stage} of 3` : s.kind === 'retention' ? ` · Check ${t.checkNumber} of 3` : ''}</Tag>
          <h1 className="h2" style={{ marginTop: 4 }}>{t.title}</h1>
          <div className="sub">{t.subtitle}</div>
          {t.range && <div className="small">{t.range}</div>}
        </div>

        {s.kind === 'strengthen' && <div className="card pad-card" style={{ marginTop: 20 }}><StageTrack stage={t.stage} /></div>}

        <div style={{ display: 'grid', gridTemplateColumns: s.kind === 'targeted' ? '1fr 1fr' : '1fr 1fr 1fr', gap: 8, marginTop: 12 }}>
          {[
            ['pages', s.kind === 'targeted' ? t.targets.length : t.pages.length, s.kind === 'targeted' ? 'weak points' : t.pages.length === 1 ? 'page' : 'pages'],
            ['clock', `~${t.minutes}`, 'minutes'],
            ...(s.kind === 'targeted' ? [] : [['refresh', passes, passes === 1 ? 'pass' : 'passes']]),
          ].map(([icon, v, l]) => (
            <div key={l} className="card" style={{ padding: '12px 8px', textAlign: 'center' }}>
              <Icon name={icon} size={20} style={{ margin: '0 auto 4px', color: 'var(--ink-3)' }} />
              <div className="num" style={{ fontWeight: 650, fontSize: 18 }}>{v}</div>
              <div className="tiny">{l}</div>
            </div>
          ))}
        </div>

        <div className="section-title"><h3>What to do</h3></div>
        <div className="card" style={{ padding: '6px 0' }}>
          {instructions(s).map((line, i) => (
            <div key={i} className="row" style={{ minHeight: 48, alignItems: 'flex-start' }}>
              <span className="num" style={{ width: 24, height: 24, borderRadius: 12, background: 'var(--pri-soft)', color: 'var(--pri-soft-ink)', fontSize: 13, fontWeight: 700, display: 'grid', placeItems: 'center', flexShrink: 0 }}>{i + 1}</span>
              <span className="grow" style={{ fontSize: 15, paddingTop: 1 }}>{line}</span>
            </div>
          ))}
        </div>

        {s.kind !== 'targeted' && t.pages.length > 1 && (
          <>
            <div className="section-title"><h3>Pages</h3><span className="tiny">{t.pages.some(p => p.coverage === 'partial') ? '◐ memorized part only' : ''}</span></div>
            <div className="chips">
              {t.pages.map(p => <span key={p.n} className="chip" style={{ height: 32, padding: '0 11px', fontVariantNumeric: 'tabular-nums' }}>{p.n}{p.coverage === 'partial' ? ' ◐' : ''}</span>)}
            </div>
          </>
        )}
      </div>
      <div className="footer"><Button size="lg" block onClick={() => begin(s)}><Icon name="play" size={16} />{s.kind === 'targeted' ? 'Start practice' : 'Begin pass 1'}</Button></div>
    </>
  );
}

function mistakesSheet(s, page) {
  nav.openSheet(close => {
    const Content = () => {
      const { activeSession } = useApp();
      const list = activeSession?.current[page] ?? [];
      return (
        <div className="stack gap-12">
          <h2>Page {page}</h2>
          {list.length === 0 && <p className="sub">No mistakes logged on this page.</p>}
          <div className="card list">
            {list.map(m => (
              <div key={m.id} className="row">
                <Icon name="flag" size={18} style={{ color: 'var(--mark)' }} />
                <span className="grow"><span className="label" style={{ display: 'block' }}>{m.ayahId ? `${ayahLabel(m.ayahId)}${m.pos ? ` · word ${m.pos}` : ''}` : 'Whole page'}</span><span className="tiny">{m.type ? mistakeLabel(m.type) : 'Mistake'}</span></span>
                <IconButton icon="trash" size={18} label="Remove" onClick={() => removeMistake(activeSession, page, m.id)} />
              </div>
            ))}
          </div>
          <div style={{ height: 4 }} />
        </div>
      );
    };
    return <Content />;
  });
}

function Pass({ s }) {
  const { settings } = useApp();
  const running = !!s.timer.since;
  useTick(running);
  const t = s.task, page = t.pages[s.pageIndex], total = t.pages.length;
  const [dir, setDir] = useState(1);
  const go = d => { const i = s.pageIndex + d; if (i < 0 || i >= total) return; setDir(d); update(s, { pageIndex: i }); };
  const count = (s.current[page.n] ?? []).length;
  const allMistakes = Object.values(s.current).reduce((n, l) => n + l.length, 0);
  const last = s.pageIndex === total - 1;
  const logMistake = () => nav.push('logMistake', {
    pages: t.pages, current: page.n, marks: Object.entries(s.current).flatMap(([n, l]) => l.map(m => ({ ...m, page: +n }))),
    onSave: mistakes => { addMistakes(getState().activeSession, mistakes); nav.toast(`${mistakes.length} mistake${mistakes.length === 1 ? '' : 's'} logged`, 'flag'); },
  }, 'modal');
  const random = page.startAyahId && settings.randomAccess && s.kind !== 'strengthen';

  return (
    <>
      <TopBar onBack={requestLeave} backIcon="close" title={<span>Pass {s.passIndex + 1}{t.passes > 1 ? ` of ${t.passes}` : ''}</span>}
        right={<IconButton icon={running ? 'pause' : 'play'} label={running ? 'Pause' : 'Resume'} onClick={() => update(s, running ? pauseTimer(s) : resumeTimer(s))} />} />
      <div className="grow stack" style={{ alignItems: 'center', justifyContent: 'space-evenly', padding: '0 20px', minHeight: 0 }}>
        <div className="small" style={{ textAlign: 'center' }}>{t.title}</div>
        <Ring value={(s.pageIndex + 1) / total} size={196} stroke={10}>
          <div className="num" style={{ fontFamily: 'var(--serif)', fontSize: 46, lineHeight: 1, opacity: running ? 1 : 0.45 }}>{fmt(elapsedMs(s))}</div>
          <div className="tiny" style={{ marginTop: 6 }}>{running ? 'elapsed' : 'paused'}</div>
        </Ring>
        <div className="row-flex" style={{ width: '100%', gap: 8 }}>
          <IconButton icon="chevronLeft" filled onClick={() => go(-1)} label="Previous page" disabled={s.pageIndex === 0} style={{ opacity: s.pageIndex === 0 ? 0.3 : 1 }} />
          <motion.div className="grow" style={{ overflow: 'hidden', textAlign: 'center', touchAction: 'pan-y' }} drag="x" dragConstraints={{ left: 0, right: 0 }} dragElastic={0.25}
            onDragEnd={(e, i) => (i.offset.x < -50 ? go(1) : i.offset.x > 50 ? go(-1) : null)}>
            <AnimatePresence mode="popLayout" custom={dir} initial={false}>
              <motion.div key={page.n} custom={dir} initial={{ x: dir * 60, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -dir * 60, opacity: 0 }} transition={spring}>
                <div style={{ fontFamily: 'var(--serif)', fontSize: 30, lineHeight: 1.1 }}>Page {page.n}</div>
                <div className="small" style={{ marginTop: 4 }}>{s.pageIndex + 1} of {total}{page.ayahIds?.length ? ` · ${rangeLabel(page.ayahIds)}` : ''}</div>
                <div className="row-flex" style={{ justifyContent: 'center', gap: 6, marginTop: 8, minHeight: 22, flexWrap: 'wrap' }}>
                  {page.coverage === 'partial' && <Tag tone="grey">Memorized part only</Tag>}
                  {random && <Tag tone="blue" icon="sparkle">Start from āyah {page.startAyahId}, then the whole page</Tag>}
                  {count > 0 && <button onClick={() => mistakesSheet(s, page.n)}><Tag tone="amber" icon="flag">{count} mistake{count === 1 ? '' : 's'}</Tag></button>}
                </div>
              </motion.div>
            </AnimatePresence>
          </motion.div>
          <IconButton icon="chevronRight" filled onClick={() => go(1)} label="Next page" disabled={last} style={{ opacity: last ? 0.3 : 1 }} />
        </div>
        {total > 1 && (
          <div className="row-flex" style={{ gap: total > 16 ? 3 : 5, justifyContent: 'center', flexWrap: 'wrap', maxWidth: '100%' }}>
            {t.pages.map((p, i) => (
              <button key={p.n} onClick={() => { setDir(i > s.pageIndex ? 1 : -1); update(s, { pageIndex: i }); }} aria-label={`Page ${p.n}`} style={{ padding: 3 }}>
                <motion.span animate={{ width: i === s.pageIndex ? 18 : 7, background: i === s.pageIndex ? 'var(--pri)' : (s.current[p.n]?.length ? 'var(--mark)' : i < s.pageIndex ? 'var(--pri-soft-ink)' : 'var(--line-2)') }} transition={spring} style={{ display: 'block', height: 7, borderRadius: 4, opacity: i < s.pageIndex && i !== s.pageIndex ? 0.5 : 1 }} />
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="footer">
        <Button size="xl" block onClick={logMistake}><Icon name="flag" size={22} />Log mistake</Button>
        <div className="row-flex" style={{ gap: 10 }}>
          {!last && <Button variant="secondary" size="lg" className="grow" onClick={() => go(1)}>Next page</Button>}
          <Button variant={last ? 'soft' : 'secondary'} size="lg" className="grow" onClick={() => { update(s, { ...pauseTimer(s), phase: 'rate', ratings: { accuracy: null, fluency: null, perPage: {} } }); }}>
            Finish pass{allMistakes ? ` · ${allMistakes}` : ''}
          </Button>
        </div>
      </div>
    </>
  );
}

function Rate({ s }) {
  const t = s.task, r = s.ratings ?? { perPage: {} };
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const mistakes = Object.values(s.current).reduce((n, l) => n + l.length, 0);
  const set = patch => update(s, { ratings: { ...r, ...patch } });
  const setPage = (n, patch) => set({ perPage: { ...r.perPage, [n]: { ...(r.perPage[n] ?? {}), ...patch } } });
  const pages = [...t.pages].sort((a, b) => (s.current[b.n]?.length ?? 0) - (s.current[a.n]?.length ?? 0));
  const cont = () => {
    try {
      const next = finishPass({ ...s, timer: { ...s.timer } }, r);
      if (next.phase === 'pass') update(next, resumeTimer(next));
      else if (next.phase === 'repair') update(next, resumeTimer(next));
    } catch (e) { nav.toast(e.message, 'alert'); }
  };
  return (
    <>
      <TopBar onBack={requestLeave} backIcon="close" title={`Pass ${s.passIndex + 1} complete`} right={<Pressable className="link" style={{ width: 64, justifyContent: 'flex-end', paddingRight: 8 }} onClick={() => update(s, { ...resumeTimer(s), phase: 'pass' })}>Resume</Pressable>} />
      <div className="scroll pad" style={{ paddingBottom: 16 }}>
        <div className="row-flex" style={{ gap: 14, padding: '6px 0 4px' }}>
          <CheckBurst size={52} />
          <div>
            <div className="h2" style={{ fontSize: 22 }}>How was this pass?</div>
            <div className="small">{fmt(elapsedMs(s))} · {mistakes} mistake{mistakes === 1 ? '' : 's'} logged · {t.pages.length} page{t.pages.length === 1 ? '' : 's'}</div>
          </div>
        </div>
        <div className="section-title"><h3>Accuracy</h3></div>
        <OptionGrid columns={4} options={ACCURACY} value={r.accuracy} onChange={v => set({ accuracy: v })} />
        <div className="section-title"><h3>Fluency</h3></div>
        <OptionGrid columns={3} options={FLUENCY} value={r.fluency} onChange={v => set({ fluency: v })} />

        {t.pages.length > 1 && (
          <>
            <Pressable onClick={() => setOpen(!open)} className="row-flex small" style={{ marginTop: 18, gap: 6, color: 'var(--pri-soft-ink)', fontWeight: 600 }}>
              <motion.span animate={{ rotate: open ? 180 : 0 }}><Icon name="chevronDown" size={16} /></motion.span> Some pages went differently
            </Pressable>
            <AnimatePresence initial={false}>
              {open && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} style={{ overflow: 'hidden' }}>
                  <div className="card list" style={{ marginTop: 10 }}>
                    {pages.map(p => {
                      const own = r.perPage[p.n] ?? {}, m = s.current[p.n]?.length ?? 0;
                      const acc = own.accuracy ?? r.accuracy, flu = own.fluency ?? r.fluency;
                      return (
                        <div key={p.n} style={{ borderTop: '1px solid var(--line)' }}>
                          <button className="row" style={{ minHeight: 50 }} onClick={() => setExpanded(expanded === p.n ? null : p.n)}>
                            <span className="grow"><span className="label">Page {p.n}</span>{m > 0 && <span className="tiny" style={{ color: 'var(--mark)' }}> · {m} mistake{m === 1 ? '' : 's'}</span>}</span>
                            <span className="tiny">{[ACCURACY.find(a => a.value === acc)?.label, FLUENCY.find(f => f.value === flu)?.label].filter(Boolean).join(' · ') || 'Same as pass'}</span>
                          </button>
                          <AnimatePresence initial={false}>
                            {expanded === p.n && (
                              <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} style={{ overflow: 'hidden' }}>
                                <div className="stack gap-8" style={{ padding: '0 12px 12px' }}>
                                  <OptionGrid columns={4} options={ACCURACY} value={acc} onChange={v => setPage(p.n, { accuracy: v })} />
                                  <OptionGrid columns={3} options={FLUENCY} value={flu} onChange={v => setPage(p.n, { fluency: v })} />
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}
      </div>
      <div className="footer"><Button size="lg" block disabled={!r.accuracy || !r.fluency} onClick={cont}>Continue</Button></div>
    </>
  );
}

function TargetCard({ target, count, onClean, onAgain, extra, done, attempts }) {
  const limit = count >= MAX_TARGETED && !done;
  return (
    <motion.div layout transition={softSpring} className="card" style={{ padding: 14, opacity: done ? 0.7 : 1 }}>
      <div className="row-flex" style={{ alignItems: 'flex-start', gap: 12 }}>
        <div style={{ width: 30, height: 30, borderRadius: 15, flexShrink: 0, display: 'grid', placeItems: 'center', background: done ? 'var(--pri)' : 'var(--amber-soft)', color: done ? 'var(--pri-ink)' : 'var(--amber-ink)' }}>
          <Icon name={done ? 'check' : target.ayahId ? 'target' : 'pages'} size={16} stroke={2.2} />
        </div>
        <div className="grow stack" style={{ gap: 2 }}>
          <div className="h3" style={{ fontSize: 16 }}>{target.label ?? (target.ayahId ? ayahLabel(target.ayahId) : `Page ${target.page} · whole page`)}</div>
          <div className="tiny">{target.why}{target.ayahId ? ` · page ${target.page}` : ''}</div>
          {target.mistakeTypes?.length > 0 && <div className="tiny">{target.mistakeTypes.map(mistakeLabel).join(' · ')}</div>}
          {!done && target.ayahIds && target.ayahIds.length > 1 && <div className="tiny" style={{ color: 'var(--ink-2)' }}>Recite {rangeLabel(target.ayahIds)}</div>}
        </div>
        {attempts > 0 && <div className="row-flex" style={{ gap: 3 }}>{Array.from({ length: Math.min(attempts, 5) }, (_, i) => <span key={i} className="dot" style={{ width: 6, height: 6, background: 'var(--ink-3)' }} />)}</div>}
      </div>
      {!done && target.ayahId && <div style={{ marginTop: 10, padding: '4px 10px', borderRadius: 10, background: 'var(--paper)', border: '1px solid var(--line)' }}><AyahGlyphs page={target.page} ayahId={target.ayahId} size={21} /></div>}
      {!done && (
        <div className="row-flex" style={{ gap: 8, marginTop: 12 }}>
          {extra}
          {limit ? <span className="small grow" style={{ textAlign: 'center' }}>Repetition limit reached for this page</span> : (
            <>
              <Button variant="secondary" size="sm" className="grow" onClick={onAgain} style={{ height: 44 }}>Still a mistake</Button>
              <Button variant="soft" size="sm" className="grow" onClick={onClean} style={{ height: 44 }}><Icon name="check" size={16} stroke={2.4} />Clean</Button>
            </>
          )}
        </div>
      )}
    </motion.div>
  );
}

function Repair({ s }) {
  useTick(!!s.timer.since);
  const { targets, beforePass } = s.repair;
  const open = targets.filter(t => !t.resolved), done = targets.filter(t => t.resolved);
  const blocked = open.filter(t => (s.targetedCounts[t.page] ?? 0) < MAX_TARGETED);
  const finish = () => { try { continueAfterRepair(s); } catch (e) { nav.toast(e.message, 'alert'); } };
  return (
    <>
      <TopBar onBack={requestLeave} backIcon="close" title="Repair" right={<span className="tiny num" style={{ width: 44, textAlign: 'right', paddingRight: 8 }}>{fmt(elapsedMs(s))}</span>} />
      <div className="scroll pad" style={{ paddingBottom: 16 }}>
        <h1 className="h2">{beforePass ? `Repair before pass ${s.passIndex + 2}` : 'Repair before finishing'}</h1>
        <p className="sub" style={{ margin: '6px 0 16px' }}>Recite each one from memory until it flows without a mistake.</p>
        <div className="stack gap-12">
          <AnimatePresence initial={false}>
            {[...open, ...done].map(t => (
              <TargetCard key={t.id} target={t} done={t.resolved} attempts={t.attempts} count={s.targetedCounts[t.page] ?? 0}
                onClean={() => repairAttempt(s, t, true)} onAgain={() => repairAttempt(s, t, false)} />
            ))}
          </AnimatePresence>
        </div>
      </div>
      <div className="footer border">
        {blocked.length > 0 && s.task.stage === 1 && beforePass && <div className="tiny" style={{ textAlign: 'center' }}>Unrepaired mistakes keep Day 1 from completing.</div>}
        <Button size="lg" block variant={blocked.length ? 'secondary' : 'primary'} onClick={finish}>{beforePass ? `Begin pass ${s.passIndex + 2}` : 'Finish session'}</Button>
      </div>
    </>
  );
}

function Targeted({ s }) {
  useTick(!!s.timer.since);
  const t = s.task;
  const state = id => {
    const a = s.attempts.filter(x => x.targetId === id);
    return { attempts: a.length, clean: a.some(x => x.clean) };
  };
  const practised = new Set(s.attempts.map(a => a.targetId)).size;
  const order = [...t.targets].sort((a, b) => Number(state(a.id).clean) - Number(state(b.id).clean));
  const mistake = target => nav.push('logMistake', {
    pages: [{ n: target.page, ayahIds: target.ayahIds ?? null }], current: target.page, highlight: target.ayahId, quickAyah: target.ayahId,
    title: target.label, onSave: mistakes => { targetedAttempt(getState().activeSession, target, false, mistakes); nav.toast('Logged — try it again', 'flag'); },
  }, 'modal');
  const finish = () => { try { submit(s); } catch (e) { nav.toast(e.message, 'alert'); } };
  return (
    <>
      <TopBar onBack={requestLeave} backIcon="close" title="Targeted weaknesses" right={<span className="tiny num" style={{ width: 44, textAlign: 'right', paddingRight: 8 }}>{fmt(elapsedMs(s))}</span>} />
      <div className="scroll pad" style={{ paddingBottom: 16 }}>
        <p className="sub" style={{ margin: '0 0 16px' }}>Recite each from memory with its neighbouring āyāt.</p>
        <div className="stack gap-12">
          {order.map(target => {
            const st = state(target.id);
            return (
              <TargetCard key={target.id} target={target} done={st.clean} attempts={st.attempts} count={0}
                onClean={() => targetedAttempt(s, target, true)} onAgain={() => mistake(target)}
                extra={<IconButton icon="book" filled size={20} label="Open page" onClick={() => nav.push('reader', { page: target.page, highlight: target.ayahId })} />} />
            );
          })}
        </div>
      </div>
      <div className="footer border">
        <Button size="lg" block disabled={!practised} onClick={finish}>Finish{practised ? ` · ${practised} of ${t.targets.length} practised` : ''}</Button>
      </div>
    </>
  );
}

function Complete({ s }) {
  const r = s.result;
  const { engine } = useApp();
  const practice = sessionPracticeTask(engine, s.sessionId);
  const done = () => { clearActiveSession(); nav.pop(); };
  return (
    <>
      <div className="scroll stack pad session-complete" style={{ alignItems: 'center', textAlign: 'center', gap: 10, paddingTop: 'calc(var(--safe-t) + 24px)', paddingBottom: 20 }}>
        {r.passed ? <CheckBurst size={92} /> : (
          <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={spring} style={{ width: 92, height: 92, borderRadius: 46, background: 'var(--amber-soft)', color: 'var(--amber-ink)', display: 'grid', placeItems: 'center' }}>
            <Icon name="refresh" size={40} />
          </motion.div>
        )}
        <motion.h1 className="h1" style={{ marginTop: 14 }} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>{r.headline}</motion.h1>
        <motion.p className="sub" style={{ margin: 0, maxWidth: 320 }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25 }}>{s.task.title} · {s.task.subtitle}</motion.p>
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, width: '100%', marginTop: 18 }}>
          {[[Math.max(1, Math.round(r.minutes)), 'minutes'], [s.kind === 'targeted' ? s.attempts.length : r.pages, s.kind === 'targeted' ? 'attempts' : 'pages'], [r.mistakes, 'mistakes']].map(([v, l]) => (
            <div key={l} className="card" style={{ padding: '14px 6px' }}><div className="num" style={{ fontFamily: 'var(--serif)', fontSize: 28 }}>{v}</div><div className="tiny">{l}</div></div>
          ))}
        </motion.div>
        {r.reasons?.length > 0 && (
          <motion.div className="card" style={{ width: '100%', padding: '4px 0', textAlign: 'left', marginTop: 4 }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.45 }}>
            {r.reasons.map(x => <div key={x} className="row small" style={{ minHeight: 44 }}><Icon name="info" size={18} style={{ color: 'var(--amber-ink)' }} /><span className="grow">{x}</span></div>)}
          </motion.div>
        )}
        {r.next && <motion.div className="row-flex small" style={{ marginTop: 8, gap: 8, textAlign: 'left', padding: '12px 14px', borderRadius: 14, background: 'var(--pri-soft)', color: 'var(--pri-soft-ink)', width: '100%' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}>
          <Icon name="arrowUp" size={18} style={{ transform: 'rotate(90deg)', flexShrink: 0 }} /><span>{r.next}</span>
        </motion.div>}
        {practice && <><h2 className="h2" style={{ alignSelf: 'flex-start', marginTop: 14 }}>Your mistakes</h2><MistakeList task={practice} sessionId={s.sessionId} /></>}
      </div>
      <div className="footer border">
        {practice && <Button size="lg" block onClick={() => nav.replace('sessionMistakes', { sessionId: s.sessionId })}>Review & practise mistakes</Button>}
        <Button variant={practice ? 'secondary' : 'primary'} size="lg" block onClick={done}>{practice ? 'Done for now' : 'Done'}</Button>
      </div>
    </>
  );
}

export default function Session({ draftId }) {
  const { activeSession: s } = useApp();
  if (!s || s.id !== draftId) return <div className="layer" />;
  const key = `${s.phase}-${s.passIndex}`;
  const View = { intro: Intro, pass: Pass, rate: Rate, repair: Repair, targeted: Targeted, complete: Complete }[s.phase];
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={key} className="layer" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.22, ease: 'easeOut' }}>
        <View s={s} />
      </motion.div>
    </AnimatePresence>
  );
}
