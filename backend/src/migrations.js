import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('../migrations/', import.meta.url));

/** Apply every migrations/NNN_*.sql not yet recorded in schema_migrations, in order. */
export async function migrate(db, { log = () => {} } = {}) {
  await db.exec('create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now())');
  const done = new Set((await db.query('select version from schema_migrations')).rows.map(r => r.version));
  const files = (await readdir(DIR)).filter(f => /^\d+_.*\.sql$/.test(f)).sort();
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = await readFile(join(DIR, file), 'utf8');
    await db.tx(async q => {
      for (const statement of splitSql(sql)) await q.query(statement);
      await q.query('insert into schema_migrations (version) values ($1)', [file]);
    });
    log(`applied ${file}`);
  }
}

// Statements are separated by semicolons at line ends; the migrations contain no functions.
function splitSql(sql) {
  return sql.replace(/--[^\n]*/g, '').split(/;\s*(?:\n|$)/).map(s => s.trim()).filter(Boolean);
}
