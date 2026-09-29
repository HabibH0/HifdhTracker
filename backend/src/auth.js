import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb);

// scrypt with N=2^15, r=8, p=1: ~32 MiB and tens of milliseconds per hash.
const PARAMS = { N: 32768, r: 8, p: 1 };
const KEY_LEN = 32;
const MAXMEM = 96 * 1024 * 1024;

export const SESSION_DAYS = 180;
export const LIMITS = {
  loginFailuresPerUser: 10,   // per 15 minutes
  loginFailuresPerIp: 50,     // per 15 minutes
  registrationsPerIp: 20,     // per hour
};

export class HttpError extends Error {
  constructor(status, code, message, extra) { super(message); this.status = status; this.code = code; this.extra = extra; }
}

// ---- Usernames & passwords
export function normalizeUsername(raw) {
  if (typeof raw !== 'string') throw new HttpError(400, 'invalid_username', 'Choose a username.');
  const display = raw.normalize('NFKC').trim();
  const norm = display.toLowerCase();
  if (!/^[a-z0-9][a-z0-9_.-]{2,31}$/.test(norm)) throw new HttpError(400, 'invalid_username', 'Usernames are 3–32 letters, numbers, dots, dashes or underscores.');
  return { display, norm };
}

export function checkPassword(password) {
  if (typeof password !== 'string' || password.length < 8) throw new HttpError(400, 'weak_password', 'Use at least 8 characters.');
  if (password.length > 256) throw new HttpError(400, 'invalid_password', 'Passwords are limited to 256 characters.');
  if (/^(.)\1+$/.test(password)) throw new HttpError(400, 'weak_password', 'That password is too easy to guess.');
  return password.normalize('NFKC');
}

export async function hashPassword(password, params = PARAMS) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEY_LEN, { ...params, maxmem: MAXMEM });
  return `scrypt$${params.N}$${params.r}$${params.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, N, r, p, salt, hash] = String(stored).split('$');
  if (scheme !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64');
  const key = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, { N: +N, r: +r, p: +p, maxmem: MAXMEM });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

// Verified against for unknown usernames so both paths take the same time.
let dummyHash;
export async function burnTime(password) {
  dummyHash ??= await hashPassword('not-a-real-password');
  await verifyPassword(password, dummyHash);
}

// ---- Session tokens: 256 random bits handed to the client once; only the hash is stored.
export const newToken = () => randomBytes(32).toString('base64url');
export const tokenHash = token => createHash('sha256').update(token).digest('hex');

export async function createSession(db, userId, userAgent) {
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000);
  await db.query('insert into auth_sessions (user_id, token_hash, user_agent, expires_at) values ($1, $2, $3, $4)', [userId, tokenHash(token), userAgent?.slice(0, 200) ?? null, expiresAt]);
  return { token, expiresAt: expiresAt.toISOString() };
}

/** Resolve a bearer token to its user, sliding the expiry at most once a day. */
export async function authenticate(db, header) {
  const match = /^Bearer ([A-Za-z0-9_-]{20,100})$/.exec(header ?? '');
  if (!match) throw new HttpError(401, 'unauthenticated', 'Sign in to continue.');
  const { rows } = await db.query(
    `select s.id as session_id, s.last_used_at, u.id as user_id, u.username
       from auth_sessions s join users u on u.id = s.user_id
      where s.token_hash = $1 and s.expires_at > now() and u.deleted_at is null`, [tokenHash(match[1])]);
  if (!rows.length) throw new HttpError(401, 'session_expired', 'Your session has ended. Sign in again.');
  const row = rows[0];
  if (Date.now() - new Date(row.last_used_at).getTime() > 86400000) {
    await db.query(`update auth_sessions set last_used_at = now(), expires_at = now() + interval '${SESSION_DAYS} days' where id = $1`, [row.session_id]);
  }
  return { userId: row.user_id, username: row.username, sessionId: row.session_id, token: match[1] };
}

export async function revokeSession(db, token) {
  await db.query('delete from auth_sessions where token_hash = $1', [tokenHash(token)]);
}

// ---- Rate limiting, persisted so it holds across function instances.
export async function assertNotThrottled(db, kind, { usernameNorm, ip }) {
  if (kind === 'login') {
    const { rows } = await db.query(
      `select count(*) filter (where username_norm = $1)::int as by_user, count(*) filter (where ip = $2)::int as by_ip
         from auth_attempts where kind = 'login' and not succeeded and created_at > now() - interval '15 minutes'
          and (username_norm = $1 or ip = $2)`, [usernameNorm, ip]);
    if (rows[0].by_user >= LIMITS.loginFailuresPerUser || rows[0].by_ip >= LIMITS.loginFailuresPerIp) {
      throw new HttpError(429, 'too_many_attempts', 'Too many attempts. Try again in 15 minutes.', { retryAfter: 900 });
    }
  } else {
    const { rows } = await db.query(`select count(*)::int as n from auth_attempts where kind = 'register' and ip = $1 and created_at > now() - interval '1 hour'`, [ip]);
    if (rows[0].n >= LIMITS.registrationsPerIp) throw new HttpError(429, 'too_many_attempts', 'Too many new accounts from this network. Try again later.', { retryAfter: 3600 });
  }
}

export async function recordAttempt(db, kind, { usernameNorm, ip }, succeeded) {
  await db.query('insert into auth_attempts (kind, username_norm, ip, succeeded) values ($1, $2, $3, $4)', [kind, usernameNorm, ip, succeeded]);
  if (Math.random() < 0.02) await db.query(`delete from auth_attempts where created_at < now() - interval '2 days'`);
}
