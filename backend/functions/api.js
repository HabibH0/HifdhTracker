// Neon Function entry point (deployed by `neon deploy`, see neon.ts).
// DATABASE_URL is injected by Neon; it never leaves the server.
import pg from 'pg';
import { attachDatabasePool, waitUntil } from '@neon/functions';
import { createApp, originsFromEnv } from '../src/app.js';
import { pgDb } from '../src/db.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
attachDatabasePool(pool);

export default createApp({
  db: pgDb(pool),
  allowedOrigins: originsFromEnv(process.env.ALLOWED_ORIGINS),
  defer: promise => { waitUntil(promise); },
});
