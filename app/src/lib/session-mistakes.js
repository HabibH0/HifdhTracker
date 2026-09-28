/** Append a batch in one draft update, preserving existing marks on every page. */
export function appendMistakes(session, mistakes, makeId) {
  const current = { ...session.current };
  for (const { page, ayahId, pos, type } of mistakes) {
    current[page] = [...(current[page] ?? []), {
      id: makeId(), ayahId: ayahId ?? null, pos: pos ?? null, type: type ?? null,
    }];
  }
  return { ...session, current };
}

/** Several marked locations belong to one recall attempt, not several attempts. */
export function targetedObservation(target, clean, mistakes = []) {
  const logged = clean ? [] : mistakes;
  const review = {
    pageId: target.pageId,
    ...(target.ayahId ? { scope: 'ayah', ayahIds: target.ayahIds } : {}),
    accuracy: clean || target.ayahId ? 'good' : 'difficult',
    fluency: clean ? 'mostly_fluent' : 'hesitant',
    mistakes: logged.map(m => ({
      ayahId: m.ayahId ?? target.ayahId ?? null,
      ...(m.type ? { type: m.type } : {}),
    })),
  };
  const marks = logged.filter(m => m.ayahId).map(m => ({
    page: target.page, ayahId: m.ayahId, pos: m.pos ?? null, type: m.type ?? null,
  }));
  return { review, marks };
}
