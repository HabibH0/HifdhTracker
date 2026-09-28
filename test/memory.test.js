import test from 'node:test';
import assert from 'node:assert/strict';
import { makeEngine, metadata, review, timestamp } from './helpers.js';
import { RevisionEngine } from '../src/index.js';

test('all onboarding mappings are exact, and claimed strength does not invent spaced evidence', () => {
  for (const [strength, stability, fluency] of [['very_weak', .5, .2], ['weak', 1.5, .35], ['medium', 4, .55], ['strong', 10, .75], ['very_strong', 30, .9]]) {
    const engine = makeEngine({ initialStrength: strength }), page = engine.getPageState('page-1-1');
    assert.equal(page.stabilityDays, stability); assert.equal(page.fluencyScore, fluency);
    assert.equal(page.successfulSpacedReviews, 0); assert.equal(page.lastActiveRecallAt, null);
  }
});

test('perfect recall after a long gap increases stability more than recall after one day', () => {
  const short = makeEngine({ initialStrength: 'strong' }), long = makeEngine({ initialStrength: 'strong' });
  review(short, { day: 2 }); review(long, { day: 21 });
  assert.equal(short.getPageState('page-1-1').stabilityDays, 15.4);
  assert.equal(long.getPageState('page-1-1').stabilityDays, 23);
});

test('same-day gains across the entire day are capped at five percent', () => {
  const engine = makeEngine();
  review(engine);
  const afterFirst = engine.getPageState('page-1-1').stabilityDays;
  for (let n = 0; n < 100; n++) review(engine, { at: timestamp(2, '18:00') });
  assert.ok(Math.abs(engine.getPageState('page-1-1').stabilityDays - afterFirst * 1.05) < 1e-10);
  assert.equal(engine.getPageState('page-1-1').successfulSpacedReviews, 1);
});

test('passive reading and listening improve fluency without stability or active recall evidence', () => {
  const engine = makeEngine();
  for (const activity of ['reading', 'listening']) review(engine, { activity });
  const page = engine.getPageState('page-1-1');
  assert.equal(page.stabilityDays, 1.5); assert.equal(page.lastActiveRecallAt, null);
  assert.equal(page.successfulSpacedReviews, 0); assert.ok(page.fluencyScore > .35);
});

test('same-day recitation keeps improving fluency independently of stability', () => {
  const engine = makeEngine(); review(engine);
  const before = engine.getPageState('page-1-1').fluencyScore;
  review(engine); review(engine); review(engine);
  assert.ok(engine.getPageState('page-1-1').fluencyScore > before);
});

test('failed recall sharply reduces stability and resets spaced success', () => {
  const engine = makeEngine({ initialStrength: 'strong' });
  review(engine); const before = engine.getPageState('page-1-1');
  review(engine, { day: 3, accuracy: 'failed', fluency: 'hesitant' });
  const page = engine.getPageState('page-1-1');
  assert.equal(page.stabilityDays, before.stabilityDays * .35);
  assert.equal(page.successfulSpacedReviews, 0);
  assert.ok(Math.abs(page.fluencyScore - (.65 * before.fluencyScore + .35 * .4) * .8) < 1e-12);
  assert.equal(page.nextReviewAt, '2026-01-04');
});

test('failed same-day recall is not hidden by the growth cap', () => {
  const engine = makeEngine({ initialStrength: 'strong' }); review(engine);
  const before = engine.getPageState('page-1-1').stabilityDays;
  review(engine, { accuracy: 'failed' });
  assert.equal(engine.getPageState('page-1-1').stabilityDays, before * .35);
});

test('accuracy and fluency independently determine quality and exact stability branches', () => {
  const cases = [['difficult', 'hesitant', 6], ['good', 'hesitant', 9], ['good', 'mostly_fluent', 13.25], ['perfect', 'mostly_fluent', 13.25], ['perfect', 'automatic', 15.4]];
  for (const [accuracy, fluency, expected] of cases) {
    const engine = makeEngine({ initialStrength: 'strong' }); review(engine, { accuracy, fluency });
    assert.ok(Math.abs(engine.getPageState('page-1-1').stabilityDays - expected) < 1e-10);
  }
});

test('activity evidence weights and the maximum stability are bounded', () => {
  const results = ['memory', 'tested', 'random_start'].map(activity => { const e = makeEngine({ initialStrength: 'strong' }); review(e, { activity }); return e.getPageState('page-1-1').stabilityDays; });
  assert.ok(results[0] < results[1] && results[1] < results[2]);
  const engine = makeEngine({ initialStrength: 'very_strong', config: { activities: { random_start: { weight: 100 } } } });
  review(engine, { at: '2026-05-01T12:00:00Z', activity: 'random_start' });
  assert.equal(engine.getPageState('page-1-1').stabilityDays, 76.8);
  review(engine, { at: '2026-10-01T12:00:00Z' });
  assert.equal(engine.getPageState('page-1-1').stabilityDays, 90);
});

test('partial ayah recall does not reset a full page risk clock or inflate page stability', () => {
  const engine = makeEngine();
  review(engine, { pages: [{ pageId: 'page-1-1', scope: 'ayah', ayahIds: ['ayah-3'], accuracy: 'perfect', fluency: 'automatic' }] });
  const page = engine.getPageState('page-1-1');
  assert.equal(page.stabilityDays, 1.5); assert.equal(page.lastActiveRecallAt, null);
  assert.equal(page.successfulSpacedReviews, 0);
});

test('stored stability does not decay and stronger pages tolerate longer gaps', () => {
  const weak = makeEngine(), strong = makeEngine({ initialStrength: 'very_strong' });
  assert.equal(weak.getForgettingRisk('page-1-1', timestamp(11)).level, 'high_risk');
  assert.equal(strong.getForgettingRisk('page-1-1', timestamp(11)).level, 'secure');
  assert.equal(strong.getPageState('page-1-1').stabilityDays, 30);
  assert.equal(strong.getDueReviews(timestamp(11)).length, 0);
});

test('initial estimates are superseded by actual evidence in both directions', () => {
  const weak = makeEngine({ initialStrength: 'very_weak' }), strong = makeEngine({ initialStrength: 'very_strong' });
  for (let day = 2; day <= 15; day++) { review(weak, { day }); review(strong, { day, accuracy: 'failed' }); }
  assert.ok(weak.getPageState('page-1-1').stabilityDays > 14);
  assert.equal(strong.getPageState('page-1-1').stabilityDays, .5);
  assert.equal(strong.getPageState('page-1-1').state, 'very_weak');
});

test('calendar-day evidence honors time zones rather than a rolling 24-hour window', () => {
  const engine = makeEngine({ initializedAt: '2026-01-01T00:00:00Z', config: { timeZone: 'Asia/Riyadh' } });
  review(engine, { at: '2026-01-02T20:59:00Z' });
  review(engine, { at: '2026-01-02T21:01:00Z' });
  assert.equal(engine.getPageState('page-1-1').history.at(-1).firstActiveRecallOfDay, true);
  assert.equal(engine.getPageState('page-1-1').successfulSpacedReviews, 1);
});

test('metadata is mandatory, layout-aware and validated', () => {
  assert.throws(() => makeEngine({ metadata: { layoutId: 'bad', pages: [], ayat: [] } }), /Metadata/);
  const data = metadata(); data.pages[0].ayahIds = ['not-known'];
  assert.throws(() => makeEngine({ metadata: data }), /metadata/);
  const engine = new RevisionEngine({ metadata: metadata(), initializedAt: timestamp(1) });
  assert.deepEqual(engine.getPageState('page-1-1').ayahIds, ['ayah-3', 'ayah-4']);
});
