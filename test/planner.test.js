import test from 'node:test';
import assert from 'node:assert/strict';
import { makeEngine, metadata, review, strengthen, graduate, timestamp } from './helpers.js';

test('recently strengthened material is prioritised ahead of ordinary due work and new cycles', () => {
  const engine = makeEngine(); graduate(engine);
  const plan = engine.generateDailyPlan(timestamp(5), 8);
  assert.equal(plan.dueReviews[0].kind, 'early_retention');
  assert.equal(plan.dueReviews[0].halfJuzId, 'half-1');
  assert.ok(plan.totalEstimatedDurationMinutes <= 8);
});

test('active strengthening work is protected before mandatory retention or ordinary due work', () => {
  const engine = makeEngine();
  engine.startStrengtheningCycle({ halfJuzId: 'half-1', occurredAt: timestamp(1) });
  const plan = engine.generateDailyPlan(timestamp(10), 20);
  assert.equal(plan.strengthen[0].protected, true);
  assert.equal(plan.strengthen[0].halfJuzId, 'half-1');
  assert.equal(plan.dueReviews.length, 0);
});

test('overdue work is sorted by risk priority', () => {
  const strengths = Object.fromEntries(metadata().pages.map(p => [p.id, p.id === 'page-1-1' ? 'medium' : 'very_strong']));
  const engine = makeEngine({ initialStrength: strengths });
  const due = engine.getDueReviews(timestamp(20));
  assert.equal(due[0].pageId, 'page-1-1');
  assert.equal(due[0].reason, 'high_risk');
  const plan = engine.generateDailyPlan(timestamp(20), 2);
  assert.equal(plan.dueReviews[0].pageId, 'page-1-1');
});

test('daily capacity is respected across all sections and urgent deferrals are honest', () => {
  const engine = makeEngine();
  engine.startStrengtheningCycle({ halfJuzId: 'half-1', occurredAt: timestamp(1) });
  for (const capacity of [0, 1, 5, 15, 30, 60, 90, 120]) {
    const plan = engine.generateDailyPlan(timestamp(20), capacity);
    assert.ok(plan.totalEstimatedDurationMinutes <= capacity);
    assert.equal(plan.totalEstimatedDurationMinutes, [...plan.strengthen, ...plan.dueReviews, ...plan.targetedWeaknesses, ...plan.maintenance].reduce((sum, p) => sum + p.estimatedMinutes, 0));
    assert.ok(plan.deferredItems.every(p => typeof p.postponementReason === 'string'));
  }
  const deferred = engine.generateDailyPlan(timestamp(20), 1).deferredItems;
  assert.equal(deferred.find(p => p.kind === 'strengthening').safeToPostpone, false);
});

test('missed days recalculate risk without an accumulating backlog or changing stored data', () => {
  const engine = makeEngine({ initialStrength: 'medium' }), before = engine.exportData();
  const plan = engine.generateDailyPlan('2027-01-01', 'light');
  assert.ok(plan.totalEstimatedDurationMinutes <= 30);
  assert.ok(plan.dueReviews.length + plan.deferredItems.filter(i => i.kind === 'spaced_review').length <= engine.metadata.pages.length);
  assert.deepEqual(engine.exportData(), before);
  assert.deepEqual(engine.generateDailyPlan('2027-01-01', 'light'), plan);
});

test('one active cycle prevents starting another weak half-juz', () => {
  const engine = makeEngine(); strengthen(engine, 1);
  assert.throws(() => engine.startStrengtheningCycle({ halfJuzId: 'half-2', occurredAt: timestamp(1) }), /active/);
  assert.equal(engine.selectNextStrengthening(timestamp(2)), null);
  assert.equal(engine.generateDailyPlan(timestamp(2), 60).strengthen[0].halfJuzId, 'half-1');
});

test('new strengthening selection uses weakest lower quartile, then longest neglect', () => {
  const strengths = Object.fromEntries(metadata().pages.map(p => [p.id, p.halfJuzId === 'half-2' ? 'very_weak' : 'weak']));
  const engine = makeEngine({ initialStrength: strengths });
  assert.equal(engine.selectNextStrengthening(timestamp(1)).halfJuzId, 'half-2');
  assert.equal(engine.generateDailyPlan(timestamp(1), 60).strengthen[0].requiresStart, true);
  assert.equal(engine.getStrengtheningState().activeCycle, null);
});

test('completed work uses actual duration and is not planned again that day', () => {
  const engine = makeEngine({ initialStrength: 'medium' });
  review(engine, { day: 10, actualDurationMinutes: 29 });
  const plan = engine.generateDailyPlan('2026-01-10', 30);
  assert.equal(plan.completedDurationMinutes, 29);
  assert.equal(plan.remainingCapacityMinutes, 1);
  assert.equal(plan.totalEstimatedDurationMinutes, 0);
});

function strongEngine(config = {}) {
  const engine = makeEngine({ initialStrength: 'very_strong', config });
  const pageIds = engine.metadata.pages.map(p => p.id);
  for (let day = 2; day <= 4; day++) review(engine, { day, pageIds });
  return engine;
}

test('maintenance rotates fairly through strong ajza and stays near one juz', () => {
  const engine = strongEngine();
  const first = engine.generateDailyPlan(timestamp(5), 60);
  assert.equal(first.maintenance.length, 1);
  assert.equal(first.maintenance[0].fractionOfJuz, 1);
  review(engine, { day: 5, pageIds: first.maintenance[0].pageIds, purpose: 'maintenance' });
  const second = engine.generateDailyPlan(timestamp(6), 60);
  assert.notEqual(first.maintenance[0].juzId, second.maintenance[0].juzId);
  assert.ok(second.maintenance[0].pageIds.every(id => !second.dueReviews.some(p => p.pageIds.includes(id))));
});

test('maintenance skips pages in due reviews and does not displace urgent work', () => {
  const engine = strongEngine();
  review(engine, { day: 5, accuracy: 'failed' });
  const plan = engine.generateDailyPlan(timestamp(6), 2);
  assert.equal(plan.dueReviews[0].pageId, 'page-1-1');
  assert.equal(plan.maintenance.length, 0);
});

test('random access is deterministic, limited to eligible strong material and configurable', () => {
  const engine = strongEngine({ maintenance: { randomAccessFraction: 1 } });
  const plan = engine.generateDailyPlan(timestamp(5), 60);
  assert.equal(plan.maintenance[0].randomAccessTests.length, plan.maintenance[0].pageIds.length);
  assert.deepEqual(plan, engine.generateDailyPlan(timestamp(5), 60));
  for (const item of plan.maintenance[0].randomAccessTests) assert.ok(engine.getPageState(item.pageId).ayahIds.includes(item.startAyahId));
});

test('next strengthening stage is deferred to a later calendar day', () => {
  const engine = makeEngine(); strengthen(engine, 1);
  const plan = engine.generateDailyPlan('2026-01-01', 90);
  assert.equal(plan.strengthen.length, 0);
  assert.equal(plan.deferredItems.find(p => p.kind === 'strengthening').reason, 'later_calendar_day_required');
});
