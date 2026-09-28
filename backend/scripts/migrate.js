// Usage: DATABASE_URL_UNPOOLED=postgres://... node scripts/migrate.js
// (falls back to DATABASE_URL; `neon env pull` writes both into .env)
import pg from 'pg';
import { pgDb } from '../src/db.js';
import { migrate } from '../src/migrations.js';

try { process.loadEnvFile?.('.env'); } catch { /* no .env: rely on the environment */ }
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) { console.error('Set DATABASE_URL_UNPOOLED (or DATABASE_URL) first, e.g. via `neon env pull`.'); process.exit(1); }
const pool = new pg.Pool({ connectionString: url, max: 1 });
try {
  await migrate(pgDb(pool), { log: console.log });
  console.log('Database is up to date.');
} finally {
  await pool.end();
}
