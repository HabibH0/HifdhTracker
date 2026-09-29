import { PGlite } from '@electric-sql/pglite';
import { createApp } from '../src/app.js';
import { pgliteDb } from '../src/db.js';
import { migrate } from '../src/migrations.js';

export const ORIGIN = 'http://localhost:5173';
export const API = 'https://api.test';

/** A fresh in-memory Postgres with migrations applied, and the API app on top of it. */
export async function testServer() {
  const pg = new PGlite();
  const db = pgliteDb(pg);
  await migrate(db);
  const app = createApp({ db, allowedOrigins: [ORIGIN], logger: { error() {} } });
  let ip = 0;
  const call = async (method, path, { body, token, origin, headers = {} } = {}) => {
    const res = await app.request(path, {
      method,
      headers: {
        'content-type': 'application/json', 'x-forwarded-for': `10.0.${Math.floor(++ip / 250)}.${ip % 250}`,
        ...(token ? { authorization: `Bearer ${token}` } : {}), ...(origin ? { origin } : {}), ...headers,
      },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
  };
  return { pg, db, app, call, close: () => pg.close() };
}

export async function register(call, username = 'aisha', password = 'correct horse battery') {
  const res = await call('POST', '/register', { body: { username, password } });
  if (res.status !== 201) throw new Error(`register failed ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}
