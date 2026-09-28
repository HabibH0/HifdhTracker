# Hifdh backend — Neon Functions + Neon Postgres

A small API that stores accounts and syncs the app's offline data to Postgres. The app never
depends on it: revision, mistake logging, scheduling and plans all run on the device, and
sync catches up whenever a connection is available.

## Layout

| Path | Purpose |
| --- | --- |
| `functions/api.js` | Neon Function entry (`pg` pool + `attachDatabasePool`, `waitUntil`) |
| `neon.ts` | Neon config: one function, slug `hifdhapi` |
| `src/app.js` | Hono routes, CORS allowlist, error handling |
| `src/auth.js` | scrypt password hashes, hashed bearer tokens, persisted rate limits |
| `src/sync.js` | Push/pull sync, validation, last-writer-wins, export |
| `src/projections.js` | Replays events through the revision engine to fill read-model tables |
| `migrations/*.sql` | Schema, applied in order by `npm run migrate` |
| `scripts/dev-server.js` | Local API on :8787 using PGlite (or `DATABASE_URL`) |
| `../shared/` | ID generation and the deterministic event merge, shared with the app |

## API

All responses are JSON with `Cache-Control: no-store`. Authenticated routes take
`Authorization: Bearer <token>`.

| Route | Body | Result |
| --- | --- | --- |
| `POST /register` | `{ username, password }` | `201 { token, expiresAt, user, hasData }`; `409` if taken |
| `POST /login` | `{ username, password }` | `{ token, expiresAt, user, hasData }`; `401` generic error; `429` when throttled |
| `POST /logout` | — | `204`, revokes this token |
| `GET /me` | — | `{ user, hasData }` |
| `POST /sync` | `{ cursor, deviceId, changes: { events, wordMarks, sessionMeta, dayTasks, settings } }` | `{ acked, overrides, changes, cursor, hasMore, serverTime }` |
| `GET /export` | — | Full account backup (importable in the app via Settings → Restore) |
| `GET /health` | — | `{ ok: true }` |

Usernames: 3–32 characters (letters, digits, `.`, `-`, `_`), case-insensitive. Passwords: 8–256
characters. No email is collected; there is no password reset.

## Data model and sync

- **`revision_events`** is the source of truth: the engine's raw events, each with a stable
  client-generated, time-ordered ID. Events are immutable, so re-sending one is a no-op.
- **`word_marks`, `session_labels`, `day_tasks`, `settings`** are mutable records resolved
  last-writer-wins on `(updatedAt, deviceId)`. Deletions are tombstones (`deleted_at`).
  When the server's copy wins, it is returned in `overrides`.
- **`memorized_material`, `page_states`, `strengthening_cycles`, `revision_sessions`,
  `mistakes`** are projections. After new events arrive, the server replays the user's log
  through the same, unchanged revision engine and deterministic merge (`shared/merge.js`) the
  app uses, then bulk-upserts the results.
- Every row has `created_at`, `updated_at` and, where records can disappear, `deleted_at`.
- Each write gets a `server_seq` from one sequence. A per-user advisory lock serializes a
  user's sync writes, so pulling "everything after my cursor" never skips a row.

Merging devices that were both offline is deterministic. Events are ordered by
`(occurredAt, id)`; content duplicates (e.g. a re-imported backup) are dropped; a second
device's `initialized` event becomes "memorized material added". Any event the engine
cannot apply after the merge is set aside identically on every replica and reported as a
conflict, instead of breaking replay.

## Local development

```sh
npm install
npm run dev          # http://localhost:8787, PGlite data in ./.pglite, migrations applied on start
npm test             # auth, sync and migration tests against in-memory Postgres
```

In `../app`, `.env.development.local` points the app at `http://localhost:8787`.
`ALLOWED_ORIGINS` in `.env` controls which local origins may call the API.

## Deploying to Neon

1. `npx neonctl auth` (browser sign-in), then `npx neonctl link` in this folder to choose or create
   the project. This writes `.neon` and pulls `DATABASE_URL`/`DATABASE_URL_UNPOOLED` into `.env`.
   Pick a region where Functions are available (Ohio, N. Virginia, Frankfurt or Singapore).
2. `npm run migrate` applies the schema.
3. `ALLOWED_ORIGINS=https://<github-user>.github.io npx neonctl deploy` bundles and deploys the
   function. `npx neonctl functions get hifdhapi` prints its URL.
4. Set that URL as the repository variable `VITE_API_URL` so the GitHub Pages build uses it.

For CI deploys (`.github/workflows/deploy-api.yml`), add the repository secrets `NEON_API_KEY` and
`DATABASE_URL_UNPOOLED`, and the variables `NEON_PROJECT_ID`, `ALLOWED_ORIGINS` and optionally
`NEON_BRANCH`.

## Security notes

- Passwords are hashed with scrypt (N=2^15, r=8, p=1, 16-byte salt). Tokens are 256-bit random
  values; only their SHA-256 is stored. Sessions last 180 days, sliding, and logout revokes them.
- Unknown usernames take the same time to reject as wrong passwords, and both return one error.
- Failed logins are limited to 10 per username and 50 per IP address per 15 minutes; sign-ups
  to 20 per IP address per hour. The IP comes from `X-Forwarded-For`.
- The database URL exists only in the function's environment. Browsers get CORS access only from
  `ALLOWED_ORIGINS`.
- The app keeps its token in IndexedDB. On GitHub Pages, all of an account's project sites share
  the origin `https://<user>.github.io`, so other pages you publish there could read it. Use a
  custom domain for the app if you host other projects on the same GitHub account.
