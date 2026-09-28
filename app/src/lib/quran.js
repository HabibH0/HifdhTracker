import meta from '../data/quran-meta.json';
import { engineMetadata as buildMetadata } from '../../../shared/layout.js';

export const LAYOUT_ID = meta.layoutId;
export const SOURCE = meta.source;
export const SURAHS = meta.surahs;
export const PAGES = meta.pages; // index = page - 1
export const PAGE_COUNT = PAGES.length;

export const pageId = n => `p${n}`;
export const pageNum = id => +String(id).slice(1);
export const hizbId = n => `h${n}`;
export const hizbNum = id => +String(id).slice(1);
export const juzId = n => `j${n}`;
export const juzNum = id => +String(id).slice(1);
export const pageMeta = n => PAGES[n - 1];

export const JUZ_PAGES = Array.from({ length: 30 }, (_, i) => PAGES.filter(p => p.juz === i + 1).map(p => p.p));
export const HIZB_PAGES = Array.from({ length: 60 }, (_, i) => PAGES.filter(p => p.hizb === i + 1).map(p => p.p));

const split = id => id.split(':').map(Number);
export const surahOf = ayahId => SURAHS[split(ayahId)[0] - 1];
export const ayahNo = ayahId => split(ayahId)[1];
export const surahNo = ayahId => split(ayahId)[0];

/** Engine layout metadata; built by the same shared code the server uses. */
export const engineMetadata = () => buildMetadata(meta);

export function ayahLabel(ayahId) {
  return `${surahOf(ayahId).en} ${ayahId}`;
}

/** "Al-Baqarah 2:6–16" or "Al-Mulk 67:20 – Al-Qalam 68:4" */
export function rangeLabel(ayahIds) {
  if (!ayahIds?.length) return '';
  const first = ayahIds[0], last = ayahIds.at(-1);
  if (first === last) return ayahLabel(first);
  if (surahNo(first) === surahNo(last)) return `${surahOf(first).en} ${first}–${ayahNo(last)}`;
  return `${surahOf(first).en} ${first} – ${surahOf(last).en} ${last}`;
}

/** Compress page numbers: [231..240] → "231–240", [523,524,527] → "523–524, 527" */
export function compressPages(nums) {
  const sorted = [...new Set(nums)].sort((a, b) => a - b), parts = [];
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(i === j ? `${sorted[i]}` : `${sorted[i]}–${sorted[j]}`);
    i = j;
  }
  return parts.join(', ');
}
export function pagesLabel(nums) {
  return `${nums.length === 1 ? 'Page' : 'Pages'} ${compressPages(nums)}`;
}

export function halfLabel(hizb) {
  return `Juz ${Math.ceil(hizb / 2)} · ${hizb % 2 ? 'First' : 'Second'} half`;
}

export function pageSurahs(n) {
  return [...new Set(pageMeta(n).ayahs.map(surahNo))].map(s => SURAHS[s - 1]);
}

export function surahStartPage(s) {
  return SURAHS[s - 1].pages[0];
}

export function pagesForSurah(s) {
  return PAGES.filter(p => p.ayahs.some(a => surahNo(a) === s)).map(p => p.p);
}

/** First page on which an ayah appears. */
const ayahPage = new Map();
for (const p of PAGES) for (const a of p.ayahs) if (!ayahPage.has(a)) ayahPage.set(a, p.p);
export const pageOfAyah = ayahId => ayahPage.get(ayahId);

export const ARABIC_DIGITS = n => String(n).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);
