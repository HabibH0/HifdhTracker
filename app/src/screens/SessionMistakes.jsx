import { useApp } from '../lib/store.js';
import { nav } from '../lib/nav.js';
import { sessionPracticeTask } from '../lib/plan.js';
import { mistakeLabel } from '../lib/session.js';
import { openTask } from './Today.jsx';
import { Button, TopBar } from '../components/ui.jsx';

export function MistakeList({ task, sessionId }) {
  const { wordMarks } = useApp();
  return <div className="stack gap-8" style={{ width: '100%', textAlign: 'left' }}>
    {task.targets.map(target => {
      const positions = [...new Set(wordMarks.filter(m => m.sessionId === sessionId && m.page === target.page && m.ayahId === target.ayahId && m.pos).map(m => m.pos))].sort((a, b) => a - b);
      return <div className="card pad-card stack gap-8" key={target.id}>
        <div className="h3">{target.label}</div>
        <div className="tiny">Page {target.page} · {target.why}</div>
        {target.mistakeTypes?.length > 0 && <div className="small">{target.mistakeTypes.map(mistakeLabel).join(' · ')}</div>}
        {positions.length > 0 && <div className="tiny">Word{positions.length === 1 ? '' : 's'} {positions.join(', ')}</div>}
        <Button variant="secondary" size="sm" onClick={() => nav.push('reader', { page: target.page, highlight: target.ayahId })}>Look at passage</Button>
      </div>;
    })}
  </div>;
}

export default function SessionMistakes({ sessionId }) {
  const { engine, activeSession } = useApp();
  const task = sessionPracticeTask(engine, sessionId);
  return <div className="layer">
    <TopBar title="Session mistakes" onBack={() => nav.pop()} />
    <div className="scroll pad" style={{ paddingBottom: 20 }}>
      <p className="sub">{task ? 'Review what went wrong, then recall each passage from memory. Start slightly before the mistake and continue beyond it.' : 'No mistakes or weak recall were recorded in this session.'}</p>
      {task && <MistakeList task={task} sessionId={sessionId} />}
    </div>
    {task && <div className="footer border"><Button size="lg" block onClick={() => openTask(task, activeSession)}>Practise {task.targets.length} location{task.targets.length === 1 ? '' : 's'}</Button></div>}
  </div>;
}
