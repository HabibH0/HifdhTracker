import { motion } from 'framer-motion';
import { PAGES, halfLabel, compressPages, rangeLabel } from '../lib/quran.js';
import { freshAyat } from './MaterialPicker.jsx';

// Starting ratings, mapped onto the engine's initial strengths. "Relearning" starts lowest, so
// the planner strengthens those half-juz first, through the 3-day cycle, one at a time.
export const RATINGS = [
  { value: 'very_weak', label: 'Relearning', short: 'Relearn', sub: 'Goes into the 3-day cycle first' },
  { value: 'weak', label: 'Needs work', short: 'Weak', sub: 'Strengthened in turn' },
  { value: 'medium', label: 'Fairly solid', short: 'Solid', sub: 'Regular reviews' },
  { value: 'strong', label: 'Strong', short: 'Strong', sub: 'Reviewed less often' },
];

/** New material grouped by half-juz (the strengthening unit): [{ hizb, pages, ayahIds }] */
export function selectionSections(sel, known) {
  const fresh = freshAyat(sel, known);
  const byHizb = new Map();
  for (const p of PAGES) {
    const ayahIds = p.ayahs.filter(a => fresh.has(a));
    if (!ayahIds.length) continue;
    const s = byHizb.get(p.hizb) ?? { hizb: p.hizb, pages: [], ayahIds: [] };
    s.pages.push(p.p);
    for (const a of ayahIds) if (!s.ayahIds.includes(a)) s.ayahIds.push(a);
    byHizb.set(p.hizb, s);
  }
  return [...byHizb.values()];
}

/** Engine initialStrength map: { pageId: strength } for every page in a rated section. */
export function strengthMap(sections, ratings) {
  const map = {};
  for (const s of sections) for (const p of s.pages) map[`p${p}`] = ratings[s.hizb];
  return map;
}

function Pills({ value, onChange, compact }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
      {RATINGS.map(r => (
        <motion.button type="button" key={r.value} whileTap={{ scale: 0.95 }} className={`opt ${value === r.value ? 'on' : ''}`}
          style={{ minHeight: compact ? 40 : 48, fontSize: compact ? 13 : 14, borderRadius: 12, padding: '4px 2px' }} onClick={() => onChange(r.value)}>
          {compact ? r.short : r.label}
        </motion.button>
      ))}
    </div>
  );
}

/** Rate each half-juz of newly added material; a "set all" row covers the common case. */
export default function SectionRater({ sections, ratings, onChange }) {
  const values = sections.map(s => ratings[s.hizb]);
  const all = values.length && values.every(v => v === values[0]) ? values[0] : null;
  const setAll = v => onChange(Object.fromEntries(sections.map(s => [s.hizb, v])));
  const chosen = RATINGS.find(r => r.value === all);
  return (
    <div className="stack gap-12">
      {sections.length > 1 && (
        <div className="card pad-card stack gap-8">
          <div className="row-flex" style={{ justifyContent: 'space-between' }}>
            <span className="h3" style={{ fontSize: 15 }}>All {sections.length} sections</span>
            <span className="tiny">{chosen ? chosen.sub : values.some(Boolean) ? 'Mixed' : 'Tap to set all'}</span>
          </div>
          <Pills value={all} onChange={setAll} />
        </div>
      )}
      {sections.map(s => {
        const r = RATINGS.find(x => x.value === ratings[s.hizb]);
        return (
          <div key={s.hizb} className="card pad-card stack gap-8">
            <div>
              <div className="row-flex" style={{ justifyContent: 'space-between', gap: 8 }}>
                <span className="h3" style={{ fontSize: 15 }}>{halfLabel(s.hizb)}</span>
                <span className="tiny num">{s.pages.length === 1 ? 'p.' : 'pp.'} {compressPages(s.pages)}</span>
              </div>
              <div className="tiny ellipsis">{rangeLabel(s.ayahIds)}{r && sections.length === 1 ? ` · ${r.sub}` : ''}</div>
            </div>
            <Pills compact={sections.length > 1} value={ratings[s.hizb]} onChange={v => onChange({ ...ratings, [s.hizb]: v })} />
          </div>
        );
      })}
    </div>
  );
}
