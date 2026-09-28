# Hifdh — mobile app

Offline-first mobile web app (installable PWA) built around the revision engine in `../src`.
The engine is imported unchanged via the `@engine` alias.

```sh
npm install
npm run dev        # http://localhost:5174 (or via .claude/launch.json → hifdh-app)
npm run build && npm run preview
```

## Mistake logging and regression checks

During a revision, tap **Log mistake**, choose a page, and tap each affected word or āyah.
Each tap adds a marked location; select its mistake type if known. Marks stay selected when
switching pages. Tap a selection to edit it, or use its remove button, then **Save N mistakes**
to add the entire batch to the current recall. Targeted practice also records the batch as one attempt.

Run `npm test` from the repository root for batch persistence and targeted-observation tests.
With the dev server and Mushaf assets available, open `/test/mushaf.html` to run five real-browser
rendering checks, including reopening a cached page, resizing and switching pages. These test
fixtures are not included in the production build.

## Mushaf data

`public/mushaf/` holds the Quran Foundation **QCF V2** (1441H Madinah, 15 lines, 604 pages) data:
one JSON layout and one page font per page, plus the surah-name font. `src/data/quran-meta.json`
holds surah names, page → āyāt, and juz/hizb ownership. All of it was produced by

```sh
npm run fetch-mushaf   # idempotent; re-downloads anything missing
```

which copies glyph codes, line and page positions verbatim from the Quran Foundation API and the
official page fonts from its CDN. No Qur'anic text is generated or typed by hand. Surah headers use
the canonical surah-name font, and the basmalah uses quran.com's basmalah artwork (`src/assets/bismillah.svg`).

Pages are laid out once at a fixed 15-line geometry (`components/MushafPage.jsx`) and scaled as a
whole to the viewport, so lines never reflow. Each page's hizb ownership (needed by the engine for
half-juz scheduling) is the hizb containing most of that page's words.

## Where things live

| Path | Purpose |
| --- | --- |
| `src/lib/store.js` | App state, the local repository and engine, backup/restore |
| `src/lib/syncCore.js` | Local repository, engine bridge and the push/pull loop (pure; tested in `../backend/test`) |
| `src/lib/cloud.js` | Sync scheduling, retries and account actions |
| `src/lib/plan.js` | Turns `generateDailyPlan` into Today's task cards |
| `src/lib/session.js` | Pass → rating → repair → submit logic for every task type |
| `src/lib/stats.js` | Strength, history and weak-point calculations for Mushaf/Progress |
| `src/lib/mushaf.js` | Page/font loading and the background "whole Mushaf offline" download |
| `src/screens/*` | Today, Session, MistakeLogger, Mushaf, Reader, WeakPoints, Progress, Settings, Memorized, History |

## Offline behaviour and sync

- All user data lives in IndexedDB as individual records (engine events, word marks, session
  labels, completed day tasks, settings), each flagged unsynced until the server acknowledges it.
  The engine is rebuilt from the events on launch; only raw events are stored.
- Revision, mistake logging, scheduling and plans never touch the network.
- When an account is signed in (Settings → Account & sync) and `VITE_API_URL` is set, `lib/cloud.js`
  syncs after local changes, when the app regains focus or connectivity, and every 5 minutes.
  Failures back off and retry; the Today header shows the status. See `../backend/README.md`.
- The service worker precaches the app shell. On first run the app copies all 604 page layouts and
  fonts (~100 MB) into the `mushaf-v1` cache in the background; Settings → Mushaf shows progress.
- Backups export/import as JSON from Settings; the cloud export uses the same format.

| Variable | Purpose |
| --- | --- |
| `VITE_API_URL` | Deployed Neon Function URL; empty builds a local-only app |
| `VITE_BASE` | Base path, e.g. `/HifdhTracker/` for a GitHub Pages project site |

Word-level mistake positions are stored alongside the engine (the engine records mistakes per āyah).
Daily reminders can only fire while the app, or its installed window, is running.
