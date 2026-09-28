import test from 'node:test';
import assert from 'node:assert/strict';
import { RevisionEngine, MemoryStore } from '../src/index.js';
import { metadata, makeEngine, timestamp, review, strengthen, graduate } from './helpers.js';

test('new users start empty; unknown material is never treated as weak or overdue', () => {
  const engine = new RevisionEngine({ metadata: metadata(), initializedAt: timestamp(1) });
  assert.equal(engine.getMemorizedMaterial().totalTrackedPages, 0);
  assert.equal(engine.getPageState('page-1-1').state, 'not_memorized');
  assert.equal(engine.getPageState('page-1-1').stabilityDays, null);
  assert.equal(engine.getPageState('page-1-1').nextReviewAt, null);
  assert.equal(engine.getHalfJuzState('half-1').state, 'not_memorized');
  assert.equal(engine.getForgettingRisk('page-1-1', '2027-01-01').level, 'not_memorized');
  assert.deepEqual(engine.getDueReviews('2027-01-01'), []);
  assert.deepEqual(engine.getUpcomingReviews('2027-01-01'), []);
  const plan = engine.generateDailyPlan('2027-01-01', 'light');
  assert.equal(plan.totalEstimatedDurationMinutes, 0);
  for (const key of ['strengthen', 'dueReviews', 'targetedWeaknesses', 'maintenance', 'deferredItems']) assert.deepEqual(plan[key], []);
  assert.throws(() => review(engine), /no memorized material/);
  assert.throws(() => strengthen(engine, 2), /no memorized material/);
});

test('known material needs no strength rating; optional sparse ratings override the configured default', () => {
  const engine = makeEngine({ memorized: { pageIds: ['page-1-1', 'page-2-1'] }, initialStrength: { 'page-2-1': 'strong' } });
  assert.equal(engine.getPageState('page-1-1').stabilityDays, 1.5);
  assert.equal(engine.getPageState('page-2-1').stabilityDays, 10);
  assert.equal(engine.getPageState('page-1-2').state, 'not_memorized');
  const tuned = makeEngine({ memorized: { pageIds: ['page-1-1'] }, config: { inventory: { defaultInitialStrength: 'medium' } } });
  assert.equal(tuned.getPageState('page-1-1').stabilityDays, 4);
});

test('surahs, ayah ranges, pages, half-juz and juz selectors union without duplicated coverage', () => {
  const data = metadata();
  data.ayat.forEach((a, index) => { a.surah = index < 3 ? 1 : 2; });
  const surah = makeEngine({ metadata: data, memorized: { surahs: [1] } });
  assert.deepEqual(surah.getMemorizedMaterial().ayahIds, ['ayah-3', 'ayah-4', 'ayah-5']);
  assert.equal(surah.getPageState('page-1-2').coverage, 'partial');
  const ranged = makeEngine({ memorized: { ayahRanges: [{ fromAyahId: 'ayah-4', toAyahId: 'ayah-6' }], ayahIds: ['ayah-4'], pageIds: ['page-1-2'] } });
  assert.deepEqual(ranged.getMemorizedMaterial().ayahIds, ['ayah-4', 'ayah-5', 'ayah-6']);
  const grouped = makeEngine({ memorized: { juzIds: ['juz-1'], halfJuzIds: ['half-1'], pageIds: ['page-1-1'] } });
  assert.equal(grouped.getMemorizedMaterial().totalTrackedPages, 10);
});

test('plans name only known ayat and scale work to a partially memorized page', () => {
  const engine = makeEngine({ memorized: { ayahIds: ['ayah-3'] } });
  const item = engine.generateDailyPlan(timestamp(1), 'light').strengthen[0];
  assert.equal(item.coverage, 'partial');
  assert.deepEqual(item.pageIds, ['page-1-1']);
  assert.deepEqual(item.passage.pages, [{ pageId: 'page-1-1', scope: 'memorized', ayahIds: ['ayah-3'], coverage: 'partial' }]);
  assert.equal(item.estimatedMinutes, 1.875);
  assert.equal(engine.getHalfJuzState('half-1').memorizedPageCount, 1);
  assert.equal(engine.getHalfJuzState('half-1').stabilityDays, 1.5);
});

test('reviewing the whole known portion earns scoped evidence; a targeted subset does not', () => {
  const engine = makeEngine({ memorized: { ayahIds: ['ayah-3'] } });
  review(engine);
  const page = engine.getPageState('page-1-1');
  assert.equal(page.history[0].scope, 'memorized');
  assert.deepEqual(page.history[0].ayahIds, ['ayah-3']);
  assert.ok(page.stabilityDays > 1.5);
  assert.equal(page.coverage, 'partial');
  assert.throws(() => review(engine, { pages: [{ pageId: 'page-1-1', scope: 'page', accuracy: 'perfect', fluency: 'automatic' }] }), /entire page/);
  assert.throws(() => review(engine, { pages: [{ pageId: 'page-1-1', scope: 'ayah', ayahIds: ['ayah-4'], accuracy: 'perfect', fluency: 'automatic' }] }), /outside memorized/);
  const stability = page.stabilityDays;
  review(engine, { pages: [{ pageId: 'page-1-1', scope: 'ayah', ayahIds: ['ayah-3'], accuracy: 'perfect', fluency: 'automatic' }] });
  assert.equal(engine.getPageState('page-1-1').stabilityDays, stability);
});

test('strengthening and all early retention checks work with just one known ayah', () => {
  const engine = makeEngine({ memorized: { ayahIds: ['ayah-3'] } }), ids = graduate(engine);
  assert.deepEqual(ids, ['page-1-1']);
  const plan = engine.generateDailyPlan(timestamp(5), 'light');
  assert.deepEqual(plan.dueReviews[0].passage.ayahIds, ['ayah-3']);
  for (const day of [5, 9, 16]) review(engine, { day });
  assert.equal(engine.getPageState('page-1-1').state, 'strong');
  assert.equal(engine.getPageState('page-1-1').coverage, 'partial');
  assert.equal(engine.getPageState('page-1-2').state, 'not_memorized');
});

test('deterioration is assessed against memorized pages and never enrolls unknown neighbours', () => {
  const engine = makeEngine({ memorized: { pageIds: ['page-1-1', 'page-1-2'] }, initialStrength: 'strong' });
  review(engine, { accuracy: 'failed' });
  assert.deepEqual(engine.getStrengtheningState().activeCycle.pageIds, ['page-1-1', 'page-1-2']);
  assert.equal(engine.getPageState('page-1-3').state, 'not_memorized');
});

test('targeting context stops at the boundary of known material and never jumps unknown gaps', () => {
  const engine = makeEngine({ memorized: { ayahIds: ['ayah-3', 'ayah-5'] }, initialStrength: 'strong' });
  for (const day of [2, 3]) review(engine, { day, pages: [{ pageId: 'page-1-1', scope: 'ayah', ayahIds: ['ayah-3'], accuracy: 'good', fluency: 'automatic', mistakes: [{ ayahId: 'ayah-3' }] }] });
  const item = engine.generateDailyPlan(timestamp(4), 30).targetedWeaknesses.find(t => t.ayahId === 'ayah-3');
  assert.equal(item.context.startAyahId, 'ayah-3');
  assert.equal(item.context.endAyahId, 'ayah-3');
});

test('maintenance and random access stay within known portions and scale below a full juz', () => {
  const engine = makeEngine({ memorized: { ayahIds: ['ayah-3'] }, initialStrength: 'very_strong', config: { maintenance: { randomAccessFraction: 1 } } });
  for (const day of [2, 3, 4]) review(engine, { day });
  const plan = engine.generateDailyPlan(timestamp(5), 30), item = plan.maintenance[0];
  assert.equal(plan.maintenance.length, 1);
  assert.deepEqual(item.passage.ayahIds, ['ayah-3']);
  assert.equal(item.randomAccessTests[0].startAyahId, 'ayah-3');
  assert.equal(item.randomAccessTests[0].completePageRecallRequiredForStability, false);
  assert.equal(item.fractionOfJuz, .05);
  assert.equal(item.estimatedMinutes, 1);
});

test('new material can be added repeatedly, with risk anchored to when it was learned', () => {
  const engine = makeEngine({ memorized: {} });
  for (const [day, id] of [[2, 'page-1-1'], [10, 'page-1-2'], [20, 'page-2-1']]) engine.addMemorizedMaterial({ selection: { pageIds: [id] }, occurredAt: timestamp(day) });
  assert.equal(engine.getMemorizedMaterial().totalTrackedPages, 3);
  assert.equal(engine.getForgettingRisk('page-2-1', timestamp(20)).riskRatio, 0);
  assert.equal(engine.getPageState('page-2-1').lastActiveRecallAt, null);
  assert.equal(engine.getPageState('page-2-1').nextReviewAt, '2026-01-21');
  assert.equal(engine.getPageState('page-1-3').state, 'not_memorized');
});

test('adding a different passage preserves existing strength, dates, history and cycle progress', () => {
  const engine = makeEngine({ memorized: { pageIds: ['page-1-1'] } });
  strengthen(engine, 1);
  const page = engine.getPageState('page-1-1'), cycle = engine.getStrengtheningState().activeCycle;
  engine.addMemorizedMaterial({ selection: { pageIds: ['page-2-1'] }, occurredAt: timestamp(2) });
  assert.deepEqual(engine.getPageState('page-1-1'), page);
  assert.deepEqual(engine.getStrengtheningState().activeCycle, cycle);
  assert.equal(engine.getPageState('page-2-1').stabilityDays, 1.5);
});

test('overlapping additions are idempotent and cannot reset established scores', () => {
  const engine = makeEngine({ memorized: { pageIds: ['page-1-1'] } });
  review(engine);
  const before = engine.exportData();
  engine.addMemorizedMaterial({ selection: { pageIds: ['page-1-1'], ayahIds: ['ayah-3'] }, occurredAt: timestamp(3), initialStrength: 'very_strong' });
  assert.deepEqual(engine.exportData(), before);
});

test('expanding a partial page does not transfer old strength to newly learned ayat', () => {
  const engine = makeEngine({ memorized: { ayahIds: ['ayah-3'] }, initialStrength: 'very_strong' });
  for (const day of [2, 3, 4]) review(engine, { day });
  const history = engine.getRevisionHistory();
  assert.equal(engine.getPageState('page-1-1').state, 'strong');
  engine.addMemorizedMaterial({ selection: { ayahIds: ['ayah-4'] }, occurredAt: timestamp(5) });
  const expanded = engine.getPageState('page-1-1');
  assert.equal(expanded.coverage, 'complete');
  assert.equal(expanded.stabilityDays, 1.5);
  assert.equal(expanded.successfulSpacedReviews, 0);
  assert.equal(expanded.lastActiveRecallAt, null);
  assert.equal(expanded.coverageVersion, 2);
  assert.deepEqual(engine.getRevisionHistory(), history);
  assert.equal(engine.getForgettingRisk('page-1-1', timestamp(5)).riskRatio, 0);
  assert.throws(() => review(engine, { day: 5, pages: [{ pageId: 'page-1-1', scope: 'memorized', ayahIds: ['ayah-3'], accuracy: 'perfect', fluency: 'automatic' }] }), /all prescribed/);
});

test('expanded material needs fresh strengthening evidence; old sessions remain available', () => {
  const engine = makeEngine({ memorized: { ayahIds: ['ayah-3'] } }); strengthen(engine, 1); strengthen(engine, 2);
  engine.addMemorizedMaterial({ selection: { ayahIds: ['ayah-4'] }, occurredAt: timestamp(3) });
  assert.equal(engine.getStrengtheningState().activeCycle.stage, 1);
  assert.equal(engine.getStrengtheningState().activeCycle.sessions.length, 2);
  assert.equal(engine.getRevisionHistory().length, 2);
});

test('expanded pages cannot inherit a pending early retention group', () => {
  const engine = makeEngine({ memorized: { ayahIds: ['ayah-3'] } }); graduate(engine);
  engine.addMemorizedMaterial({ selection: { ayahIds: ['ayah-4'] }, occurredAt: timestamp(4) });
  assert.equal(engine.getPageState('page-1-1').state, 'weak');
  assert.equal(engine.getStrengtheningState().retention[0].status, 'coverage_changed');
});

test('adding coverage after a same-day recall does not mark the expanded passage completed', () => {
  const engine = makeEngine({ memorized: { ayahIds: ['ayah-3'] } }); review(engine);
  engine.addMemorizedMaterial({ selection: { ayahIds: ['ayah-4'] }, occurredAt: timestamp(2, '13:00') });
  const plan = engine.generateDailyPlan('2026-01-02', 30);
  assert.equal(plan.completedDurationMinutes, .75);
  assert.deepEqual(plan.strengthen[0].passage.ayahIds, ['ayah-3', 'ayah-4']);
});

test('inventory and additions survive restart and raw-event replay', () => {
  const store = new MemoryStore(), engine = makeEngine({ store, memorized: { ayahIds: ['ayah-3'] } });
  review(engine);
  engine.addMemorizedMaterial({ selection: { pageIds: ['page-2-1'] }, occurredAt: timestamp(3) });
  const reloaded = new RevisionEngine({ store }), replayed = RevisionEngine.replay(engine.exportData());
  assert.deepEqual(reloaded.exportData(), engine.exportData());
  assert.deepEqual(replayed.exportData().snapshot, engine.exportData().snapshot);
  assert.deepEqual(replayed.generateDailyPlan(timestamp(4), 30), engine.generateDailyPlan(timestamp(4), 30));
});

test('existing logs without inventory keep their original fully tracked material', () => {
  const engine = makeEngine(); review(engine);
  const oldDocument = engine.exportData(); delete oldDocument.events[0].memorizedAyahIds;
  const migrated = RevisionEngine.replay(oldDocument);
  assert.equal(migrated.getMemorizedMaterial().completePages, metadata().pages.length);
  assert.equal(migrated.getPageState('page-1-1').stabilityDays, engine.getPageState('page-1-1').stabilityDays);
});

test('invalid additions and selections are rejected atomically', () => {
  const engine = makeEngine({ memorized: {} }), before = engine.exportData();
  for (const selection of [{ pageIds: ['missing'] }, { surahs: [999] }, { ayahIds: ['missing'] }, { ayahRanges: [{ fromAyahId: 'ayah-6', toAyahId: 'ayah-3' }] }, { juzIds: 'juz-1' }, { all: true }]) {
    assert.throws(() => engine.addMemorizedMaterial({ selection, occurredAt: timestamp(2) }));
    assert.deepEqual(engine.exportData(), before);
  }
  assert.throws(() => engine.addMemorizedMaterial({ selection: { pageIds: ['page-1-1'] }, occurredAt: timestamp(2), initialStrength: 'unknown' }), /Unknown initial strength/);
  assert.deepEqual(engine.exportData(), before);
});
