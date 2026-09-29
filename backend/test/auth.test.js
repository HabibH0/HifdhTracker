import test from 'node:test';
import assert from 'node:assert/strict';
import { testServer, register, ORIGIN } from './helpers.js';
import { hashPassword, verifyPassword, tokenHash } from '../src/auth.js';

test('authentication', async t => {
  const s = await testServer();
  t.after(() => s.close());

  await t.test('passwords are stored only as salted scrypt hashes', async () => {
    const a = await hashPassword('same password'), b = await hashPassword('same password');
    assert.match(a, /^scrypt\$32768\$8\$1\$/);
    assert.notEqual(a, b, 'salted');
    assert.ok(await verifyPassword('same password', a));
    assert.ok(!(await verifyPassword('same passworD', a)));
  });

  await t.test('register returns a session token and never stores the password or token', async () => {
    const res = await s.call('POST', '/register', { body: { username: 'Aisha.M', password: 'correct horse battery' } });
    assert.equal(res.status, 201);
    assert.equal(res.body.user.username, 'Aisha.M');
    assert.match(res.body.token, /^[A-Za-z0-9_-]{43}$/);
    const { rows: [user] } = await s.db.query("select * from users where username_norm = 'aisha.m'");
    assert.ok(!JSON.stringify(user).includes('correct horse'));
    assert.match(user.password_hash, /^scrypt\$/);
    const { rows: sessions } = await s.db.query('select token_hash from auth_sessions');
    assert.equal(sessions[0].token_hash, tokenHash(res.body.token));
    assert.ok(!JSON.stringify(sessions).includes(res.body.token));
  });

  await t.test('usernames are unique case-insensitively and validated', async () => {
    assert.equal((await s.call('POST', '/register', { body: { username: 'aisha.m', password: 'another password' } })).status, 409);
    assert.equal((await s.call('POST', '/register', { body: { username: 'a', password: 'another password' } })).status, 400);
    assert.equal((await s.call('POST', '/register', { body: { username: 'has space', password: 'another password' } })).status, 400);
    assert.equal((await s.call('POST', '/register', { body: { username: 'yusuf', password: 'short' } })).status, 400);
  });

  await t.test('login accepts the right password only, with one generic error', async () => {
    const wrong = await s.call('POST', '/login', { body: { username: 'AISHA.M', password: 'wrong password!' } });
    const unknown = await s.call('POST', '/login', { body: { username: 'nobody', password: 'wrong password!' } });
    assert.equal(wrong.status, 401);
    assert.deepEqual(wrong.body, unknown.body, 'no username enumeration');
    const ok = await s.call('POST', '/login', { body: { username: 'AISHA.M', password: 'correct horse battery' } });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.hasData, false);
    const me = await s.call('GET', '/me', { token: ok.body.token });
    assert.equal(me.status, 200);
    assert.equal(me.body.user.username, 'Aisha.M');
  });

  await t.test('protected routes reject missing or forged tokens', async () => {
    assert.equal((await s.call('GET', '/state')).status, 401);
    assert.equal((await s.call('GET', '/export', { token: 'x'.repeat(43) })).status, 401);
    assert.equal((await s.call('GET', '/me', { headers: { authorization: 'Basic abc' } })).status, 401);
  });

  await t.test('logout revokes only that session', async () => {
    const a = await s.call('POST', '/login', { body: { username: 'aisha.m', password: 'correct horse battery' } });
    const b = await s.call('POST', '/login', { body: { username: 'aisha.m', password: 'correct horse battery' } });
    assert.equal((await s.call('POST', '/logout', { token: a.body.token })).status, 204);
    assert.equal((await s.call('GET', '/me', { token: a.body.token })).status, 401);
    assert.equal((await s.call('GET', '/me', { token: b.body.token })).status, 200);
  });

  await t.test('expired sessions are rejected', async () => {
    const { token } = await register(s.call, 'expiring', 'correct horse battery');
    await s.db.query("update auth_sessions set expires_at = now() - interval '1 second' where token_hash = $1", [tokenHash(token)]);
    const res = await s.call('GET', '/me', { token });
    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'session_expired');
  });

  await t.test('repeated failed logins are throttled', async () => {
    await register(s.call, 'target', 'correct horse battery');
    for (let i = 0; i < 10; i++) assert.equal((await s.call('POST', '/login', { body: { username: 'target', password: `guess number ${i}` } })).status, 401);
    const blocked = await s.call('POST', '/login', { body: { username: 'target', password: 'correct horse battery' } });
    assert.equal(blocked.status, 429);
    assert.equal(blocked.headers.get('retry-after'), '900');
  });

  await t.test('CORS: allow-listed origins only', async () => {
    const pre = await s.app.request('/state', { method: 'OPTIONS', headers: { origin: ORIGIN, 'access-control-request-method': 'PUT' } });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get('access-control-allow-origin'), ORIGIN);
    const evil = await s.app.request('/state', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } });
    assert.equal(evil.status, 403);
    const blocked = await s.call('POST', '/login', { origin: 'https://evil.example', body: { username: 'aisha.m', password: 'correct horse battery' } });
    assert.equal(blocked.status, 403);
    const fine = await s.call('GET', '/health', { origin: ORIGIN });
    assert.equal(fine.headers.get('access-control-allow-origin'), ORIGIN);
    assert.equal(fine.headers.get('cache-control'), 'no-store');
  });

  await t.test('malformed bodies get a 400, not a crash', async () => {
    assert.equal((await s.call('POST', '/login', { body: '{not json' })).status, 400);
    const { token } = await register(s.call, 'malformed', 'correct horse battery');
    assert.equal((await s.call('PUT', '/state', { token, body: { baseVersion: 0 } })).status, 400);
    assert.equal((await s.call('PUT', '/state', { token, body: { state: { sections: {} }, baseVersion: 0 } })).status, 400);
    assert.equal((await s.call('PUT', '/state', { token, body: { state: { sections: {}, settings: {} }, baseVersion: -1 } })).status, 400);
  });
});
