// Local API for development without a Neon account: PGlite (in-process Postgres) persisted to
// backend/.pglite, or a real Postgres when DATABASE_URL is set. Serves on http://localhost:8787,
// the same port `neon dev` uses.
import { serve } from '@hono/node-server';
import { createApp, originsFromEnv } from '../src/app.js';
import { pgDb, pgliteDb } from '../src/db.js';
import { migrate } from '../src/migrations.js';

try { process.loadEnvFile?.('.env'); } catch { /* optional */ }
let db;
if (process.env.DATABASE_URL) {
  const pg = (await import('pg')).default;
  db = pgDb(new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 }));
} else {
  const { PGlite } = await import('@electric-sql/pglite');
  db = pgliteDb(new PGlite(process.env.PGLITE_DIR ?? './.pglite'));
}
await migrate(db, { log: m => console.log(`[migrate] ${m}`) });
const origins = originsFromEnv(process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173');
const app = createApp({ db, allowedOrigins: origins });
const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => console.log(`Hifdh API on http://localhost:${port} (origins: ${origins.join(', ')})`));
