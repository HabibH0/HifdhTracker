import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { testServer, register } from './helpers.js';
import { pgliteDb } from '../src/db.js';
import { migrate } from '../src/migrations.js';
import { hashPassword } from '../src/auth.js';
import { createApp } from '../src/app.js';

const doc = (n = 1) => ({ settings: { cycleLength: 3 }, sections: { 1: { id: 1, memorised: true, revisionCount: n } }, weakQueue: [1] });

test('planner state', async t => {
  const s = await testServer();
  t.after(() => s.close());
  const { token } = await register(s.call, 'planner', 'correct horse battery');
  const put = (body, tk = token) => s.call('PUT', '/state', { token: tk, body });

  await t.test('a new account has no saved state', async () => {
    const res = await s.call('GET', '/state', { token });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { state: null, version: 0, updatedAt: null });
    assert.equal((await s.call('GET', '/me', { token })).body.hasData, false);
  });

  await t.test('the first save creates version 1 and round-trips the document', async () => {
    const res = await put({ state: doc(1), baseVersion: 0, deviceId: 'phone', updatedAt: '2026-09-29T10:00:00.000Z' });
    assert.equal(res.status, 200);
    assert.equal(res.body.version, 1);
    const got = await s.call('GET', '/state', { token });
    assert.deepEqual(got.body.state, doc(1));
    assert.equal(got.body.version, 1);
    assert.equal(new Date(got.body.updatedAt).toISOString(), '2026-09-29T10:00:00.000Z');
    assert.equal((await s.call('GET', '/me', { token })).body.hasData, true);
  });

  await t.test('saving from the current version bumps it', async () => {
    const res = await put({ state: doc(2), baseVersion: 1, deviceId: 'phone' });
    assert.equal(res.body.version, 2);
  });

  await t.test('a save based on a stale version is rejected with the current copy', async () => {
    const res = await put({ state: doc(99), baseVersion: 1, deviceId: 'laptop' });
    assert.equal(res.status, 409);
    assert.equal(res.body.error, 'version_conflict');
    assert.equal(res.body.current.version, 2);
    assert.deepEqual(res.body.current.state, doc(2));
    assert.deepEqual((await s.call('GET', '/state', { token })).body.state, doc(2), 'stored copy unchanged');
  });

  await t.test('accounts cannot see each other\'s state', async () => {
    const other = await register(s.call, 'someone', 'correct horse battery');
    assert.equal((await s.call('GET', '/state', { token: other.token })).body.state, null);
    assert.equal((await put({ state: doc(5), baseVersion: 0 }, other.token)).body.version, 1);
    assert.deepEqual((await s.call('GET', '/state', { token })).body.state, doc(2));
  });

  await t.test('login reports whether the account has saved data', async () => {
    const res = await s.call('POST', '/login', { body: { username: 'planner', password: 'correct horse battery' } });
    assert.equal(res.body.hasData, true);
  });

  await t.test('export includes the saved state', async () => {
    const res = await s.call('GET', '/export', { token });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.username, 'planner');
    assert.deepEqual(res.body.state, doc(2));
  });
});

test('upgrading a database from the previous app keeps existing accounts', async () => {
  const pg = new PGlite();
  const db = pgliteDb(pg);
  // Simulate the deployed database: only 001 applied, with an existing user.
  await db.exec('create table schema_migrations (version text primary key, applied_at timestamptz not null default now())');
  const { readFile } = await import('node:fs/promises');
  const sql = await readFile(new URL('../migrations/001_init.sql', import.meta.url), 'utf8');
  await pg.exec(sql);
  await db.query("insert into schema_migrations (version) values ('001_init.sql')");
  await db.query("insert into users (username, username_norm, password_hash) values ('Habib', 'habib', $1)", [await hashPassword('an existing password')]);

  await migrate(db);
  const { rows } = await db.query('select version from schema_migrations order by version');
  assert.deepEqual(rows.map(r => r.version), ['001_init.sql', '002_planner_state.sql']);

  const app = createApp({ db, allowedOrigins: [], logger: { error() {} } });
  const res = await app.request('/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'habib', password: 'an existing password' }) });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).hasData, false);
  await pg.close();
});
