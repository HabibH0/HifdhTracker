// Downloads the Quran Foundation QCF V2 (1441H Madinah, 604 pages) layout and fonts
// into local files so the app never needs the network to show the Mushaf.
// Nothing here generates Qur'anic text: every glyph code, line and page position is
// copied verbatim from the Quran Foundation API; the fonts are the official page fonts.
//
//   node scripts/fetch-mushaf.mjs            (idempotent; skips files already present)
import { mkdir, writeFile, access, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://api.quran.com/api/v4';
const CDN = 'https://static.qurancdn.com/fonts/quran';
const GH = 'https://raw.githubusercontent.com/quran/quran.com-frontend-next/production/public';
const PAGES = 604;
const OUT_PAGES = join(ROOT, 'public/mushaf/pages');
const OUT_FONTS = join(ROOT, 'public/mushaf/fonts');
const OUT_META = join(ROOT, 'src/data/quran-meta.json');

const exists = p => access(p).then(() => true, () => false);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(url, as = 'json') {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      return as === 'json' ? await res.json() : Buffer.from(await res.arrayBuffer());
    } catch (error) {
      if (attempt >= 5) throw error;
      await sleep(500 * attempt ** 2);
    }
  }
}

async function pool(items, size, fn) {
  let next = 0, done = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await fn(item);
      if (++done % 50 === 0) console.log(`  ${done}/${items.length}`);
    }
  }));
}

await mkdir(OUT_PAGES, { recursive: true });
await mkdir(OUT_FONTS, { recursive: true });
await mkdir(dirname(OUT_META), { recursive: true });

console.log('Fonts…');
await pool(Array.from({ length: PAGES }, (_, i) => i + 1), 8, async page => {
  const file = join(OUT_FONTS, `p${page}.woff2`);
  if (!(await exists(file))) await writeFile(file, await get(`${CDN}/hafs/v2/woff2/p${page}.woff2`, 'buf'));
});
if (!(await exists(join(OUT_FONTS, 'sura_names.woff2')))) await writeFile(join(OUT_FONTS, 'sura_names.woff2'), await get(`${CDN}/surah-names/v1/sura_names.woff2`, 'buf'));
if (!(await exists(join(OUT_FONTS, 'bismillah.svg')))) await writeFile(join(OUT_FONTS, 'bismillah.svg'), await get(`${GH}/bismillah.svg`, 'buf'));

console.log('Chapters…');
const { chapters } = await get(`${API}/chapters?language=en`);

console.log('Page words…');
const RAW = join(ROOT, 'scripts/.cache');
await mkdir(RAW, { recursive: true });
const fields = 'word_fields=code_v2,v2_page,line_v2,line_number,page_number,text_uthmani&fields=juz_number,hizb_number,rub_el_hizb_number,page_number';
await pool(Array.from({ length: PAGES }, (_, i) => i + 1), 6, async page => {
  const file = join(RAW, `${page}.json`);
  if (await exists(file)) return;
  const verses = [];
  for (let p = 1; ; p++) {
    const json = await get(`${API}/verses/by_page/${page}?words=true&per_page=50&page=${p}&${fields}`);
    verses.push(...json.verses);
    if (!json.pagination.next_page) break;
  }
  await writeFile(file, JSON.stringify(verses));
});

// Merge every returned word, dedupe by id, then place each word by its own V2 page/line.
const words = new Map(), verseInfo = new Map();
for (let page = 1; page <= PAGES; page++) {
  for (const v of JSON.parse(await readFile(join(RAW, `${page}.json`), 'utf8'))) {
    verseInfo.set(v.verse_key, { juz: v.juz_number, hizb: v.hizb_number, rub: v.rub_el_hizb_number });
    for (const w of v.words) words.set(w.id, { ...w, verseKey: v.verse_key });
  }
}
const expectedVerses = chapters.reduce((n, c) => n + c.verses_count, 0);
if (verseInfo.size !== expectedVerses) throw new Error(`Expected ${expectedVerses} verses, got ${verseInfo.size}`);

const byPage = Array.from({ length: PAGES + 1 }, () => new Map());
for (const w of words.values()) {
  const page = w.v2_page ?? w.page_number, line = w.line_v2 ?? w.line_number;
  if (!byPage[page].has(line)) byPage[page].set(line, []);
  byPage[page].get(line).push(w);
}
const [s1, a1] = [k => +k.split(':')[0], k => +k.split(':')[1]];
const order = w => [s1(w.verseKey), a1(w.verseKey), w.position];
const cmp = (a, b) => { const x = order(a), y = order(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; };

// Global sequence of 15 lines per page; empty runs before a verse-1 start are that
// surah's header (+ basmalah, except al-Fatihah where it is ayah 1, and at-Tawbah).
const slots = [];
for (let page = 1; page <= PAGES; page++) {
  const lines = byPage[page];
  const maxLine = Math.max(...lines.keys());
  const count = maxLine <= 8 ? 8 : 15; // pages 1–2 have eight lines in this layout
  for (let n = 1; n <= count; n++) slots.push({ page, n, words: (lines.get(n) ?? []).sort(cmp) });
}
for (let i = 0; i < slots.length; i++) {
  if (slots[i].words.length) continue;
  let j = i; while (j < slots.length && !slots[j].words.length) j++;
  const first = slots[j]?.words[0];
  if (!first || a1(first.verseKey) !== 1 || first.position !== 1) throw new Error(`Unexplained empty line p${slots[i].page} l${slots[i].n}`);
  const surah = s1(first.verseKey), run = slots.slice(i, j);
  const hasBasmala = surah !== 1 && surah !== 9;
  run.forEach((slot, k) => {
    slot.type = hasBasmala && k === run.length - 1 && run.length > 1 ? 'basmala' : 'header';
    slot.surah = surah;
  });
  if (run.length !== (hasBasmala ? 2 : 1)) console.warn(`  note: ${run.length}-line gap before surah ${surah} (p${run[0].page})`);
  i = j - 1;
}

const pagesMeta = [];
for (let page = 1; page <= PAGES; page++) {
  const lines = slots.filter(s => s.page === page).map(s => s.words.length
    ? { n: s.n, t: 'text', w: s.words.map(w => [w.id, w.code_v2, w.verseKey, w.position, w.char_type_name === 'end' ? 1 : 0, w.text_uthmani]) }
    : { n: s.n, t: s.type, s: s.surah });
  await writeFile(join(OUT_PAGES, `${String(page).padStart(3, '0')}.json`), JSON.stringify({ p: page, lines }));
  const pageWords = lines.flatMap(l => l.w ?? []);
  const ayahs = [...new Set(pageWords.map(w => w[2]))];
  // Scheduling ownership: the hizb holding most of this page's words (README: provider-supplied).
  const tally = new Map();
  for (const w of pageWords) { const h = verseInfo.get(w[2]).hizb; tally.set(h, (tally.get(h) ?? 0) + 1); }
  const hizb = [...tally].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
  // Ayat that end on this page vs. continue onto the next — used for partial-ayah display.
  const ends = new Set(pageWords.filter(w => w[4]).map(w => w[2]));
  pagesMeta.push({ p: page, hizb, juz: Math.ceil(hizb / 2), ayahs, split: ayahs.filter(a => !ends.has(a)) });
}

const meta = {
  source: 'Quran Foundation API v4 · QCF V2 (King Fahd Glorious Qur\'an Printing Complex, 1441H Madinah Mushaf, 15 lines, 604 pages)',
  layoutId: 'qcf-v2-madinah-604',
  surahs: chapters.map(c => ({ n: c.id, ar: c.name_arabic, en: c.name_simple, meaning: c.translated_name.name, verses: c.verses_count, pages: c.pages, place: c.revelation_place })),
  pages: pagesMeta,
};
await writeFile(OUT_META, JSON.stringify(meta));
console.log(`Done: ${words.size} words, ${verseInfo.size} ayat, ${PAGES} pages.`);
