export const DAY_MS = 86_400_000;
export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function calendarDay(value, timeZone = 'UTC') {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(`${value}T00:00:00Z`);
    if (!Number.isFinite(+date) || date.toISOString().slice(0, 10) !== value) throw new Error(`Invalid date: ${value}`);
    return value;
  }
  const date = new Date(value);
  if (!Number.isFinite(+date)) throw new Error(`Invalid timestamp: ${value}`);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  return ['year', 'month', 'day'].map(type => parts.find(p => p.type === type).value).join('-');
}

// Date-only queries refer to midnight in the configured calendar zone, including DST.
export function instant(value, timeZone = 'UTC') {
  if (typeof value !== 'string') throw new Error('Dates must be ISO strings');
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    calendarDay(value, timeZone);
    const target = Date.parse(`${value}T00:00:00Z`);
    let guess = target;
    for (let i = 0; i < 4; i++) {
      const p = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(guess));
      const get = type => p.find(x => x.type === type).value;
      const represented = Date.parse(`${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}Z`);
      const delta = target - represented;
      guess += delta;
      if (!delta) break;
    }
    return new Date(guess).toISOString();
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) throw new Error('Timestamp must include an explicit UTC offset');
  calendarDay(value.slice(0, 10));
  if (!Number.isFinite(Date.parse(value))) throw new Error('Invalid timestamp');
  return new Date(value).toISOString();
}

export function addDays(day, days) {
  const result = new Date(`${calendarDay(day)}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}
export const elapsedDays = (from, to) => Math.max(0, (Date.parse(to) - Date.parse(from)) / DAY_MS);
export function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * fraction;
  const low = Math.floor(position), high = Math.ceil(position);
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}
export function stableHash(text) {
  let hash = 2166136261;
  for (const char of text) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return hash;
}
