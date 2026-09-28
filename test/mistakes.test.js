import test from 'node:test';
import assert from 'node:assert/strict';
import { makeEngine, review, timestamp } from './helpers.js';

const target = (mistakes = []) => [{ pageId: 'page-1-1', scope: 'ayah', ayahIds: ['ayah-3'], accuracy: 'good', fluency: 'mostly_fluent', mistakes }];
const error = () => [{ ayahId: 'ayah-3', type: 'wrong_word' }];

test('two consecutive active-recall sessions identify a troublesome ayah', () => {
  const engine = makeEngine({ initialStrength: 'strong' });
  review(engine, { pages: target(error()) });
  assert.equal(engine.getTroublesomeAyat().length, 0);
  review(engine, { day: 3, activity: 'reading', pages: target() });
  review(engine, { day: 4, pages: target(error()) });
  const [item] = engine.getTroublesomeAyat();
  assert.equal(item.ayahId, 'ayah-3'); assert.equal(item.troublesome, true);
  assert.equal(engine.getPageState('page-1-1').mistakeHistory[1].repeated, true);
});

test('three nonconsecutive mistake sessions in 30 days also trigger targeting', () => {
  const engine = makeEngine({ initialStrength: 'strong' });
  for (let day = 2; day <= 6; day++) review(engine, { day, pages: target(day % 2 === 0 ? error() : []) });
  assert.equal(engine.getTroublesomeAyat()[0].recentMistakeSessions, 3);
});

test('three separate clean active sessions resolve troublesome ayat, passive reading cannot', () => {
  const engine = makeEngine({ initialStrength: 'strong' });
  review(engine, { pages: target(error()) }); review(engine, { day: 3, pages: target(error()) });
  for (let n = 0; n < 5; n++) review(engine, { day: 4, activity: 'reading', pages: target() });
  assert.equal(engine.getTroublesomeAyat()[0].cleanSessions, 0);
  review(engine, { day: 5, pages: target() }); review(engine, { day: 6, pages: target() });
  assert.equal(engine.getTroublesomeAyat().length, 1);
  review(engine, { day: 7, pages: target() });
  assert.equal(engine.getTroublesomeAyat().length, 0);
  assert.equal(engine.getPageState('page-1-1').targetedRepair, false);
  assert.equal(engine.generateDailyPlan(timestamp(8), 'normal').targetedWeaknesses.some(t => t.ayahId === 'ayah-3'), false);
});

test('sessions not covering the ayah do not count as clean recall or break consecutive errors', () => {
  const engine = makeEngine({ initialStrength: 'strong' });
  review(engine, { pages: target(error()) }); review(engine, { day: 3, pageIds: ['page-2-1'] });
  review(engine, { day: 4, pages: target(error()) });
  assert.equal(engine.getTroublesomeAyat().length, 1);
});

test('unknown mistake locations remain page weaknesses instead of inventing ayah evidence', () => {
  const engine = makeEngine({ initialStrength: 'strong' });
  for (let day = 2; day <= 4; day++) review(engine, { day, pages: target([{ type: 'hesitation' }]) });
  assert.equal(engine.getTroublesomeAyat().length, 0);
  assert.equal(engine.getPageState('page-1-1').targetedRepair, true);
});

test('recordMistake attaches raw mistakes and records symmetric confusion links', () => {
  const engine = makeEngine({ initialStrength: 'strong' });
  const session = review(engine);
  engine.recordMistake({ sessionId: session.sessionId, pageId: 'page-1-1', ayahId: 'ayah-3', type: 'confused_with_similar_passage', confusedWithAyahId: 'ayah-5', count: 2 });
  review(engine, { day: 3, pageIds: ['page-1-2'], pages: [{ pageId: 'page-1-2', accuracy: 'good', fluency: 'automatic', mistakes: [{ ayahId: 'ayah-5', confusedWithAyahId: 'ayah-3' }] }] });
  assert.deepEqual(engine.getConfusionLinks(), [{ ayahIds: ['ayah-3', 'ayah-5'], confusionCount: 3, lastConfusionDate: '2026-01-03' }]);
  assert.equal(engine.getRevisionHistory({ sessionId: session.sessionId })[0].mistakes[0].count, 2);
});

test('targeted output includes surrounding transition context and a clean-recall prescription', () => {
  const engine = makeEngine({ initialStrength: 'very_strong' });
  review(engine, { pages: target(error()) }); review(engine, { day: 3, pages: target(error()) });
  const item = engine.generateDailyPlan(timestamp(4), 'normal').targetedWeaknesses.find(t => t.ayahId === 'ayah-3');
  assert.equal(item.context.endAyahId, 'ayah-4');
  assert.equal(item.prescribedRepetitions.until, 'one_clean_active_recall');
  assert.equal(item.kind, 'troublesome_ayah');
});
