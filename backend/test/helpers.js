import { PGlite } from '@electric-sql/pglite';
import { createApp } from '../src/app.js';
import { pgliteDb } from '../src/db.js';
import { migrate } from '../src/migrations.js';

export const ORIGIN = 'http://localhost:5174';
export const API = 'https://api.test';

/** A fresh in-memory Postgres with migrations applied, and the API app on top of it. */
export async function testServer() {
  const pg = new PGlite();
  const db = pgliteDb(pg);
  await migrate(db);
  const pending = [];
  const app = createApp({ db, allowedOrigins: [ORIGIN], defer: p => pending.push(p), logger: { error() {} } });
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
  /** Background work (projection rebuilds) that Neon's waitUntil would run after the response. */
  const settle = async () => { while (pending.length) await pending.shift(); };
  // A fetch() routed to the in-process app for the client sync code. `net.offline` simulates no
  // connectivity; `net.dropResponses` makes the server do the work but the response get lost.
  const net = { offline: false, requests: 0, dropResponses: 0 };
  const fetchImpl = async (url, init) => {
    if (net.offline) throw new TypeError('Failed to fetch');
    net.requests++;
    const u = new URL(url);
    const res = await app.request(u.pathname + u.search, init);
    await settle();
    if (net.dropResponses > 0) { net.dropResponses--; throw new TypeError('Network connection lost'); }
    return res;
  };
  return { pg, db, app, call, settle, fetchImpl, net, close: () => pg.close() };
}

export async function register(call, username = 'aisha', password = 'correct horse battery') {
  const res = await call('POST', '/register', { body: { username, password } });
  if (res.status !== 201) throw new Error(`register failed ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}
