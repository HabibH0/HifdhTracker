import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RevisionEngine } from '../src/index.js';
import { engineMetadata } from '../shared/layout.js';
import { makeEngine, review, strengthen, graduate, timestamp } from './helpers.js';

const minutes = items => items.reduce((sum, item) => sum + item.estimatedMinutes, 0);

test('the photographed scenario gets daily reviews alongside Juz 18 relearning within 60 minutes', () => {
  const meta = engineMetadata(JSON.parse(readFileSync(new URL('../app/src/data/quran-meta.json', import.meta.url), 'utf8')));
  const engine = new RevisionEngine({ metadata: meta, initializedAt: timestamp(1), memorized: { juzIds: ['j1', 'j2', 'j18'] }, initialStrength: 'strong' });
  engine.startStrengtheningCycle({ halfJuzId: 'h35', occurredAt: timestamp(1) });
  const plan = engine.generateDailyPlan(timestamp(1), 60);
  assert.equal(plan.strengthen[0].halfJuzId, 'h35');
  assert.equal(plan.strengthen[0].estimatedMinutes, 30);
  assert.equal(minutes(plan.dailyReviews), 30);
  assert.equal(plan.totalEstimatedDurationMinutes, 60);
  assert.equal(plan.dueReviews.length, 0);
  for (const item of plan.dailyReviews) {
    assert.equal(item.reason, 'initial_verification');
    assert.equal(engine.getPageState(item.pageId).state, 'developing');
    assert.ok(!plan.strengthen[0].pageIds.includes(item.pageId));
  }
});

test('developing material gets a bounded daily review even before its due date', () => {
  const engine = makeEngine({ initialStrength: 'strong' });
  const before = engine.exportData(), plan = engine.generateDailyPlan(timestamp(1), 120);
  assert.ok(plan.dailyReviews.length > 0);
  assert.equal(plan.totalEstimatedDurationMinutes, 30);
  assert.ok(plan.dailyReviews.every(r => r.nextReviewAt > plan.date));
  assert.deepEqual(engine.getDueReviews(timestamp(1)), []);
  assert.deepEqual(engine.exportData(), before);
  assert.deepEqual(engine.generateDailyPlan(timestamp(1), 120), plan);
});

test('finishing relearning does not suppress daily review for the rest of today', () => {
  const engine = makeEngine({ initialStrength: 'strong' });
  strengthen(engine, 1, { actualDurationMinutes: 20 });
  const plan = engine.generateDailyPlan(timestamp(1), 60);
  assert.equal(plan.completedDurationMinutes, 20);
  assert.equal(plan.strengthen.length, 0);
  assert.ok(plan.dailyReviews.length > 0);
  assert.ok(plan.dailyReviews.every(r => !engine._halfPages('half-1').includes(r.pageId)));
  assert.ok(plan.totalEstimatedDurationMinutes <= 40);
});

test('completed coverage counts toward the target even when the reciter finishes quickly', () => {
  const engine = makeEngine({ initialStrength: 'strong', config: { dailyReview: { targetMinutes: 3 } } });
  const first = engine.generateDailyPlan(timestamp(2), 60);
  assert.equal(minutes(first.dailyReviews), 3);
  const pageIds = first.dailyReviews.map(i => i.pageId);
  review(engine, { day: 2, pageIds, actualDurationMinutes: 1 });
  assert.deepEqual(engine.generateDailyPlan(timestamp(2), 60).dailyReviews, []);
  const tomorrow = engine.generateDailyPlan(timestamp(3), 60);
  assert.equal(minutes(tomorrow.dailyReviews), 3);
  assert.ok(tomorrow.dailyReviews.every(i => !pageIds.includes(i.pageId)));
});

test('daily rotation prefers never-reviewed material then oldest recall, without same-day duplication', () => {
  const engine = makeEngine({ initialStrength: 'strong', memorized: { pageIds: ['page-1-1', 'page-1-2', 'page-1-3'] }, config: { dailyReview: { targetMinutes: 1.5 } } });
  review(engine, { day: 2, pageIds: ['page-1-1'] });
  review(engine, { day: 3, pageIds: ['page-1-2'] });
  assert.equal(engine.generateDailyPlan(timestamp(4), 60).dailyReviews[0].pageId, 'page-1-3');
  review(engine, { day: 4, pageIds: ['page-1-3'] });
  assert.equal(engine.generateDailyPlan(timestamp(5), 60).dailyReviews[0].pageId, 'page-1-1');
});

test('due work takes priority and counts toward the daily review target', () => {
  const engine = makeEngine({ initialStrength: 'medium' });
  const plan = engine.generateDailyPlan(timestamp(10), 30);
  assert.equal(minutes(plan.dueReviews), 30);
  assert.deepEqual(plan.dailyReviews, []);
});

test('mandatory retention gaps cannot be bypassed by daily rotation', () => {
  const engine = makeEngine({ initialStrength: 'strong' });
  const retentionPages = graduate(engine);
  const plan = engine.generateDailyPlan(timestamp(4), 60);
  assert.ok(plan.dailyReviews.length > 0);
  assert.ok(plan.dailyReviews.every(i => !retentionPages.includes(i.pageId)));
  assert.equal(engine.getStrengtheningState().retention[0].nextReviewAt, '2026-01-05');
});

test('the daily rotation supports partial pages and never prescribes unknown ayat', () => {
  const engine = makeEngine({ initialStrength: 'strong', memorized: { ayahIds: ['ayah-3', 'ayah-5'] } });
  const plan = engine.generateDailyPlan(timestamp(1), .75);
  assert.equal(plan.dailyReviews.length, 1);
  assert.equal(plan.totalEstimatedDurationMinutes, .75);
  assert.deepEqual(plan.dailyReviews[0].passage.ayahIds, ['ayah-3']);
  assert.equal(plan.dailyReviews[0].passage.pages[0].scope, 'memorized');
});

test('daily reviews fill a small remaining slot when a full maintenance section cannot fit', () => {
  const engine = makeEngine({ initialStrength: 'very_strong' });
  for (const day of [2, 3, 4]) review(engine, { day, pageIds: engine.metadata.pages.map(p => p.id) });
  const plan = engine.generateDailyPlan(timestamp(5), 3);
  assert.equal(plan.maintenance.length, 0);
  assert.ok(plan.dailyReviews.length > 0);
  assert.ok(plan.totalEstimatedDurationMinutes <= 3);
});

test('maintenance counts toward the target and shares no pages with daily review', () => {
  const engine = makeEngine({ initialStrength: 'very_strong' });
  for (const day of [2, 3, 4]) review(engine, { day, pageIds: engine.metadata.pages.map(p => p.id) });
  const plan = engine.generateDailyPlan(timestamp(5), 60);
  const maintained = new Set(plan.maintenance.flatMap(i => i.pageIds));
  assert.ok(maintained.size > 0);
  assert.ok(plan.dailyReviews.every(i => !maintained.has(i.pageId)));
  assert.ok(minutes(plan.maintenance) + minutes(plan.dailyReviews) <= 30);
});

test('a full strengthening budget or an inventory consisting only of that cycle cannot create extra work', () => {
  const engine = makeEngine({ initialStrength: 'strong' });
  engine.startStrengtheningCycle({ halfJuzId: 'half-1', occurredAt: timestamp(1) });
  const full = engine.generateDailyPlan(timestamp(1), 15);
  assert.equal(full.strengthen.length, 1);
  assert.deepEqual(full.dailyReviews, []);
  const small = makeEngine({ memorized: { pageIds: ['page-1-1'] } });
  assert.deepEqual(small.generateDailyPlan(timestamp(1), 60).dailyReviews, []);
});

test('daily review survives replay and respects a configurable disabled target', () => {
  const engine = makeEngine({ initialStrength: 'strong' });
  const replayed = RevisionEngine.replay(engine.exportData());
  assert.deepEqual(replayed.generateDailyPlan(timestamp(2), 60), engine.generateDailyPlan(timestamp(2), 60));
  const disabled = makeEngine({ initialStrength: 'strong', config: { dailyReview: { targetMinutes: 0 } } });
  assert.deepEqual(disabled.generateDailyPlan(timestamp(2), 60).dailyReviews, []);
});
