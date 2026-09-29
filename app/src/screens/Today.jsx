import { motion, AnimatePresence } from 'framer-motion';
import { useApp, setSettings, today, capacityToday, clearActiveSession } from '../lib/store.js';
import { todayPlan, TASK_TYPES } from '../lib/plan.js';
import { nav } from '../lib/nav.js';
import { createSession, update } from '../lib/session.js';
import { Button, IconButton, OptionGrid, Pressable, Ring, Tag, confirmSheet, softSpring } from '../components/ui.jsx';
import { Icon, StarPattern } from '../components/Icons.jsx';
import { CAPACITIES } from './Onboarding.jsx';
import { requestLeave } from './Session.jsx';
import { SyncBadge } from '../components/SyncStatus.jsx';

const gregorian = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
let hijri;
try { hijri = new Intl.DateTimeFormat('en-GB-u-ca-islamic-umalqura', { day: 'numeric', month: 'long', year: 'numeric' }); } catch { hijri = null; }

const toneVar = { green: 'var(--pri-soft)', blue: 'var(--blue-soft)', amber: 'var(--amber-soft)', gold: 'var(--gold-soft)' };
const toneInk = { green: 'var(--pri-soft-ink)', blue: 'var(--blue-ink)', amber: 'var(--amber-ink)', gold: 'var(--gold)' };

export function openTask(task, activeSession) {
  const unfinished = activeSession && activeSession.phase !== 'intro' && activeSession.phase !== 'complete';
  if (unfinished && activeSession.taskKey === task.key) return nav.push('session', { onBack: requestLeave, draftId: activeSession.id });
  const start = () => { const s = update(createSession(task), {}); nav.push('session', { onBack: requestLeave, draftId: s.id }); };
  if (!unfinished) return start();
  confirmSheet({
    title: 'Finish your other session first?',
    body: `“${activeSession.task.title}” is still in progress. Starting this task discards it.`,
    confirm: 'Resume that session', tone: 'primary', cancel: 'Discard it and start this one',
    onConfirm: () => nav.push('session', { onBack: requestLeave, draftId: activeSession.id }),
    onCancel: start,
  });
}

function UnfinishedBanner({ session }) {
  return (
    <motion.div className="card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} style={{ padding: 14, marginTop: 14, display: 'flex', alignItems: 'center', gap: 12, borderColor: 'var(--pri-soft)' }}>
      <Icon name="history" size={22} style={{ color: 'var(--pri-soft-ink)' }} />
      <div className="grow"><div className="label" style={{ fontWeight: 600, fontSize: 15 }}>Unfinished session</div><div className="tiny ellipsis">{session.task.title} · {session.task.subtitle}</div></div>
      <Button size="sm" variant="soft" onClick={() => nav.push('session', { onBack: requestLeave, draftId: session.id })}>Resume</Button>
      <IconButton icon="close" size={18} label="Discard" onClick={() => confirmSheet({ title: 'Discard this session?', body: 'Nothing from it has been recorded yet.', confirm: 'Discard', onConfirm: () => clearActiveSession() })} />
    </motion.div>
  );
}

function capacitySheet(plan) {
  nav.openSheet(close => {
    const Content = () => {
      const { settings } = useApp();
      const value = capacityToday();
      return (
        <div className="stack gap-12">
          <h2>Time available today</h2>
          <p className="sub" style={{ margin: 0 }}>Today’s plan re-orders to fit. Your default stays {settings.capacity} minutes.</p>
          <OptionGrid columns={4} options={CAPACITIES.map(c => ({ ...c, label: c.value, sub: 'min' }))} value={value}
            onChange={v => { setSettings({ todayCapacity: { date: today(), minutes: v } }); setTimeout(close, 180); }} />
          <div style={{ height: 6 }} />
        </div>
      );
    };
    return <Content />;
  });
}

function deferredSheet(plan) {
  nav.openSheet(close => (
    <div className="stack gap-12">
      <h2>Moved to another day</h2>
      <p className="sub" style={{ margin: 0 }}>These didn’t fit in {plan.capacity} minutes. They’ll be ranked again tomorrow.</p>
      <div className="card list">
        {plan.deferred.map((d, i) => (
          <div key={i} className="row">
            <span className="dot" style={{ background: d.safe ? 'var(--ink-3)' : 'var(--st-weak)' }} />
            <span className="grow"><span className="label" style={{ display: 'block' }}>{d.label}</span><span className="tiny">{d.safe ? 'Safe to postpone' : 'Important — better not to delay long'}</span></span>
            <span className="tiny num">{d.minutes} min</span>
          </div>
        ))}
      </div>
      {plan.capacity < 120 && <Button variant="soft" block size="lg" onClick={() => { close(); setTimeout(() => capacitySheet(plan), 250); }}>Add time today</Button>}
      <div style={{ height: 4 }} />
    </div>
  ));
}

function TaskCard({ task, done, active, onOpen }) {
  const type = TASK_TYPES[task.kind];
  const inProgress = active && active.taskKey === task.key && active.phase !== 'intro' && active.phase !== 'complete';
  return (
    <motion.div layout="position" transition={softSpring} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }}>
      <Pressable className="card" onClick={done ? () => nav.push('sessionMistakes', { sessionId: task.sessionId }) : onOpen}
        style={{ display: 'flex', gap: 14, padding: 16, width: '100%', textAlign: 'left', alignItems: 'center', opacity: done ? 0.72 : 1 }}>
        <div style={{ width: 44, height: 44, borderRadius: 14, display: 'grid', placeItems: 'center', flexShrink: 0, background: done ? 'var(--pri)' : toneVar[type.tone], color: done ? 'var(--pri-ink)' : toneInk[type.tone] }}>
          <Icon name={done ? 'check' : type.icon} size={22} stroke={done ? 2.4 : 1.9} />
        </div>
        <div className="grow stack" style={{ gap: 3 }}>
          <div className="row-flex" style={{ gap: 8 }}>
            <Tag tone={type.tone}>{type.label}</Tag>
            {task.overdue && !done && <Tag tone="red">Overdue</Tag>}
          </div>
          <div className="h3 ellipsis" style={{ textDecoration: done ? 'none' : undefined }}>{task.title}</div>
          <div className="small ellipsis">{task.subtitle}</div>
          <div className="tiny ellipsis" style={{ color: inProgress ? 'var(--pri-soft-ink)' : undefined, fontWeight: inProgress ? 600 : 400 }}>
            {done ? `Done · ${task.actualMinutes} min${task.mistakes ? ` · ${task.mistakes} mistake${task.mistakes === 1 ? '' : 's'}` : ''}${task.headline ? ` · ${task.headline}` : ''}` : inProgress ? `In progress · ${active.kind === 'targeted' ? 'practice' : `pass ${active.passIndex + 1} of ${task.passes}`}` : task.status}
          </div>
        </div>
        {!done && (
          <div className="stack" style={{ alignItems: 'flex-end', gap: 8, flexShrink: 0 }}>
            <span className="small num" style={{ fontWeight: 600, color: 'var(--ink)' }}>{task.minutes} min</span>
            <span style={{ width: 34, height: 34, borderRadius: 17, display: 'grid', placeItems: 'center', background: inProgress ? 'var(--pri)' : 'var(--card-2)', color: inProgress ? 'var(--pri-ink)' : 'var(--pri-soft-ink)', border: '1px solid var(--line)' }}>
              <Icon name="play" size={14} />
            </span>
          </div>
        )}
      </Pressable>
    </motion.div>
  );
}

export default function Today() {
  const app = useApp();
  let plan, error;
  try { plan = todayPlan(); } catch (e) { error = e; console.error(e); }
  const now = new Date();
  if (error) return <div className="scroll tab-scroll"><p className="sub">The plan couldn’t be generated: {error.message}</p></div>;

  const total = plan.done.length + plan.pending.length;
  const allDone = total > 0 && plan.pending.length === 0;
  const empty = total === 0;
  const next = plan.pending[0];
  const active = app.activeSession?.date === today() ? app.activeSession : null;
  const resumeTask = active && active.phase !== 'intro' && plan.pending.find(t => t.key === active.taskKey);
  const orphan = app.activeSession && !['intro', 'complete'].includes(app.activeSession.phase) && !resumeTask ? app.activeSession : null;
  const startTask = resumeTask ?? next;

  return (
    <div className="scroll">
      <div style={{ position: 'relative' }}>
        <div style={{ position: 'absolute', inset: '0 0 -40px', color: 'var(--pri)', maskImage: 'linear-gradient(#000, transparent)', WebkitMaskImage: 'linear-gradient(#000, transparent)' }}><StarPattern opacity={0.05} /></div>
        <div className="pad" style={{ paddingTop: 'calc(var(--safe-t) + 22px)', position: 'relative' }}>
          <div className="row-flex" style={{ justifyContent: 'space-between', minHeight: 30 }}>
            <div className="eyebrow">{gregorian.format(now)}{hijri ? ` · ${hijri.format(now).replace(' AH', '')}` : ''}</div>
            <SyncBadge />
          </div>
          <div className="small" style={{ marginTop: 8, color: 'var(--ink-2)' }}>Assalāmu ʿalaykum</div>
          <h1 className="h1" style={{ marginTop: 2 }}>{allDone ? 'All done for today' : empty ? 'A quiet day' : 'Today’s revision'}</h1>
        </div>
      </div>

      <div className="pad" style={{ paddingBottom: 'calc(var(--tabbar) + var(--safe-b) + 28px)' }}>
        <motion.div className="card" style={{ padding: 18, marginTop: 18 }} layout transition={softSpring}>
          <div className="row-flex" style={{ gap: 18, alignItems: 'center' }}>
            <Ring value={total ? plan.done.length / total : 0} size={100} stroke={9}>
              <div className="num" style={{ fontFamily: 'var(--serif)', fontSize: 30, lineHeight: 1 }}>{plan.done.length}<span style={{ fontSize: 18, color: 'var(--ink-3)' }}>/{total}</span></div>
              <div className="tiny" style={{ marginTop: 2 }}>tasks</div>
            </Ring>
            <div className="stack gap-8 grow">
              <div className="row-flex small" style={{ gap: 8, color: 'var(--ink)' }}>
                <Icon name="clock" size={17} style={{ color: 'var(--ink-3)' }} />
                <span><b className="num">{allDone ? plan.doneMinutes : plan.pendingMinutes}</b> min {allDone ? 'revised' : plan.done.length ? 'remaining' : 'estimated'}</span>
              </div>
              {plan.done.length > 0 && !allDone && (
                <div className="row-flex small" style={{ gap: 8, color: 'var(--ink)' }}><Icon name="check" size={17} style={{ color: 'var(--ink-3)' }} /><span><b className="num">{plan.doneMinutes}</b> min done</span></div>
              )}
              <Pressable className="row-flex small" onClick={() => capacitySheet(plan)} style={{ gap: 8, color: 'var(--pri-soft-ink)', fontWeight: 600, alignSelf: 'flex-start', padding: '6px 10px 6px 8px', margin: '-2px 0 0 -8px', borderRadius: 10, background: 'var(--pri-soft)' }}>
                <Icon name="edit" size={15} /> {plan.capacity} min available
              </Pressable>
            </div>
          </div>
          <AnimatePresence initial={false} mode="wait">
            {startTask ? (
              <motion.div key="start" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                <div style={{ height: 16 }} />
                <Button size="lg" block onClick={() => openTask(startTask, active)}>
                  <Icon name="play" size={16} />{resumeTask ? 'Continue revision' : plan.done.length ? 'Continue with next task' : 'Start revision'}
                </Button>
              </motion.div>
            ) : (
              <motion.p key="msg" className="small" style={{ margin: '16px 0 0' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                {allDone ? `${plan.nextStage ? 'Your strengthening continues tomorrow. ' : ''}Tomorrow’s plan will be ready in the morning.` : 'Nothing is due today. Your plan fills up as material needs review.'}
              </motion.p>
            )}
          </AnimatePresence>
        </motion.div>

        {orphan && <UnfinishedBanner session={orphan} />}
        <Button variant="secondary" block style={{ marginTop: 16 }} onClick={() => nav.push('revisionSections')}>Manage revision · relearn & maintain</Button>

        {plan.pending.length > 0 && <div className="section-title"><h3>Plan</h3><span className="tiny">{plan.pending.length} task{plan.pending.length === 1 ? '' : 's'}</span></div>}
        <div className="stack gap-12">
          <AnimatePresence initial={false}>
            {plan.pending.map(task => <TaskCard key={task.key} task={task} active={active} onOpen={() => openTask(task, active)} />)}
          </AnimatePresence>
        </div>

        {plan.deferred.length > 0 && (
          <Pressable onClick={() => deferredSheet(plan)} className="row-flex small" style={{ width: '100%', marginTop: 14, padding: '12px 14px', borderRadius: 14, border: '1px dashed var(--line-2)', gap: 10, color: 'var(--ink-2)' }}>
            <Icon name={plan.deferred.some(d => !d.safe) ? 'alert' : 'info'} size={18} style={{ color: plan.deferred.some(d => !d.safe) ? 'var(--st-weak)' : 'var(--ink-3)' }} />
            <span className="grow" style={{ textAlign: 'left' }}>{plan.deferred.length} item{plan.deferred.length === 1 ? '' : 's'} didn’t fit today</span>
            <Icon name="chevronRight" size={16} />
          </Pressable>
        )}

        {plan.done.length > 0 && (
          <>
            <div className="section-title"><h3>Completed</h3><span className="tiny">{plan.doneMinutes} min</span></div>
            <div className="stack gap-12">
              {plan.done.map(task => <TaskCard key={`done-${task.sessionId}`} task={task} done />)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
