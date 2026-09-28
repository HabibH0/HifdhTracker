// Engine layout metadata derived from the baked QCF V2 data (app/src/data/quran-meta.json).
// Shared so the device and the server replay events against identical metadata.
export function engineMetadata(meta) {
  const ayat = [];
  for (const s of meta.surahs) for (let a = 1; a <= s.verses; a++) ayat.push({ id: `${s.n}:${a}`, surah: s.n, ayah: a });
  return {
    layoutId: meta.layoutId,
    ayat,
    pages: meta.pages.map(p => ({ id: `p${p.p}`, halfJuzId: `h${p.hizb}`, juzId: `j${p.juz}`, ayahIds: p.ayahs })),
  };
}
