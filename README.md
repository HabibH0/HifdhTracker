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

Data is stored in the browser on the device (localStorage). Use **Settings → Export backup** to save a copy.

## Files

- `index.html`, `styles.css`, `app.js` — the whole app, no build step
- `serve.py` — local dev server with caching disabled (`python serve.py`, then open http://localhost:5173)
- `.github/workflows/deploy-pages.yml` — publishes the app to GitHub Pages on every push to `main`
