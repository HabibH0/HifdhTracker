import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { loadAll, fontFamily, isPageReady } from '../lib/mushaf.js';
import bismillah from '../assets/bismillah.svg?raw';

// Fixed design geometry for every page. The frame is laid out once at this size and then
// scaled as a whole to the viewport, so words never reflow between lines.
export const FONT = 30;
export const PAGE_W = 520;
export const PAD_X = 14;
export const LINE_H = 54;
export const PAD_Y = 16;
export const PAGE_H = LINE_H * 15 + PAD_Y * 2;
export const PAGE_RATIO = PAGE_W / PAGE_H;

const pad3 = n => String(n).padStart(3, '0');
const cachedPages = new Map();

function SurahHeader({ s }) {
  return (
    <div className="surah-head">
      <svg viewBox="0 0 540 50" preserveAspectRatio="none" style={{ position: 'absolute', inset: '4px 0', width: '100%', height: 'calc(100% - 8px)' }} aria-hidden="true">
        <g fill="none" stroke="var(--mushaf-frame)">
          <rect x="1.5" y="1.5" width="537" height="47" rx="6" strokeWidth="1.6" />
          <rect x="7" y="6.5" width="526" height="37" rx="4" strokeWidth=".9" />
          <path d="M150 25h-120M390 25h120" strokeWidth=".9" strokeDasharray="1.5 4" />
          <g transform="translate(24 25)"><rect x="-7" y="-7" width="14" height="14" strokeWidth="1" /><rect x="-7" y="-7" width="14" height="14" transform="rotate(45)" strokeWidth="1" /></g>
          <g transform="translate(516 25)"><rect x="-7" y="-7" width="14" height="14" strokeWidth="1" /><rect x="-7" y="-7" width="14" height="14" transform="rotate(45)" strokeWidth="1" /></g>
        </g>
      </svg>
      <span className="name" style={{ fontSize: FONT * 1.25 }}>{`surah${pad3(s)}`}</span>
    </div>
  );
}

function Basmala() {
  return <div className="basmala" dangerouslySetInnerHTML={{ __html: bismillah }} />;
}

/**
 * props:
 *  n            page number (1–604)
 *  fit          'contain' (fit width and height) | 'width'
 *  dimAyahs     Set of ayahIds to show dimmed and untappable (not memorized / outside the section)
 *  selected     { ayahId, pos } — pos null selects the whole ayah
 *  wordMarks    Map `${ayahId}:${pos}` → count
 *  ayahMarks    Map ayahId → count
 *  highlight    Set of ayahIds to tint softly (e.g. a targeted weakness)
 *  onWord       ({ ayahId, pos, isEnd, glyph, text, page }) => void
 */
export const MushafPage = memo(function MushafPage(props) {
  // A new page needs its own loaded data and measured line layout.
  return <PageContent key={props.n} {...props} />;
});

function PageContent({ n, fit = 'contain', dimAyahs, selected, wordMarks, ayahMarks, highlight, onWord, onReady }) {
  const hostRef = useRef(null), frameRef = useRef(null);
  const [data, setData] = useState(() => (isPageReady(n) ? cachedPages.get(n) : null));
  const [error, setError] = useState(null);
  const [box, setBox] = useState(null);
  const [layout, setLayout] = useState(null); // per-line 'justify' | 'center'
  const hasBox = box !== null;

  useEffect(() => {
    let live = true;
    setError(null);
    loadAll(n).then(page => { cachedPages.set(n, page); if (live) setData(page); }).catch(e => live && setError(e));
    return () => { live = false; };
  }, [n]);

  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Decide once per page which lines are full (justified edge to edge) and which are short.
  useLayoutEffect(() => {
    if (!data || !frameRef.current) return;
    const lines = [...frameRef.current.querySelectorAll('.mushaf-line')];
    const special = n <= 2;
    setLayout(lines.map(line => {
      if (special) return 'center';
      let sum = 0;
      // Unscaled widths stay valid while the host or its ancestors are animating.
      for (const w of line.children) sum += w.offsetWidth;
      return sum > (PAGE_W - PAD_X * 2) * 0.8 ? 'justify' : 'center';
    }));
    onReady?.();
    // Cached data can arrive before the first host measurement mounts the frame.
  }, [data, n, hasBox]);

  const scale = box ? (fit === 'width' ? box.w / PAGE_W : Math.min(box.w / PAGE_W, box.h / PAGE_H)) : 0;
  const top = box && fit !== 'width' ? Math.max(0, (box.h - PAGE_H * scale) / 2) : 0;
  const special = n <= 2;
  let textLine = 0;

  return (
    <div ref={hostRef} className="mushaf-host" style={fit === 'width' && box ? { height: PAGE_H * scale } : undefined}>
      {error && <div className="center small" style={{ position: 'absolute', inset: 0 }}>Page {n} isn’t available offline yet.</div>}
      {box && data && (
        <motion.div ref={frameRef} className="mushaf-frame" initial={{ opacity: 0 }} animate={{ opacity: layout ? 1 : 0 }} transition={{ duration: 0.25 }}
          style={{ width: PAGE_W, height: PAGE_H, marginLeft: -PAGE_W / 2, transform: `translateY(${top}px) scale(${scale})`, fontFamily: fontFamily(n), fontSize: FONT, padding: `${PAD_Y + (special ? LINE_H * 3.5 : 0)}px ${PAD_X}px` }}>
          {data.lines.map((line, i) => {
            if (line.t === 'header') return <div key={i} style={{ height: LINE_H }}><SurahHeader s={line.s} /></div>;
            if (line.t === 'basmala') return <div key={i} style={{ height: LINE_H }}><Basmala /></div>;
            const mode = layout?.[textLine++] ?? 'center';
            return (
              <div key={i} className={`mushaf-line ${mode}`} style={{ height: LINE_H, padding: special ? '0 12%' : undefined }}>
                {line.w.map(w => {
                  const [id, glyph, ayahId, pos, isEnd, text] = w;
                  const dim = dimAyahs?.has(ayahId);
                  const isSel = selected && selected.ayahId === ayahId && (selected.pos == null || selected.pos === pos);
                  const wm = !isEnd && wordMarks?.get(`${ayahId}:${pos}`);
                  const am = isEnd && ayahMarks?.get(ayahId);
                  const cls = `w ${isEnd ? 'end' : ''} ${dim ? 'dim' : onWord ? 'tappable' : ''} ${isSel ? 'sel' : highlight?.has(ayahId) ? 'hl' : ''}`;
                  return (
                    <span key={id} className={cls} role={onWord && !dim ? 'button' : undefined} aria-label={isEnd ? `End of āyah ${ayahId}` : text}
                      onClick={onWord && !dim ? e => { e.stopPropagation(); onWord({ ayahId, pos: isEnd ? null : pos, isEnd: !!isEnd, glyph, text, page: n }); } : undefined}>
                      {glyph}
                      {wm ? <i className="mk" /> : null}
                      {am ? <i className="ring" /> : null}
                    </span>
                  );
                })}
              </div>
            );
          })}
        </motion.div>
      )}
      {box && !data && !error && (
        <div style={{ position: 'absolute', left: '50%', width: PAGE_W * scale, marginLeft: -(PAGE_W * scale) / 2, top: top + PAD_Y * scale, display: 'flex', flexDirection: 'column' }}>
          {Array.from({ length: 15 }, (_, i) => <div key={i} style={{ height: LINE_H * scale, display: 'flex', alignItems: 'center' }}><div className="skeleton-line" /></div>)}
        </div>
      )}
    </div>
  );
}

/** A short preview of an ayah using its real Mushaf glyphs (same page font). */
export function AyahGlyphs({ page, ayahId, size = 22, maxWords = 8 }) {
  const [words, setWords] = useState(null);
  useEffect(() => {
    let live = true;
    loadAll(page).then(p => live && setWords(p.lines.flatMap(l => (l.w ?? []).filter(w => w[2] === ayahId)))).catch(() => {});
    return () => { live = false; };
  }, [page, ayahId]);
  if (!words) return <div style={{ height: size * 1.5 }} />;
  const shown = words.filter(w => !w[4]).slice(0, maxWords), more = words.filter(w => !w[4]).length > maxWords;
  return (
    <div dir="rtl" style={{ fontFamily: fontFamily(page), fontSize: size, lineHeight: 1.5, color: 'var(--mushaf-ink)', display: 'flex', flexWrap: 'wrap', columnGap: size * 0.2, maxHeight: size * 3.1, overflow: 'hidden' }}>
      {shown.map(w => <span key={w[0]}>{w[1]}</span>)}
      {more && <span style={{ fontFamily: 'var(--sans)', color: 'var(--ink-3)', fontSize: size * 0.6, alignSelf: 'center' }}>…</span>}
    </div>
  );
}

export function WordGlyph({ page, glyph, size = 44 }) {
  return <span style={{ fontFamily: fontFamily(page), fontSize: size, lineHeight: 1.3, color: 'var(--mushaf-ink)' }}>{glyph}</span>;
}
