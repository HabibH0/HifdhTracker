# Hifdh revision engine

A deterministic, UI-independent domain engine implementing page memory, half-juz strengthening, early retention checks, targeted ayah repair, and juz maintenance. Users enroll only what they have memorized, including individual ayat or short surahs, and can keep adding material as they learn. No UI, network calls, authentication, notifications, or runtime dependencies.

Requires Node.js 22 or newer. Run the automated suite with:

```sh
npm test
```

## Using the engine

```js
import { RevisionEngine } from './src/index.js';
import { JsonFileStore } from './src/node-store.js';

const engine = new RevisionEngine({
  metadata: verifiedLayoutMetadata,
  initializedAt: '2026-09-27T08:00:00+01:00',
  memorized: { surahs: [112, 113, 114] }, // Only what this user knows.
  config: { timeZone: 'Europe/London' },
  store: new JsonFileStore('./revision-data.json'),
});

const plan = engine.generateDailyPlan('2026-09-27', 'normal');
// { strengthen, dueReviews, targetedWeaknesses, maintenance, dailyReviews,
//   totalEstimatedDurationMinutes, deferredItems, ... }

engine.recordRevision({
  sessionId: 'recall-2026-09-27-morning',
  occurredAt: '2026-09-27T09:00:00+01:00',
  activity: 'memory',
  purpose: 'ordinary',
  actualDurationMinutes: 3,
  pages: [{
    pageId: engine.getMemorizedMaterial().pages[0].pageId,
    accuracy: 'good',
    fluency: 'mostly_fluent',
    mistakes: [],
  }],
});
```

The default store is `MemoryStore`. Supply a persistent store when retaining data across process restarts. An existing store supplies its original metadata and configuration; reopening does not silently change the algorithm.

### Memorized inventory and ongoing additions

No initial strength ratings are required. `memorized` accepts any combination of `surahs` (surah numbers), `juzIds`, `halfJuzIds`, `pageIds`, `ayahIds`, and inclusive `ayahRanges: [{fromAyahId, toAyahId}]`. These resolve through the supplied metadata, and overlapping selections are deduplicated. Omit `memorized`, or supply `{}`, to start with an empty inventory and an empty plan. A hafidh can explicitly select all supplied ajza or pages.

```js
// Add a newly memorized passage without replacing existing material.
engine.addMemorizedMaterial({
  occurredAt: '2026-10-01T09:00:00+01:00',
  selection: { surahs: [111] },
});

// Other examples of selection shapes (use identifiers from your metadata):
// { pageIds: ['page-id'] }
// { ayahRanges: [{ fromAyahId: '2:1', toAyahId: '2:5' }] }

const inventory = engine.getMemorizedMaterial();
// { ayahIds, pages, totalTrackedPages, completePages, partialPages, ... }
```

Known material starts at `config.inventory.defaultInitialStrength`, initially `weak`, and actual reviews establish its strength. Optionally provide one `initialStrength` for a selection, or a sparse `{[pageId]: strength}` map; omitted ratings use the default. This optional override is accepted both at construction and when adding material. It never changes scores for material already enrolled.

Unmemorized pages expose `state: 'not_memorized'`, null memory scores and no due date. They never appear in strengthening, due reviews, upcoming reviews or maintenance. A partially memorized half-juz is strengthened using only its known pages/ayat. Plans include `passage.pages`, each with exact `ayahIds`, `scope`, and `coverage`, so a consumer must not interpret the half-juz or juz label as a request to recite unknown material. Targeted context and random-start locations also stay within known ayat; context stops at unknown gaps.

Additions persist as raw events and are idempotent. Adding a different page leaves existing scores, dates, cycle progress and history intact. New material's risk clock starts at enrollment, rather than at the user's original onboarding date. Expanding an already tracked page resets its current memory estimate, recall clock and spaced-success count for the larger scope, while preserving every earlier session and mistake. If that page is in an active cycle, the cycle returns to Stage 1; if it is awaiting retention checks, the expanded page leaves that old retention group. Other pages retain their evidence. This prevents newly learned ayat from inheriting strength earned by a shorter passage.

Existing saved logs created before inventory support retain their original fully tracked pages when reopened or replayed. New engine instances default to an empty inventory, even when an optional strength rating is provided.

### Metadata contract

Supply authoritative metadata for the selected mushaf layout; no production Qur'an dataset is bundled. The tests use explicitly synthetic metadata. Page IDs are opaque identifiers, never interpreted as passage numbers.

```js
{
  layoutId: 'your-verified-layout-id',
  ayat: [
    { id: 'surah:ayah', surah: 1, ayah: 1 },
    // ...ordered in Qur'an recitation order
  ],
  pages: [
    { id: 'opaque-page-id', halfJuzId: 'half-juz-id', juzId: 'juz-id',
      ayahIds: ['surah:ayah' /* ...all ayat contained on this page */] },
  ],
}
```

Each page has explicit half-juz/juz ownership and contained ayat. An ayah may appear on multiple pages when a layout splits it. Metadata describes the layout, independently of what the user knows: supply the complete supported layout so users can add more material later and surah/juz selectors resolve completely. For layouts whose page boundaries cross a half-juz boundary, the metadata provider must supply the canonical scheduling ownership; this engine does not infer it. Layout changes need an explicit history/state migration rather than reusing page IDs from another layout.

### Revision input

`activity` is `listening`, `reading`, `memory`, `tested`, or `random_start`. The first two are passive. Active attempts require both `accuracy` (`failed`, `difficult`, `good`, `perfect`) and `fluency` (`hesitant`, `mostly_fluent`, `automatic`). Passive attempts require fluency but do not produce recall quality or change stability.

`pages` is an ordered list of attempts. Repeated attempts in one sitting use the **same session**, with repeated page entries. Use a new `sessionId` for a distinct session, not for each repetition. This distinction matters for troublesome-ayah detection. An attempt can override the session's activity.

The default scope is `'page'` for a fully memorized page, or `'memorized'` for a partially memorized page. Both attest to recall of **all enrolled ayat on that page** and update stability for that exact scope. A partial page cannot be submitted as a full-page recall. For narrower targeted practice, supply `scope: 'ayah'` and `ayahIds`; these update fluency and mistake evidence but do not reset the complete-portion recall clock, grow its stability, or increment its spaced-success count. Unknown ayat are rejected. Supplying the plan's explicit `ayahIds` also catches stale prescriptions after an inventory expansion. Random-start tests earn their 1.20 weight only when they cover the entire currently memorized portion; use ayah scope for shorter tests.

Optional mistakes have `{ ayahId, count, type, confusedWithAyahId, major }`. A missing ayah location remains a page weakness; the engine does not invent a location. Supported mistake types are exported as `MISTAKE_TYPES`. Inline mistakes are preferable. `recordMistake` attaches an additional mistake to an ordinary revision session; strengthening mistakes must be supplied inline, before progression is evaluated.

`purpose` is `ordinary`, `targeted`, `maintenance`, or `early_retention`. Retention checks are recognized from coverage and the mandatory due date regardless of purpose. Mark maintenance sessions with `purpose: 'maintenance'` so juz rotation records completion.

### Strengthening sessions

Planning does not mutate state. When there is no active cycle, it chooses the weakest eligible section and returns `requiresStart: true`. A consumer can call `startStrengtheningCycle`, or submit `recordStrengtheningSession` directly to start that recommended section. The user does not need to choose what to revise.

```js
const item = plan.strengthen[0];
const pageResults = item.pageIds.map(pageId => ({
  pageId, accuracy: 'perfect', fluency: 'automatic',
}));

engine.recordStrengtheningSession({
  sessionId: 'strengthening-day-1',
  occurredAt: '2026-09-27T10:00:00+01:00',
  halfJuzId: item.halfJuzId,
  actualDurationMinutes: 32,
  steps: [
    { kind: 'pass', reviews: pageResults },
    // Insert real targeted attempts here when the first pass had problems.
    // { kind: 'targeted', reviews: [...] },
    { kind: 'pass', reviews: pageResults },
  ],
});
```

Submit actual observations, not a copy of the prescribed work. Both complete passes of the prescribed **memorized portion** are required to pass a stage. Incomplete sessions are retained and return failure reasons without advancing the stage. Stage 1 requires targeted repair between the first and second passes when the first pass had problems; subsequent problems must also be repaired. Maximum targeted repetitions are counted per page across the entire session, including ayah attempts. Stage 2 requires targeted practice for errors/hesitation and at least 70% fluent pages. Stage 3 requires 80% automatic pages and all remaining pages at least mostly fluent. Stage checks use the latest complete-portion accuracy/fluency observations, with unresolved mistake locations checked separately.

Stages 2 and 3 require a later **calendar day**, not necessarily exactly 24 hours. Missed days preserve progress. Graduation resets post-cycle spaced-success evidence and marks pages recently strengthened. Retention checks occur after 2 days, then 4 days after a successful check, then 7 days after the next success. A check must cover the current retention group in one active session. Early/partial practice cannot skip a mandatory gap. A moderately unsuccessful check is retried the next day; a badly failed check starts repair for affected pages, or the whole section at the deterioration threshold. Other damaged sections queue for repair while one cycle is active.

## Public operations

| Operation | Result / purpose |
| --- | --- |
| `getMemorizedMaterial()` | Exact enrolled ayat and complete/partial page coverage. |
| `addMemorizedMaterial({selection, occurredAt, initialStrength?})` | Adds newly learned material, preserving existing history. |
| `recordRevision(input)` | Persists raw attempts, scores the session and assesses regression/retention. |
| `recordMistake(input)` | Logs an ayah/page error against an existing ordinary session. |
| `startStrengtheningCycle({halfJuzId, occurredAt, pageIds?})` | Starts a section, optionally a subset for local repair. |
| `recordStrengtheningSession(input)` | Records ordered passes/targets and returns progression reasons. |
| `getStrengtheningState(halfJuzId?)` | Active cycle, cycle history, retention schedules and queued repairs. |
| `getPageState(pageId, date?)` | Memory values, evidence-based state, full revision and mistake histories. |
| `getHalfJuzState(halfJuzId, date?)` | Lower-quartile stability and weakest pages in ascending strength order. |
| `getForgettingRisk(pageId, date)` | Dynamic risk, interpretation and interpretable priority score. |
| `getDueReviews(date)` | Current due pages, reasons and priorities; no stored missed-card queue. |
| `getTroublesomeAyat(date?, {includeResolved?}?)` | Active targets and their clean-session progress. |
| `getConfusionLinks()` | Undirected ayah links, confusion counts and most recent date. |
| `selectNextStrengthening(date)` | Next eligible section, or null while a cycle remains active. |
| `generateDailyPlan(date, capacity)` | Structured, capacity-limited plan and explicit deferral reasons. |
| `getRevisionHistory({pageId?, sessionId?}?)` | Complete sessions, attempts, mistakes and actual durations. |
| `getUpcomingReviews(date, {days?}?)` | Current scheduled dates within a horizon, including overdue entries. |
| `exportData()` | Portable event log, layout, configuration and calculated snapshot. |
| `RevisionEngine.replay(document, {config?, store?}?)` | Recalculates raw history, optionally under tuned constants. |

## Deterministic policy details

All scheduling constants are in [`src/config.js`](src/config.js). Defaults implement the supplied formulas, thresholds, multipliers, capacities, and early-retention gaps. The following resolve details not specified numerically:

- Dates use an explicit IANA time zone, defaulting to UTC. Inputs require an explicit timestamp offset, or a date-only value interpreted as local midnight. A date-only query on the latest recorded day includes that day's recorded observations. Writes must be chronological. Historical queries require replaying an event prefix.
- Before the first active recall, that page's enrollment time is the provisional risk anchor; the engine does not fabricate a previous recall. Optional initial strength labels are estimates, not earned `strong`/`very_strong` states.
- A spaced success needs quality at least 0.72, the first complete-portion active recall that day, and an elapsed gap of at least one day. A failed complete recall resets the streak. Graduation starts a fresh post-strengthening streak.
- The first complete recall of the enrolled scope each calendar day uses the specified stability formula. All later positive gains combined are limited to 5% of the stability immediately after that first recall. Failures still apply their reductions and never replenish the positive-growth budget. Passive and narrower targeted recalls cannot consume or reset that evidence allowance.
- Failed fluency is the specified weighted update followed by the 20% reduction. Ordinary unsuccessful recalls and isolated mistakes get a one-day repair interval. Recent failures count distinct failed/difficult sessions over 30 days.
- The half-juz percentile uses linear interpolation over enrolled pages only. Its weakest pages remain visible even when the 25th percentile does not capture a single outlier. A half-juz's known portion is never labeled strong unless every enrolled page meets evidence-based strong criteria. `coverage` and `strengthScope` distinguish this from a fully memorized half-juz. Deterioration percentages also use enrolled pages as the denominator.
- A troublesome ayah requires the specified repeated-session evidence. Sessions that did not cover that ayah are ignored. Passive practice cannot clear it; three clean active sessions are required, and a mistake within a session prevents that session from counting as clean. Targets do not disappear merely because time passed.
- Random access uses a stable hash of layout, calendar date, and page ID, giving approximately 10% of eligible opportunities. No random generator, clock read, or network response affects a plan. Starting ayat come from the supplied metadata or reported confusion links.

## Capacity, priorities and deferrals

Daily capacities are 30/60/90/120 minutes for `light`/`normal`/`full`/`intensive`, or pass a numeric number of minutes. Time estimates default to 1.5 minutes per active page, 0.75 per targeted page, 0.5 per targeted ayah, plus 0.25 for a random-start test. Partial-page duration estimates scale by the proportion of contained ayat enrolled, with a configurable 0.25-minute minimum capped at the full-page estimate. Ayah counts are an estimate of workload, not a claim that all ayat have equal length. Actual session durations are saved; no automatic personalization is assumed yet.

The planner reserves active-cycle work, mandatory early checks, overdue/high-risk pages, ordinary due pages, targeted weaknesses, and maintenance in that order. When starting an optional new cycle, mandatory early checks are reserved first. Within due groups it sorts by the requested risk/weakness/failure/recent-strengthening priority. Planning is pure and repeatable; completion, not viewing a plan, advances rotation.

The remaining capacity also supports a **daily review alongside relearning**, including developing material whose spaced review is not yet due. `dailyReview.targetMinutes` defaults to 30 minutes of review workload per day (set to 0 to disable this additional rotation). Due reviews, early checks, maintenance, and already completed ordinary review count toward this target; strengthening and targeted practice do not. Completed review counts by estimated coverage so a faster recitation does not continually create extra tasks. Actual durations still determine remaining daily capacity.

The `dailyReviews` array selects never-reviewed material first, then material with the oldest active recall, using enrollment date, risk, due date and metadata order to break ties. It excludes current strengthening work, pending retention groups, already selected work, unmemorized material, and pages recalled that day. Mandatory retention gaps remain unchanged. This is preventive rotation, so these items are not reported as overdue and do not alter due dates until actually reviewed. The app displays them as **Daily review** and records them as ordinary active recall. If every known page belongs to the current cycle, or protected work consumes the available time, no additional review is invented.

Completed work on the requested day subtracts its actual duration, or its estimate if actual duration was omitted, from the available capacity. A normal day targets approximately one juz of maintenance, with fair rotation, recency and risk tie-breakers; due/selected pages are excluded. Only known material participates, so someone who knows less than a juz receives a smaller maintenance selection. Partial strong sections contribute toward the target by their estimated memorized page fraction.

A complete strengthening session or mandatory retention group is not silently split into an easier passing test. If it cannot fit, the output explicitly defers it. In particular, a large half-juz may require more than the light preset at the default estimates. Protected or urgent deferrals have `safeToPostpone: false`; increasing the available session time or tuning realistic duration estimates is needed in that case. Other deferrals explain why higher-priority work was chosen, without guaranteeing no forgetting. No missed daily copies are ever accumulated.

## Persistence and integration

Domain modules use only standard JavaScript. The optional Node-specific JSON adapter is separate. A custom store implements synchronous `load()` and atomic `save(document, expectedVersion)`; optimistic version checks reject stale writers and failed saves roll back the engine's in-memory change. Browser/mobile integrations can supply their own adapter or wrap the synchronous domain operations in their persistence layer.

The JSON adapter persists events **and** a calculated snapshot through a flushed temporary file and atomic rename, with a lock file to prevent concurrent writes. If a process crashes while holding the lock, inspect and remove a stale `.lock` before reopening for writes; automatic lock stealing is intentionally absent. It is a small local-store adapter, not a database service.

On reopen, the engine recomputes the snapshot from raw events rather than trusting cached scores. Event records carry explicit dates and stable session/event identifiers. Keep these files private and back them up as application data. To tune an algorithm, replay into a separate store, compare the resulting plans, and then explicitly adopt the recalculation.

## Tests

The suite covers every requested behavior plus empty and partial inventories, one-ayah strengthening/retention, ongoing additions, coverage expansion, legacy replay, partial-page evidence, intra-session repetitions, calendar boundaries/DST, unsuccessful early checks, delayed retention gaps, grouped deterioration, duration accounting, deterministic random access, raw-event replay, file persistence, stale-write rejection and atomic validation failures.
