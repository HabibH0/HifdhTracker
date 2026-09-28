export const MISTAKE_TYPES = ['hesitation', 'wrong_word', 'omitted_text', 'needed_prompting', 'lost_continuation', 'confused_with_similar_passage', 'major_breakdown'];

export function validateMetadata(input) {
  const metadata = structuredClone(input);
  if (!metadata?.layoutId || !metadata.ayat?.length || !metadata.pages?.length) throw new Error('Metadata requires layoutId, ayat and pages');
  const ayat = new Map();
  for (const ayah of metadata.ayat) {
    if (typeof ayah.id !== 'string' || !ayah.id || ayat.has(ayah.id) || !Number.isInteger(ayah.surah) || ayah.surah < 1 || !Number.isInteger(ayah.ayah) || ayah.ayah < 1) throw new Error('Invalid or duplicate ayah metadata');
    ayat.set(ayah.id, ayah);
  }
  const pages = new Set(), halfJuz = new Map();
  for (const page of metadata.pages) {
    if (![page.id, page.halfJuzId, page.juzId].every(id => typeof id === 'string' && id.length) || pages.has(page.id) || !page.ayahIds?.length || new Set(page.ayahIds).size !== page.ayahIds.length || page.ayahIds.some(id => !ayat.has(id))) throw new Error('Invalid page metadata or missing ayah');
    if (halfJuz.has(page.halfJuzId) && halfJuz.get(page.halfJuzId) !== page.juzId) throw new Error('Half-juz must belong to one juz');
    if ([page.id, page.halfJuzId, page.juzId].some(id => ['__proto__', 'constructor', 'prototype'].includes(id))) throw new Error('Reserved metadata identifier');
    pages.add(page.id);
    halfJuz.set(page.halfJuzId, page.juzId);
  }
  return metadata;
}
