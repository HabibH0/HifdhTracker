import test from 'node:test';
import assert from 'node:assert/strict';
import { makeEngine, timestamp, review, graduate } from './helpers.js';
import { RevisionEngine } from '../src/index.js';
import { assignSections, moveQueuedSection } from '../app/src/lib/revision-preferences.js';
import { sessionPracticeItems } from '../app/src/lib/session-practice.js';

test('manual queue is ordered, deduplicated and mutually exclusive with maintenance', () => {
  const settings = { strengthenQueue: ['half-2'], maintenanceHalfJuzIds: ['half-1'] };
  const queued = assignSections(settings, ['half-1', 'half-1', 'half-3'], 'relearn');
  assert.deepEqual(queued.strengthenQueue, ['half-2', 'half-1', 'half-3']);
  assert.deepEqual(queued.maintenanceHalfJuzIds, []);
  assert.deepEqual(moveQueuedSection(queued.strengthenQueue, 'half-3', -1), ['half-2', 'half-3', 'half-1']);
  assert.deepEqual(assignSections(queued, ['half-1'], 'maintenance'), { strengthenQueue: ['half-2', 'half-3'], maintenanceHalfJuzIds: ['half-1'] });
  assert.deepEqual(settings.strengthenQueue, ['half-2']);
});

test('chosen relearning queue takes precedence and cannot replace an active cycle', () => {
  const e = makeEngine({ initialStrength: 'weak' });
  const preferences = { strengthenQueue: ['half-3', 'half-2'] };
  assert.equal(e.generateDailyPlan(timestamp(1), 60, preferences).strengthen[0].halfJuzId, 'half-3');
  e.startStrengtheningCycle({ halfJuzId: 'half-1', occurredAt: timestamp(1) });
  assert.equal(e.generateDailyPlan(timestamp(1), 60, preferences).strengthen[0].halfJuzId, 'half-1');
  assert.equal(e.state.cycles.length, 1);
});

test('self-reported strong material enters maintenance without fabricated spaced successes', () => {
  const e = makeEngine({ initialStrength: 'strong' });
  const before = e.exportData();
  const preferences = { maintenanceHalfJuzIds: ['half-2'] };
  const plan = e.generateDailyPlan(timestamp(1), 30, preferences);
  assert.deepEqual(plan.maintenance.flatMap(i => i.pageIds).sort(), e._halfPages('half-2').sort());
  assert.equal(e.getPageState('page-2-1').successfulSpacedReviews, 0);
  assert.equal(e.getPageState('page-2-1').state, 'developing');
  assert.deepEqual(e.exportData(), before);
  const restored = RevisionEngine.replay(before);
  assert.deepEqual(restored.generateDailyPlan(timestamp(1), 30, JSON.parse(JSON.stringify(preferences))), plan);
});

test('relearning and chosen maintenance fit together without reviewing a page twice', () => {
  const e = makeEngine({ initialStrength: 'strong' });
  e.startStrengtheningCycle({ halfJuzId: 'half-1', occurredAt: timestamp(1) });
  const p = e.generateDailyPlan(timestamp(1), 18, { maintenanceHalfJuzIds: ['half-2', 'half-3'] });
  assert.equal(p.strengthen.length, 1);
  assert.equal(p.maintenance.length, 1);
  assert.equal(p.maintenance[0].pageIds.length, 2);
  assert.ok(p.totalEstimatedDurationMinutes <= 18);
  const ids = [...p.strengthen, ...p.maintenance, ...p.dailyReviews, ...p.dueReviews].flatMap(i => i.pageIds);
  assert.equal(new Set(ids).size, ids.length);
});

test('manual maintenance does not bypass deterioration or mandatory retention checks', () => {
  const e = makeEngine({ initialStrength: 'strong' });
  review(e, { day: 2, pageIds: e._halfPages('half-2'), accuracy: 'failed' });
  const p = e.generateDailyPlan(timestamp(2), 60, { maintenanceHalfJuzIds: ['half-2'] });
  assert.equal(p.strengthen[0].halfJuzId, 'half-2');
  assert.ok(p.maintenance.every(i => i.pageIds.every(id => !id.startsWith('page-2-'))));
  const retained = makeEngine({ initialStrength: 'strong' });
  graduate(retained);
  const pending = retained.generateDailyPlan(timestamp(4), 60, { maintenanceHalfJuzIds: ['half-1'] });
  assert.ok(pending.maintenance.every(i => i.pageIds.every(id => !id.startsWith('page-1-'))));
});

test('next manual queue item waits until the day after graduation', () => {
  const e = makeEngine({ initialStrength: 'strong' });
  graduate(e);
  const preferences = { strengthenQueue: ['half-2'] };
  assert.equal(e.generateDailyPlan(timestamp(3), 60, preferences).strengthen.length, 0);
  assert.equal(e.generateDailyPlan(timestamp(4), 60, preferences).strengthen[0].halfJuzId, 'half-2');
});

test('only memorized portions of a chosen maintenance section are prescribed', () => {
  const e = makeEngine({ memorized: { ayahIds: ['ayah-3'] }, initialStrength: 'strong' });
  const p = e.generateDailyPlan(timestamp(1), 10, { maintenanceHalfJuzIds: ['half-1'] });
  assert.deepEqual(p.maintenance[0].passage.ayahIds, ['ayah-3']);
});

test('session practice includes one-off errors, groups repeat locations and preserves history', () => {
  const e = makeEngine({ initialStrength: 'strong' });
  const saved = review(e, { pages: [
    { pageId: 'page-1-1', accuracy: 'good', fluency: 'mostly_fluent', mistakes: [{ ayahId: 'ayah-3', type: 'wrong_word' }, { ayahId: 'ayah-3', type: 'hesitation' }] },
    { pageId: 'page-1-2', accuracy: 'difficult', fluency: 'hesitant', mistakes: [] },
  ] });
  const before = e.exportData();
  const items = sessionPracticeItems(e, saved.sessionId);
  assert.equal(items.length, 2);
  assert.equal(items[0].mistakeCount, 2);
  assert.deepEqual(items[0].mistakeTypes, ['wrong_word', 'hesitation']);
  assert.equal(items[1].kind, 'weak_page');
  assert.equal(e.getTroublesomeAyat(timestamp(2)).length, 0);
  assert.deepEqual(e.exportData(), before);
  assert.deepEqual(sessionPracticeItems(e, 'unknown'), []);
});

test('failed targeted recall stays limited to its reviewed ayat and clean sessions have no practice', () => {
  const e = makeEngine({ initialStrength: 'strong' });
  const saved = review(e, { purpose: 'targeted', pages: [{ pageId: 'page-1-1', scope: 'ayah', ayahIds: ['ayah-3'], accuracy: 'failed', fluency: 'hesitant' }] });
  assert.deepEqual(sessionPracticeItems(e, saved.sessionId).map(i => i.ayahId), ['ayah-3']);
  const clean = review(e, { day: 3, pageIds: ['page-2-1'] });
  assert.deepEqual(sessionPracticeItems(e, clean.sessionId), []);
});
