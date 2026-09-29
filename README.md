# Hifdh Tracker

A mobile-first revision planner for Qur'an hifdh. It schedules revision only — you decide the state of each section.

**Live:** https://habibh0.github.io/HifdhTracker/

## How it works

Each half-juz has two properties: **strength** (weak / strong) and **confidence** (unconfident / confident). That decides which queue it's in:

| State | Queue | Daily default |
| --- | --- | --- |
| Weak | Strengthening — one section at a time, 3-day cycle (relearn → repeat → consolidate) | ½ juz |
| Strong · unconfident | Confidence building — rotates longest-unrevised first | ½ juz |
| Strong · confident | Maintenance — rotates longest-unrevised first | 1 juz |

Lifecycle: `weak → strengthening cycle → strong/unconfident → confidence queue → strong/confident → maintenance`

If a queue is empty, that category is skipped for the day. Cycle length, daily amounts and the confidence check-in threshold are configurable in Settings.

## Accounts and sync

Data is always kept on the device (localStorage), so the app works offline. Signing in
(**Settings → Account**) also saves the planner to your account on Neon and keeps devices in step:

- Changes are saved to the account a moment after you make them, and fetched when the app opens
  or comes back to the foreground.
- The whole planner is one document per account. If two devices changed it before syncing, the
  copy changed most recently wins.
- Signing in on a device that already has its own data asks which copy to keep.
- Sync pauses while **Simulate days** is in use.

Use **Settings → Export backup** to save a copy as a file.

## Files

- `index.html`, `styles.css`, `app.js` — the whole app, no build step
- `serve.py` — local dev server with caching disabled (`python serve.py`, then open http://localhost:5173)
- `backend/` — the API on Neon Functions + Neon Postgres (accounts and saved planner state); see below
- `.github/workflows/deploy-pages.yml` — publishes the app to GitHub Pages on every push to `main`

## Backend

`backend/` is a small [Hono](https://hono.dev) API deployed as a Neon Function (`hifdhapi`).

| Route | Body | Result |
| --- | --- | --- |
| `POST /register` | `{ username, password }` | `201 { token, expiresAt, user, hasData }`; `409` if taken |
| `POST /login` | `{ username, password }` | `{ token, expiresAt, user, hasData }`; `401`; `429` when throttled |
| `POST /logout` | — | `204`, revokes this token |
| `GET /me` | — | `{ user, hasData }` |
| `GET /state` | — | `{ state, version, updatedAt }` (`state: null, version: 0` if nothing saved) |
| `PUT /state` | `{ state, baseVersion, deviceId, updatedAt }` | `{ version, updatedAt }`; `409 { current }` if `baseVersion` is stale |
| `GET /export` | — | The account's saved planner as a download |
| `GET /health` | — | `{ ok: true }` |

Passwords are hashed with scrypt; tokens are random and only their SHA-256 is stored; failed logins
are rate-limited. The browser keeps its token in localStorage. On GitHub Pages every project site
of an account shares the origin `https://<user>.github.io`, so other pages published there could
read it — use a custom domain if that matters.

```sh
cd backend
npm install
npm run dev     # local API on http://localhost:8787 (in-process Postgres); the app uses it when served from localhost
npm test        # auth, planner state and migration tests
```

Deploying (needs `neonctl` signed in):

```sh
cd backend
DATABASE_URL_UNPOOLED="$(npx neonctl connection-string main --project-id <project-id>)" npm run migrate
ALLOWED_ORIGINS=https://habibh0.github.io npx neonctl deploy --project-id <project-id> --branch main --update-existing --no-env-pull
```

Migrations are additive; `001_init.sql` holds the previous app's tables, which are left as they are.
