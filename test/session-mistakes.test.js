import test from 'node:test';
import assert from 'node:assert/strict';
import { appendMistakes, targetedObservation } from '../app/src/lib/session-mistakes.js';

test('batch logging preserves existing marks and all selected locations across pages', () => {
  const old = { id: 'old', ayahId: '23:22', pos: 1, type: 'hesitation' };
  const session = { current: { 343: [old] }, steps: [] };
  let id = 0;
  const next = appendMistakes(session, [
    { page: 343, ayahId: '23:22', pos: 2, type: 'wrong_word' },
    { page: 343, ayahId: '23:23', pos: null, type: 'omitted_text' },
    { page: 344 },
  ], () => `new-${++id}`);
  assert.deepEqual(session.current, { 343: [old] });
  assert.equal(next.current[343].length, 3);
  assert.equal(next.current[343][0], old);
  assert.equal(next.current[343][1].type, 'wrong_word');
  assert.equal(next.current[343][2].ayahId, '23:23');
  assert.deepEqual(next.current[344], [{ id: 'new-3', ayahId: null, pos: null, type: null }]);
  const restored = JSON.parse(JSON.stringify(next));
  assert.deepEqual(restored.current, next.current);
});

const target = { pageId: 'p343', page: 343, ayahId: '23:22', ayahIds: ['23:22', '23:23'] };
const marks = [
  { page: 343, ayahId: '23:22', pos: 1, type: 'wrong_word' },
  { page: 343, ayahId: '23:23', pos: 2, type: 'hesitation' },
];

test('targeted batch produces one observation containing every error and word mark', () => {
  const { review, marks: saved } = targetedObservation(target, false, marks);
  assert.equal(review.scope, 'ayah');
  assert.deepEqual(review.ayahIds, target.ayahIds);
  assert.deepEqual(review.mistakes, [
    { ayahId: '23:22', type: 'wrong_word' },
    { ayahId: '23:23', type: 'hesitation' },
  ]);
  assert.deepEqual(saved, marks);
  assert.equal(review.fluency, 'hesitant');
});

test('whole-page and clean targeted recalls retain their correct scope', () => {
  const pageTarget = { pageId: 'p343', page: 343 };
  const failed = targetedObservation(pageTarget, false, [{ page: 343, type: 'major_breakdown' }]);
  assert.equal(failed.review.scope, undefined);
  assert.equal(failed.review.accuracy, 'difficult');
  assert.deepEqual(failed.review.mistakes, [{ ayahId: null, type: 'major_breakdown' }]);
  const clean = targetedObservation(target, true, marks);
  assert.deepEqual(clean.review.mistakes, []);
  assert.deepEqual(clean.marks, []);
  assert.equal(clean.review.fluency, 'mostly_fluent');
  const scoped = targetedObservation(target, false, [{ page: 343 }]);
  assert.deepEqual(scoped.review.mistakes, [{ ayahId: '23:22' }]);
});
