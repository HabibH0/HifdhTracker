import { useApp, timeZone } from '../lib/store.js';
import { nav } from '../lib/nav.js';
import { calendarDay } from '@engine/time.js';
import { sessions, sessionKind, isSpacedSuccess } from '../lib/stats.js';
import { TASK_TYPES } from '../lib/plan.js';
import { ayahLabel, pageNum, pagesLabel } from '../lib/quran.js';
import { mistakeLabel, ACCURACY, FLUENCY } from '../lib/session.js';
import { Pressable, Tag, TopBar } from '../components/ui.jsx';
import { Icon } from '../components/Icons.jsx';

const dayFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
const timeFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
const label = (list, v) => list.find(x => x.value === v)?.label ?? '—';

export function sessionTitle(s, meta) {
  const m = meta[s.sessionId];
  if (m) return { title: m.title, subtitle: m.subtitle };
  const pages = [...new Set(s.reviews.map(r => pageNum(r.pageId)))];
  return { title: pagesLabel(pages), subtitle: '' };
}

export function SessionRow({ s, meta }) {
  const kind = sessionKind(s), type = TASK_TYPES[kind] ?? TASK_TYPES.review;
  const { title, subtitle } = sessionTitle(s, meta);
  return (
    <Pressable className="row" style={{ minHeight: 64 }} onClick={() => sessionSheet(s, meta)}>
      <span style={{ width: 36, height: 36, borderRadius: 11, display: 'grid', placeItems: 'center', background: 'var(--card-2)', color: 'var(--ink-2)', flexShrink: 0 }}><Icon name={type.icon} size={18} /></span>
      <span className="grow" style={{ minWidth: 0 }}>
        <span className="label ellipsis" style={{ display: 'block' }}>{title}</span>
        <span className="tiny ellipsis" style={{ display: 'block' }}>{type.label}{subtitle ? ` · ${subtitle}` : ''}</span>
      </span>
      <span className="stack" style={{ alignItems: 'flex-end', gap: 2 }}>
        <span className="small num">{timeFmt.format(new Date(s.occurredAt))}</span>
        <span className="tiny num">{s.actualDurationMinutes != null ? `${Math.round(s.actualDurationMinutes)} min` : ''}{s.mistakes.length ? ` · ${s.mistakes.length}✕` : ''}</span>
      </span>
    </Pressable>
  );
}

function sessionSheet(s, meta) {
  const { title } = sessionTitle(s, meta);
  const result = s.strengtheningResult;
  nav.openSheet(() => (
    <div className="stack gap-12">
      <h2>{title}</h2>
      <div className="small" style={{ marginTop: -6 }}>{dayFmt.format(new Date(s.occurredAt))} · {timeFmt.format(new Date(s.occurredAt))}{s.actualDurationMinutes != null ? ` · ${Math.round(s.actualDurationMinutes)} min` : ''}</div>
      {result && <Tag tone={result.passed ? 'green' : 'amber'}>{result.passed ? `Day ${result.stage} passed` : `Day ${result.stage} not yet passed`}</Tag>}
      <div className="card list">
        {s.reviews.map((r, i) => (
          <div key={i} className="row" style={{ minHeight: 48 }}>
            <span className="grow">
              <span className="label" style={{ display: 'block', fontSize: 14.5 }}>{r.scope === 'ayah' ? `${ayahLabel(r.ayahIds[0])}${r.ayahIds.length > 1 ? `–${r.ayahIds.at(-1).split(':')[1]}` : ''}` : `Page ${pageNum(r.pageId)}`}</span>
              <span className="tiny">{r.accuracy ? `${label(ACCURACY, r.accuracy)} · ` : ''}{label(FLUENCY, r.fluency)}{isSpacedSuccess(r) ? ' · spaced success' : ''}</span>
            </span>
            {r.mistakes.length > 0 && <span className="tiny" style={{ color: 'var(--mark)' }}>{r.mistakes.map(m => m.ayahId ? `${m.ayahId}${m.type ? ` ${mistakeLabel(m.type).toLowerCase()}` : ''}` : 'page').join(', ')}</span>}
          </div>
        ))}
      </div>
      <div style={{ height: 4 }} />
    </div>
  ));
}

export default function History() {
  const { sessionMeta } = useApp();
  const tz = timeZone();
  const groups = new Map();
  for (const s of sessions()) {
    const day = calendarDay(s.occurredAt, tz);
    groups.set(day, [...(groups.get(day) ?? []), s]);
  }
  return (
    <div className="layer">
      <TopBar title="Revision history" onBack={() => nav.pop()} />
      <div className="scroll pad" style={{ paddingBottom: 'calc(var(--safe-b) + 24px)' }}>
        {[...groups].map(([day, list]) => (
          <div key={day}>
            <div className="section-title"><h3>{dayFmt.format(new Date(`${day}T12:00:00`))}</h3><span className="tiny">{Math.round(list.reduce((n, s) => n + (s.actualDurationMinutes ?? 0), 0))} min</span></div>
            <div className="card list">{list.map(s => <SessionRow key={s.sessionId} s={s} meta={sessionMeta} />)}</div>
          </div>
        ))}
        {!groups.size && <p className="sub" style={{ textAlign: 'center', marginTop: 40 }}>Completed sessions will appear here.</p>}
      </div>
    </div>
  );
}
