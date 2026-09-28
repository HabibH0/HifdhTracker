// Loads the locally bundled QCF V2 page layouts and page fonts. Each of the 604 pages has
// its own font whose glyphs are that page's words; lines are fixed and never reflow.
import { PAGE_COUNT } from './quran.js';
import { setOffline } from './store.js';

const BASE = import.meta.env.BASE_URL;
const pad = n => String(n).padStart(3, '0');
export const pageUrl = n => `${BASE}mushaf/pages/${pad(n)}.json`;
export const fontUrl = n => `${BASE}mushaf/fonts/p${n}.woff2`;
export const fontFamily = n => `qcf-p${n}`;

const pages = new Map();
const fonts = new Map();
const ready = new Set();

/** Page JSON: { p, lines: [{ n, t: 'text'|'header'|'basmala', s?, w?: [[id, glyph, verseKey, position, isEnd, text]] }] } */
export function loadPage(n) {
  if (!pages.has(n)) {
    pages.set(n, fetch(pageUrl(n)).then(r => {
      if (!r.ok) throw new Error(`Page ${n} unavailable`);
      return r.json();
    }).catch(error => { pages.delete(n); throw error; }));
  }
  return pages.get(n);
}

export function loadFont(n) {
  if (!fonts.has(n)) {
    // Load bytes with fetch() (same request path as the offline cache), then build the face from
    // the buffer; a url() FontFace makes a CORS request that can miss cached entries offline.
    fonts.set(n, fetch(fontUrl(n))
      .then(r => { if (!r.ok) throw new Error(`Font ${n} unavailable`); return r.arrayBuffer(); })
      .then(buf => new FontFace(fontFamily(n), buf, { display: 'block' }).load())
      .then(f => { document.fonts.add(f); ready.add(n); return f; })
      .catch(error => { fonts.delete(n); throw error; }));
  }
  return fonts.get(n);
}

export const isPageReady = n => ready.has(n);

export function preload(n) {
  if (n < 1 || n > PAGE_COUNT) return;
  loadPage(n).catch(() => {});
  loadFont(n).catch(() => {});
}

export async function loadAll(n) {
  const [page] = await Promise.all([loadPage(n), loadFont(n)]);
  return page;
}

/** Words of an ayah on a page, in order (for small previews of real Mushaf glyphs). */
export function ayahWords(page, ayahId) {
  return page.lines.flatMap(l => (l.w ?? []).filter(w => w[2] === ayahId));
}

// ---- Offline: copy every page layout + font into the Mushaf cache once, in the background.
const CACHE = 'mushaf-v1';
let running = false;
export async function ensureOffline() {
  if (running || !('caches' in window)) return;
  running = true;
  try {
    const cache = await caches.open(CACHE);
    const urls = [`${BASE}mushaf/fonts/sura_names.woff2`];
    for (let n = 1; n <= PAGE_COUNT; n++) urls.push(pageUrl(n), fontUrl(n));
    const cached = new Set((await cache.keys()).map(r => new URL(r.url).pathname));
    const missing = urls.filter(u => !cached.has(new URL(u, location.href).pathname));
    const total = urls.length;
    let done = total - missing.length;
    setOffline({ done, total, complete: !missing.length });
    let i = 0;
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (i < missing.length) {
        const url = missing[i++];
        try { await cache.add(url); done++; } catch { /* offline right now; retried next launch */ }
        if (done % 20 === 0 || done === total) setOffline({ done, total, complete: done === total });
      }
    }));
    setOffline({ done, total, complete: done === total });
  } finally {
    running = false;
  }
}

// Surah-name calligraphy font (used by page headers and the surah list).
let surahNames;
export function loadSurahNames() {
  surahNames ??= fetch(`${BASE}mushaf/fonts/sura_names.woff2`)
    .then(r => r.arrayBuffer())
    .then(buf => new FontFace('surahnames', buf, { display: 'block' }).load())
    .then(f => document.fonts.add(f))
    .catch(() => { surahNames = null; });
  return surahNames;
}
