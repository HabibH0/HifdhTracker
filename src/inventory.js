/** Resolve overlapping selections through layout metadata, never page-number arithmetic. */
export function resolveMemorizedSelection(metadata, selection = {}) {
  if (!selection || typeof selection !== 'object' || Array.isArray(selection)) throw new Error('Memorized selection must be an object');
  const keys = ['juzIds', 'halfJuzIds', 'pageIds', 'surahs', 'ayahIds', 'ayahRanges'];
  for (const [key, values] of Object.entries(selection)) {
    if (!keys.includes(key) || !Array.isArray(values)) throw new Error(`Invalid memorized selector: ${key}`);
  }
  const chosen = new Set();
  for (const [key, field] of [['juzIds', 'juzId'], ['halfJuzIds', 'halfJuzId'], ['pageIds', 'id']]) {
    for (const id of selection[key] ?? []) {
      const pages = metadata.pages.filter(p => p[field] === id);
      if (!pages.length) throw new Error(`Unknown ${key} selection: ${id}`);
      for (const page of pages) page.ayahIds.forEach(ayahId => chosen.add(ayahId));
    }
  }
  for (const surah of selection.surahs ?? []) {
    const ayat = metadata.ayat.filter(a => a.surah === surah);
    if (!Number.isInteger(surah) || !ayat.length) throw new Error(`Unknown surah selection: ${surah}`);
    ayat.forEach(a => chosen.add(a.id));
  }
  const indices = new Map(metadata.ayat.map((a, index) => [a.id, index]));
  for (const id of selection.ayahIds ?? []) {
    if (!indices.has(id)) throw new Error(`Unknown ayah selection: ${id}`);
    chosen.add(id);
  }
  for (const range of selection.ayahRanges ?? []) {
    if (!range || !indices.has(range.fromAyahId) || !indices.has(range.toAyahId)) throw new Error('Ayah ranges require known fromAyahId and toAyahId');
    const from = indices.get(range.fromAyahId), to = indices.get(range.toAyahId);
    if (from > to) throw new Error('Ayah range must follow metadata recitation order');
    metadata.ayat.slice(from, to + 1).forEach(a => chosen.add(a.id));
  }
  const contained = new Set(metadata.pages.flatMap(p => p.ayahIds));
  if ([...chosen].some(id => !contained.has(id))) throw new Error('Selected ayah has no page in this layout');
  return metadata.ayat.filter(a => chosen.has(a.id)).map(a => a.id);
}
