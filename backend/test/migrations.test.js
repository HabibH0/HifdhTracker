import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { pgliteDb } from '../src/db.js';
import { migrate } from '../src/migrations.js';

test('migrations apply once and are idempotent', async () => {
  const pg = new PGlite();
  const db = pgliteDb(pg);
  const applied = [];
  await migrate(db, { log: m => applied.push(m) });
  await migrate(db, { log: m => applied.push(m) });
  assert.deepEqual(applied, ['applied 001_init.sql']);
  const { rows } = await db.query(`select table_name from information_schema.tables where table_schema = 'public' order by table_name`);
  const tables = rows.map(r => r.table_name);
  for (const t of ['users', 'auth_sessions', 'revision_events', 'word_marks', 'session_labels', 'day_tasks', 'settings',
    'memorized_material', 'page_states', 'strengthening_cycles', 'revision_sessions', 'mistakes', 'user_sync_state', 'schema_migrations']) {
    assert.ok(tables.includes(t), `missing table ${t}`);
  }
  // Every synced and projected table carries created_at / updated_at / deleted_at.
  for (const t of ['revision_events', 'word_marks', 'session_labels', 'day_tasks', 'settings', 'memorized_material', 'page_states', 'strengthening_cycles', 'revision_sessions', 'mistakes']) {
    const { rows: cols } = await db.query('select column_name from information_schema.columns where table_name = $1', [t]);
    const names = cols.map(c => c.column_name);
    for (const c of ['id', 'created_at', 'updated_at', 'deleted_at']) assert.ok(names.includes(c), `${t}.${c}`);
  }
  await pg.close();
});
