import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import {
  HttpError, assertNotThrottled, authenticate, burnTime, checkPassword, createSession, hashPassword,
  normalizeUsername, recordAttempt, revokeSession, verifyPassword,
} from './auth.js';
import { getPlannerState, hasPlannerData, putPlannerState } from './planner.js';

/**
 * createApp({ db, allowedOrigins })
 *  db              see db.js
 *  allowedOrigins  exact origins allowed to call the API from a browser
 */
export function createApp({ db, allowedOrigins = [], logger = console }) {
  const app = new Hono();
  const allowed = new Set(allowedOrigins.map(o => o.replace(/\/$/, '')));

  app.use('*', async (c, next) => {
    const origin = c.req.header('origin');
    const ok = origin && allowed.has(origin);
    if (c.req.method === 'OPTIONS') {
      if (!ok) return c.body(null, 403);
      return c.body(null, 204, {
        'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, content-type', 'Access-Control-Max-Age': '86400', Vary: 'Origin',
      });
    }
    // Browsers from other sites get no CORS grant; non-browser clients send no Origin at all.
    if (origin && !ok) return c.json({ error: 'origin_not_allowed', message: 'This site may not use the API.' }, 403);
    await next();
    if (ok) { c.header('Access-Control-Allow-Origin', origin); c.header('Vary', 'Origin'); }
    c.header('Cache-Control', 'no-store');
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'no-referrer');
  });

  app.onError((error, c) => {
    if (error instanceof HttpError) {
      if (error.extra?.retryAfter) c.header('Retry-After', String(error.extra.retryAfter));
      const current = error.extra?.current ? { current: error.extra.current } : {};
      return c.json({ error: error.code, message: error.message, ...current }, error.status);
    }
    logger.error?.(error);
    return c.json({ error: 'server_error', message: 'Something went wrong. Your data is safe on your device.' }, 500);
  });
  app.notFound(c => c.json({ error: 'not_found', message: 'Not found.' }, 404));

  const json = async c => {
    try { return await c.req.json(); } catch { throw new HttpError(400, 'invalid_json', 'Expected a JSON body.'); }
  };
  const clientIp = c => (c.req.header('x-forwarded-for') ?? '').split(',')[0].trim() || c.req.header('x-real-ip') || 'unknown';
  const auth = async (c, next) => { c.set('user', await authenticate(db, c.req.header('authorization'))); await next(); };
  const small = bodyLimit({ maxSize: 16 * 1024, onError: c => c.json({ error: 'too_large', message: 'Request too large.' }, 413) });
  const large = bodyLimit({ maxSize: 1024 * 1024, onError: c => c.json({ error: 'too_large', message: 'Request too large.' }, 413) });
  const userJson = u => ({ id: u.id ?? u.userId, username: u.username });

  app.get('/health', async c => {
    await db.query('select 1');
    return c.json({ ok: true });
  });

  app.post('/register', small, async c => {
    const body = await json(c);
    const { display, norm } = normalizeUsername(body.username);
    const password = checkPassword(body.password);
    const who = { usernameNorm: norm, ip: clientIp(c) };
    await assertNotThrottled(db, 'register', who);
    const hash = await hashPassword(password);
    const { rows } = await db.query(
      'insert into users (username, username_norm, password_hash) values ($1, $2, $3) on conflict (username_norm) do nothing returning id, username',
      [display, norm, hash]);
    await recordAttempt(db, 'register', who, rows.length > 0);
    if (!rows.length) throw new HttpError(409, 'username_taken', 'That username is taken.');
    const session = await createSession(db, rows[0].id, c.req.header('user-agent'));
    return c.json({ ...session, user: userJson(rows[0]), hasData: false }, 201);
  });

  app.post('/login', small, async c => {
    const body = await json(c);
    let norm;
    try { norm = normalizeUsername(body.username).norm; } catch { norm = null; }
    const password = typeof body.password === 'string' ? body.password.normalize('NFKC') : '';
    const who = { usernameNorm: norm, ip: clientIp(c) };
    await assertNotThrottled(db, 'login', who);
    const { rows } = norm ? await db.query('select id, username, password_hash from users where username_norm = $1 and deleted_at is null', [norm]) : { rows: [] };
    const ok = rows.length ? await verifyPassword(password, rows[0].password_hash) : (await burnTime(password), false);
    await recordAttempt(db, 'login', who, ok);
    if (!ok) throw new HttpError(401, 'invalid_credentials', 'Username or password is incorrect.');
    const session = await createSession(db, rows[0].id, c.req.header('user-agent'));
    return c.json({ ...session, user: userJson(rows[0]), hasData: await hasPlannerData(db, rows[0].id) });
  });

  app.post('/logout', auth, async c => {
    await revokeSession(db, c.get('user').token);
    return c.body(null, 204);
  });

  app.get('/me', auth, async c => {
    const user = c.get('user');
    return c.json({ user: userJson(user), hasData: await hasPlannerData(db, user.userId) });
  });

  // The planner's saved document. PUT requires the version the device last saw (see planner.js).
  app.get('/state', auth, async c => c.json(await getPlannerState(db, c.get('user').userId)));

  app.put('/state', large, auth, async c => c.json(await putPlannerState(db, c.get('user').userId, await json(c))));

  app.get('/export', auth, async c => {
    const user = c.get('user');
    c.header('Content-Disposition', `attachment; filename="hifdh-planner-backup-${new Date().toISOString().slice(0, 10)}.json"`);
    return c.json({ user: userJson(user), exportedAt: new Date().toISOString(), ...(await getPlannerState(db, user.userId)) });
  });

  return app;
}

export function originsFromEnv(value) {
  return String(value ?? '').split(',').map(s => s.trim()).filter(Boolean);
}
