import test from 'node:test';
import assert from 'node:assert/strict';
import { RevisionEngine } from '../../src/index.js';
import { LocalRepo, syncOnce, openEngine, createEngineIn } from '../../app/src/lib/syncCore.js';
import { createApi, NetworkError } from '../../app/src/lib/apiClient.js';
import { buildEngine } from '../../shared/merge.js';
import { METADATA } from '../src/projections.js';
import { testServer, register, API } from './helpers.js';

// A simulated device: the app's real repository, engine bridge and sync loop, with persistence
// into a Map (standing in for IndexedDB) so it can be "restarted".
function device(server, { disk = new Map(), clock } = {}) {
  let t = clock ?? Date.parse('2026-09-01T05:00:00.000Z');
  const now = () => t;
  const repo = new LocalRepo({
    entries: Object.fromEntries(disk),
    write: (puts, deletes) => { for (const [k, v] of puts) disk.set(k, structuredClone(v)); for (const k of deletes) disk.delete(k); },
    now,
  });
  const api = createApi({ baseUrl: API, fetch: server.fetchImpl });
  let { engine, conflicts } = openEngine({ RevisionEngine, repo, metadata: METADATA });
  const d = {
    repo, api, disk,
    get engine() { return engine; },
    get conflicts() { return conflicts; },
    tick(minutes = 1) { t += minutes * 60000; return new Date(t).toISOString(); },
    at() { return new Date(t).toISOString(); },
    init(memorized = { surahs: [110, 111, 112, 113, 114] }) {
      engine = createEngineIn({ RevisionEngine, repo, metadata: METADATA, initializedAt: d.tick(), memorized, initialStrength: 'medium', config: { timeZone: 'Europe/London' } });
      return engine;
    },
    review(pageId, { accuracy = 'good', fluency = 'mostly_fluent', mistakes = [], sessionId } = {}) {
      const occurredAt = d.tick(10);
      return engine.recordRevision({ sessionId: sessionId ?? `s-${Math.random().toString(36).slice(2)}`, occurredAt, activity: 'memory', purpose: 'ordinary', actualDurationMinutes: 3, pages: [{ pageId, accuracy, fluency, mistakes }] });
    },
    async login(username, password = 'correct horse battery') {
      const res = await api.login(username, password);
      repo.bindAccount(res);
      return res;
    },
    async sync() {
      const result = await syncOnce(repo, api, { batch: 3 }); // tiny batches exercise pagination
      if (result.eventsAdded) ({ engine, conflicts } = openEngine({ RevisionEngine, repo, metadata: METADATA }));
      return result;
    },
    restart() { repo.flush(); return device(server, { disk, clock: t }); },
  };
  return d;
}

const plan = (d, date) => JSON.stringify(d.engine.generateDailyPlan(date, 60));
const state = d => ({
  inventory: d.engine.getMemorizedMaterial(),
  pages: Object.fromEntries(Object.values(d.engine.state.pages).filter(p => p.memorizedAyahIds.length).map(p => [p.pageId, [p.stabilityDays, p.fluencyScore, p.nextReviewAt, p.successfulSpacedReviews]])),
  sessions: Object.keys(d.engine.state.sessions).sort(),
  mistakes: d.engine.state.mistakes.length,
});
const count = async (s, table) => (await s.db.query(`select count(*)::int as n from ${table}`)).rows[0].n;

test('sync', async t => {
  const s = await testServer();
  t.after(() => s.close());
  await register(s.call, 'aisha');

  const a = device(s);

  await t.test('offline writes are saved locally, flagged unsynced, and survive a restart', async () => {
    s.net.offline = true;
    a.init();
    a.review('p604', { mistakes: [{ ayahId: '113:3', type: 'hesitation' }] });
    a.review('p603', { accuracy: 'perfect', fluency: 'automatic' });
    a.repo.put('settings', 'app', { capacity: 90 });
    assert.equal(a.repo.pendingCount(), 4, 'three events + settings pending');
    await a.login('aisha').then(() => assert.fail('should be offline'), e => assert.ok(e instanceof NetworkError));
    // Sign in happened earlier in real life; bind with a token issued while online.
    s.net.offline = false;
    await a.login('aisha');
    s.net.offline = true;
    await assert.rejects(a.sync(), NetworkError, 'sync fails without blocking or losing anything');
    assert.equal(a.repo.pendingCount(), 4);
    assert.equal(Object.keys(a.engine.state.sessions).length, 2, 'revision recorded locally regardless');
    const reopened = a.restart();
    assert.equal(reopened.repo.pendingCount(), 4, 'pending flags persisted');
    assert.deepEqual(state(reopened), state(a), 'engine rebuilt identically from persisted events');
    assert.equal(await count(s, 'revision_events'), 0);
  });

  await t.test('successful sync uploads everything and fills the Postgres projections', async () => {
    s.net.offline = false;
    const result = await a.sync();
    assert.equal(result.status, 'synced');
    assert.equal(a.repo.pendingCount(), 0);
    assert.equal(await count(s, 'revision_events'), 3);
    assert.equal(await count(s, 'settings'), 1);
    assert.equal(await count(s, 'revision_sessions'), 2);
    assert.equal(await count(s, 'mistakes'), 1);
    const { rows: pages } = await s.db.query('select id, state, stability_days from page_states order by id');
    assert.deepEqual(pages.map(p => p.id), ['p603', 'p604']);
    assert.equal(pages[0].stability_days, a.engine.state.pages.p603.stabilityDays, 'server replay matches the device');
    const { rows: [material] } = await s.db.query("select ayah_ids, coverage from memorized_material where id = 'p604'");
    assert.deepEqual(material.ayah_ids, a.engine.state.pages.p604.memorizedAyahIds);
    const { rows: [ev] } = await s.db.query('select created_at, updated_at, deleted_at, status from revision_events limit 1');
    assert.ok(ev.created_at && ev.updated_at && ev.deleted_at === null && ev.status === 'applied');
  });

  const b = device(s, { clock: Date.parse('2026-09-01T09:00:00.000Z') });

  await t.test('a second device signs in and rebuilds identical state', async () => {
    const res = await b.login('aisha');
    assert.equal(res.hasData, true);
    await b.sync();
    assert.deepEqual(state(b), state(a));
    assert.equal(plan(b, '2026-09-02'), plan(a, '2026-09-02'));
    assert.equal(b.repo.get('settings', 'app').capacity, 90);
  });

  await t.test('repeated syncs never duplicate records', async () => {
    const before = await count(s, 'revision_events');
    for (let i = 0; i < 3; i++) { await a.sync(); await b.sync(); }
    assert.equal(await count(s, 'revision_events'), before);
    assert.equal(a.repo.eventRecords().length, before);
    assert.equal(b.repo.eventRecords().length, before);

    // The server stores a push but the response is lost: the device resends, nothing doubles.
    a.review('p604', { accuracy: 'good', fluency: 'automatic' });
    a.repo.put('wordMarks', 'mark-1', { page: 604, ayahId: '113:3', pos: 2, type: 'hesitation', date: '2026-09-01' });
    s.net.dropResponses = 1;
    await assert.rejects(a.sync(), NetworkError);
    assert.equal(await count(s, 'revision_events'), before + 1, 'server already has it');
    assert.equal(a.repo.pendingCount(), 2, 'device still thinks it is pending');
    await a.sync();
    assert.equal(a.repo.pendingCount(), 0);
    assert.equal(await count(s, 'revision_events'), before + 1);
    assert.equal(await count(s, 'word_marks'), 1);

    // Replaying an identical raw push is also a no-op.
    const records = a.repo.eventRecords().map(({ synced, ...r }) => r);
    const again = await a.api.sync(a.repo.meta.token, { cursor: '0', changes: { events: records } });
    assert.equal(again.acked.events.length, records.length);
    assert.equal(await count(s, 'revision_events'), before + 1);

    await b.sync();
    assert.equal(b.repo.eventRecords().length, before + 1);
    assert.equal(b.repo.list('wordMarks').length, 1);
    assert.deepEqual(state(b), state(a));
  });

  await t.test('both devices offline, then recover and converge', async () => {
    s.net.offline = true;
    a.tick(60 * 24); b.tick(60 * 24 + 5);
    a.review('p603', { mistakes: [{ ayahId: '110:2' }] });
    a.repo.put('settings', 'app', { capacity: 30 });
    b.review('p604', { accuracy: 'difficult', fluency: 'hesitant' });
    b.repo.put('settings', 'app', { capacity: 120 }); // later edit wins
    b.repo.put('sessionMeta', 'label-1', { title: 'Juz 30' });
    await assert.rejects(a.sync(), NetworkError);
    await assert.rejects(b.sync(), NetworkError);
    assert.equal(a.repo.pendingCount(), 2);
    assert.equal(b.repo.pendingCount(), 3);

    s.net.offline = false;
    await a.sync(); await b.sync(); await a.sync();
    assert.equal(a.repo.pendingCount() + b.repo.pendingCount(), 0);
    const ids = d => d.repo.eventRecords().map(r => r.id).sort();
    assert.deepEqual(ids(a), ids(b));
    assert.deepEqual(state(a), state(b));
    assert.equal(plan(a, '2026-09-03'), plan(b, '2026-09-03'));
    assert.equal(a.repo.get('settings', 'app').capacity, 120);
    assert.equal(b.repo.get('settings', 'app').capacity, 120);
    assert.equal(a.repo.get('sessionMeta', 'label-1').title, 'Juz 30');
    assert.equal(await count(s, 'revision_events'), a.repo.eventRecords().length);
    assert.equal(await count(s, 'revision_sessions'), Object.keys(a.engine.state.sessions).length);
    assert.deepEqual(a.conflicts, []);
  });

  await t.test('a device that started offline on its own merges into the account', async () => {
    const c = device(s, { clock: Date.parse('2026-09-05T07:00:00.000Z') });
    c.init({ surahs: [1] });
    c.review('p1', { accuracy: 'perfect', fluency: 'automatic' });
    await c.login('aisha'); // "combine" choice in the app
    await c.sync(); await a.sync();
    const inits = c.repo.eventRecords().filter(r => r.type === 'initialized');
    assert.equal(inits.length, 2, 'both devices’ initialisations are kept as records');
    assert.ok(c.engine.getMemorizedMaterial().ayahIds.includes('1:1'), 'new device inventory kept');
    assert.ok(c.engine.getMemorizedMaterial().ayahIds.includes('114:1'), 'account inventory kept');
    assert.deepEqual(state(c), state(a));
  });

  await t.test('deletions sync as tombstones', async () => {
    a.repo.remove('wordMarks', 'mark-1');
    await a.sync(); await b.sync();
    assert.equal(b.repo.list('wordMarks').length, 0);
    const { rows: [mark] } = await s.db.query("select deleted_at from word_marks where id = 'mark-1'");
    assert.ok(mark.deleted_at);
  });

  await t.test('export returns the whole account in an importable backup format', async () => {
    const res = await s.call('GET', '/export', { token: a.repo.meta.token });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-disposition'), /attachment/);
    const backup = res.body;
    assert.equal(backup.app, 'hifdh-revision');
    assert.equal(backup.engine.metadata.layoutId, 'qcf-v2-madinah-604');
    assert.equal(backup.eventRecords.length, a.repo.eventRecords().length);
    assert.equal(backup.cloud.revisionSessions.length, Object.keys(a.engine.state.sessions).length);
    assert.equal(backup.settings.data.capacity, 120);
    const other = await register(s.call, 'someone');
    const theirs = await s.call('GET', '/export', { token: other.token });
    assert.equal(theirs.body.eventRecords.length, 0, 'accounts are isolated');
  });
});

test('merge sets aside events that cannot apply, identically everywhere', () => {
  const init = { id: '0190a000-0000-7000-8000-000000000001', occurredAt: '2026-09-01T05:00:00.000Z', type: 'initialized', deviceId: 'd1',
    body: { type: 'initialized', occurredAt: '2026-09-01T05:00:00.000Z', memorizedAyahIds: ['112:1', '112:2', '112:3', '112:4'], strengths: { p604: 'medium' } }, config: { timeZone: 'UTC' } };
  const orphan = { id: '0190a000-0000-7000-8000-000000000002', occurredAt: '2026-09-01T06:00:00.000Z', type: 'strengthening_session', deviceId: 'd2',
    body: { type: 'strengthening_session', occurredAt: '2026-09-01T06:00:00.000Z', sessionId: 'x', actualDurationMinutes: 1, halfJuzId: 'h60', steps: [] } };
  const ok = { id: '0190a000-0000-7000-8000-000000000003', occurredAt: '2026-09-01T07:00:00.000Z', type: 'revision', deviceId: 'd1',
    body: { type: 'revision', occurredAt: '2026-09-01T07:00:00.000Z', sessionId: 'y', actualDurationMinutes: 1, purpose: 'ordinary', reviews: [{ pageId: 'p604', activity: 'memory', accuracy: 'good', fluency: 'automatic', scope: 'memorized', ayahIds: ['112:1', '112:2', '112:3', '112:4'], mistakes: [] }] } };
  const store = doc => ({ load: () => doc, save() {} });
  const one = buildEngine({ RevisionEngine, records: [ok, orphan, init], metadata: METADATA, makeStore: store });
  const two = buildEngine({ RevisionEngine, records: [init, ok, orphan], metadata: METADATA, makeStore: store });
  assert.deepEqual(one.conflicts, [orphan.id]);
  assert.deepEqual(two.conflicts, [orphan.id]);
  assert.equal(Object.keys(one.engine.state.sessions).length, 1, 'the valid revision still applies');
  // Re-importing the same session under a new id is recognised as a duplicate.
  const dup = { ...ok, id: '0190a000-0000-7000-8000-000000000004' };
  const three = buildEngine({ RevisionEngine, records: [init, ok, dup], metadata: METADATA, makeStore: store });
  assert.deepEqual(three.duplicates, [dup.id]);
});
