import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, unlinkSync, rmdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RevisionEngine, MemoryStore, createConfig } from '../src/index.js';
import { JsonFileStore } from '../src/node-store.js';
import { makeEngine, review, graduate, timestamp } from './helpers.js';

test('raw events replay to the same state, retaining mistakes, sessions and duration', () => {
  const engine = makeEngine(); const ids = graduate(engine);
  review(engine, { day: 5, pageIds: ids, actualDurationMinutes: 12.5 });
  const document = engine.exportData(), replayed = RevisionEngine.replay(document);
  assert.deepEqual(replayed.exportData().snapshot, document.snapshot);
  assert.deepEqual(replayed.exportData().events, document.events);
  assert.equal(replayed.getRevisionHistory().at(-1).actualDurationMinutes, 12.5);
  const recalculated = RevisionEngine.replay(document, { config: { stability: { maximum: 5 } } });
  assert.ok(recalculated.getPageState(ids[0]).stabilityDays <= 5);
  assert.equal(recalculated.exportData().events.length, document.events.length);
});

test('file store writes both raw history and snapshot and reopens without loss', () => {
  const directory = mkdtempSync(join(tmpdir(), 'hifdh-engine-test-')), path = join(directory, 'state.json');
  try {
    const engine = makeEngine({ store: new JsonFileStore(path) }); review(engine);
    const stored = JSON.parse(readFileSync(path, 'utf8'));
    assert.equal(stored.events.length, 2); assert.ok(stored.snapshot.pages['page-1-1']);
    const reopened = new RevisionEngine({ store: new JsonFileStore(path) });
    assert.deepEqual(reopened.exportData(), engine.exportData());
  } finally { unlinkSync(path); rmdirSync(directory); }
});

test('stale writers are rejected without changing memory or persisted data', () => {
  const store = new MemoryStore(), first = makeEngine({ store }), stale = new RevisionEngine({ store });
  const before = stale.exportData(); review(first);
  assert.throws(() => review(stale), /Concurrent/);
  assert.deepEqual(stale.exportData(), before);
  assert.equal(store.load().events.length, 2);
});

test('validation failures are atomic and reject invalid metadata, ratings and dates', () => {
  const engine = makeEngine(), before = engine.exportData();
  assert.throws(() => review(engine, { accuracy: 'excellent' }), /accuracy/);
  assert.throws(() => review(engine, { at: '2026-02-30T12:00:00Z' }), /Invalid date/);
  assert.throws(() => review(engine, { at: '2026-01-02T12:00:00' }), /offset/);
  assert.throws(() => review(engine, { pages: [{ pageId: 'page-1-1', accuracy: 'good', fluency: 'automatic', mistakes: [{ ayahId: 'unknown' }] }] }), /contained/);
  assert.deepEqual(engine.exportData(), before);
  review(engine, { day: 3 });
  assert.throws(() => review(engine, { day: 2 }), /chronological/);
  assert.throws(() => engine.generateDailyPlan(timestamp(2)), /latest event/);
});

test('configuration validates thresholds and supports duration tuning', () => {
  assert.throws(() => createConfig({ risk: { due: 2 } }), /thresholds/);
  assert.throws(() => createConfig({ fluency: { oldWeight: .9 } }), /sum/);
  assert.throws(() => createConfig({ typo: 1 }), /Unknown/);
  const engine = makeEngine({ config: { durations: { activePageMinutes: 2 } } });
  assert.equal(engine.generateDailyPlan(timestamp(1), 60).strengthen[0].estimatedMinutes, 23.75);
});
