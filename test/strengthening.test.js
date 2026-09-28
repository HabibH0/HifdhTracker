import test from 'node:test';
import assert from 'node:assert/strict';
import { makeEngine, review, strengthen, graduate, timestamp } from './helpers.js';

test('isolated difficult pages shorten their interval and do not force the whole half into relearning', () => {
  const engine = makeEngine({ initialStrength: 'strong' });
  const untouched = engine.getPageState('page-1-2').stabilityDays;
  review(engine, { accuracy: 'difficult' });
  assert.equal(engine.getStrengtheningState().activeCycle, null);
  assert.equal(engine.getPageState('page-1-1').targetedRepair, true);
  assert.equal(engine.getPageState('page-1-1').nextReviewAt, '2026-01-03');
  assert.equal(engine.getPageState('page-1-2').stabilityDays, untouched);
});

test('widespread failure returns the half-juz to strengthening', () => {
  const engine = makeEngine({ initialStrength: 'strong' });
  review(engine, { pageIds: ['page-1-1', 'page-1-2'], accuracy: 'failed' });
  assert.equal(engine.getStrengtheningState().activeCycle.halfJuzId, 'half-1');
  assert.equal(engine.getPageState('page-1-5').state, 'relearning');
});

test('a second deterioration queues repair without starting a concurrent cycle', () => {
  const engine = makeEngine({ initialStrength: 'strong' });
  review(engine, { pageIds: ['page-1-1', 'page-1-2'], accuracy: 'failed' });
  review(engine, { pageIds: ['page-2-1', 'page-2-2'], accuracy: 'failed' });
  const state = engine.getStrengtheningState();
  assert.equal(state.cycles.filter(c => c.status === 'active').length, 1);
  assert.equal(state.queuedRepairs[0].halfJuzId, 'half-2');
});

test('Stage 1 cannot progress without reliable recall or two complete passes', () => {
  const engine = makeEngine(); engine.startStrengtheningCycle({ halfJuzId: 'half-1', occurredAt: timestamp(1) });
  assert.equal(strengthen(engine, 1, { accuracy: 'difficult' }).strengtheningResult.passed, false);
  assert.equal(engine.getStrengtheningState().activeCycle.stage, 1);
  const reviews = engine._halfPages('half-1').map(pageId => ({ pageId, accuracy: 'good', fluency: 'automatic' }));
  assert.equal(strengthen(engine, 2, { steps: [{ kind: 'pass', reviews }] }).strengtheningResult.passed, false);
});

test('Stage 1 requires targeted repair and subsequent clean recall of major mistakes', () => {
  const engine = makeEngine(); engine.startStrengtheningCycle({ halfJuzId: 'half-1', occurredAt: timestamp(1) });
  const clean = engine._halfPages('half-1').map(pageId => ({ pageId, accuracy: 'perfect', fluency: 'automatic' }));
  const bad = structuredClone(clean); bad[0].mistakes = [{ ayahId: 'ayah-3', type: 'major_breakdown' }];
  const failed = strengthen(engine, 1, { steps: [{ kind: 'pass', reviews: bad }, { kind: 'pass', reviews: clean }] });
  assert.ok(failed.strengtheningResult.reasons.includes('targeted_repetition_required'));
  const passed = strengthen(engine, 2, { steps: [{ kind: 'pass', reviews: bad }, { kind: 'targeted', reviews: [{ ...clean[0], scope: 'ayah', ayahIds: ['ayah-3'] }] }, { kind: 'pass', reviews: clean }] });
  assert.equal(passed.strengtheningResult.passed, true);
});

test('targeted strengthening repetitions are capped at three per page per session', () => {
  const engine = makeEngine();
  const r = { pageId: 'page-1-1', accuracy: 'good', fluency: 'automatic' };
  assert.throws(() => strengthen(engine, 1, { steps: [{ kind: 'targeted', reviews: [r, r, r, r] }] }), /limit/);
  assert.equal(engine.getStrengtheningState().activeCycle, null);
});

test('Stage 2 and Stage 3 require later calendar days; missed days preserve progress', () => {
  const engine = makeEngine(); strengthen(engine, 1);
  assert.equal(engine.getStrengtheningState().activeCycle.stage, 2);
  assert.throws(() => strengthen(engine, 1), /later calendar day/);
  strengthen(engine, 7);
  assert.equal(engine.getStrengtheningState().activeCycle.stage, 3);
  assert.throws(() => strengthen(engine, 7), /later calendar day/);
  strengthen(engine, 15);
  assert.equal(engine.getStrengtheningState().activeCycle, null);
});

test('Stage 2 requires fluent recall and Stage 3 requires at least 80% automatic', () => {
  const engine = makeEngine(); strengthen(engine, 1);
  assert.equal(strengthen(engine, 2, { fluency: 'hesitant' }).strengtheningResult.passed, false);
  assert.equal(engine.getStrengtheningState().activeCycle.stage, 2);
  strengthen(engine, 3, { fluency: 'mostly_fluent' });
  assert.equal(strengthen(engine, 4, { fluency: 'mostly_fluent' }).strengtheningResult.passed, false);
  assert.equal(engine.getStrengtheningState().activeCycle.stage, 3);
  const reviews = engine._halfPages('half-1').map((pageId, i) => ({ pageId, accuracy: 'perfect', fluency: i === 4 ? 'mostly_fluent' : 'automatic' }));
  assert.equal(strengthen(engine, 5, { steps: [{ kind: 'pass', reviews }, { kind: 'pass', reviews }] }).strengtheningResult.passed, true);
});

test('graduation schedules checks after 2, then 4, then 7 days before adaptive scheduling', () => {
  const engine = makeEngine(), ids = graduate(engine);
  assert.equal(engine.getPageState(ids[0]).state, 'recently_strengthened');
  assert.equal(engine.getPageState(ids[0]).successfulSpacedReviews, 0);
  assert.equal(engine.getPageState(ids[0]).nextReviewAt, '2026-01-05');
  review(engine, { day: 5, pageIds: ids, purpose: 'early_retention' });
  assert.equal(engine.getPageState(ids[0]).nextReviewAt, '2026-01-09');
  review(engine, { day: 9, pageIds: ids, purpose: 'early_retention' });
  assert.equal(engine.getPageState(ids[0]).nextReviewAt, '2026-01-16');
  review(engine, { day: 16, pageIds: ids, purpose: 'early_retention' });
  const page = engine.getPageState(ids[0]);
  assert.equal(page.state, 'strong'); assert.equal(page.successfulSpacedReviews, 3);
  assert.equal(engine.getStrengtheningState().retention[0].status, 'complete');
  assert.notEqual(page.nextReviewAt, '2026-01-17');
});

test('extra or partial early reviews cannot prematurely advance retention checks', () => {
  const engine = makeEngine(), ids = graduate(engine);
  review(engine, { day: 4, pageIds: ids });
  assert.equal(engine.getStrengtheningState().retention[0].successes, 0);
  assert.equal(engine.getPageState(ids[0]).nextReviewAt, '2026-01-05');
  review(engine, { day: 5, pageIds: ids.slice(0, 2) });
  assert.equal(engine.getStrengtheningState().retention[0].successes, 0);
});

test('bad early retention repairs affected pages only when failure is isolated', () => {
  const engine = makeEngine(), ids = graduate(engine);
  review(engine, { day: 5, pages: ids.map((pageId, i) => ({ pageId, accuracy: i ? 'perfect' : 'failed', fluency: 'automatic' })) });
  assert.deepEqual(engine.getStrengtheningState().activeCycle.pageIds, [ids[0]]);
  assert.equal(engine.getPageState(ids[1]).state, 'recently_strengthened');
});

test('half-juz exposes lower-quartile stability and its weakest page separately', () => {
  const initialStrength = Object.fromEntries(makeEngine().metadata.pages.map(p => [p.id, p.id === 'page-1-1' ? 'very_weak' : 'very_strong']));
  const engine = makeEngine({ initialStrength }), state = engine.getHalfJuzState('half-1');
  assert.equal(state.weakestPages[0].pageId, 'page-1-1');
  assert.equal(state.weakestPages[0].stabilityDays, .5);
  assert.equal(state.state, 'developing');
});
