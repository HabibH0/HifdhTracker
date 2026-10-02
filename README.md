# Hifdh Tracker

A mobile-first revision planner for Qur'an hifdh. It schedules revision only — you decide the state of each section.

**Live:** https://habibh0.github.io/HifdhTracker/

## How it works

Each half-juz has two properties: **strength** (weak / strong) and **confidence** (unconfident / confident). That decides which queue it's in:

| State | Queue | Daily default |
| --- | --- | --- |
| Weak | Strengthening — one section at a time, 3-day cycle (relearn → repeat → consolidate) | ½ juz |
| Strong · unconfident | Confidence building — growing gaps, most overdue first | ½ juz |
| Strong · confident | Maintenance — weighted rotation | 1 juz |

Lifecycle: `weak → strengthening cycle → strong/unconfident → confidence queue → strong/confident → maintenance`

**Confidence building.** After its strengthening cycle a section comes back after gaps of 1, 2, 3, 5, 7,
10 and 14 days. The daily amount is fixed: if more are due than fit, the most overdue (relative to its
gap) go first and the rest wait. Late revisions move on to the next gap as normal, and an extra
recitation you log counts as the next step. Once a section holds up over the 14-day gap you're asked if
it's confident; "keep practising" asks again after another 14-day gap.

**Maintenance.** Sections aim for a share of the average gap (number of confident sections ÷ daily
amount): 0.6× for their first 30 days as confident, 1× up to 90 days, 1.3× after that (and for anything
marked confident at setup). No section goes longer than 1.5× the average.

**Waiting weak sections.** Every 3 days, an optional "Keep warm" read of whichever waiting weak section
has gone longest untouched, on top of the normal amount.

**Spare capacity.** When there's nothing to strengthen, the weak slot goes to confidence building: the
next most overdue section, or one due within two days (never one waiting out its check-in gap). If
nothing in confidence building is due, that slot is skipped for the day.

**Forest.** Hifdh → Forest shows a woodland of 30 trees, one per juz (juz 1 at the back left, 30 at the
front right; tap a tree to see which juz it is). Species vary — oak, pine, cypress, date palm, olive and
birch. Each grows from the planner's state rather than a count of recitations: weak halves are seedlings, unconfident ones young trees (growing along their gaps), and
confident ones mature trees, fully grown once each half has been maintained 3 times as confident. A tree
left well past its planned revision drops some leaves (never more than about half) and revising brings
them back.

Cycle length, daily amounts, the check-in gap, the keep-warm interval and the longest confident gap are
configurable in Settings. The forecast and projected dates come from running these rules forward.

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
