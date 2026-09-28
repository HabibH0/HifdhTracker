export const DEFAULT_CONFIG = {
  timeZone: 'UTC',
  inventory: { defaultInitialStrength: 'weak' },
  initialStrength: {
    very_weak: { stabilityDays: 0.5, fluencyScore: 0.20 },
    weak: { stabilityDays: 1.5, fluencyScore: 0.35 },
    medium: { stabilityDays: 4, fluencyScore: 0.55 },
    strong: { stabilityDays: 10, fluencyScore: 0.75 },
    very_strong: { stabilityDays: 30, fluencyScore: 0.90 },
  },
  accuracy: { failed: 0, difficult: 0.55, good: 0.85, perfect: 1 },
  reviewFluency: { hesitant: 0.60, mostly_fluent: 0.85, automatic: 1 },
  observedFluency: { hesitant: 0.40, mostly_fluent: 0.75, automatic: 1 },
  activities: {
    listening: { active: false, weight: 0 },
    reading: { active: false, weight: 0 },
    memory: { active: true, weight: 1 },
    tested: { active: true, weight: 1.10 },
    random_start: { active: true, weight: 1.20 },
  },
  stability: {
    minimum: 0.5, maximum: 90, maxSpacingRatio: 2, maxActivityWeight: 1.2,
    failedMultiplier: 0.35, poorMultiplier: 0.60, difficultMultiplier: 0.90,
    poorThreshold: 0.50, growthThreshold: 0.72, excellentThreshold: 0.90,
    goodBaseGrowth: 0.30, goodSpacingGrowth: 0.25,
    excellentBaseGrowth: 0.50, excellentSpacingGrowth: 0.40,
    sameDayGrowthLimit: 0.05, minimumSpacedDays: 1,
  },
  fluency: { oldWeight: 0.65, observedWeight: 0.35, failureMultiplier: 0.80 },
  risk: { approaching: 0.60, due: 0.85, overdue: 1.10, high: 1.50 },
  scheduling: { intervalFactor: 0.80, minimumIntervalDays: 1, repairIntervalDays: 1 },
  strengthening: {
    requiredPasses: 2, maxTargetedRepetitions: 3, stage2FluentFraction: 0.70,
    stage3AutomaticFraction: 0.80, deteriorationFraction: 0.30,
    earlyIntervalsDays: [2, 4, 7], earlySuccessQuality: 0.72,
    badEarlyQuality: 0.50, maxActiveCycles: 1, weakSelectionThreshold: 4,
    majorMistakeTypes: ['major_breakdown', 'needed_prompting', 'lost_continuation'],
  },
  states: { veryWeakBelow: 1, weakBelow: 4, strongAt: 14, veryStrongAt: 30, strongSuccesses: 3, veryStrongSuccesses: 5, halfJuzPercentile: 0.25 },
  mistakes: { windowDays: 30, separateSessions: 3, consecutiveSessions: 2, cleanSessionsToResolve: 3 },
  priority: { weaknessNumerator: 10, minWeakness: 1, maxWeakness: 3, failureIncrement: 0.25, maxFailureExtra: 1, recentlyStrengthened: 1.5, failureWindowDays: 30 },
  capacityMinutes: { light: 30, normal: 60, full: 90, intensive: 120 },
  durations: { activePageMinutes: 1.5, targetedPageMinutes: 0.75, targetedAyahMinutes: 0.5, randomStartExtraMinutes: 0.25, minimumPartialPageMinutes: 0.25 },
  maintenance: { targetJuzPerDay: 1, randomAccessFraction: 0.10 },
  dailyReview: { targetMinutes: 30 },
  targeting: { contextAyahsBefore: 1, contextAyahsAfter: 1, cleanRecallsRequired: 1 },
};

function merge(base, overrides) {
  const result = structuredClone(base);
  for (const [key, value] of Object.entries(overrides)) {
    if (!Object.hasOwn(base, key)) throw new Error(`Unknown configuration key: ${key}`);
    if (typeof value !== typeof base[key] || value === null || Array.isArray(value) !== Array.isArray(base[key])) throw new Error(`Invalid configuration type: ${key}`);
    result[key] = value && typeof value === 'object' && !Array.isArray(value)
      ? merge(base[key], value) : structuredClone(value);
  }
  return result;
}

export function createConfig(overrides = {}) {
  const config = merge(DEFAULT_CONFIG, overrides);
  new Intl.DateTimeFormat('en', { timeZone: config.timeZone });
  const visit = (value, path = '') => {
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === 'number' && (!Number.isFinite(item) || item < 0)) throw new Error(`Invalid configuration: ${path}${key}`);
      if (item && typeof item === 'object') visit(item, `${path}${key}.`);
    }
  };
  visit(config);
  if (!Object.hasOwn(config.initialStrength, config.inventory.defaultInitialStrength)) throw new Error('Unknown default initial strength');
  const s = config.stability;
  if (!(s.minimum > 0 && s.maximum >= s.minimum && s.poorThreshold < s.growthThreshold && s.growthThreshold < s.excellentThreshold && s.excellentThreshold <= 1)) throw new Error('Invalid stability thresholds');
  const r = config.risk;
  if (!(0 < r.approaching && r.approaching < r.due && r.due < r.overdue && r.overdue < r.high)) throw new Error('Invalid risk thresholds');
  if (Math.abs(config.fluency.oldWeight + config.fluency.observedWeight - 1) > 1e-9) throw new Error('Fluency weights must sum to one');
  for (const group of [config.accuracy, config.reviewFluency, config.observedFluency]) if (Object.values(group).some(n => typeof n !== 'number' || n > 1)) throw new Error('Ratings must be in [0, 1]');
  for (const n of Object.values(config.durations)) if (!(n > 0)) throw new Error('Durations must be positive');
  if (config.strengthening.earlyIntervalsDays.length !== 3 || config.strengthening.earlyIntervalsDays.some(n => !Number.isInteger(n) || n < 1)) throw new Error('Three positive early retention intervals required');
  if (config.strengthening.maxActiveCycles !== 1) throw new Error('v1 supports one active strengthening cycle');
  for (const n of [config.strengthening.stage2FluentFraction, config.strengthening.stage3AutomaticFraction, config.strengthening.deteriorationFraction, config.maintenance.randomAccessFraction]) if (!(n > 0 && n <= 1)) throw new Error('Fractions must be in (0, 1]');
  if (config.states.halfJuzPercentile > 1) throw new Error('Percentile must be in [0, 1]');
  for (const n of [config.strengthening.requiredPasses, config.strengthening.maxTargetedRepetitions, config.mistakes.separateSessions, config.mistakes.consecutiveSessions, config.mistakes.cleanSessionsToResolve, config.scheduling.minimumIntervalDays, config.scheduling.repairIntervalDays]) if (!Number.isInteger(n) || n < 1) throw new Error('Counts and day intervals must be positive integers');
  if (config.priority.minWeakness > config.priority.maxWeakness) throw new Error('Invalid priority bounds');
  if (Object.entries(config.activities).some(([name, a]) => a.active !== DEFAULT_CONFIG.activities[name].active)) throw new Error('Activity evidence classification cannot change');
  return config;
}
