import { createConfig } from './config.js';
import { validateMetadata, MISTAKE_TYPES } from './metadata.js';
import { MemoryStore } from './store.js';
import { addDays, calendarDay, clamp, elapsedDays, instant, percentile } from './time.js';
import { buildDailyPlan } from './planner.js';
import { resolveMemorizedSelection } from './inventory.js';

const clone = value => structuredClone(value);
const goodAccuracy = rating => rating === 'good' || rating === 'perfect';
const strongStates = new Set(['strong', 'very_strong']);

export class RevisionEngine {
  constructor({ metadata, initializedAt, memorized = {}, initialStrength, config = {}, store = new MemoryStore() } = {}) {
    this.store = store;
    const existing = store.load();
    if (existing) {
      if (existing.schemaVersion !== 1) throw new Error('Unsupported store schema version');
      this.config = createConfig(existing.config);
      this.metadata = validateMetadata(existing.metadata);
      this.events = clone(existing.events);
      this.version = existing.version;
    } else {
      this.config = createConfig(config);
      this.metadata = validateMetadata(metadata);
      const at = instant(initializedAt, this.config.timeZone);
      const memorizedAyahIds = resolveMemorizedSelection(this.metadata, memorized);
      const known = new Set(memorizedAyahIds);
      const strengths = {};
      for (const page of this.metadata.pages) {
        if (!page.ayahIds.some(id => known.has(id))) continue;
        const strength = (typeof initialStrength === 'string' ? initialStrength : initialStrength?.[page.id]) ?? this.config.inventory.defaultInitialStrength;
        if (!Object.hasOwn(this.config.initialStrength, strength)) throw new Error(`Missing or unknown initial strength for ${page.id}`);
        strengths[page.id] = strength;
      }
      this.events = [{ id: 'event-1', type: 'initialized', occurredAt: at, strengths, memorizedAyahIds }];
      this.version = 0;
    }
    this.pageMetadata = new Map(this.metadata.pages.map(p => [p.id, p]));
    this.halfJuzIds = [...new Set(this.metadata.pages.map(p => p.halfJuzId))];
    this.juzIds = [...new Set(this.metadata.pages.map(p => p.juzId))];
    this._rebuild();
    if (!existing) this._save();
  }

  /** Recalculate from raw events, optionally with a new configuration, into a separate store. */
  static replay(document, { config = document.config, store = new MemoryStore() } = {}) {
    const copy = clone(document);
    copy.config = createConfig(config);
    copy.version = 1;
    delete copy.snapshot;
    store.save(copy, 0);
    const engine = new RevisionEngine({ store });
    engine._save();
    return engine;
  }

  exportData() { return clone({ schemaVersion: 1, version: this.version, config: this.config, metadata: this.metadata, events: this.events, snapshot: this.state }); }

  _rebuild() {
    this.state = { pages: {}, cycles: [], retention: {}, repairRequests: {}, sessions: {}, mistakes: [], maintenance: {} };
    for (const event of this.events) this._apply(event);
  }

  _save() {
    const document = this.exportData();
    document.version = this.version + 1;
    this.store.save(document, this.version);
    this.version = document.version;
  }

  _commit(events) {
    const oldState = clone(this.state), oldEvents = this.events;
    try {
      this.events = [...this.events];
      for (const event of events) {
        event.id = `event-${this.events.length + 1}`;
        this.events.push(clone(event));
        this._apply(event);
      }
      this._save();
    } catch (error) { this.state = oldState; this.events = oldEvents; throw error; }
  }

  _at(value, writing = false) {
    let at = instant(value, this.config.timeZone);
    const latest = this.events.at(-1).occurredAt;
    if (!writing && /^\d{4}-\d{2}-\d{2}$/.test(value) && calendarDay(latest, this.config.timeZone) === value && at < latest) at = latest;
    if (at < (writing ? latest : this.events[0].occurredAt)) throw new Error(writing ? 'Events must be recorded in chronological order; replay an ordered event log to import older history' : 'Query precedes initialization');
    if (!writing && at < latest) throw new Error('Query precedes latest event; replay a historical event prefix first');
    return at;
  }
  _page(id) { if (!Object.hasOwn(this.state.pages, id)) throw new Error(`Unknown page: ${id}`); return this.state.pages[id]; }
  _halfPages(id) {
    const pages = this.metadata.pages.filter(p => p.halfJuzId === id).map(p => p.id);
    if (!pages.length) throw new Error(`Unknown half-juz: ${id}`);
    return pages.filter(pageId => this._page(pageId).memorizedAyahIds.length);
  }
  _knownPages() { return this.metadata.pages.filter(p => this._page(p.id).memorizedAyahIds.length); }
  _isCompleteReview(review) { return review.scope === 'page' || review.scope === 'memorized'; }
  _pageFraction(id) { return this._page(id).memorizedAyahIds.length / this.pageMetadata.get(id).ayahIds.length; }
  _pageMinutes(id, targeted = false) {
    const base = targeted ? this.config.durations.targetedPageMinutes : this.config.durations.activePageMinutes;
    return Math.min(base, Math.max(this.config.durations.minimumPartialPageMinutes, base * this._pageFraction(id)));
  }
  _passage(pageIds) {
    const pages = pageIds.map(pageId => {
      const page = this._page(pageId);
      return { pageId, scope: page.coverage === 'complete' ? 'page' : 'memorized', ayahIds: [...page.memorizedAyahIds], coverage: page.coverage };
    });
    return { layoutId: this.metadata.layoutId, pageIds: [...pageIds], ayahIds: [...new Set(pages.flatMap(p => p.ayahIds))], pages };
  }

  getMemorizedMaterial() {
    const pages = this._passage(this._knownPages().map(p => p.id)).pages;
    const known = new Set(pages.flatMap(p => p.ayahIds));
    return { layoutId: this.metadata.layoutId, ayahIds: this.metadata.ayat.filter(a => known.has(a.id)).map(a => a.id), pages, totalTrackedPages: pages.length, completePages: pages.filter(p => p.coverage === 'complete').length, partialPages: pages.filter(p => p.coverage === 'partial').length };
  }

  addMemorizedMaterial({ selection, occurredAt, initialStrength }) {
    const at = this._at(occurredAt, true), selected = resolveMemorizedSelection(this.metadata, selection);
    const existing = new Set(this.getMemorizedMaterial().ayahIds);
    const ayahIds = selected.filter(id => !existing.has(id));
    const strengths = {};
    for (const page of this.metadata.pages.filter(p => p.ayahIds.some(id => ayahIds.includes(id)))) {
      const strength = (typeof initialStrength === 'string' ? initialStrength : initialStrength?.[page.id]) ?? this.config.inventory.defaultInitialStrength;
      if (!Object.hasOwn(this.config.initialStrength, strength)) throw new Error(`Unknown initial strength for ${page.id}`);
      strengths[page.id] = strength;
    }
    if (ayahIds.length) this._commit([{ type: 'memorized_material_added', occurredAt: at, ayahIds, strengths }]);
    return this.getMemorizedMaterial();
  }
  _activeCycle() { return this.state.cycles.find(c => c.status === 'active'); }
  _cycleForPage(id) { return this.state.cycles.find(c => c.status === 'active' && c.pageIds.includes(id)); }
  _retentionForPage(id) { return Object.values(this.state.retention).find(r => r.status === 'pending' && r.pageIds.includes(id)); }
  _quality(review) { return this.config.accuracy[review.accuracy] * this.config.reviewFluency[review.fluency]; }

  _normalizeMistake(input, pageId) {
    const page = this.pageMetadata.get(pageId);
    if (input.ayahId != null && !page.ayahIds.includes(input.ayahId)) throw new Error('Mistake ayah must be contained on the page');
    if (input.type != null && !MISTAKE_TYPES.includes(input.type)) throw new Error('Unknown mistake type');
    if (input.confusedWithAyahId != null && (!this.metadata.ayat.some(a => a.id === input.confusedWithAyahId) || input.confusedWithAyahId === input.ayahId || !input.ayahId)) throw new Error('Confusion requires two distinct known ayat');
    const count = input.count ?? 1;
    if (!Number.isInteger(count) || count < 1) throw new Error('Mistake count must be a positive integer');
    return { ayahId: input.ayahId ?? null, count, type: input.type ?? null, confusedWithAyahId: input.confusedWithAyahId ?? null, major: input.major === true || this.config.strengthening.majorMistakeTypes.includes(input.type) };
  }

  _normalizeReview(input, activity) {
    const page = this._page(input.pageId);
    if (!page.memorizedAyahIds.length) throw new Error('Page has no memorized material; add it to the inventory first');
    const actualActivity = input.activity ?? activity;
    if (!Object.hasOwn(this.config.activities, actualActivity)) throw new Error('Unknown revision activity');
    const active = this.config.activities[actualActivity].active;
    if (active && !Object.hasOwn(this.config.accuracy, input.accuracy)) throw new Error('Active recall requires an accuracy rating');
    if (!Object.hasOwn(this.config.observedFluency, input.fluency)) throw new Error('Revision requires a fluency rating');
    const scope = input.scope ?? (page.coverage === 'complete' ? 'page' : 'memorized');
    if (!['page', 'memorized', 'ayah'].includes(scope)) throw new Error('Scope must be page, memorized or ayah');
    if (scope === 'page' && page.coverage !== 'complete') throw new Error('Full-page recall requires the entire page to be memorized');
    const contained = this.pageMetadata.get(input.pageId).ayahIds;
    const ayahIds = scope === 'page' ? [...contained] : scope === 'memorized' ? [...page.memorizedAyahIds] : input.ayahIds;
    if (!Array.isArray(ayahIds) || !ayahIds.length || new Set(ayahIds).size !== ayahIds.length || ayahIds.some(id => !contained.includes(id))) throw new Error('Targeted recall needs valid contained ayat');
    if (ayahIds.some(id => !page.memorizedAyahIds.includes(id))) throw new Error('Revision includes an ayah outside memorized material');
    if (scope !== 'ayah' && input.ayahIds && (input.ayahIds.length !== ayahIds.length || ayahIds.some(id => !input.ayahIds.includes(id)))) throw new Error('Complete recall must cover all prescribed memorized ayat; use ayah scope for a subset');
    const mistakes = (input.mistakes ?? []).map(m => this._normalizeMistake(m, input.pageId));
    if (mistakes.some(m => m.ayahId && !ayahIds.includes(m.ayahId))) throw new Error('Mistake lies outside reviewed ayat');
    return { pageId: input.pageId, activity: actualActivity, accuracy: active ? input.accuracy : null, fluency: input.fluency, scope, ayahIds: [...ayahIds], mistakes };
  }

  _sessionInput(input) {
    if (typeof input.sessionId !== 'string' || !input.sessionId || ['__proto__', 'constructor', 'prototype'].includes(input.sessionId) || Object.hasOwn(this.state.sessions, input.sessionId)) throw new Error('A unique sessionId is required');
    const occurredAt = this._at(input.occurredAt, true);
    const actualDurationMinutes = input.actualDurationMinutes ?? null;
    if (actualDurationMinutes !== null && (!Number.isFinite(actualDurationMinutes) || actualDurationMinutes < 0)) throw new Error('Invalid actual session duration');
    return { sessionId: input.sessionId, occurredAt, actualDurationMinutes };
  }

  recordRevision(input) {
    const common = this._sessionInput(input);
    if (!Array.isArray(input.pages) || !input.pages.length) throw new Error('Revision must include pages');
    const purpose = input.purpose ?? 'ordinary';
    if (!['ordinary', 'targeted', 'maintenance', 'early_retention'].includes(purpose)) throw new Error('Unknown revision purpose');
    const reviews = input.pages.map(p => this._normalizeReview(p, input.activity));
    this._commit([{ type: 'revision', ...common, purpose, reviews }]);
    return clone(this.state.sessions[common.sessionId]);
  }

  recordMistake(input) {
    if (!Object.hasOwn(this.state.sessions, input.sessionId)) throw new Error('Mistake must reference an existing revision session');
    const session = this.state.sessions[input.sessionId];
    if (!session) throw new Error('Mistake must reference an existing revision session');
    if (session.purpose === 'strengthening') throw new Error('Include strengthening mistakes inline before submitting the session so stage progression uses complete evidence');
    const reviews = session.reviews.filter(r => r.pageId === input.pageId);
    if (!reviews.length) throw new Error('Page was not reviewed in this session');
    const mistake = this._normalizeMistake(input, input.pageId);
    if (mistake.ayahId && !reviews.some(r => r.ayahIds.includes(mistake.ayahId))) throw new Error('Ayah was not reviewed in this session');
    const recordedAt = this._at(input.recordedAt ?? session.occurredAt, true);
    this._commit([{ type: 'mistake', occurredAt: recordedAt, revisionAt: session.occurredAt, sessionId: input.sessionId, pageId: input.pageId, mistake }]);
    return clone(this.state.mistakes.at(-1));
  }

  startStrengtheningCycle({ halfJuzId, occurredAt, pageIds }) {
    const at = this._at(occurredAt, true);
    const contained = this._halfPages(halfJuzId);
    if (this._activeCycle()) throw new Error('An active strengthening cycle must finish before another starts');
    const selected = pageIds ?? contained;
    if (!selected.length || new Set(selected).size !== selected.length || selected.some(id => !contained.includes(id))) throw new Error('Invalid strengthening pages');
    this._commit([{ type: 'strengthening_started', occurredAt: at, halfJuzId, pageIds: [...selected] }]);
    return clone(this._activeCycle());
  }

  recordStrengtheningSession(input) {
    const common = this._sessionInput(input);
    let cycle = this._activeCycle();
    const events = [];
    if (!cycle) {
      const selected = this.selectNextStrengthening(common.occurredAt);
      const halfJuzId = input.halfJuzId ?? selected?.halfJuzId;
      if (!halfJuzId) throw new Error('No strengthening section selected');
      const pageIds = this.state.repairRequests[halfJuzId]?.pageIds ?? this._halfPages(halfJuzId);
      if (!pageIds.length) throw new Error('This half-juz has no memorized material');
      events.push({ type: 'strengthening_started', occurredAt: common.occurredAt, halfJuzId, pageIds });
      cycle = { halfJuzId, pageIds, stage: 1, lastPassedDay: null };
    }
    if (input.halfJuzId && input.halfJuzId !== cycle.halfJuzId) throw new Error('Another half-juz is already being strengthened');
    const day = calendarDay(common.occurredAt, this.config.timeZone);
    if (cycle.lastPassedDay && day <= cycle.lastPassedDay) throw new Error('The next strengthening stage requires a later calendar day');
    if (!Array.isArray(input.steps) || !input.steps.length) throw new Error('Strengthening requires ordered session steps');
    const steps = input.steps.map(step => {
      if (!['pass', 'targeted'].includes(step.kind) || !Array.isArray(step.reviews) || !step.reviews.length) throw new Error('Invalid strengthening step');
      const reviews = step.reviews.map(r => this._normalizeReview(r, input.activity ?? 'memory'));
      if (reviews.some(r => !this.config.activities[r.activity].active || !cycle.pageIds.includes(r.pageId))) throw new Error('Strengthening requires active recall within the cycle');
      if (step.kind === 'pass' && (reviews.some(r => !this._isCompleteReview(r)) || new Set(reviews.map(r => r.pageId)).size !== reviews.length)) throw new Error('A pass must contain distinct complete recalls of memorized material');
      return { kind: step.kind, reviews };
    });
    const counts = {};
    for (const step of steps.filter(s => s.kind === 'targeted')) for (const r of step.reviews) {
      counts[r.pageId] = (counts[r.pageId] ?? 0) + 1;
      if (counts[r.pageId] > this.config.strengthening.maxTargetedRepetitions) throw new Error('Targeted repetition limit exceeded for this session');
    }
    events.push({ type: 'strengthening_session', ...common, halfJuzId: cycle.halfJuzId, steps });
    this._commit(events);
    return clone(this.state.sessions[common.sessionId]);
  }

  _apply(event) {
    if (event.type === 'initialized') {
      this.state.initializedAt = event.occurredAt;
      // Older event logs predate explicit enrollment and tracked every supplied page.
      const known = new Set(event.memorizedAyahIds ?? this.metadata.pages.flatMap(p => p.ayahIds));
      for (const meta of this.metadata.pages) {
        const memorizedAyahIds = meta.ayahIds.filter(id => known.has(id));
        const initial = memorizedAyahIds.length ? this.config.initialStrength[event.strengths[meta.id] ?? this.config.inventory.defaultInitialStrength] : { stabilityDays: null, fluencyScore: null };
        this.state.pages[meta.id] = {
          pageId: meta.id, ...clone(initial), lastActiveRecallAt: null, lastRevisedAt: null,
          memorizedAyahIds, coverage: !memorizedAyahIds.length ? 'none' : memorizedAyahIds.length === meta.ayahIds.length ? 'complete' : 'partial',
          coverageVersion: memorizedAyahIds.length ? 1 : 0, enrolledAt: memorizedAyahIds.length ? event.occurredAt : null,
          nextReviewAt: memorizedAyahIds.length ? addDays(calendarDay(event.occurredAt, this.config.timeZone), this._interval(initial.stabilityDays)) : null,
          successfulSpacedReviews: 0, recentFailureCount: 0, history: [], mistakeHistory: [], dailyEvidence: null,
          targetedRepair: false, repairAyahIds: [], needsFullPageRepair: false,
        };
      }
    } else if (event.type === 'memorized_material_added') {
      this._applyMemorizedAddition(event);
    } else if (event.type === 'strengthening_started') {
      this._startCycle(event.halfJuzId, event.pageIds, event.occurredAt, event.id);
    } else if (event.type === 'revision') {
      this._applyRevision(event);
      this._assessRetention(event);
      this._assessDeterioration(event);
    } else if (event.type === 'strengthening_session') {
      this._applyStrengthening(event);
    } else if (event.type === 'mistake') {
      this._addMistake(event.mistake, event.pageId, event.sessionId, event.revisionAt, event.id);
    } else throw new Error(`Unknown event type: ${event.type}`);
    for (const page of Object.values(this.state.pages)) {
      page.recentFailureCount = this._recentFailures(page, event.occurredAt);
      page.state = this._pageState(page);
    }
  }

  _applyMemorizedAddition(event) {
    const changed = [];
    for (const meta of this.metadata.pages) {
      const page = this._page(meta.id), added = meta.ayahIds.filter(id => event.ayahIds.includes(id) && !page.memorizedAyahIds.includes(id));
      if (!added.length) continue;
      changed.push(meta.id);
      const known = new Set([...page.memorizedAyahIds, ...added]);
      page.memorizedAyahIds = meta.ayahIds.filter(id => known.has(id));
      page.coverage = page.memorizedAyahIds.length === meta.ayahIds.length ? 'complete' : 'partial';
      page.coverageVersion++;
      page.enrolledAt = event.occurredAt;
      Object.assign(page, clone(this.config.initialStrength[event.strengths[meta.id]]));
      // Evidence for a shorter passage cannot prove retention of its expanded scope.
      page.lastActiveRecallAt = null; page.dailyEvidence = null; page.successfulSpacedReviews = 0;
      page.nextReviewAt = addDays(calendarDay(event.occurredAt, this.config.timeZone), this._interval(page.stabilityDays));
    }
    const active = this._activeCycle();
    if (active && active.pageIds.some(id => changed.includes(id))) {
      active.stage = 1; active.lastPassedDay = null;
    }
    for (const retention of Object.values(this.state.retention)) if (retention.status === 'pending') {
      retention.pageIds = retention.pageIds.filter(id => !changed.includes(id));
      if (!retention.pageIds.length) retention.status = 'coverage_changed';
    }
  }

  _interval(stability) { return Math.max(this.config.scheduling.minimumIntervalDays, Math.round(this.config.scheduling.intervalFactor * stability)); }
  _startCycle(halfJuzId, pageIds, at, id) {
    const active = this._activeCycle();
    if (active) {
      if (active.halfJuzId === halfJuzId) {
        active.pageIds = [...new Set([...active.pageIds, ...pageIds])];
        active.stage = 1; active.lastPassedDay = null;
      } else {
        const previous = this.state.repairRequests[halfJuzId]?.pageIds ?? [];
        this.state.repairRequests[halfJuzId] = { halfJuzId, pageIds: [...new Set([...previous, ...pageIds])], requestedAt: at };
      }
    } else {
      this.state.cycles.push({ id, halfJuzId, pageIds: [...pageIds], stage: 1, status: 'active', startedAt: at, lastPassedDay: null, sessions: [], graduatedAt: null });
      delete this.state.repairRequests[halfJuzId];
    }
    // Suspend retention for pages returned to repair; unaffected pages keep their checks.
    for (const retention of Object.values(this.state.retention)) {
      if (retention.status !== 'pending') continue;
      retention.pageIds = retention.pageIds.filter(p => !pageIds.includes(p));
      if (!retention.pageIds.length) retention.status = 'regressed';
    }
  }

  _applyRevision(event) {
    const session = { sessionId: event.sessionId, occurredAt: event.occurredAt, actualDurationMinutes: event.actualDurationMinutes, purpose: event.purpose, reviews: [] };
    this.state.sessions[event.sessionId] = session;
    for (const [index, review] of event.reviews.entries()) {
      const entry = { ...clone(review), eventId: event.id, attemptId: `${event.id}:${index}`, sessionId: event.sessionId, occurredAt: event.occurredAt, purpose: event.purpose };
      this._applyPageReview(entry);
      session.reviews.push(entry);
      for (const mistake of review.mistakes) this._addMistake(mistake, review.pageId, event.sessionId, event.occurredAt, entry.attemptId);
    }
    if (event.purpose === 'maintenance') {
      for (const review of event.reviews) if (this._isCompleteReview(review)) this.state.maintenance[this.pageMetadata.get(review.pageId).juzId] = event.occurredAt;
    }
  }

  _applyPageReview(entry) {
    const page = this._page(entry.pageId), config = this.config, s = config.stability;
    const active = config.activities[entry.activity].active;
    const full = this._isCompleteReview(entry);
    entry.coverageVersion = page.coverageVersion;
    const before = page.stabilityDays;
    page.fluencyScore = clamp(config.fluency.oldWeight * page.fluencyScore + config.fluency.observedWeight * config.observedFluency[entry.fluency], 0, 1);
    if (active && entry.accuracy === 'failed') page.fluencyScore *= config.fluency.failureMultiplier;
    entry.recallQuality = active ? this._quality(entry) : null;
    if (active && full) {
      const day = calendarDay(entry.occurredAt, config.timeZone);
      const firstToday = page.dailyEvidence?.day !== day;
      const gap = elapsedDays(page.lastActiveRecallAt ?? page.enrolledAt, entry.occurredAt);
      const spacingRatio = clamp(gap / before, 0, s.maxSpacingRatio);
      const quality = entry.recallQuality;
      let proposed;
      if (entry.accuracy === 'failed') {
        proposed = Math.max(s.minimum, before * s.failedMultiplier);
        page.successfulSpacedReviews = 0;
      } else if (quality < s.poorThreshold) proposed = Math.max(s.minimum, before * s.poorMultiplier);
      else if (quality < s.growthThreshold) proposed = Math.max(s.minimum, before * s.difficultMultiplier);
      else {
        const weight = clamp(config.activities[entry.activity].weight, 0, s.maxActivityWeight);
        const growth = quality < s.excellentThreshold
          ? (s.goodBaseGrowth + s.goodSpacingGrowth * spacingRatio) * weight
          : (s.excellentBaseGrowth + s.excellentSpacingGrowth * spacingRatio) * weight;
        proposed = before * (1 + growth);
      }
      if (firstToday) page.dailyEvidence = { day, baseline: clamp(proposed, s.minimum, s.maximum), additionalGain: 0 };
      else if (proposed > before) {
        const remaining = Math.max(0, page.dailyEvidence.baseline * s.sameDayGrowthLimit - page.dailyEvidence.additionalGain);
        const gain = Math.min(proposed - before, remaining, Math.max(0, s.maximum - before));
        proposed = before + gain;
        page.dailyEvidence.additionalGain += gain;
      }
      page.stabilityDays = clamp(proposed, s.minimum, s.maximum);
      if (firstToday && gap >= s.minimumSpacedDays && quality >= s.growthThreshold && entry.accuracy !== 'failed') page.successfulSpacedReviews++;
      page.lastActiveRecallAt = entry.occurredAt;
      const pending = this._retentionForPage(page.pageId);
      if (!pending) page.nextReviewAt = addDays(day, quality >= s.growthThreshold && entry.accuracy !== 'failed' ? this._interval(page.stabilityDays) : config.scheduling.repairIntervalDays);
      if (!goodAccuracy(entry.accuracy)) page.needsFullPageRepair = true;
      else if (!entry.mistakes.length) { page.needsFullPageRepair = false; page.repairAyahIds = []; }
      entry.firstActiveRecallOfDay = firstToday;
      entry.elapsedDays = gap;
    } else if (active) {
      if (!goodAccuracy(entry.accuracy)) page.repairAyahIds = [...new Set([...page.repairAyahIds, ...entry.ayahIds])];
      else if (!entry.mistakes.length) page.repairAyahIds = page.repairAyahIds.filter(id => !entry.ayahIds.includes(id));
    }
    page.targetedRepair = page.needsFullPageRepair || page.repairAyahIds.length > 0;
    page.lastRevisedAt = entry.occurredAt;
    entry.stabilityBefore = before;
    entry.stabilityAfter = page.stabilityDays;
    page.history.push(clone(entry));
  }

  _addMistake(mistake, pageId, sessionId, at, eventId) {
    const repeated = this.state.mistakes.some(m => m.pageId === pageId && m.ayahId === mistake.ayahId);
    const entry = { ...clone(mistake), pageId, sessionId, date: calendarDay(at, this.config.timeZone), occurredAt: at, eventId, repeated };
    this.state.mistakes.push(entry);
    const page = this._page(pageId);
    page.mistakeHistory.push(clone(entry));
    if (mistake.ayahId) page.repairAyahIds = [...new Set([...page.repairAyahIds, mistake.ayahId])];
    else page.needsFullPageRepair = true;
    page.targetedRepair = true;
    const repairDate = addDays(entry.date, this.config.scheduling.repairIntervalDays);
    if (!this._retentionForPage(pageId) && repairDate < page.nextReviewAt) page.nextReviewAt = repairDate;
  }

  _applyStrengthening(event) {
    const cycle = this._activeCycle();
    const stage = cycle.stage;
    const flattened = event.steps.flatMap(step => step.reviews);
    this._applyRevision({ ...event, purpose: 'strengthening', reviews: flattened });
    const latest = new Map(), everGood = new Set(), unresolved = new Map(), targetedRequired = new Set();
    let completePasses = 0, missedStage1TargetingOrder = false;
    for (const step of event.steps) {
      if (stage === 1 && step.kind === 'pass' && completePasses > 0 && targetedRequired.size) missedStage1TargetingOrder = true;
      if (step.kind === 'pass' && cycle.pageIds.every(id => step.reviews.some(r => r.pageId === id))) completePasses++;
      for (const r of step.reviews) {
        if (this._isCompleteReview(r)) { latest.set(r.pageId, r); if (goodAccuracy(r.accuracy)) everGood.add(r.pageId); }
        const clean = goodAccuracy(r.accuracy) && !r.mistakes.length;
        if (clean) {
          for (const [key, problem] of unresolved) if (problem.pageId === r.pageId && (problem.ayahId ? r.ayahIds.includes(problem.ayahId) : this._isCompleteReview(r))) unresolved.delete(key);
          if (step.kind === 'targeted' && this._isCompleteReview(r)) targetedRequired.delete(r.pageId);
          if (step.kind === 'targeted' && r.scope === 'ayah' && ![...unresolved.values()].some(p => p.pageId === r.pageId)) targetedRequired.delete(r.pageId);
        }
        const hesitationNeedsPractice = stage === 2 && step.kind === 'pass' && r.fluency === 'hesitant';
        const problem = !goodAccuracy(r.accuracy) || r.mistakes.length || hesitationNeedsPractice;
        if (problem) {
          targetedRequired.add(r.pageId);
          if (!goodAccuracy(r.accuracy) || hesitationNeedsPractice) unresolved.set(`${r.pageId}:page`, { pageId: r.pageId, ayahId: null });
          for (const m of r.mistakes) unresolved.set(`${r.pageId}:${m.ayahId ?? 'page'}`, { pageId: r.pageId, ayahId: m.ayahId });
        }
      }
    }
    const observations = cycle.pageIds.map(id => latest.get(id));
    const reliable = observations.every(r => r && goodAccuracy(r.accuracy));
    const fluentFraction = observations.filter(r => r && r.fluency !== 'hesitant').length / cycle.pageIds.length;
    const automaticFraction = observations.filter(r => r?.fluency === 'automatic').length / cycle.pageIds.length;
    const reasons = [];
    if (completePasses < this.config.strengthening.requiredPasses) reasons.push('complete_passes_required');
    if (missedStage1TargetingOrder) reasons.push('targeted_repetition_required_before_second_pass');
    if (!reliable || (stage === 1 && everGood.size !== cycle.pageIds.length)) reasons.push('reliable_recall_required');
    if (unresolved.size) reasons.push('unresolved_mistakes_or_hesitation');
    if (stage < 3 && targetedRequired.size) reasons.push('targeted_repetition_required');
    if (stage === 2 && fluentFraction < this.config.strengthening.stage2FluentFraction) reasons.push('insufficient_fluency');
    if (stage === 3 && (automaticFraction < this.config.strengthening.stage3AutomaticFraction || fluentFraction < 1)) reasons.push('insufficient_automatic_recall');
    const result = { stage, passed: !reasons.length, reasons, completePasses, fluentFraction, automaticFraction };
    this.state.sessions[event.sessionId].strengtheningResult = result;
    cycle.sessions.push({ sessionId: event.sessionId, occurredAt: event.occurredAt, ...result });
    if (result.passed) {
      cycle.lastPassedDay = calendarDay(event.occurredAt, this.config.timeZone);
      if (stage < 3) cycle.stage++;
      else {
        cycle.status = 'graduated'; cycle.graduatedAt = event.occurredAt;
        const due = addDays(cycle.lastPassedDay, this.config.strengthening.earlyIntervalsDays[0]);
        this.state.retention[cycle.id] = { cycleId: cycle.id, halfJuzId: cycle.halfJuzId, pageIds: [...cycle.pageIds], status: 'pending', successes: 0, nextReviewAt: due, lastSuccessfulDay: null, graduatedAt: event.occurredAt, history: [] };
        for (const id of cycle.pageIds) { this._page(id).nextReviewAt = due; this._page(id).successfulSpacedReviews = 0; }
      }
    }
  }

  _assessRetention(event) {
    const day = calendarDay(event.occurredAt, this.config.timeZone);
    for (const retention of Object.values(this.state.retention)) {
      if (retention.status !== 'pending') continue;
      const attempts = event.reviews.filter(r => retention.pageIds.includes(r.pageId) && this._isCompleteReview(r) && this.config.activities[r.activity].active);
      const reviews = [...new Map(attempts.map(r => [r.pageId, r])).values()];
      if (!reviews.length) continue;
      const affected = [...new Set(attempts.filter(r => r.accuracy === 'failed' || this._quality(r) < this.config.strengthening.badEarlyQuality).map(r => r.pageId))];
      if (affected.length) {
        const whole = this._halfPages(retention.halfJuzId);
        const deteriorated = new Set(attempts.filter(r => ['failed', 'difficult'].includes(r.accuracy)).map(r => r.pageId)).size / whole.length >= this.config.strengthening.deteriorationFraction;
        this._startCycle(retention.halfJuzId, deteriorated ? whole : affected, event.occurredAt, `${event.id}:regression`);
        continue;
      }
      if (reviews.length !== retention.pageIds.length || day < retention.nextReviewAt || day === retention.lastSuccessfulDay) continue;
      const quality = reviews.reduce((sum, r) => sum + this._quality(r), 0) / reviews.length;
      const passed = reviews.every(r => r.accuracy !== 'failed') && quality >= this.config.strengthening.earlySuccessQuality;
      retention.history.push({ sessionId: event.sessionId, day, quality, passed });
      if (passed) {
        retention.successes++;
        retention.lastSuccessfulDay = day;
        if (retention.successes === this.config.strengthening.earlyIntervalsDays.length) retention.status = 'complete';
        else retention.nextReviewAt = addDays(day, this.config.strengthening.earlyIntervalsDays[retention.successes]);
      } else retention.nextReviewAt = addDays(day, this.config.scheduling.repairIntervalDays);
      for (const id of retention.pageIds) this._page(id).nextReviewAt = retention.status === 'complete' ? addDays(day, this._interval(this._page(id).stabilityDays)) : retention.nextReviewAt;
    }
  }

  _assessDeterioration(event) {
    const active = event.reviews.filter(r => this.config.activities[r.activity].active && this._isCompleteReview(r));
    for (const half of new Set(active.map(r => this.pageMetadata.get(r.pageId).halfJuzId))) {
      const ids = this._halfPages(half);
      const poor = new Set(active.filter(r => ids.includes(r.pageId) && ['failed', 'difficult'].includes(r.accuracy)).map(r => r.pageId));
      if (poor.size / ids.length >= this.config.strengthening.deteriorationFraction) this._startCycle(half, ids, event.occurredAt, `${event.id}:deterioration`);
    }
  }

  _recentFailures(page, at) {
    return new Set(page.history.filter(r => r.coverageVersion === page.coverageVersion && this.config.activities[r.activity].active && ['failed', 'difficult'].includes(r.accuracy) && elapsedDays(r.occurredAt, at) <= this.config.priority.failureWindowDays).map(r => r.sessionId)).size;
  }
  _pageState(page) {
    if (!page.memorizedAyahIds.length) return 'not_memorized';
    const thresholds = this.config.states;
    if (this._cycleForPage(page.pageId)) return 'relearning';
    if (this._retentionForPage(page.pageId)) return 'recently_strengthened';
    if (page.stabilityDays < thresholds.veryWeakBelow) return 'very_weak';
    if (page.stabilityDays < thresholds.weakBelow) return 'weak';
    if (page.stabilityDays >= thresholds.veryStrongAt && page.successfulSpacedReviews >= thresholds.veryStrongSuccesses) return 'very_strong';
    if (page.stabilityDays >= thresholds.strongAt && page.successfulSpacedReviews >= thresholds.strongSuccesses) return 'strong';
    return 'developing';
  }

  getPageState(pageId, date = this.events.at(-1).occurredAt) {
    const at = this._at(date), page = this._page(pageId);
    return clone({ ...page, state: this._pageState(page), recentFailureCount: this._recentFailures(page, at), ...this.pageMetadata.get(pageId) });
  }
  getStrengtheningState(halfJuzId) {
    if (halfJuzId) this._halfPages(halfJuzId);
    return clone({ activeCycle: this._activeCycle() ?? null, cycles: this.state.cycles.filter(c => !halfJuzId || c.halfJuzId === halfJuzId), retention: Object.values(this.state.retention).filter(r => !halfJuzId || r.halfJuzId === halfJuzId), queuedRepairs: Object.values(this.state.repairRequests).filter(r => !halfJuzId || r.halfJuzId === halfJuzId) });
  }
  getHalfJuzState(halfJuzId, date = this.events.at(-1).occurredAt) {
    const at = this._at(date), pages = this._halfPages(halfJuzId).map(id => this.getPageState(id, at));
    const all = this.metadata.pages.filter(p => p.halfJuzId === halfJuzId);
    const coverage = { coverage: !pages.length ? 'none' : pages.length === all.length && pages.every(p => p.coverage === 'complete') ? 'complete' : 'partial', strengthScope: 'memorized_material', memorizedPageCount: pages.length, totalPageCount: all.length, passage: this._passage(pages.map(p => p.pageId)) };
    if (!pages.length) return { halfJuzId, juzId: all[0].juzId, stabilityDays: null, state: 'not_memorized', weakestPages: [], lastActiveRecallAt: null, ...coverage };
    const stabilityDays = percentile(pages.map(p => p.stabilityDays), this.config.states.halfJuzPercentile);
    const weakestPages = [...pages].sort((a, b) => a.stabilityDays - b.stabilityDays || a.pageId.localeCompare(b.pageId)).map(p => ({ pageId: p.pageId, stabilityDays: p.stabilityDays, state: p.state }));
    let state = 'developing';
    if (pages.some(p => p.state === 'relearning')) state = 'relearning';
    else if (pages.some(p => p.state === 'recently_strengthened')) state = 'recently_strengthened';
    else if (stabilityDays < this.config.states.veryWeakBelow) state = 'very_weak';
    else if (stabilityDays < this.config.states.weakBelow) state = 'weak';
    else if (pages.every(p => p.state === 'very_strong')) state = 'very_strong';
    else if (pages.every(p => strongStates.has(p.state))) state = 'strong';
    return { halfJuzId, juzId: pages[0].juzId, stabilityDays, state, weakestPages, lastActiveRecallAt: pages.map(p => p.lastActiveRecallAt ?? p.enrolledAt).sort()[0], ...coverage };
  }
  getForgettingRisk(pageId, date) {
    const at = this._at(date), page = this._page(pageId);
    if (!page.memorizedAyahIds.length) return { pageId, daysSinceLastActiveRecall: null, riskRatio: null, level: 'not_memorized', priority: 0, provisional: false };
    const daysSinceLastActiveRecall = elapsedDays(page.lastActiveRecallAt ?? page.enrolledAt, at);
    const riskRatio = daysSinceLastActiveRecall / page.stabilityDays, r = this.config.risk;
    const level = riskRatio < r.approaching ? 'secure' : riskRatio < r.due ? 'approaching_review' : riskRatio <= r.overdue ? 'due' : riskRatio <= r.high ? 'overdue' : 'high_risk';
    const p = this.config.priority;
    const priority = riskRatio * clamp(p.weaknessNumerator / page.stabilityDays, p.minWeakness, p.maxWeakness) * (1 + Math.min(this._recentFailures(page, at) * p.failureIncrement, p.maxFailureExtra)) * (this._retentionForPage(pageId) ? p.recentlyStrengthened : 1);
    return { pageId, daysSinceLastActiveRecall, riskRatio, level, priority, provisional: page.lastActiveRecallAt === null };
  }
  getDueReviews(date) {
    const at = this._at(date), day = calendarDay(at, this.config.timeZone);
    return this._knownPages().map(meta => {
      const page = this._page(meta.id), risk = this.getForgettingRisk(meta.id, at), retention = this._retentionForPage(meta.id);
      const reason = retention && retention.nextReviewAt <= day ? 'mandatory_early_retention' : risk.level === 'high_risk' ? 'high_risk' : risk.level === 'overdue' ? 'overdue' : page.nextReviewAt <= day ? 'scheduled_adaptive_review' : 'risk_due';
      return { pageId: meta.id, halfJuzId: meta.halfJuzId, juzId: meta.juzId, ayahIds: [...page.memorizedAyahIds], scope: page.coverage === 'complete' ? 'page' : 'memorized', coverage: page.coverage, nextReviewAt: page.nextReviewAt, risk, reason, mandatory: reason === 'mandatory_early_retention' };
    }).filter(item => {
      if (this._cycleForPage(item.pageId)) return false;
      const pending = this._retentionForPage(item.pageId);
      if (pending) return pending.nextReviewAt <= day;
      const page = this._page(item.pageId);
      // A failed page may need a next-day repair even though its last recall was recent.
      return item.risk.riskRatio >= this.config.risk.due || (page.nextReviewAt <= day && (item.risk.level !== 'secure' || page.targetedRepair));
    }).sort((a, b) => Number(b.mandatory) - Number(a.mandatory) || b.risk.priority - a.risk.priority || a.pageId.localeCompare(b.pageId));
  }

  getTroublesomeAyat(date = this.events.at(-1).occurredAt, { includeResolved = false } = {}) {
    const at = this._at(date), results = [];
    const mistakenAyat = new Set(this.state.mistakes.map(m => m.ayahId).filter(Boolean));
    const mistakesBySession = new Map();
    for (const mistake of this.state.mistakes) {
      if (!mistakesBySession.has(mistake.sessionId)) mistakesBySession.set(mistake.sessionId, []);
      mistakesBySession.get(mistake.sessionId).push(mistake);
    }
    for (const ayah of this.metadata.ayat.filter(a => mistakenAyat.has(a.id))) {
      let active = false, consecutiveErrors = 0, cleanSessions = 0, triggeredAt = null;
      const errorDates = [], errorSessions = [];
      for (const session of Object.values(this.state.sessions)) {
        const observations = session.reviews.filter(r => this.config.activities[r.activity].active && r.ayahIds.includes(ayah.id));
        if (!observations.length) continue;
        const sessionMistakes = mistakesBySession.get(session.sessionId) ?? [];
        const mistakes = sessionMistakes.filter(m => m.ayahId === ayah.id);
        const unspecifiedMistake = sessionMistakes.some(m => m.ayahId === null && observations.some(r => r.pageId === m.pageId));
        if (mistakes.length) {
          consecutiveErrors++; cleanSessions = 0;
          errorDates.push(session.occurredAt); errorSessions.push(session.sessionId);
          const recentCount = errorDates.filter(d => elapsedDays(d, session.occurredAt) <= this.config.mistakes.windowDays).length;
          if (consecutiveErrors >= this.config.mistakes.consecutiveSessions || recentCount >= this.config.mistakes.separateSessions) { active = true; triggeredAt = session.occurredAt; }
        } else {
          consecutiveErrors = 0;
          if (!unspecifiedMistake && observations.every(r => goodAccuracy(r.accuracy))) {
            if (active) cleanSessions++;
            if (cleanSessions >= this.config.mistakes.cleanSessionsToResolve) active = false;
          } else cleanSessions = 0;
        }
      }
      if (triggeredAt && (active || includeResolved)) results.push({ ayahId: ayah.id, pageIds: this.metadata.pages.filter(p => p.ayahIds.includes(ayah.id)).map(p => p.id), troublesome: active, triggeredAt, mistakeSessionIds: errorSessions, recentMistakeSessions: errorDates.filter(d => elapsedDays(d, at) <= this.config.mistakes.windowDays).length, cleanSessions, reason: 'repeated_ayah_mistakes' });
    }
    return results;
  }

  getConfusionLinks() {
    const links = new Map();
    for (const mistake of this.state.mistakes) if (mistake.ayahId && mistake.confusedWithAyahId) {
      const ayahIds = [mistake.ayahId, mistake.confusedWithAyahId].sort(), key = JSON.stringify(ayahIds);
      const item = links.get(key) ?? { ayahIds, confusionCount: 0, lastConfusionDate: null };
      item.confusionCount += mistake.count; item.lastConfusionDate = mistake.date;
      links.set(key, item);
    }
    return clone([...links.values()]);
  }

  selectNextStrengthening(date) {
    const at = this._at(date);
    if (this._activeCycle()) return null;
    const queued = Object.values(this.state.repairRequests);
    const candidates = this.halfJuzIds.map(id => this.getHalfJuzState(id, at)).filter(h => h.memorizedPageCount > 0 && (queued.some(q => q.halfJuzId === h.halfJuzId) || (!Object.values(this.state.retention).some(r => r.halfJuzId === h.halfJuzId && r.status === 'pending') && h.stabilityDays < this.config.strengthening.weakSelectionThreshold)));
    candidates.sort((a, b) => a.stabilityDays - b.stabilityDays || a.lastActiveRecallAt.localeCompare(b.lastActiveRecallAt) || a.halfJuzId.localeCompare(b.halfJuzId));
    const chosen = candidates[0];
    return chosen ? { halfJuzId: chosen.halfJuzId, pageIds: this.state.repairRequests[chosen.halfJuzId]?.pageIds ?? this._halfPages(chosen.halfJuzId), stage: 1, requiresStart: true } : null;
  }

  generateDailyPlan(date, capacity = 'normal') { return buildDailyPlan(this, this._at(date), capacity); }
  getRevisionHistory({ pageId, sessionId } = {}) {
    if (pageId) this._page(pageId);
    return clone(Object.values(this.state.sessions).filter(s => !sessionId || s.sessionId === sessionId).map(s => ({ ...s, reviews: s.reviews.filter(r => !pageId || r.pageId === pageId), mistakes: this.state.mistakes.filter(m => m.sessionId === s.sessionId && (!pageId || m.pageId === pageId)) })).filter(s => s.reviews.length));
  }
  getUpcomingReviews(date, { days = 30 } = {}) {
    if (!Number.isInteger(days) || days < 0) throw new Error('Horizon must be a nonnegative number of days');
    const at = this._at(date), day = calendarDay(at, this.config.timeZone), end = addDays(day, days);
    return this._knownPages().filter(p => !this._cycleForPage(p.id)).map(p => ({ pageId: p.id, halfJuzId: p.halfJuzId, passage: this._passage([p.id]), nextReviewAt: this._page(p.id).nextReviewAt, mandatory: !!this._retentionForPage(p.id), risk: this.getForgettingRisk(p.id, at) })).filter(p => p.nextReviewAt <= end).sort((a, b) => a.nextReviewAt.localeCompare(b.nextReviewAt) || b.risk.priority - a.risk.priority || a.pageId.localeCompare(b.pageId));
  }
}
