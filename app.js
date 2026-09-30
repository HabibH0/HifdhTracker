'use strict';

/* =========================================================================
   Hifdh revision planner
   Each half-juz (60 sections) has: memorised?, strength, confidence.
   Category (which queue it lives in) is derived:
     weak                   -> strengthening queue (one at a time, N-day cycle)
     strong + unconfident   -> confidence queue   (rotating, ~½ juz/day)
     strong + confident     -> maintenance        (oldest first, ~1 juz/day)
   ========================================================================= */

const STORAGE_KEY = 'hifdh-planner.v1';

const JUZ_NAMES = [
  'Alif Lam Mim', 'Sayaqul', 'Tilka ar-Rusul', 'Lan Tanalu', 'Wal-Muhsanat',
  'La Yuhibbullah', 'Wa Idha Sami‘u', 'Wa Law Annana', 'Qalal-Mala', 'Wa‘lamu',
  'Ya‘tadhirun', 'Wa Ma Min Dabbah', 'Wa Ma Ubarri’u', 'Rubama', 'Subhanalladhi',
  'Qal Alam', 'Iqtaraba', 'Qad Aflaha', 'Wa Qalalladhina', 'Amman Khalaq',
  'Utlu Ma Uhiya', 'Wa Man Yaqnut', 'Wa Mali', 'Fa Man Azlam', 'Ilayhi Yuradd',
  'Ha Mim', 'Qala Fa Ma Khatbukum', 'Qad Sami‘ Allah', 'Tabarakalladhi', '‘Amma',
];

const DEFAULT_SETTINGS = {
  cycleLength: 3,     // days in a strengthening cycle
  weakPerDay: 1,      // half-juz of weak material per day (one section at a time)
  confPerDay: 1,      // half-juz from the confidence queue per day
  maintPerDay: 2,     // half-juz from maintenance per day
  promoteAfter: 7,    // confidence revisions before suggesting "confident"
  dayOffset: 0,       // preview tool: pretend it's N days later
};

const CYCLE_GUIDE = [
  { t: 'Relearn', d: 'Get comfortable reciting it again.' },
  { t: 'Repeat', d: 'Build fluency — fewer pauses, smoother flow.' },
  { t: 'Consolidate', d: 'Keep at it until it feels strong and dependable.' },
];

/* ---------- Icons ---------- */
const I = {
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  chev: '<svg class="chev" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="M6 15l6-6 6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  redo: '<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4h4"/></svg>',
  swap: '<svg viewBox="0 0 24 24"><path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3"/></svg>',
  shield: '<svg viewBox="0 0 24 24"><path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/></svg>',
  moon: '<svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>',
  flag: '<svg viewBox="0 0 24 24"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></svg>',
  arrowTop: '<svg viewBox="0 0 24 24"><path d="M5 4h14M12 20V9M7 13l5-5 5 5"/></svg>',
};

/* ---------- State ---------- */
let state = null;                              // loaded at startup (bottom of file), once every helper exists
let ui = {
  tab: 'today', queueTab: 'weak', hifdhView: 'map', selecting: false, selected: new Set(),
  logSel: new Set(), logDate: null, logEarlier: false, barSel: null, chartRange: 14, theme: 'system', justDone: null,
};
try {
  ui.tab = localStorage.getItem(STORAGE_KEY + '.tab') || 'today';
  ui.theme = localStorage.getItem(STORAGE_KEY + '.theme') || 'system';
} catch (e) {}

const TABS = ['today', 'queues', 'map', 'settings'];
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const EASE = 'cubic-bezier(.2,.8,.2,1)';

function freshState() {
  const sections = {};
  for (let id = 1; id <= 60; id++) {
    sections[id] = {
      id, memorised: false, strength: 'weak', confidence: 'unconfident',
      cycleDone: 0, extraDays: 0, confRevs: 0,
      lastRevised: null, revisionCount: 0, enteredAt: 0, tie: Math.random(),
    };
  }
  return {
    settings: { ...DEFAULT_SETTINGS }, sections, weakQueue: [], plan: null,
    log: [],                                  // every recitation: { d: 'YYYY-MM-DD', s: sectionId, k: 'plan' | 'extra' }
    counters: { cycles: 0, promotions: 0 },
    journeys: [],                             // weak → confident: { s, from, to } dates
  };
}

/** Fill in fields added after a state was first saved (older devices, account copies). */
function upgrade(s) {
  s.settings = { ...DEFAULT_SETTINGS, ...s.settings };
  s.counters = { cycles: 0, promotions: 0, ...s.counters };
  if (!Array.isArray(s.journeys)) s.journeys = [];
  for (const sec of Object.values(s.sections)) {
    if (typeof sec.tie !== 'number') sec.tie = Math.random();
    // Sections already weak before journeys were tracked: start from when they entered the queue.
    if (sec.memorised && sec.strength === 'weak' && !sec.weakSince) {
      sec.weakSince = sec.enteredAt > 1e12 ? iso(new Date(sec.enteredAt)) : iso(new Date());
    }
  }
  if (!Array.isArray(s.log)) {
    // No history yet: seed one entry per section from its last revision so stats start sensibly.
    s.log = Object.values(s.sections)
      .filter(sec => sec.memorised && sec.lastRevised)
      .map(sec => ({ d: sec.lastRevised, s: sec.id, k: 'plan' }))
      .sort((a, b) => a.d.localeCompare(b.d));
  }
  return s;
}

function load() {
  let raw = null;
  try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
  if (!raw) return freshState();
  try {
    return upgrade(JSON.parse(raw));
  } catch (e) {
    // Never silently drop saved data: keep the unreadable copy aside before starting fresh.
    console.error('Could not load saved planner', e);
    try { localStorage.setItem(`${STORAGE_KEY}.recovery.${Date.now()}`, raw); } catch (err) {}
    return freshState();
  }
}

const hasPlannerData = st => !!st && Object.values(st.sections || {}).some(s => s.memorised);

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
}

/* ---------- Dates ---------- */
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
const diffDays = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);
function today() { const d = new Date(); d.setDate(d.getDate() + state.settings.dayOffset); return iso(d); }

function relDay(s) {
  if (!s) return '—';
  const n = diffDays(today(), s);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  if (n > 1 && n < 7) return parse(s).toLocaleDateString('en-GB', { weekday: 'long' });
  return parse(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
/** "Today", "Yesterday" or "28 Sept" — for past dates. */
function dayLabel(s) {
  const n = diffDays(s, today());
  if (n === 0) return 'Today';
  if (n === 1) return 'Yesterday';
  return parse(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
function agoDay(s) {
  if (!s) return 'Never';
  const n = diffDays(s, today());
  if (n <= 0) return 'Today';
  if (n === 1) return 'Yesterday';
  return `${n} days ago`;
}

/* ---------- Sections ---------- */
const juzOf = id => Math.ceil(id / 2);
const halfOf = id => (id % 2 === 1 ? 1 : 2);
function pages(id) {
  const j = juzOf(id);
  const start = j === 1 ? 1 : 22 + (j - 2) * 20;
  const end = j === 30 ? 604 : j === 1 ? 21 : start + 19;
  const mid = start + Math.floor((end - start + 1) / 2);
  return halfOf(id) === 1 ? [start, mid - 1] : [mid, end];
}
const title = id => `Juz ${juzOf(id)} · ${halfOf(id) === 1 ? '1st' : '2nd'} half`;
const subtitle = id => { const [a, b] = pages(id); return `${JUZ_NAMES[juzOf(id) - 1]} · pp. ${a}–${b}`; };

function cat(s) {
  if (!s.memorised) return 'none';
  if (s.strength === 'weak') return 'weak';
  return s.confidence === 'confident' ? 'maint' : 'conf';
}
const CAT_NAME = { weak: 'Weak', conf: 'Strong · unconfident', maint: 'Strong · confident', none: 'Not memorised' };
const sections = () => Object.values(state.sections);
const inCat = c => sections().filter(s => cat(s) === c);
const cycleTarget = s => state.settings.cycleLength + (s.extraDays || 0);

/**
 * Rotation order for confidence / maintenance: longest-unrevised first. Ties are broken by each
 * section's random `tie`, which is redrawn whenever it's revised, so equal sections come up in
 * a fresh random order each time round (but the order doesn't jump between renders).
 */
function rotation(c) {
  return inCat(c).sort((a, b) => (a.lastRevised || '').localeCompare(b.lastRevised || '') || a.tie - b.tie);
}

function normalize() {
  const weakIds = new Set(inCat('weak').map(s => s.id));
  state.weakQueue = state.weakQueue.filter(id => weakIds.has(id));
  // Sections newly marked weak together join the queue in random order.
  for (const s of inCat('weak').sort((a, b) => a.tie - b.tie)) {
    if (!state.weakQueue.includes(s.id)) state.weakQueue.push(s.id);
  }
}

/** Apply a classification change; moving category moves the section between queues. */
function classify(id, patch) {
  const s = state.sections[id];
  const before = cat(s);
  Object.assign(s, patch);
  const after = cat(s);
  if (before !== after) {
    s.enteredAt = Date.now();
    s.tie = Math.random();
    if (after === 'conf') s.confRevs = 0;
    if (after === 'weak') { s.cycleDone = 0; s.extraDays = 0; s.weakSince ||= today(); }
    if (before === 'conf' && after === 'maint') state.counters.promotions++;
    if (after === 'maint' && s.weakSince) {
      state.journeys.push({ s: s.id, from: s.weakSince, to: today() });
      delete s.weakSince;
    }
    if (after === 'none') delete s.weakSince;
  }
  normalize();
}

/* ---------- Daily plan ---------- */
function refreshPlan() {
  const t = today();
  if (!state.plan || state.plan.date !== t) state.plan = { date: t, items: [] };
  const p = state.plan;
  const S = state.sections;
  const weakNow = state.weakQueue.slice(0, state.settings.weakPerDay);

  // Keep completed items; drop pending items that no longer belong.
  p.items = p.items.filter(it => it.done ||
    (it.cat === 'weak' ? weakNow.includes(it.sid) : cat(S[it.sid]) === it.cat));

  const has = new Set(p.items.map(i => i.sid));
  const count = c => p.items.filter(i => i.cat === c).length;
  const fill = (c, list, quota) => {
    for (const s of list) {
      if (count(c) >= quota) break;
      if (!has.has(s.id)) { p.items.push({ sid: s.id, cat: c, done: false }); has.add(s.id); }
    }
  };
  fill('weak', weakNow.map(id => S[id]), state.settings.weakPerDay);
  fill('conf', rotation('conf'), state.settings.confPerDay);
  fill('maint', rotation('maint'), state.settings.maintPerDay);
}

function planItem(sid) { return state.plan.items.find(i => i.sid === sid); }

/** Projected next revision date for a section, given current queues and quotas. */
function nextScheduled(s) {
  const t = today();
  const c = cat(s);
  const it = planItem(s.id);
  if (it && !it.done && it.cat === c) return t;
  if (c === 'none') return null;
  if (c === 'weak') {
    const q = state.weakQueue;
    const idx = q.indexOf(s.id);
    const doneToday = state.plan.items.some(i => i.cat === 'weak' && i.done);
    let d = doneToday ? 1 : 0;
    for (let k = 0; k < idx; k++) {
      const o = state.sections[q[k]];
      d += Math.max(1, cycleTarget(o) - o.cycleDone);
    }
    return addDays(t, d);
  }
  const quota = c === 'conf' ? state.settings.confPerDay : state.settings.maintPerDay;
  if (!quota) return null;
  const pendingToday = new Set(state.plan.items.filter(i => !i.done).map(i => i.sid));
  const rest = rotation(c).filter(x => !pendingToday.has(x.id));
  const k = rest.findIndex(x => x.id === s.id);
  return addDays(t, 1 + Math.floor(k / quota));
}

function queuePosition(s) {
  const c = cat(s);
  if (c === 'weak') return state.weakQueue.indexOf(s.id) + 1;
  if (c === 'none') return null;
  return rotation(c).findIndex(x => x.id === s.id) + 1;
}

/* ---------- Recording revisions ---------- */

/** Record a revision of a section on a date (default today) and log it. Doesn't commit. */
function recordRevision(s, kind, date = today()) {
  if (!s.lastRevised || date >= s.lastRevised) { s.lastRevised = date; s.tie = Math.random(); }
  s.revisionCount++;
  // Keep the log in date order (back-dated entries slot in after that day's others).
  let i = state.log.length;
  while (i > 0 && state.log[i - 1].d > date) i--;
  state.log.splice(i, 0, { d: date, s: s.id, k: kind });
}

/**
 * Tick off today's planned item for a section. Returns the follow-up prompt it earns, if any:
 * 'cycle-end' when a strengthening cycle completes, 'promote' at the confidence check-in.
 */
function applyCompletion(sid) {
  const it = planItem(sid);
  if (!it || it.done) return null;
  const s = state.sections[sid];
  it.prev = { lastRevised: s.lastRevised, revisionCount: s.revisionCount, cycleDone: s.cycleDone, confRevs: s.confRevs, tie: s.tie };
  it.done = true;
  recordRevision(s, 'plan');
  if (it.cat === 'weak') s.cycleDone++;
  if (it.cat === 'conf') s.confRevs++;
  if (it.cat === 'weak' && s.cycleDone >= cycleTarget(s)) return 'cycle-end';
  if (it.cat === 'conf' && s.confRevs === state.settings.promoteAfter) return 'promote';
  return null;
}

function showPrompt(prompt, sid) {
  if (prompt === 'cycle-end') setTimeout(() => openCycleEnd(sid), 350);
  if (prompt === 'promote') setTimeout(() => openPromote(sid), 350);
}

function completeItem(sid) {
  const prompt = applyCompletion(sid);
  if (!planItem(sid)?.done) return;
  ui.justDone = sid;
  commit();
  haptic();
  if (prompt) showPrompt(prompt, sid);
  else toast(`${title(sid)} revised`, () => undoItem(sid));
}

function undoItem(sid) {
  const it = planItem(sid);
  if (!it || !it.done) return;
  Object.assign(state.sections[sid], it.prev);
  it.done = false;
  delete it.prev;
  // Drop the most recent planned log entry for this section today.
  for (let i = state.log.length - 1; i >= 0; i--) {
    const e = state.log[i];
    if (e.s === sid && e.d === today() && e.k === 'plan') { state.log.splice(i, 1); break; }
  }
  commit();
}

/**
 * Log recitations that weren't (or weren't all) on today's plan. A section still pending on
 * today's plan is simply ticked off; anything else counts as an extra revision, which moves it
 * to the back of its rotation and counts towards confidence building.
 */
function logRecitations(ids, date = today()) {
  const snapshot = JSON.stringify(state);
  let prompt = null, promptSid = null;
  for (const sid of ids) {
    const it = planItem(sid);
    let p = null;
    if (date === today() && it && !it.done) p = applyCompletion(sid);
    else {
      const s = state.sections[sid];
      recordRevision(s, 'extra', date);
      if (cat(s) === 'conf') {
        s.confRevs++;
        if (s.confRevs === state.settings.promoteAfter) p = 'promote';
      }
    }
    if (p && !prompt) { prompt = p; promptSid = sid; }
  }
  commit();
  haptic();
  const pagesTotal = ids.reduce((n, id) => n + pageCount(id), 0);
  const when = date === today() ? '' : ` · ${dayLabel(date).toLowerCase()}`;
  if (prompt) showPrompt(prompt, promptSid);
  else toast(`Logged ${ids.length === 1 ? title(ids[0]) : `${ids.length} half-juz`} · ${pagesTotal} pages${when}`, () => {
    state = upgrade(JSON.parse(snapshot));
    commit();
  });
}

const pageCount = id => { const [a, b] = pages(id); return b - a + 1; };

function finishCycle(sid) {
  const s = state.sections[sid];
  classify(sid, { strength: 'strong', confidence: 'unconfident' });
  s.cycleDone = 0; s.extraDays = 0;
  state.counters.cycles++;
  commit();
  const next = state.weakQueue[0];
  toast(next ? `Marked strong. Next up: ${title(next)}` : 'Marked strong. Weak queue is clear.');
}

function extendCycle(sid) { state.sections[sid].extraDays++; commit(); toast('Cycle extended by a day'); }
function restartCycle(sid) {
  const s = state.sections[sid];
  s.cycleDone = 0; s.extraDays = 0;
  // If today's session is already logged, restarting means today counts as day 1.
  const it = planItem(sid);
  if (it && it.done && it.cat === 'weak') s.cycleDone = 1;
  commit(); toast('Cycle restarted');
}

function moveWeak(sid, to) {
  const q = state.weakQueue;
  const from = q.indexOf(sid);
  if (from < 0) return;
  q.splice(from, 1);
  q.splice(Math.max(0, Math.min(to, q.length)), 0, sid);
  commit();
}

/** Apply a user change: tidy queues, refresh today's plan, persist, re-render and sync. */
function commit() {
  normalize();
  refreshPlan();
  state.updatedAt = Date.now();
  save();
  render();
  markDirty();
}

/* ---------- Forecast & stats ---------- */

/**
 * Simulate the schedule forward to estimate when every memorised section is strong + confident.
 * Assumes each strengthening cycle ends on time and sections are confirmed confident at the
 * check-in. Returns { days, date, ready } — days of revision left counting today — or
 * { never: true } if the settings leave no room for confidence building.
 */
function greenForecast() {
  const st = state.settings;
  const t = today();
  const ready = inCat('conf').filter(s => s.confRevs >= st.promoteAfter).length;
  const weak = state.weakQueue.map(id => ({ id, left: cycleTarget(state.sections[id]) - state.sections[id].cycleDone }));
  const conf = rotation('conf').filter(s => s.confRevs < st.promoteAfter)
    .map(s => ({ id: s.id, need: st.promoteAfter - s.confRevs }));
  if (!weak.length && !conf.length) return { days: 0, date: t, ready };
  if (!st.confPerDay) return { never: true, ready };

  const done = state.plan.items.filter(i => i.done);
  const weakCap0 = done.some(i => i.cat === 'weak') ? 0 : 1;
  const confCap0 = Math.max(0, st.confPerDay - done.filter(i => i.cat === 'conf').length);
  const graduate = w => conf.push({ id: w.id, need: st.promoteAfter });
  while (weak.length && weak[0].left <= 0) graduate(weak.shift());

  for (let day = 0; day < 3650; day++) {
    if (!weak.length && !conf.length) return { days: day, date: addDays(t, Math.max(0, day - 1)), ready };
    const confCap = day === 0 ? confCap0 : st.confPerDay;
    const picked = conf.splice(0, Math.min(confCap, conf.length));
    picked.forEach(x => { if (--x.need > 0) conf.push(x); });
    if ((day === 0 ? weakCap0 : 1) && weak.length && --weak[0].left <= 0) graduate(weak.shift());
  }
  return { never: true, ready };
}

/** Everything the stats view shows, derived from the recitation log and current state. */
function computeStats() {
  const log = state.log;
  const t = today();

  // Khatms: sequential complete readings. Repeats of a section already covered in the current
  // reading don't count towards the next one — a reading must finish before the next starts.
  let khatms = 0, lastKhatm = null;
  const covered = new Set();
  for (const e of log) {
    covered.add(e.s);
    if (covered.size === 60) { khatms++; lastKhatm = e.d; covered.clear(); }
  }

  const pagesByDay = new Map();
  for (const e of log) pagesByDay.set(e.d, (pagesByDay.get(e.d) || 0) + pageCount(e.s));
  const days = [...pagesByDay.keys()].sort();
  const totalPages = [...pagesByDay.values()].reduce((a, b) => a + b, 0);

  // Streaks of consecutive days with at least one recitation. Today not yet counted doesn't break it.
  let best = 0, run = 0, prev = null;
  for (const d of days) { run = prev && diffDays(prev, d) === 1 ? run + 1 : 1; best = Math.max(best, run); prev = d; }
  let current = 0;
  for (let d = pagesByDay.has(t) ? t : addDays(t, -1); pagesByDay.has(d); d = addDays(d, -1)) current++;

  const last30 = Array.from({ length: 30 }, (_, i) => pagesByDay.get(addDays(t, -i)) || 0);
  const firstDay = days[0];
  const span = firstDay ? Math.min(30, diffDays(firstDay, t) + 1) : 0;
  const avg30 = span ? last30.slice(0, span).reduce((a, b) => a + b, 0) / span : 0;

  const rank = { maint: 3, conf: 2, weak: 1 };
  const memorised = sections().filter(s => s.memorised);
  const strongest = [...memorised].sort((a, b) =>
    rank[cat(b)] - rank[cat(a)] || b.revisionCount - a.revisionCount || a.id - b.id).slice(0, 5);
  const stalest = memorised.filter(s => cat(s) !== 'weak')
    .sort((a, b) => (a.lastRevised || '').localeCompare(b.lastRevised || '') || a.id - b.id).slice(0, 3);

  return {
    khatms, lastKhatm, khatmProgress: covered.size, totalPages, recitations: log.length,
    current, best, avg30, pagesByDay, strongest, stalest,
    memorisedCount: memorised.length, confidentCount: inCat('maint').length,
  };
}

/* ---------- Sample data ---------- */
function loadSample() {
  state = freshState();
  const t = today();
  const set = (ids, patch) => ids.forEach(id => Object.assign(state.sections[id], { memorised: true, ...patch }));
  // Juz 1–6 and 26–30 memorised (22 half-juz)
  set([5, 6, 10, 53], { strength: 'weak' });
  set([2, 3, 4, 7, 51, 52], { strength: 'strong', confidence: 'unconfident' });
  set([1, 8, 9, 11, 12, 54, 55, 56, 57, 58, 59, 60], { strength: 'strong', confidence: 'confident' });
  let i = 0;
  for (const s of sections()) {
    if (!s.memorised) continue;
    s.enteredAt = i;
    if (cat(s) !== 'weak') {
      s.lastRevised = addDays(t, -((i * 5) % 13) - 1);
      s.revisionCount = 3 + (i * 7) % 11;
      if (cat(s) === 'conf') s.confRevs = (i * 3) % 6;
    }
    i++;
  }
  state.weakQueue = [10, 5, 6, 53];
  const cur = state.sections[10];
  cur.cycleDone = 1; cur.lastRevised = addDays(t, -1); cur.revisionCount = 1;
  state.journeys = [
    { s: 8, from: addDays(t, -44), to: addDays(t, -27) },
    { s: 54, from: addDays(t, -33), to: addDays(t, -19) },
    { s: 1, from: addDays(t, -21), to: addDays(t, -10) },
  ];
  [10, 5, 6, 53].forEach((id, k) => { state.sections[id].weakSince = addDays(t, -2 - k * 3); });
  // A month of recitation history (with a couple of missed days) so the stats have something to show.
  const ids = sections().filter(s => s.memorised).map(s => s.id);
  for (let back = 29; back >= 1; back--) {
    if (back === 12 || back === 20) continue;
    const n = 2 + (back * 7) % 3;
    for (let k = 0; k < n; k++) state.log.push({ d: addDays(t, -back), s: ids[(back * 5 + k * 3) % ids.length], k: k < 3 ? 'plan' : 'extra' });
  }
  commit();
  toast('Sample hifdh loaded');
}

/* =========================================================================
   Rendering
   ========================================================================= */
const $ = s => document.querySelector(s);
const view = $('#view');

let lastTab = null;

/**
 * Re-render the current tab. A tab change plays a staggered entrance; any other
 * update keeps things in place and animates what moved or changed (FLIP + settle).
 */
function render(opts = {}) {
  const tabChanged = lastTab !== ui.tab;
  const dir = lastTab ? Math.sign(TABS.indexOf(ui.tab) - TABS.indexOf(lastTab)) : 0;
  lastTab = ui.tab;

  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('on', b.dataset.tab === ui.tab));
  $('#tabbar').style.setProperty('--i', TABS.indexOf(ui.tab));

  const first = tabChanged || opts.sub ? null : measure();
  view.classList.remove('enter', 'enter-sub');
  const fn = { today: renderToday, queues: renderQueues, map: renderMap, settings: renderSettings }[ui.tab];
  view.innerHTML = fn();
  ui.justDone = null;

  if (!reducedMotion && (tabChanged || opts.sub)) {
    [...view.children].forEach((el, i) => el.style.setProperty('--i', Math.min(i, 8)));
    view.style.setProperty('--dx', `${dir * 18}px`);
    void view.offsetWidth;
    view.classList.add(tabChanged ? 'enter' : 'enter-sub');
    clearTimeout(render.t);
    render.t = setTimeout(() => view.classList.remove('enter', 'enter-sub'), 1200);
  } else {
    flip(first);
  }
  settle(view, tabChanged);

  syncSelBar();
}

/* ---------- Motion helpers ---------- */
function measure() {
  const m = {};
  view.querySelectorAll('[data-flip]').forEach(el => { m[el.dataset.flip] = el.getBoundingClientRect(); });
  return m;
}

/** FLIP: slide elements that moved from their old position; fade in newcomers. */
function flip(first) {
  if (reducedMotion || !first) return;
  view.querySelectorAll('[data-flip]').forEach(el => {
    const f = first[el.dataset.flip];
    if (!f) {
      el.animate([{ opacity: 0, transform: 'scale(.97) translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 380, easing: EASE });
      return;
    }
    const l = el.getBoundingClientRect();
    const dx = f.left - l.left, dy = f.top - l.top;
    if (Math.abs(dx) + Math.abs(dy) > 0.5) {
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 450, easing: EASE });
    }
  });
}

/**
 * Elements tagged data-anim-key/prop/to remember their last value across renders,
 * so a freshly rendered element can transition from where the old one was.
 *   w    → width %      x → translateX(n × 100%)
 *   pop  → pop in when it turns on       bump → pulse when the value changes
 */
const animMemo = {};
function settle(root, fromZero = false) {
  const later = [];
  root.querySelectorAll('[data-anim-key]').forEach(el => {
    const { animKey: key, animProp: prop, animTo: to } = el.dataset;
    let from = animMemo[key];
    animMemo[key] = to;
    if (prop === 'pop' || prop === 'bump') {
      if (!reducedMotion && from !== undefined && from !== to && (prop === 'bump' || to === '1')) el.classList.add(prop);
      return;
    }
    if (fromZero && prop === 'w') from = '0';
    if (reducedMotion || from === undefined || from === to) { setAnimProp(el, prop, to); return; }
    el.style.transition = 'none';
    setAnimProp(el, prop, from);
    later.push([el, prop, to]);
  });
  if (!later.length) return;
  void root.offsetWidth;
  later.forEach(([el, prop, to]) => { el.style.transition = ''; setAnimProp(el, prop, to); });
}
function setAnimProp(el, prop, v) {
  if (prop === 'w') el.style.width = `${v}%`;
  else if (prop === 'x') el.style.transform = `translateX(${v * 100}%)`;
}
const anim = (key, prop, to) => `data-anim-key="${key}" data-anim-prop="${prop}" data-anim-to="${to}"`;

/** Segmented control with a sliding indicator. */
const segWrap = (key, idx, n, buttons, cls = '') =>
  `<div class="seg ${cls}" style="--n:${n}"><span class="seg-ind" ${anim(key, 'x', idx)}></span>${buttons}</div>`;

/* ---------- Theme ---------- */
function applyTheme(t) {
  ui.theme = t;
  try { localStorage.setItem(STORAGE_KEY + '.theme', t); } catch (e) {}
  if (t === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  syncThemeColor();
}
function syncThemeColor() {
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  $('#theme-color').setAttribute('content', bg);
}
function setTheme(t, x, y) {
  if (t === ui.theme) return;
  const apply = () => { applyTheme(t); render(); };
  if (!document.startViewTransition || reducedMotion) return apply();
  const vt = document.startViewTransition(apply);
  vt.ready.then(() => {
    const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    document.documentElement.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
      { duration: 650, easing: 'cubic-bezier(.4,0,.2,1)', pseudoElement: '::view-transition-new(root)' });
  }).catch(() => {});
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncThemeColor);

const dot = c => `<i class="dot ${c}"></i>`;
const juzName = id => JUZ_NAMES[juzOf(id) - 1];
const head = (eyebrow, h, right = '') =>
  `<header class="page-head"><div><div class="eyebrow">${eyebrow}</div><h1>${h}</h1></div>${right}</header>`;
const label = (c, name, amt, right = '', key = '') =>
  `<div class="label">${dot(c)}<span>${name}</span>${amt ? `<em>${amt}</em>` : ''}<span class="r" ${key ? anim(key, 'bump', right) : ''}>${right}</span></div>`;
function shortAgo(s) {
  if (!s) return 'new';
  const n = diffDays(s, today());
  return n <= 0 ? 'today' : `${n}d ago`;
}

/* ---------- Today ---------- */
function renderToday() {
  const d = parse(today());
  const weekday = d.toLocaleDateString('en-GB', { weekday: 'long' });
  const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
  let hijri = '';
  try { hijri = new Intl.DateTimeFormat('en-GB-u-ca-islamic-umalqura', { day: 'numeric', month: 'long', year: 'numeric' }).format(d); } catch (e) {}

  if (!sections().some(s => s.memorised)) {
    return head(weekday, date) + `
      <div class="onboard">
        <div class="mark">۞</div>
        <h2>Set up your hifdh</h2>
        <p>Mark which half-juz you've memorised and how each one feels. Your daily revision is built from there.</p>
        <button class="btn" data-action="start-setup">Classify sections</button>
        ${auth ? '' : `<div class="links">
          <button class="link" data-action="auth-open">Sign in</button>·<button class="link" data-action="sample">Try sample data</button>
        </div>`}
      </div>`;
  }

  const items = state.plan.items;
  const total = items.length;
  const done = items.filter(i => i.done).length;
  const complete = total > 0 && done === total;
  const pct = total ? done / total : 0;

  return head(`${weekday}${state.settings.dayOffset ? ' · preview' : ''}`, date) + `
    <div class="progress ${complete ? 'complete' : ''}">
      <div class="progress-text"><span>${hijri}</span>
        <span ${anim('prog-t', 'bump', done)}>${complete ? 'All done today' : `${fmtNum(done / 2)} of ${fmtNum(total / 2)} juz`}</span></div>
      <div class="bar"><i ${anim('progress', 'w', pct * 100)}></i></div>
    </div>
    ${etaLine()}
    ${weakBlock()}
    ${listBlock('conf', 'Confidence', state.settings.confPerDay)}
    ${listBlock('maint', 'Maintenance', state.settings.maintPerDay)}
    <button class="log-btn" data-action="log-open" data-flip="log-btn">${I.plus}<span>Log a recitation</span></button>`;
}

/** "N days until everything is green" — see greenForecast(). */
function etaLine() {
  const f = greenForecast();
  const readyText = f.ready ? `${f.ready} section${f.ready > 1 ? 's' : ''} ready to mark confident` : '';
  let main, right = '';
  if (f.never) main = 'Confidence building is set to 0 — nothing turns green';
  else if (!f.days && !f.ready) main = '<b>Everything is green</b> — all memorised sections are confident';
  else if (!f.days) main = `<b>${readyText}</b>`;
  else {
    main = `<b ${anim('eta-d', 'bump', f.days)}>${f.days} day${f.days > 1 ? 's' : ''}</b> until everything is green`;
    right = parse(f.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }
  return `<button class="eta" data-action="eta-info" data-flip="eta">${dot('maint')}<span>${main}</span><span class="r">${right}</span></button>`;
}

function weakBlock() {
  const it = state.plan.items.find(i => i.cat === 'weak');
  if (!it) return `<section class="block" data-flip="b-weak">${label('weak', 'Strengthen')}<p class="skip">No weak sections — skipped today.</p></section>`;
  const s = state.sections[it.sid];

  if (it.done && cat(s) !== 'weak') {
    const next = state.weakQueue[0];
    return `<section class="block" data-flip="b-weak">${label('weak', 'Strengthen', '½ juz', 'Finished')}
      <div class="card focus">
        <div class="f-title">${title(s.id)}</div>
        <div class="f-sub">Marked strong · now in ${cat(s) === 'maint' ? 'maintenance' : 'confidence building'}</div>
        <div class="segs">${'<span><i style="width:100%"></i></span>'.repeat(3)}</div>
        <p class="note">${next ? `Next up is <b>${title(next)}</b>, starting tomorrow.` : 'Nothing left to strengthen.'}</p>
      </div></section>`;
  }

  const target = cycleTarget(s);
  const dayNum = it.done ? s.cycleDone : s.cycleDone + 1;
  const cycleComplete = !it.done && s.cycleDone >= target;
  const g = CYCLE_GUIDE[Math.min(dayNum, 3) - 1] || CYCLE_GUIDE[2];
  const extra = dayNum > state.settings.cycleLength;
  const segs = Array.from({ length: target }, (_, k) => `<span><i ${anim(`cyc-${s.id}-${k}`, 'w', k < s.cycleDone ? 100 : 0)}></i></span>`).join('');
  const sid = `data-sid="${s.id}"`;

  let body;
  if (cycleComplete) {
    body = `
      <p class="note"><b>Cycle complete.</b> How does it feel after ${target} days?</p>
      <button class="btn" data-action="finish-cycle" ${sid}>It's strong now</button>
      <div class="links"><button class="link" data-action="extend" ${sid}>One more day</button>·<button class="link" data-action="restart" ${sid}>Restart</button></div>`;
  } else if (it.done) {
    const left = target - s.cycleDone;
    body = `
      <p class="note"><span class="ok ${ui.justDone === s.id ? 'pop' : ''}">${I.check}</span>Day ${dayNum} done${left > 0 ? ` — day ${dayNum + 1} tomorrow` : ''}.</p>
      <div class="links"><button class="link" data-action="undo" ${sid}>Undo</button>·<button class="link" data-action="finish-cycle" ${sid}>Mark strong</button>·<button class="link" data-action="cycle-opts" ${sid}>Options</button></div>`;
  } else {
    body = `
      <p class="note"><b>${extra ? 'Extra day.' : `${g.t}.`}</b> ${extra ? 'Keep consolidating until it feels strong.' : g.d}</p>
      <button class="btn" data-action="complete" ${sid}>Mark day ${dayNum} done</button>
      <div class="links"><button class="link" data-action="finish-cycle" ${sid}>Already strong</button>·<button class="link" data-action="cycle-opts" ${sid}>Options</button></div>`;
  }

  return `<section class="block" data-flip="b-weak">${label('weak', 'Strengthen', '½ juz', `Day ${Math.min(dayNum, target)} of ${target}`, 'lbl-weak')}
    <div class="card focus">
      <button class="f-head" data-action="open" ${sid}>
        <div class="f-title">${title(s.id)}</div>
        <div class="f-sub">${subtitle(s.id)}</div>
      </button>
      <div class="segs">${segs}</div>
      ${body}
    </div></section>`;
}

function listBlock(c, name, quota) {
  const items = state.plan.items.filter(i => i.cat === c);
  if (!items.length) {
    const why = quota ? `Nothing ${c === 'conf' ? 'to build confidence on' : 'in maintenance'} yet — skipped.` : 'Turned off in settings.';
    return `<section class="block" data-flip="b-${c}">${label(c, name)}<p class="skip">${why}</p></section>`;
  }
  const done = items.filter(i => i.done).length;
  const P = state.settings.promoteAfter;
  const rows = items.map(it => {
    const s = state.sections[it.sid];
    const sid = `data-sid="${s.id}"`;
    let right;
    if (c === 'conf' && s.confRevs >= P) right = `<button class="tag" data-action="promote" ${sid}>Ready?</button>`;
    else if (c === 'conf') right = `<span class="meta">${Math.min(s.confRevs + (it.done ? 0 : 1), P)} of ${P}</span>`;
    else right = `<span class="meta">${it.done ? 'today' : shortAgo(s.lastRevised)}</span>`;
    return `
      <div class="item ${it.done ? 'done' : ''}">
        <button class="check ${c} ${it.done ? 'on' : ''}" ${anim(`chk-${s.id}`, 'pop', it.done ? 1 : 0)} data-action="${it.done ? 'undo' : 'complete'}" ${sid} aria-label="Toggle done">${I.check}</button>
        <button class="item-main" data-action="open" ${sid}><div class="t">${title(s.id)}</div><div class="s">${juzName(s.id)}</div></button>
        ${right}
      </div>`;
  }).join('');
  return `<section class="block" data-flip="b-${c}">${label(c, name, `${fmtJuz(items.length)} juz`, `${done}/${items.length}`, `lbl-${c}`)}
    <div class="card list">${rows}</div></section>`;
}

/* ---------- Queues ---------- */
function renderQueues() {
  const n = { weak: state.weakQueue.length, conf: inCat('conf').length, maint: inCat('maint').length };
  const q = ui.queueTab;
  const names = { weak: 'Weak', conf: 'Confidence', maint: 'Maintain' };
  const keys = Object.keys(names);
  let html = head('Revision', 'Queues') + segWrap('seg-q', keys.indexOf(q), 3, keys.map(k =>
    `<button class="${q === k ? 'on' : ''}" data-action="qtab" data-q="${k}">${names[k]}<span class="n" ${anim(`qn-${k}`, 'bump', n[k])}>${n[k]}</span></button>`).join(''));

  if (q === 'weak') {
    html += `<p class="desc qa">One section at a time on a ${state.settings.cycleLength}-day cycle. The top section is the one you're working on.</p>`;
    if (!n.weak) return html + emptyQueue('No weak sections', 'Anything you mark as weak lines up here.');
    const rows = state.weakQueue.map((id, i) => {
      const s = state.sections[id];
      const cur = i === 0;
      const right = cur
        ? `<span class="now">Day ${Math.min(s.cycleDone + 1, cycleTarget(s))}/${cycleTarget(s)}</span>`
        : `<span class="meta">${i === 1 ? 'Next' : relDay(nextScheduled(s))}</span>`;
      return `
        <div class="item" data-flip="q-${id}" style="--k:${Math.min(i, 12)}">
          <span class="pos ${cur ? 'cur' : ''}">${i + 1}</span>
          <button class="item-main" data-action="open" data-sid="${id}">
            <div class="t">${title(id)}</div>
            <div class="s">${s.cycleDone && !cur ? `Paused at day ${s.cycleDone} · ` : ''}${juzName(id)}</div>
          </button>
          ${right}
          <div class="arrows">
            <button data-action="wmove" data-sid="${id}" data-to="${i - 1}" ${i === 0 ? 'disabled' : ''} aria-label="Move up">${I.up}</button>
            <button data-action="wmove" data-sid="${id}" data-to="${i + 1}" ${i === n.weak - 1 ? 'disabled' : ''} aria-label="Move down">${I.down}</button>
          </div>
        </div>`;
    }).join('');
    return html + `<div class="card list qa">${rows}</div>`;
  }

  const list = rotation(q);
  const P = state.settings.promoteAfter;
  html += q === 'conf'
    ? `<p class="desc qa">About ${fmtJuz(state.settings.confPerDay)} juz a day, longest-unrevised first. After ${P} revisions you'll be asked if it feels confident.</p>`
    : `<p class="desc qa">About ${fmtJuz(state.settings.maintPerDay)} juz a day. Whatever has gone longest without revision comes first.</p>`;
  if (!list.length) {
    return html + (q === 'conf'
      ? emptyQueue('Nothing here yet', 'Sections arrive once a strengthening cycle finishes.')
      : emptyQueue('Nothing in maintenance', 'Sections you feel confident in are kept fresh here.'));
  }
  const rows = list.map((s, i) => {
    const next = nextScheduled(s);
    const sub = q === 'conf'
      ? `${s.confRevs} of ${P} revisions · ${shortAgo(s.lastRevised)}`
      : `Last revised ${agoDay(s.lastRevised).toLowerCase()}`;
    return `
      <div class="item" data-flip="q-${s.id}" style="--k:${Math.min(i, 12)}">
        <span class="pos">${i + 1}</span>
        <button class="item-main" data-action="open" data-sid="${s.id}"><div class="t">${title(s.id)}</div><div class="s">${sub}</div></button>
        <span class="meta ${next === today() ? 'due' : ''}">${relDay(next)}</span>
      </div>`;
  }).join('');
  return html + `<div class="card list qa">${rows}</div>`;
}

function emptyQueue(t, p) {
  return `<div class="empty qa"><h3>${t}</h3><p>${p}</p></div>`;
}

/* ---------- Map ---------- */
function renderMap() {
  const counts = { weak: 0, conf: 0, maint: 0, none: 0 };
  sections().forEach(s => counts[cat(s)]++);
  const cur = state.weakQueue[0];
  const names = { weak: 'Weak', conf: 'Unconfident', maint: 'Confident', none: 'Not memorised' };
  const statsView = ui.hifdhView === 'stats';
  let html = head(`${fmtJuz(60 - counts.none)} of 30 juz memorised`, 'My hifdh', statsView ? '' :
    `<button class="head-action ${ui.selecting ? 'on' : ''}" data-action="toggle-select">${ui.selecting ? 'Done' : 'Select'}</button>`);
  html += segWrap('seg-hifdh', statsView ? 1 : 0, 2,
    `<button class="${statsView ? '' : 'on'}" data-action="hifdh-view" data-v="map">Map</button>` +
    `<button class="${statsView ? 'on' : ''}" data-action="hifdh-view" data-v="stats">Stats</button>`);
  if (statsView) return html + renderStats();
  html += `<div class="legend qa">${Object.keys(names).map(c => `<span>${dot(c)}${names[c]} <b>${counts[c]}</b></span>`).join('')}</div>`;
  if (ui.selecting) html += `<p class="map-hint">Tap halves to select them, then choose a state below.</p>`;
  html += `<div class="grid qa">`;
  for (let j = 1; j <= 30; j++) {
    const half = s => `<button class="half ${cat(s)} ${ui.selected.has(s.id) ? 'sel' : ''} ${s.id === cur ? 'cur' : ''}" ${anim(`h-${s.id}`, 'bump', `${cat(s)}${ui.selected.has(s.id) ? '-s' : ''}`)}
      data-action="${ui.selecting ? 'sel' : 'open'}" data-sid="${s.id}" aria-label="${title(s.id)}"></button>`;
    html += `<div class="juz" style="--j:${j - 1}"><div class="jn">${j}</div><div class="halves">${half(state.sections[j * 2 - 1])}${half(state.sections[j * 2])}</div></div>`;
  }
  html += `</div>`;
  if (ui.selecting) html += `<div style="height:120px"></div>`;
  return html;
}

/* ---------- Stats ---------- */
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const weekdayOf = d => (parse(d).getDay() + 6) % 7;      // Monday = 0
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** Sequential ramp step (0–4) for a value against the max: one hue, light → strong. */
const heatStep = (v, max) => (!v ? 0 : Math.min(4, Math.ceil((v / Math.max(1, max)) * 4)));

function renderStats() {
  const st = computeStats();
  const f = greenForecast();
  const tile = (k, v, sub, key) => `<div class="tile"><div class="k">${k}</div><div class="v" ${anim(key, 'bump', v)}>${v}</div><div class="sub">${sub}</div></div>`;
  const sectionRow = (s, meta) => `
    <div class="item"><span class="dot ${cat(s)}"></span>
      <button class="item-main" data-action="open" data-sid="${s.id}"><div class="t">${title(s.id)}</div><div class="s">${juzName(s.id)}</div></button>
      <span class="meta">${meta}</span></div>`;
  const kv = (k, v) => `<div class="item"><span class="k">${k}</span><span class="v">${v}</span></div>`;
  const kPct = st.khatmProgress / 60 * 100;
  const green = f.never ? 'Confidence building is off'
    : !f.days ? (f.ready ? `${plural(f.ready, 'section')} ready to confirm` : 'Everything is green')
    : `${plural(f.days, 'day')} · by ${parse(f.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;

  return `
    <section class="block qa"><div class="group-title">Khatms</div>
      <div class="card focus khatm">
        <div class="khatm-top"><span class="big" ${anim('khatms', 'bump', st.khatms)}>${st.khatms}</span>
          <span class="muted">${st.khatms === 1 ? 'complete reading' : 'complete readings'}</span></div>
        <div class="bar"><i ${anim('khatm-p', 'w', kPct)} style="background:var(--maint)"></i></div>
        <div class="khatm-sub"><span>Current reading: ${st.khatmProgress} of 60 half-juz</span><span>${fmtJuz(60 - st.khatmProgress)} juz to go</span></div>
        <p class="fine" style="margin-top:12px">A khatm counts once every half-juz has been recited. Repeats of a section already covered in this reading don't count towards the next one.${st.lastKhatm ? ` Last completed ${parse(st.lastKhatm).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}.` : ''}</p>
      </div></section>

    <section class="block qa"><div class="tiles">
      ${tile('Current streak', plural(st.current, 'day'), st.current ? 'in a row' : 'recite today to start', 'st-cur')}
      ${tile('Best streak', plural(st.best, 'day'), 'longest run', 'st-best')}
      ${tile('Pages revised', st.totalPages.toLocaleString('en-GB'), plural(st.recitations, 'recitation'), 'st-pages')}
      ${tile('Daily average', `${Math.round(st.avg30)} pp`, 'last 30 days', 'st-avg')}
    </div></section>

    <section class="block qa"><div class="label-row"><div class="group-title">Pages revised</div>
      ${segWrap('seg-range', ['14', '30', 'all'].indexOf(String(ui.chartRange)), 3,
        [['14', '14D'], ['30', '30D'], ['all', 'All']].map(([v, l]) =>
          `<button class="${String(ui.chartRange) === v ? 'on' : ''}" data-action="chart-range" data-v="${v}">${l}</button>`).join(''), 'mini')}</div>
      <div class="card chart-card">${pagesChart(st.pagesByDay, ui.chartRange)}</div></section>

    <section class="block qa"><div class="group-title">Calendar</div>
      <div class="card chart-card">${calendarHeat(st.pagesByDay)}</div></section>

    <section class="block qa"><div class="group-title">Busiest weekday</div>
      <div class="card chart-card">${weekdayBars(st.pagesByDay)}</div></section>

    <section class="block qa"><div class="group-title">Revisions per section · last 30 days</div>
      <div class="card chart-card">${frequencyMap()}</div></section>

    <section class="block qa"><div class="group-title">Weak to confident</div>${journeys()}</section>

    <section class="block qa"><div class="group-title">Path to green</div>
      <div class="card list kv">
        ${kv('All green in', green)}
        ${kv(`${dot('weak')} Weak`, plural(inCat('weak').length, 'section'))}
        ${kv(`${dot('conf')} Building confidence`, plural(inCat('conf').length, 'section'))}
        ${kv(`${dot('maint')} Confident`, `${st.confidentCount} of ${st.memorisedCount}`)}
      </div></section>

    ${st.strongest.length ? `<section class="block qa"><div class="group-title">Strongest sections</div>
      <div class="card list">${st.strongest.map(s => sectionRow(s, plural(s.revisionCount, 'revision'))).join('')}</div></section>` : ''}

    ${st.stalest.length ? `<section class="block qa"><div class="group-title">Longest since revised</div>
      <div class="card list">${st.stalest.map(s => sectionRow(s, shortAgo(s.lastRevised))).join('')}</div></section>` : ''}

    <section class="block qa"><div class="group-title">Milestones</div>
      <div class="card list kv">
        ${kv('Juz memorised', `${fmtJuz(st.memorisedCount)} of 30`)}
        ${kv('Strengthening cycles finished', state.counters.cycles)}
        ${kv('Sections made confident', state.counters.promotions)}
        ${kv('Recitations logged', st.recitations)}
      </div></section>`;
}

/** A readout line that tapping a chart mark updates in place (see the `peek` action). */
const readout = (id, main, right = '') =>
  `<div class="readout"><span id="${id}">${main}</span><span class="muted">${right}</span></div>`;

/**
 * Bar chart of pages revised: the last 14 or 30 days, or all time (weekly totals once the
 * history is longer than 60 days). Tap a bar to read its value.
 */
function pagesChart(pagesByDay, range) {
  const t = today();
  let data, unit = 'pages';
  if (range === 'all') {
    const first = [...pagesByDay.keys()].sort()[0] || t;
    const span = diffDays(first, t) + 1;
    if (span > 60) {
      unit = 'pages that week';
      const start = addDays(first, -weekdayOf(first));                  // Monday of the first week
      const weeks = Math.ceil((diffDays(start, t) + 1) / 7);
      data = Array.from({ length: weeks }, (_, w) => {
        const from = addDays(start, w * 7);
        let v = 0;
        for (let k = 0; k < 7; k++) v += pagesByDay.get(addDays(from, k)) || 0;
        return { label: `w/c ${parse(from).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`, v };
      });
    } else {
      data = Array.from({ length: Math.max(span, 7) }, (_, i) => {
        const d = addDays(t, i - Math.max(span, 7) + 1);
        return { label: dayLabel(d), v: pagesByDay.get(d) || 0 };
      });
    }
  } else {
    data = Array.from({ length: range }, (_, i) => {
      const d = addDays(t, i - range + 1);
      return { label: dayLabel(d), v: pagesByDay.get(d) || 0 };
    });
  }
  const n = data.length;
  const sel = ui.barSel == null || ui.barSel >= n ? n - 1 : ui.barSel;
  const avg = data.reduce((a, x) => a + x.v, 0) / n;
  const top = Math.max(10, Math.ceil(Math.max(...data.map(x => x.v)) / 10) * 10);
  const W = 320, H = 150, L = 26, R = 2, T = 8, B = 22;
  const pw = W - L - R, ph = H - T - B, slot = pw / n;
  const gap = Math.min(4, slot * 0.3), bw = Math.max(1, slot - gap);
  const y = v => T + ph - (v / top) * ph;
  const barPath = (x, yTop, w, h) => {
    const r = Math.min(4, w / 2, h);
    return `M${x},${yTop + h}V${yTop + r}Q${x},${yTop} ${x + r},${yTop}H${x + w - r}Q${x + w},${yTop} ${x + w},${yTop + r}V${yTop + h}Z`;
  };
  const grid = [0, top / 2, top].map(v => `
    <line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="grid-line"/>
    <text x="${L - 6}" y="${y(v) + 3.5}" class="axis" text-anchor="end">${v}</text>`).join('');
  const bars = data.map((x, i) => {
    const bx = L + i * slot + gap / 2;
    const mark = x.v ? `<path d="${barPath(bx, y(x.v), bw, (x.v / top) * ph)}" class="bar-mark ${i === sel ? 'sel' : ''}" data-i="${i}" style="--b:${Math.min(i, 30)}"/>`
      : `<rect x="${bx}" y="${T + ph - 2}" width="${bw}" height="2" rx="1" class="bar-zero"/>`;
    const text = `<b>${x.v} ${unit}</b> · ${x.label}`;
    return `${mark}<rect x="${L + i * slot}" y="${T}" width="${slot}" height="${ph + B}" class="bar-hit" data-action="peek"
      data-target="bar-readout" data-group="bar-mark" data-i="${i}" data-text="${esc(text)}"><title>${x.label}: ${x.v} ${unit}</title></rect>`;
  }).join('');
  const ticks = n > 2 ? [0, Math.floor(n / 2), n - 1] : [n - 1];
  const xl = ticks.map(i =>
    `<text x="${L + i * slot + slot / 2}" y="${H - 6}" class="axis" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}">${data[i].label.replace('w/c ', '')}</text>`).join('');
  return readout('bar-readout', `<b>${data[sel].v} ${unit}</b> · ${data[sel].label}`, `avg ${Math.round(avg)}${unit === 'pages' ? '/day' : '/week'}`) + `
    <svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Pages revised, averaging ${Math.round(avg)} ${unit === 'pages' ? 'a day' : 'a week'}">
      ${grid}${bars}${xl}
    </svg>`;
}

/** GitHub-style calendar: the last 18 weeks, one square per day, shaded by pages. */
function calendarHeat(pagesByDay) {
  const t = today();
  const weeks = 18;
  const start = addDays(t, -weekdayOf(t) - (weeks - 1) * 7);
  const days = Array.from({ length: weeks * 7 }, (_, i) => addDays(start, i));
  const max = Math.max(...days.map(d => pagesByDay.get(d) || 0));
  const cell = 14, gap = 3, L = 28, T = 16;
  const W = L + weeks * (cell + gap), H = T + 7 * (cell + gap);
  let months = '', lastMonth = -1;
  const squares = days.map((d, i) => {
    const w = Math.floor(i / 7), wd = i % 7;
    const x = L + w * (cell + gap), yy = T + wd * (cell + gap);
    const m = parse(d).getMonth();
    if (wd === 0 && m !== lastMonth) {
      lastMonth = m;
      if (w < weeks - 1) months += `<text x="${x}" y="10" class="axis">${parse(d).toLocaleDateString('en-GB', { month: 'short' })}</text>`;
    }
    if (d > t) return '';
    const v = pagesByDay.get(d) || 0;
    const text = `<b>${v} pages</b> · ${parse(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}`;
    return `<rect x="${x}" y="${yy}" width="${cell}" height="${cell}" rx="3" class="heat h${heatStep(v, max)} ${d === t ? 'sel' : ''}"
      data-action="peek" data-target="cal-readout" data-group="heat" data-text="${esc(text)}"><title>${d}: ${v} pages</title></rect>`;
  }).join('');
  const dayLabels = [['Mon', 0], ['Wed', 2], ['Fri', 4]].map(([l, r]) =>
    `<text x="0" y="${T + r * (cell + gap) + 11}" class="axis">${l}</text>`).join('');
  const active = days.filter(d => d <= t && pagesByDay.get(d)).length;
  const legend = [0, 1, 2, 3, 4].map(k => `<i class="heat-key h${k}"></i>`).join('');
  return readout('cal-readout', `<b>${pagesByDay.get(t) || 0} pages</b> · Today`, `${active} active days`) + `
    <svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Calendar of pages revised per day over the last ${weeks} weeks; ${active} days with revision">
      ${months}${dayLabels}${squares}
    </svg>
    <div class="heat-legend"><span>Less</span>${legend}<span>More</span></div>`;
}

/** Average pages on each weekday, over the weeks since the first recitation. */
function weekdayBars(pagesByDay) {
  const t = today();
  const first = [...pagesByDay.keys()].sort()[0];
  if (!first) return `<p class="skip" style="margin:4px">Appears once you've logged some revision.</p>`;
  const totals = Array(7).fill(0), counts = Array(7).fill(0);
  for (let d = first; d <= t; d = addDays(d, 1)) {
    const wd = weekdayOf(d);
    counts[wd]++;
    totals[wd] += pagesByDay.get(d) || 0;
  }
  const avgs = totals.map((v, i) => (counts[i] ? v / counts[i] : 0));
  const max = Math.max(...avgs);
  const best = avgs.indexOf(max);
  const rows = avgs.map((v, i) => `
    <div class="wd-row ${i === best && max ? 'best' : ''}">
      <span class="wd-name">${WEEKDAYS[i].slice(0, 3)}</span>
      <span class="wd-track"><i ${anim(`wd-${i}`, 'w', max ? (v / max) * 100 : 0)}></i></span>
      <span class="wd-val">${Math.round(v)}</span>
    </div>`).join('');
  return readout('wd-readout', max ? `<b>${WEEKDAYS[best]}</b> · ${Math.round(max)} pages on average` : 'No revision yet', 'avg pages') + rows;
}

/** Every memorised half-juz, shaded by how often it was recited in the last 30 days. */
function frequencyMap() {
  const t = today();
  const from = addDays(t, -29);
  const counts = new Map();
  for (const e of state.log) if (e.d >= from) counts.set(e.s, (counts.get(e.s) || 0) + 1);
  const mem = sections().filter(s => s.memorised);
  if (!mem.length) return `<p class="skip" style="margin:4px">Appears once you've marked your memorised sections.</p>`;
  const max = Math.max(1, ...mem.map(s => counts.get(s.id) || 0));
  const least = [...mem].sort((a, b) => (counts.get(a.id) || 0) - (counts.get(b.id) || 0) || a.id - b.id)[0];
  let grid = '';
  for (let j = 1; j <= 30; j++) {
    const a = state.sections[j * 2 - 1], b = state.sections[j * 2];
    if (!a.memorised && !b.memorised) continue;
    const half = s => {
      if (!s.memorised) return `<span class="fq fq-none"></span>`;
      const n = counts.get(s.id) || 0;
      const text = `<b>${title(s.id)}</b> · ${plural(n, 'time')} in 30 days`;
      return `<button class="fq h${heatStep(n, max)}" data-action="peek" data-target="fq-readout" data-group="fq" data-text="${esc(text)}"
        aria-label="${title(s.id)}: ${plural(n, 'time')}">${n}</button>`;
    };
    grid += `<div class="juz"><div class="jn">${j}</div><div class="halves">${half(a)}${half(b)}</div></div>`;
  }
  const n = counts.get(least.id) || 0;
  return readout('fq-readout', `Least revised: <b>${title(least.id)}</b> · ${plural(n, 'time')}`) +
    `<div class="grid fq-grid">${grid}</div>
    <div class="heat-legend"><span>Less</span>${[0, 1, 2, 3, 4].map(k => `<i class="heat-key h${k}"></i>`).join('')}<span>More</span></div>`;
}

/** How long sections took from being marked weak to being confident. */
function journeys() {
  const done = state.journeys.map(j => ({ ...j, days: Math.max(1, diffDays(j.from, j.to)) }));
  const t = today();
  const inProgress = sections().filter(s => s.memorised && s.weakSince && cat(s) !== 'maint')
    .map(s => ({ s, days: Math.max(0, diffDays(s.weakSince, t)) })).sort((a, b) => b.days - a.days);
  const kv = (k, v) => `<div class="item"><span class="k">${k}</span><span class="v">${v}</span></div>`;
  if (!done.length && !inProgress.length) {
    return `<p class="skip">Appears once a section goes from weak to confident.</p>`;
  }
  const avg = done.length ? Math.round(done.reduce((a, j) => a + j.days, 0) / done.length) : null;
  const fastest = done.length ? done.reduce((a, j) => (j.days < a.days ? j : a)) : null;
  const recent = done.slice(-4).reverse().map(j => `
    <div class="item"><span class="dot maint"></span>
      <button class="item-main" data-action="open" data-sid="${j.s}"><div class="t">${title(j.s)}</div>
        <div class="s">${parse(j.from).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} → ${parse(j.to).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</div></button>
      <span class="meta">${plural(j.days, 'day')}</span></div>`).join('');
  return `
    <div class="card list kv">
      ${kv('Average', avg == null ? '—' : plural(avg, 'day'))}
      ${kv('Fastest', fastest ? `${plural(fastest.days, 'day')} · ${title(fastest.s)}` : '—')}
      ${kv('Made confident', plural(done.length, 'section'))}
      ${kv('In progress', inProgress.length ? `${inProgress.length} · longest ${plural(inProgress[0].days, 'day')}` : 'none')}
    </div>
    ${recent ? `<div class="card list" style="margin-top:10px">${recent}</div>` : ''}`;
}

/* ---------- Log a recitation ---------- */
function openLog(refresh = false) {
  sheetSid = null;
  const sel = ui.logSel;
  const t = today();
  const date = ui.logDate || t;
  const mode = date === t ? 0 : date === addDays(t, -1) && !ui.logEarlier ? 1 : 2;
  const doneToday = new Set(state.log.filter(e => e.d === date).map(e => e.s));
  const pagesSel = [...sel].reduce((n, id) => n + pageCount(id), 0);
  let grid = '';
  for (let j = 1; j <= 30; j++) {
    const a = state.sections[j * 2 - 1], b = state.sections[j * 2];
    if (!a.memorised && !b.memorised) continue;
    const half = s => `<button class="half ${cat(s)} ${sel.has(s.id) ? 'sel' : ''} ${doneToday.has(s.id) ? 'rt' : ''}"
      ${anim(`lg-${s.id}`, 'bump', sel.has(s.id) ? 1 : 0)} data-action="log-sel" data-sid="${s.id}" ${s.memorised ? '' : 'disabled'}
      aria-label="${title(s.id)}"></button>`;
    grid += `<div class="juz"><div class="jn">${j}</div><div class="halves">${half(a)}${half(b)}</div></div>`;
  }
  openSheet(`
    <div class="sh-head"><h2>Log a recitation</h2>
      <p>Pick the half-juz you recited, scheduled or not. It counts towards your stats and moves the section to the back of its queue.</p></div>
    <div class="field">Recited on</div>
    ${segWrap('seg-logdate', mode, 3,
      `<button class="${mode === 0 ? 'on' : ''}" data-action="log-date" data-v="today">Today</button>` +
      `<button class="${mode === 1 ? 'on' : ''}" data-action="log-date" data-v="yesterday">Yesterday</button>` +
      `<button class="${mode === 2 ? 'on' : ''}" data-action="log-date" data-v="earlier">Earlier</button>`)}
    ${mode === 2 ? `<input class="input date-input" type="date" id="log-date-input" value="${date}" max="${addDays(t, -1)}" min="${addDays(t, -365)}">` : ''}
    <div class="grid log-grid">${grid}</div>
    ${doneToday.size ? `<p class="fine log-key"><span class="rt-key"></span>Already recited ${date === t ? 'today' : `on ${dayLabel(date).toLowerCase() === 'yesterday' ? 'yesterday' : dayLabel(date)}`}</p>` : '<div style="height:6px"></div>'}
    <button class="btn" data-action="log-save" ${sel.size ? '' : 'disabled'}>
      ${sel.size ? `Log ${sel.size} half-juz · ${pagesSel} pages${date === t ? '' : ` · ${dayLabel(date)}`}` : 'Select what you recited'}</button>`, refresh);
}

function openEtaInfo() {
  sheetSid = null;
  const f = greenForecast();
  const st = state.settings;
  const weakDays = state.weakQueue.reduce((n, id) => n + Math.max(0, cycleTarget(state.sections[id]) - state.sections[id].cycleDone), 0);
  const confNeed = inCat('conf').reduce((n, s) => n + Math.max(0, st.promoteAfter - s.confRevs), 0);
  openSheet(`
    <div class="sh-head"><h2>Path to green</h2>
      <p>${f.never ? 'Confidence building is set to 0 in Settings, so sections never become confident.'
        : f.days ? `About ${f.days} day${f.days > 1 ? 's' : ''} of revision until every memorised section is strong and confident.`
        : 'Every memorised section is strong and confident.'}</p></div>
    <div class="card list kv">
      <div class="item"><span class="k">${dot('weak')} Strengthening left</span><span class="v">${weakDays} day${weakDays === 1 ? '' : 's'} · ${state.weakQueue.length} section${state.weakQueue.length === 1 ? '' : 's'}</span></div>
      <div class="item"><span class="k">${dot('conf')} Confidence revisions left</span><span class="v">${confNeed}</span></div>
      <div class="item"><span class="k">${dot('maint')} Ready to confirm</span><span class="v">${f.ready}</span></div>
    </div>
    <p class="fine">Assumes one strengthening cycle at a time finishing on schedule, ${fmtJuz(st.confPerDay)} juz of confidence building a day, and each section confirmed confident after ${st.promoteAfter} revisions. Sections that finish strengthening join the confidence rotation. Extra recitations make it sooner.</p>`);
}

/**
 * The selection bar persists while in select mode and is updated in place,
 * so it doesn't re-animate on every tap.
 */
function syncSelBar() {
  let bar = document.querySelector('.selbar:not(.out)');
  if (!(ui.tab === 'map' && ui.selecting)) {
    if (bar) { bar.classList.add('out'); setTimeout(() => bar.remove(), 250); }
    return;
  }
  if (!bar) {
    const b = (kind, name) => `<button data-action="bulk" data-kind="${kind}">${dot(kind)}${name}</button>`;
    document.body.insertAdjacentHTML('beforeend', `<div class="selbar">
      <div class="sb-top"><span class="sb-count"></span><button class="link sb-all" data-action="sel-all"></button></div>
      <div class="sb-acts">${b('weak', 'Weak')}${b('conf', 'Unconfident')}${b('maint', 'Confident')}${b('none', 'Remove')}</div>
    </div>`);
    bar = document.querySelector('.selbar:not(.out)');
  }
  const n = ui.selected.size;
  bar.querySelector('.sb-count').textContent = n ? `${n} selected` : 'Nothing selected';
  bar.querySelector('.sb-all').textContent = n === 60 ? 'Clear' : 'Select all';
  bar.querySelectorAll('[data-action="bulk"]').forEach(btn => { btn.disabled = !n; });
}

/* ---------- Settings ---------- */
function renderSettings() {
  const st = state.settings;
  const total = (inCat('weak').length ? st.weakPerDay : 0) + st.confPerDay + st.maintPerDay;
  const stepper = (key, min, max, fmt) => `
    <div class="stepper">
      <button data-action="step" data-key="${key}" data-d="-1" ${st[key] <= min ? 'disabled' : ''} aria-label="Decrease">−</button>
      <span ${anim(`st-${key}`, 'bump', st[key])}>${fmt(st[key])}</span>
      <button data-action="step" data-key="${key}" data-d="1" ${st[key] >= max ? 'disabled' : ''} aria-label="Increase">+</button>
    </div>`;
  const row = (t, s, ctrl) => `<div class="item"><div class="item-main"><div class="t">${t}</div><div class="s">${s}</div></div>${ctrl}</div>`;
  const link = (action, t, cls = '') => `<button class="item link-row ${cls}" data-action="${action}"><span class="item-main t">${t}</span>${I.chev}</button>`;
  const juz = v => fmtJuz(v);

  const themes = ['system', 'light', 'dark'];
  const account = auth ? `
      <div class="card list">
        <div class="item"><div class="item-main"><div class="t">${esc(auth.username)}</div><div class="s" id="sync-text">${syncText()}</div></div>
          <span class="sync-dot ${syncStatus}" id="sync-dot"></span></div>
        ${link('sync-now', 'Sync now')}
        ${link('sign-out', 'Sign out', 'red')}
      </div>` : `
      <div class="card list">
        <button class="item link-row" data-action="auth-open"><div class="item-main"><div class="t">Sign in</div>
          <div class="s">Save your hifdh to your account and use it on any device</div></div>${I.chev}</button>
      </div>`;
  return head('Planner', 'Settings') + `
    <section class="block"><div class="group-title">Account</div>${account}</section>
    <section class="block"><div class="group-title">Appearance</div>
      ${segWrap('seg-theme', themes.indexOf(ui.theme), 3, themes.map(t =>
        `<button class="${ui.theme === t ? 'on' : ''}" data-action="theme" data-v="${t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join(''))}
    </section>
    <section class="block"><div class="group-title">Daily workload (juz)</div>
      <div class="card list">
        ${row('Strengthen', 'One weak section at a time', '<span class="fixed">½</span>')}
        ${row('Confidence', 'Strong · unconfident', stepper('confPerDay', 0, 8, juz))}
        ${row('Maintenance', 'Strong · confident', stepper('maintPerDay', 0, 20, juz))}
        <div class="item total"><span class="t">Typical day</span><span class="meta">≈ ${fmtJuz(total)} juz</span></div>
      </div></section>

    <section class="block"><div class="group-title">Cycles</div>
      <div class="card list">
        ${row('Strengthening cycle', 'Days on each weak section', stepper('cycleLength', 1, 10, v => `${v} d`))}
        ${row('Confidence check-in', 'Revisions before asking', stepper('promoteAfter', 1, 30, v => `${v}×`))}
      </div></section>

    <section class="block"><div class="group-title">Preview</div>
      <div class="card list">
        ${row('Simulate days', st.dayOffset ? `Viewing ${st.dayOffset} day${st.dayOffset > 1 ? 's' : ''} ahead` : 'Step forward to see the plan roll over',
          `<div class="stepper">
            <button data-action="step" data-key="dayOffset" data-d="-1" ${st.dayOffset <= 0 ? 'disabled' : ''} aria-label="Back a day">−</button>
            <span>${st.dayOffset ? `+${st.dayOffset}` : 'Today'}</span>
            <button data-action="step" data-key="dayOffset" data-d="1" aria-label="Forward a day">+</button>
          </div>`)}
      </div></section>

    <section class="block"><div class="group-title">Data</div>
      <div class="card list">
        ${auth ? '' : link('sample', 'Load sample hifdh')}
        ${link('export', 'Export backup')}
        ${link('reset', 'Reset everything', 'red')}
      </div></section>
    <p class="foot">${auth ? 'Saved on this device and synced to your account.' : 'Saved on this device only.'}</p>`;
}

/* ---------- Sheets ---------- */
function openSheet(html, refresh = false) {
  const body = $('#sheet-body'), sheet = $('#sheet');
  body.innerHTML = html;
  settle(body);
  if (refresh) return;
  sheet.scrollTop = 0;
  if (!reducedMotion) {
    [...body.children].forEach((el, i) => el.style.setProperty('--i', Math.min(i, 10)));
    sheet.classList.remove('fresh');
    void sheet.offsetWidth;
    sheet.classList.add('fresh');
    clearTimeout(openSheet.t);
    openSheet.t = setTimeout(() => sheet.classList.remove('fresh'), 900);
  }
  $('#scrim').classList.add('on');
  sheet.classList.add('on');
}
function closeSheet() {
  $('#scrim').classList.remove('on');
  $('#sheet').classList.remove('on');
}
let sheetSid = null;

const opt = (action, sid, t, s) =>
  `<button class="item opt" data-action="${action}" ${sid ? `data-sid="${sid}"` : ''}><div class="item-main"><div class="t">${t}</div><div class="s">${s}</div></div>${I.chev}</button>`;

function openSection(sid) {
  const refresh = sheetSid === sid && $('#sheet').classList.contains('on');
  sheetSid = sid;
  const s = state.sections[sid];
  const c = cat(s);
  const pos = queuePosition(s);
  const idx = state.weakQueue.indexOf(sid);
  const isCur = c === 'weak' && idx === 0;
  const qName = { weak: 'Weak', conf: 'Confidence', maint: 'Maintenance' }[c];
  const P = state.settings.promoteAfter;

  const status = {
    weak: isCur ? `Strengthening now — day ${Math.min(s.cycleDone + 1, cycleTarget(s))} of ${cycleTarget(s)}` : `Waiting in the weak queue`,
    conf: `Building confidence — ${s.confRevs} of ${P} revisions`,
    maint: 'In long-term maintenance',
    none: 'Not part of your revision plan',
  }[c];

  const kv = (k, v) => `<div class="item"><span class="k">${k}</span><span class="v" ${anim(`kv-${sid}-${k}`, 'bump', v)}>${v}</span></div>`;
  const stats = c === 'none' ? '' : `<div class="card list kv">
      ${kv('Queue', `${qName} · #${pos}`)}
      ${kv('Next revision', relDay(nextScheduled(s)))}
      ${kv('Last revised', agoDay(s.lastRevised))}
      ${kv('Times revised', s.revisionCount)}
      ${c === 'weak' ? kv('Cycle', `${s.cycleDone} of ${cycleTarget(s)} days`) : ''}
    </div>`;

  // Stats only — classification is changed from the Hifdh map's Select mode.
  openSheet(`
    <div class="sh-head"><h2>${title(sid)}</h2><p>${subtitle(sid)}</p></div>
    <p class="status">${dot(c)}${status}</p>
    ${stats}`, refresh);
}

function openCycleEnd(sid) {
  sheetSid = null;
  const s = state.sections[sid];
  openSheet(`
    <div class="sh-head"><h2>Cycle complete</h2><p>${cycleTarget(s)} days on ${title(sid)}. How does it feel?</p></div>
    <div class="card list opts">
      ${opt('finish-cycle', sid, "It's strong", 'Move to confidence building and start the next section')}
      ${opt('extend', sid, 'One more day', 'Extend this cycle by a day')}
      ${opt('restart', sid, 'Restart the cycle', 'Still feels weak — begin again from day 1')}
    </div>
    <div class="links"><button class="link" data-action="close-sheet">Decide later</button></div>`);
}

function openCycleOpts(sid) {
  sheetSid = null;
  const s = state.sections[sid];
  openSheet(`
    <div class="sh-head"><h2>Strengthening cycle</h2><p>${title(sid)} · ${s.cycleDone} of ${cycleTarget(s)} days done</p></div>
    <div class="card list opts">
      ${opt('finish-cycle', sid, "Finish early — it's strong", 'Moves to the confidence queue')}
      ${opt('extend', sid, 'Extend by a day', `Cycle becomes ${cycleTarget(s) + 1} days`)}
      ${opt('restart', sid, 'Restart from day 1', 'Keep working on it from the beginning')}
      ${opt('switch-weak', null, 'Work on a different section', 'Progress on this one is kept')}
    </div>`);
}

function openPromote(sid) {
  sheetSid = null;
  const s = state.sections[sid];
  openSheet(`
    <div class="sh-head"><h2>Feeling confident?</h2><p>You've revised ${title(sid)} ${s.confRevs} times.</p></div>
    <div class="card list opts">
      <button class="item opt" data-action="set-conf" data-sid="${sid}" data-v="confident"><div class="item-main"><div class="t">Yes, it's confident</div><div class="s">Move to maintenance</div></div>${I.chev}</button>
      ${opt('close-sheet', null, 'Keep practising', 'Stays in the confidence rotation')}
    </div>`);
}

function openReset() {
  sheetSid = null;
  openSheet(`
    <div class="sh-head"><h2>Reset everything?</h2><p>This clears every classification, queue and revision record ${auth ? 'on this device and in your account' : 'on this device'}.</p></div>
    <button class="btn danger" data-action="reset-yes">Reset</button>
    <div class="links"><button class="link" data-action="close-sheet">Cancel</button></div>`);
}

/* =========================================================================
   Account & sync
   The whole planner state is one document per account. Each save sends the
   server version it was based on; if another device saved in between, the
   copy changed most recently wins.
   ========================================================================= */
const API_URL = ['localhost', '127.0.0.1'].includes(location.hostname)
  ? `http://${location.hostname}:8787`
  : 'https://br-misty-base-b1vi3gxo-hifdhapi.compute.c-5.eu-central-1.aws.neon.tech';
const AUTH_KEY = STORAGE_KEY + '.auth';
const SYNC_KEY = STORAGE_KEY + '.sync';

const readJSON = key => { try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; } };
const writeJSON = (key, v) => { try { v == null ? localStorage.removeItem(key) : localStorage.setItem(key, JSON.stringify(v)); } catch (e) {} };

let auth = readJSON(AUTH_KEY);                 // { token, username, expiresAt }
let sync = readJSON(SYNC_KEY) || { version: 0, dirty: false, lastSyncedAt: null };
let syncStatus = 'idle';                       // idle | syncing | offline | error | paused
let pendingRemote = null;                      // account copy awaiting "which data?" choice
const deviceId = (() => {
  let id = null;
  try { id = localStorage.getItem(STORAGE_KEY + '.device'); } catch (e) {}
  if (!id) {
    id = Math.random().toString(36).slice(2, 10);
    try { localStorage.setItem(STORAGE_KEY + '.device', id); } catch (e) {}
  }
  return id;
})();

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const saveSync = () => writeJSON(SYNC_KEY, sync);
const previewing = () => state.settings.dayOffset > 0;

async function api(method, path, body) {
  const res = await fetch(API_URL + path, {
    method,
    headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${auth.token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && auth && path !== '/login' && path !== '/register') signedOut('Your session ended. Sign in again to keep syncing.');
    const err = new Error(data?.message || 'Something went wrong.');
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function setSyncStatus(s) {
  syncStatus = s;
  const text = document.getElementById('sync-text'), dot = document.getElementById('sync-dot');
  if (text) text.textContent = syncText();
  if (dot) dot.className = `sync-dot ${s}`;
}
function syncText() {
  if (syncStatus === 'paused') return 'Sync paused while previewing days';
  if (syncStatus === 'syncing') return 'Syncing…';
  if (syncStatus === 'offline') return 'Offline — will sync when you’re back online';
  if (syncStatus === 'error') return 'Couldn’t sync — try Sync now';
  if (sync.dirty) return 'Changes waiting to sync';
  if (!sync.lastSyncedAt) return 'Signed in';
  const mins = Math.round((Date.now() - sync.lastSyncedAt) / 60000);
  return mins < 1 ? 'Synced just now' : mins < 60 ? `Synced ${mins} min ago` : `Synced ${new Date(sync.lastSyncedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`;
}

/** The document sent to the account; the preview day offset stays on this device. */
const payload = () => ({ ...state, settings: { ...state.settings, dayOffset: 0 } });

function markDirty() {
  if (!auth) return;
  if (hasPlannerData(state)) sync.allowEmpty = false;
  sync.dirty = true;
  saveSync();
  schedulePush();
}

let pushTimer = null, pushing = false;
function schedulePush(delay = 1200) {
  if (!auth) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushNow, delay);
}

async function pushNow() {
  if (!auth || !sync.dirty) return;
  if (previewing()) return setSyncStatus('paused');
  if (pushing) return schedulePush();
  // An empty planner never overwrites the account unless you chose Reset; fetch the account instead.
  if (!hasPlannerData(state) && !sync.allowEmpty) {
    sync.dirty = false;
    saveSync();
    return pull();
  }
  pushing = true;
  setSyncStatus('syncing');
  const sentAt = state.updatedAt;
  try {
    const r = await api('PUT', '/state', {
      state: payload(), baseVersion: sync.version, deviceId,
      updatedAt: new Date(state.updatedAt || Date.now()).toISOString(),
    });
    sync.version = r.version;
    if (state.updatedAt === sentAt) sync.dirty = false;
    sync.lastSyncedAt = Date.now();
    saveSync();
    setSyncStatus('idle');
  } catch (e) {
    if (e.status === 409 && e.data?.current) { resolveWith(e.data.current); setSyncStatus('idle'); }
    else if (auth) setSyncStatus(e.status ? 'error' : 'offline');
  } finally {
    pushing = false;
    if (auth && sync.dirty && syncStatus === 'idle') schedulePush(300);
  }
}

/** Fetch the account copy; take it if it's newer, otherwise send ours. */
async function pull() {
  if (!auth) return;
  if (previewing()) return setSyncStatus('paused');
  setSyncStatus('syncing');
  try {
    const remote = await api('GET', '/state');
    if (!hasPlannerData(state) && hasPlannerData(remote.state) && !sync.allowEmpty) {
      // This device has nothing (new, cleared, or couldn't read its data) but the account does.
      adopt(remote);
      toast('Restored your hifdh from your account');
    } else if (remote.version > sync.version) resolveWith(remote);
    sync.lastSyncedAt = Date.now();
    saveSync();
    setSyncStatus('idle');
    if (sync.dirty) pushNow();
  } catch (e) {
    if (auth) setSyncStatus(e.status ? 'error' : 'offline');
  }
}

/** Another copy exists on the server: keep whichever was changed most recently. */
function resolveWith(remote) {
  const remoteAt = remote.updatedAt ? Date.parse(remote.updatedAt) : 0;
  if (remote.state && (!sync.dirty || remoteAt > (state.updatedAt || 0))) {
    const hadLocalChanges = sync.dirty;
    adopt(remote);
    if (hadLocalChanges) toast('Updated with newer changes from another device');
  } else {
    sync.version = remote.version;      // ours is newer: overwrite on the next push
    sync.dirty = true;
    saveSync();
  }
}

/** Replace local state with the account copy. */
function adopt(remote) {
  const offset = state.settings.dayOffset;
  const s = upgrade(remote.state);
  s.settings.dayOffset = offset;
  s.updatedAt = remote.updatedAt ? Date.parse(remote.updatedAt) : Date.now();
  state = s;
  sync.version = remote.version;
  sync.dirty = false;
  saveSync();
  normalize();
  refreshPlan();
  save();
  render();
}

async function signIn(mode, username, password) {
  const r = await api('POST', mode === 'register' ? '/register' : '/login', { username, password });
  auth = { token: r.token, username: r.user.username, expiresAt: r.expiresAt };
  writeJSON(AUTH_KEY, auth);
  sync = { version: 0, dirty: false, lastSyncedAt: null };
  saveSync();
  const localHasData = sections().some(s => s.memorised);

  if (!r.hasData) {
    closeSheet();
    render();
    if (localHasData) { sync.dirty = true; saveSync(); await pushNow(); }
    else sync.lastSyncedAt = Date.now();
    toast(mode === 'register' ? 'Account created — your hifdh is backed up' : 'Signed in');
    return;
  }
  const remote = await api('GET', '/state');
  if (!localHasData) {
    closeSheet();
    adopt(remote);
    sync.lastSyncedAt = Date.now();
    saveSync();
    toast('Welcome back — your hifdh is restored');
    return;
  }
  pendingRemote = remote;
  openChooseData(remote);
  render();
}

function signedOut(msg) {
  auth = null;
  writeJSON(AUTH_KEY, null);
  sync = { version: 0, dirty: false, lastSyncedAt: null };
  writeJSON(SYNC_KEY, null);
  clearTimeout(pushTimer);
  setSyncStatus('idle');
  render();
  if (msg) toast(msg);
}

async function signOut() {
  if (sync.dirty) await pushNow();
  try { await api('POST', '/logout'); } catch (e) {}
  signedOut('Signed out. Your data stays on this device.');
}

function openAuth(mode = 'login', keep = null) {
  sheetSid = null;
  const login = mode === 'login';
  const b = (v, text) => `<button type="button" class="${mode === v ? 'on' : ''}" data-action="auth-mode" data-v="${v}">${text}</button>`;
  openSheet(`
    <div class="sh-head"><h2>${login ? 'Welcome back' : 'Create an account'}</h2>
      <p>${login ? 'Sign in to sync your hifdh.' : 'Your planner is saved to your account and kept in sync on every device.'}</p></div>
    ${segWrap('seg-auth', login ? 0 : 1, 2, b('login', 'Sign in') + b('register', 'Create account'))}
    <form id="auth-form" data-mode="${mode}" novalidate>
      <input class="input" name="username" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false"
        placeholder="Username" value="${esc(keep?.username ?? auth?.username ?? '')}">
      <input class="input" name="password" type="password" autocomplete="${login ? 'current-password' : 'new-password'}" placeholder="Password">
      <p class="form-error" id="auth-error" role="alert"></p>
      <button class="btn" type="submit">${login ? 'Sign in' : 'Create account'}</button>
    </form>
    ${login ? '' : '<p class="fine">3–32 letters, numbers, dots, dashes or underscores. Passwords need 8+ characters. There’s no password reset, so keep it somewhere safe.</p>'}`, !!keep);
}

async function submitAuth(form) {
  const mode = form.dataset.mode;
  const username = form.username.value.trim();
  const password = form.password.value;
  const error = document.getElementById('auth-error');
  const btn = form.querySelector('button[type=submit]');
  const fail = msg => { error.textContent = msg; error.classList.remove('shake'); void error.offsetWidth; error.classList.add('shake'); };
  if (!username || !password) return fail('Enter a username and password.');
  if (mode === 'register' && password.length < 8) return fail('Use at least 8 characters for your password.');
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = mode === 'login' ? 'Signing in…' : 'Creating account…';
  error.textContent = '';
  try {
    await signIn(mode, username, password);
  } catch (e) {
    fail(e.status ? e.message : 'Can’t reach the server. Check your connection and try again.');
    btn.disabled = false;
    btn.textContent = label;
  }
}

function openChooseData(remote) {
  sheetSid = null;
  const when = remote.updatedAt ? new Date(remote.updatedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'earlier';
  openSheet(`
    <div class="sh-head"><h2>Which data should we keep?</h2><p>Your account already has a saved planner, and this device has its own.</p></div>
    <div class="card list opts">
      ${opt('use-remote', null, 'Use my account’s data', `Last saved ${when}. Replaces what’s on this device.`)}
      ${opt('use-local', null, 'Keep this device’s data', 'Overwrites the copy in your account.')}
    </div>`);
}

/* ---------- Toast ---------- */
let toastTimer;
function toast(msg, undo) {
  const el = $('#toast');
  el.innerHTML = `<span>${msg}</span>${undo ? '<button id="toast-undo">Undo</button>' : ''}`;
  el.classList.add('on');
  if (undo) $('#toast-undo').onclick = () => { undo(); el.classList.remove('on'); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), 3200);
}

/* ---------- Helpers ---------- */
function fmtJuz(halves) { const w = Math.floor(halves / 2), f = halves % 2; return `${w || ''}${f ? '½' : ''}` || '0'; }
function fmtNum(juz) { return fmtJuz(Math.round(juz * 2)); }
function haptic() { try { navigator.vibrate && navigator.vibrate(12); } catch (e) {} }

/* =========================================================================
   Events
   ========================================================================= */
const actions = {
  tab: d => { ui.tab = d.tab; try { localStorage.setItem(STORAGE_KEY + '.tab', d.tab); } catch (e) {} window.scrollTo(0, 0); render(); },
  qtab: d => { if (ui.queueTab === d.q) return; ui.queueTab = d.q; render({ sub: true }); },
  theme: (d, el, e) => setTheme(d.v, e.clientX, e.clientY),
  complete: d => completeItem(+d.sid),
  undo: d => undoItem(+d.sid),
  open: d => openSection(+d.sid),
  'close-sheet': () => closeSheet(),
  'finish-cycle': d => { closeSheet(); finishCycle(+d.sid); },
  extend: d => { closeSheet(); extendCycle(+d.sid); },
  restart: d => { closeSheet(); restartCycle(+d.sid); },
  'cycle-opts': d => openCycleOpts(+d.sid),
  'switch-weak': () => { closeSheet(); ui.tab = 'queues'; ui.queueTab = 'weak'; render(); toast('Use ↑ or tap a section to choose what’s next'); },
  promote: d => openPromote(+d.sid),
  wmove: d => moveWeak(+d.sid, +d.to),
  'work-now': d => { moveWeak(+d.sid, 0); closeSheet(); toast(`Now strengthening ${title(+d.sid)}`); },
  'make-next': d => { moveWeak(+d.sid, 1); closeSheet(); toast(`${title(+d.sid)} is up next`); },
  'set-str': d => { classify(+d.sid, { strength: d.v }); commit(); openSection(+d.sid); },
  'set-conf': d => {
    const s = state.sections[+d.sid];
    const wasCat = cat(s);
    classify(+d.sid, { confidence: d.v }); commit();
    if (sheetSid === +d.sid) openSection(+d.sid);
    else { closeSheet(); if (wasCat === 'conf' && d.v === 'confident') toast(`${title(+d.sid)} moved to maintenance`); }
  },
  'set-mem': d => {
    const on = d.v === '1';
    classify(+d.sid, on ? { memorised: true, strength: 'weak', confidence: 'unconfident' } : { memorised: false });
    commit(); openSection(+d.sid);
  },
  'start-setup': () => { ui.tab = 'map'; ui.selecting = true; render(); toast('Select sections, then choose their state'); },
  sample: () => loadSample(),
  'toggle-select': () => { ui.selecting = !ui.selecting; ui.selected.clear(); render(); },
  sel: d => { const id = +d.sid; ui.selected.has(id) ? ui.selected.delete(id) : ui.selected.add(id); render(); },
  'sel-all': () => { if (ui.selected.size === 60) ui.selected.clear(); else for (let i = 1; i <= 60; i++) ui.selected.add(i); render(); },
  bulk: d => {
    const patch = {
      weak: { memorised: true, strength: 'weak', confidence: 'unconfident' },
      conf: { memorised: true, strength: 'strong', confidence: 'unconfident' },
      maint: { memorised: true, strength: 'strong', confidence: 'confident' },
      none: { memorised: false },
    }[d.kind];
    const n = ui.selected.size;
    [...ui.selected].sort((a, b) => a - b).forEach(id => classify(id, { ...patch }));
    ui.selected.clear();
    commit();
    toast(`${n} section${n > 1 ? 's' : ''} → ${CAT_NAME[d.kind]}`);
  },
  step: d => {
    const lim = { confPerDay: [0, 8], maintPerDay: [0, 20], cycleLength: [1, 10], promoteAfter: [1, 30], dayOffset: [0, 365] }[d.key];
    const v = state.settings[d.key] + +d.d;
    if (v < lim[0] || v > lim[1]) return;
    state.settings[d.key] = v;
    commit();
    if (d.key === 'dayOffset' && v === 0 && auth) pull();
  },
  export: () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `hifdh-backup-${today()}.json`;
    a.click();
  },
  reset: () => openReset(),
  'hifdh-view': d => {
    if (ui.hifdhView === d.v) return;
    ui.hifdhView = d.v;
    ui.selecting = false;
    ui.selected.clear();
    ui.barSel = null;
    render({ sub: true });
  },
  // Tap a chart mark: highlight it and show its value in the chart's readout line.
  peek: (d, el) => {
    if (d.group === 'bar-mark') {
      ui.barSel = +d.i;
      document.querySelectorAll('.bar-mark').forEach(m => m.classList.toggle('sel', m.dataset.i === d.i));
    } else {
      document.querySelectorAll(`.${d.group}`).forEach(m => m.classList.toggle('sel', m === el));
    }
    const out = document.getElementById(d.target);
    if (out) out.innerHTML = d.text;
  },
  'chart-range': d => {
    const v = d.v === 'all' ? 'all' : +d.v;
    if (ui.chartRange === v) return;
    ui.chartRange = v;
    ui.barSel = null;
    render();
  },
  'eta-info': () => openEtaInfo(),
  'log-open': () => { ui.logSel = new Set(); ui.logDate = null; ui.logEarlier = false; openLog(); },
  'log-date': d => {
    const t = today();
    ui.logEarlier = d.v === 'earlier';
    ui.logDate = d.v === 'today' ? t : d.v === 'yesterday' ? addDays(t, -1)
      : (ui.logDate && ui.logDate < addDays(t, -1) ? ui.logDate : addDays(t, -2));
    openLog(true);
  },
  'log-sel': d => { const id = +d.sid; ui.logSel.has(id) ? ui.logSel.delete(id) : ui.logSel.add(id); openLog(true); },
  'log-save': () => {
    const ids = [...ui.logSel].sort((a, b) => a - b);
    if (!ids.length) return;
    const date = ui.logDate || today();
    ui.logSel = new Set();
    closeSheet();
    logRecitations(ids, date);
  },
  'auth-open': () => openAuth('login'),
  'auth-mode': d => {
    const form = document.getElementById('auth-form');
    if (form && form.dataset.mode !== d.v) openAuth(d.v, { username: form.username.value });
  },
  'sync-now': () => { if (sync.dirty) pushNow(); else pull(); },
  'sign-out': () => signOut(),
  'use-remote': () => { closeSheet(); if (pendingRemote) adopt(pendingRemote); pendingRemote = null; toast('Loaded your account’s data'); },
  'use-local': () => {
    closeSheet();
    if (pendingRemote) { sync.version = pendingRemote.version; pendingRemote = null; }
    state.updatedAt = Date.now();
    save();
    markDirty();
    pushNow();
    toast('Your account now uses this device’s data');
  },
  'reset-yes': () => {
    state = freshState();
    sync.allowEmpty = true;                     // the one case where an empty planner may replace the account's
    saveSync();
    closeSheet();
    ui.tab = 'today';
    commit();
    toast('Everything reset');
  },
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.action];
  if (fn) { e.stopPropagation(); fn(el.dataset, el, e); }
});

// Swipe the sheet down to close.
(() => {
  const sheet = $('#sheet');
  let y0 = null, dy = 0;
  sheet.addEventListener('touchstart', e => { if (sheet.scrollTop <= 0) { y0 = e.touches[0].clientY; dy = 0; } }, { passive: true });
  sheet.addEventListener('touchmove', e => {
    if (y0 === null) return;
    dy = Math.max(0, e.touches[0].clientY - y0);
    sheet.style.transition = 'none';
    sheet.style.transform = `translate(-50%, ${dy}px)`;
  }, { passive: true });
  sheet.addEventListener('touchend', () => {
    if (y0 === null) return;
    sheet.style.transition = ''; sheet.style.transform = '';
    if (dy > 90) closeSheet();
    y0 = null;
  });
})();

document.addEventListener('change', e => {
  if (e.target.id !== 'log-date-input' || !e.target.value) return;
  const t = today();
  ui.logDate = e.target.value > addDays(t, -1) ? addDays(t, -1) : e.target.value;
  openLog(true);
});

document.addEventListener('submit', e => {
  if (e.target.id !== 'auth-form') return;
  e.preventDefault();
  submitAuth(e.target);
});

// Coming back to the app: roll the plan over after midnight and pick up other devices' changes.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { if (sync.dirty) pushNow(); return; }
  if (state.plan && state.plan.date !== today()) { refreshPlan(); save(); render(); }
  pull();
});
addEventListener('online', () => pull());

state = load();
applyTheme(ui.theme);
normalize();
refreshPlan();
save();
render();
pull();
