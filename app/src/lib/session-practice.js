/** Build practice from a saved session, including one-off errors (not only troublesome ayat). */
export function sessionPracticeItems(engine, sessionId) {
  const session = engine.state.sessions[sessionId];
  if (!session) return [];
  const items = new Map();
  const ensure = (pageId, ayahId) => {
    const key = `${pageId}:${ayahId ?? 'page'}`;
    if (!items.has(key)) items.set(key, {
      kind: ayahId ? 'weak_ayah' : 'weak_page', pageIds: [pageId], ayahId,
      mistakeCount: 0, mistakeTypes: [],
      estimatedMinutes: ayahId ? engine.config.durations.targetedAyahMinutes : engine._pageMinutes(pageId, true),
    });
    return items.get(key);
  };
  for (const mistake of engine.state.mistakes.filter(m => m.sessionId === sessionId)) {
    const item = ensure(mistake.pageId, mistake.ayahId);
    item.mistakeCount += mistake.count;
    if (mistake.type && !item.mistakeTypes.includes(mistake.type)) item.mistakeTypes.push(mistake.type);
  }
  for (const review of session.reviews) {
    if (review.accuracy === 'failed' || review.accuracy === 'difficult') {
      if (review.scope === 'ayah') for (const id of review.ayahIds) ensure(review.pageId, id);
      else ensure(review.pageId, null);
    }
  }
  return [...items.values()];
}
