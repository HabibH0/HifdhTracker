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
let state = load();
let ui = { tab: 'today', queueTab: 'weak', selecting: false, selected: new Set(), theme: 'system', justDone: null };
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
      lastRevised: null, revisionCount: 0, enteredAt: 0,
    };
  }
  return { settings: { ...DEFAULT_SETTINGS }, sections, weakQueue: [], plan: null };
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      s.settings = { ...DEFAULT_SETTINGS, ...s.settings };
      return s;
    }
  } catch (e) {}
  return freshState();
}

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

/** Rotation order for confidence / maintenance: longest-unrevised first. */
function rotation(c) {
  return inCat(c).sort((a, b) =>
    (a.lastRevised || '').localeCompare(b.lastRevised || '') || a.enteredAt - b.enteredAt || a.id - b.id);
}

function normalize() {
  const weakIds = new Set(inCat('weak').map(s => s.id));
  state.weakQueue = state.weakQueue.filter(id => weakIds.has(id));
  for (const s of inCat('weak').sort((a, b) => a.id - b.id)) {
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
    if (after === 'conf') s.confRevs = 0;
    if (after === 'weak') { s.cycleDone = 0; s.extraDays = 0; }
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

/* ---------- Actions on sections ---------- */
function completeItem(sid) {
  const it = planItem(sid);
  if (!it || it.done) return;
  const s = state.sections[sid];
  it.prev = { lastRevised: s.lastRevised, revisionCount: s.revisionCount, cycleDone: s.cycleDone, confRevs: s.confRevs };
  it.done = true;
  s.lastRevised = today();
  s.revisionCount++;
  if (it.cat === 'weak') s.cycleDone++;
  if (it.cat === 'conf') s.confRevs++;
  ui.justDone = sid;
  commit();
  haptic();

  if (it.cat === 'weak' && s.cycleDone >= cycleTarget(s)) {
    setTimeout(() => openCycleEnd(sid), 350);
  } else if (it.cat === 'conf' && s.confRevs === state.settings.promoteAfter) {
    setTimeout(() => openPromote(sid), 350);
  } else {
    toast(`${title(sid)} revised`, () => undoItem(sid));
  }
}

function undoItem(sid) {
  const it = planItem(sid);
  if (!it || !it.done) return;
  Object.assign(state.sections[sid], it.prev);
  it.done = false;
  delete it.prev;
  commit();
}

function finishCycle(sid) {
  const s = state.sections[sid];
  classify(sid, { strength: 'strong', confidence: 'unconfident' });
  s.cycleDone = 0; s.extraDays = 0;
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
    ${weakBlock()}
    ${listBlock('conf', 'Confidence', state.settings.confPerDay)}
    ${listBlock('maint', 'Maintenance', state.settings.maintPerDay)}`;
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
  let html = head(`${fmtJuz(60 - counts.none)} of 30 juz memorised`, 'My hifdh',
    `<button class="head-action ${ui.selecting ? 'on' : ''}" data-action="toggle-select">${ui.selecting ? 'Done' : 'Select'}</button>`);
  html += `<div class="legend">${Object.keys(names).map(c => `<span>${dot(c)}${names[c]} <b>${counts[c]}</b></span>`).join('')}</div>`;
  if (ui.selecting) html += `<p class="map-hint">Tap halves to select them, then choose a state below.</p>`;
  html += `<div class="grid">`;
  for (let j = 1; j <= 30; j++) {
    const half = s => `<button class="half ${cat(s)} ${ui.selected.has(s.id) ? 'sel' : ''} ${s.id === cur ? 'cur' : ''}" ${anim(`h-${s.id}`, 'bump', `${cat(s)}${ui.selected.has(s.id) ? '-s' : ''}`)}
      data-action="${ui.selecting ? 'sel' : 'open'}" data-sid="${s.id}" aria-label="${title(s.id)}"></button>`;
    html += `<div class="juz" style="--j:${j - 1}"><div class="jn">${j}</div><div class="halves">${half(state.sections[j * 2 - 1])}${half(state.sections[j * 2])}</div></div>`;
  }
  html += `</div>`;
  if (ui.selecting) html += `<div style="height:120px"></div>`;
  return html;
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
    if (remote.version > sync.version) resolveWith(remote);
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
  const s = remote.state;
  s.settings = { ...DEFAULT_SETTINGS, ...s.settings, dayOffset: offset };
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
  'reset-yes': () => { state = freshState(); closeSheet(); ui.tab = 'today'; commit(); toast('Everything reset'); },
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

applyTheme(ui.theme);
normalize();
refreshPlan();
save();
render();
pull();
