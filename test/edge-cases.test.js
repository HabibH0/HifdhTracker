import test from 'node:test';
import assert from 'node:assert/strict';
import { makeEngine, metadata, review, strengthen, graduate, timestamp } from './helpers.js';
import { instant, elapsedDays } from '../src/time.js';

test('repeated attempts within one session do not invent separate mistake sessions or widespread deterioration', () => {
  const engine = makeEngine({ initialStrength: 'strong' });
  const attempt = { pageId: 'page-1-1', accuracy: 'failed', fluency: 'hesitant', mistakes: [{ ayahId: 'ayah-3' }] };
  review(engine, { pages: [attempt, attempt, attempt] });
  assert.equal(engine.getTroublesomeAyat().length, 0);
  assert.equal(engine.getStrengtheningState().activeCycle, null);
  assert.equal(engine.getPageState('page-1-1').recentFailureCount, 1);
  assert.equal(engine.getRevisionHistory()[0].reviews.length, 3);
});

test('Stage 2 permits 30 percent hesitant pages once targeted practice is complete', () => {
  const engine = makeEngine({ metadata: metadata({ halves: 2, pagesPerHalf: 10 }) });
  strengthen(engine, 1);
  const reviews = engine._halfPages('half-1').map((pageId, i) => ({ pageId, accuracy: 'good', fluency: i < 7 ? 'mostly_fluent' : 'hesitant' }));
  const result = strengthen(engine, 2, { steps: [{ kind: 'pass', reviews }, { kind: 'pass', reviews }, { kind: 'targeted', reviews: reviews.slice(7) }] });
  assert.equal(result.strengtheningResult.fluentFraction, .7);
  assert.equal(result.strengtheningResult.passed, true);
});

test('Stage 1 repair must happen before the second full pass', () => {
  const engine = makeEngine();
  const clean = engine._halfPages('half-1').map(pageId => ({ pageId, accuracy: 'good', fluency: 'automatic' }));
  const bad = structuredClone(clean); bad[0].accuracy = 'difficult';
  const result = strengthen(engine, 1, { steps: [{ kind: 'pass', reviews: bad }, { kind: 'pass', reviews: clean }, { kind: 'targeted', reviews: [clean[0]] }] });
  assert.equal(result.strengtheningResult.passed, false);
  assert.ok(result.strengtheningResult.reasons.includes('targeted_repetition_required_before_second_pass'));
});

test('missed early checks use the actual successful review date for the next gap', () => {
  const engine = makeEngine(), pageIds = graduate(engine);
  review(engine, { day: 8, pageIds });
  assert.equal(engine.getPageState(pageIds[0]).nextReviewAt, '2026-01-12');
  review(engine, { day: 15, pageIds });
  assert.equal(engine.getPageState(pageIds[0]).nextReviewAt, '2026-01-22');
});

test('an unsuccessful but not badly failed early check is retried without incrementing success', () => {
  const engine = makeEngine(), pageIds = graduate(engine);
  review(engine, { day: 5, pageIds, accuracy: 'good', fluency: 'hesitant' });
  const state = engine.getStrengtheningState();
  assert.equal(state.retention[0].successes, 0);
  assert.equal(state.retention[0].nextReviewAt, '2026-01-06');
  assert.equal(state.activeCycle, null);
});

test('widespread bad early retention moves the whole half back to strengthening', () => {
  const engine = makeEngine(), pageIds = graduate(engine);
  review(engine, { day: 5, pages: pageIds.map((pageId, i) => ({ pageId, accuracy: i < 2 ? 'failed' : 'perfect', fluency: 'automatic' })) });
  assert.deepEqual(engine.getStrengtheningState().activeCycle.pageIds, pageIds);
  assert.equal(engine.getStrengtheningState().retention[0].status, 'regressed');
});

test('lower quartile is used instead of the mean of strong and weak pages', () => {
  const strengths = Object.fromEntries(metadata().pages.map(p => [p.id, ['page-1-1', 'page-1-2'].includes(p.id) ? 'weak' : 'very_strong']));
  const engine = makeEngine({ initialStrength: strengths });
  assert.equal(engine.getHalfJuzState('half-1').stabilityDays, 1.5);
  assert.equal(engine.selectNextStrengthening(timestamp(1)).halfJuzId, 'half-1');
});

test('isolated known mistakes prescribe an ayah transition independently from a full half-juz', () => {
  const engine = makeEngine({ initialStrength: 'very_strong' });
  review(engine, { pages: [{ pageId: 'page-1-1', scope: 'ayah', ayahIds: ['ayah-3'], accuracy: 'good', fluency: 'automatic', mistakes: [{ ayahId: 'ayah-3' }] }] });
  const item = engine.generateDailyPlan(timestamp(3), 60).targetedWeaknesses.find(i => i.ayahId === 'ayah-3');
  assert.equal(item.kind, 'weak_ayah'); assert.ok(item.context); assert.deepEqual(item.pageIds, ['page-1-1']);
});

test('recent failure multiplier expires without changing stored stability', () => {
  const engine = makeEngine({ initialStrength: 'very_strong' }); review(engine, { accuracy: 'difficult' });
  assert.equal(engine.getPageState('page-1-1', timestamp(3)).recentFailureCount, 1);
  assert.equal(engine.getPageState('page-1-1', '2026-03-01').recentFailureCount, 0);
});

test('date-only planning uses local midnight across daylight saving transitions', () => {
  assert.equal(instant('2026-03-29', 'Europe/London'), '2026-03-29T00:00:00.000Z');
  assert.equal(instant('2026-03-30', 'Europe/London'), '2026-03-29T23:00:00.000Z');
  assert.equal(elapsedDays(instant('2026-03-29', 'Europe/London'), instant('2026-03-30', 'Europe/London')), 23 / 24);
});

test('five spaced successes are needed to earn very strong even at high stability', () => {
  const engine = makeEngine({ initialStrength: 'very_strong' });
  for (let day = 2; day <= 4; day++) review(engine, { day });
  assert.equal(engine.getPageState('page-1-1').state, 'strong');
  review(engine, { day: 5 }); review(engine, { day: 6 });
  assert.equal(engine.getPageState('page-1-1').state, 'very_strong');
});

test('upcoming reviews include mandatory schedules and enforce the requested horizon', () => {
  const engine = makeEngine(), pageIds = graduate(engine);
  const items = engine.getUpcomingReviews(timestamp(3), { days: 2 });
  assert.equal(items.filter(p => p.mandatory).length, pageIds.length);
  assert.ok(items.every(p => p.nextReviewAt <= '2026-01-05'));
  assert.throws(() => engine.getUpcomingReviews(timestamp(3), { days: -1 }), /Horizon/);
});
