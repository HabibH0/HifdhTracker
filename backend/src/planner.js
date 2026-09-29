import { HttpError } from './auth.js';

const MAX_BYTES = 512 * 1024;

const wire = row => row
  ? { state: row.data, version: row.version, updatedAt: row.client_updated_at ?? row.updated_at }
  : { state: null, version: 0, updatedAt: null };

export async function getPlannerState(db, userId) {
  const { rows } = await db.query('select data, version, client_updated_at, updated_at from planner_state where user_id = $1', [userId]);
  return wire(rows[0]);
}

export async function hasPlannerData(db, userId) {
  const { rows } = await db.query('select exists(select 1 from planner_state where user_id = $1) as has', [userId]);
  return rows[0].has;
}

/**
 * Save the planner document if the device's baseVersion matches the stored one.
 * Returns { version, updatedAt } on success; throws 409 with the current copy on a mismatch.
 */
export async function putPlannerState(db, userId, body) {
  const { state, baseVersion, deviceId, updatedAt } = validate(body);
  const { rows } = await db.query(
    `insert into planner_state (user_id, data, version, device_id, client_updated_at)
     values ($1, $2::jsonb, 1, $3, $4)
     on conflict (user_id) do update
       set data = excluded.data, version = planner_state.version + 1, device_id = excluded.device_id,
           client_updated_at = excluded.client_updated_at, updated_at = now()
       where planner_state.version = $5
     returning version, client_updated_at, updated_at`,
    [userId, JSON.stringify(state), deviceId, updatedAt, baseVersion]);
  if (rows.length) return { version: rows[0].version, updatedAt: rows[0].client_updated_at ?? rows[0].updated_at };
  const current = await getPlannerState(db, userId);
  throw new HttpError(409, 'version_conflict', 'This account was updated on another device.', { current });
}

function validate(body) {
  if (!body || typeof body !== 'object') throw new HttpError(400, 'invalid_body', 'Expected a JSON object.');
  const { state, baseVersion, deviceId, updatedAt } = body;
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new HttpError(400, 'invalid_state', 'Missing planner state.');
  if (!state.sections || typeof state.sections !== 'object' || !state.settings || typeof state.settings !== 'object') {
    throw new HttpError(400, 'invalid_state', 'Planner state is missing sections or settings.');
  }
  if (!Number.isInteger(baseVersion) || baseVersion < 0) throw new HttpError(400, 'invalid_version', 'baseVersion must be a non-negative integer.');
  if (JSON.stringify(state).length > MAX_BYTES) throw new HttpError(413, 'too_large', 'Planner state is too large.');
  const when = updatedAt == null ? null : new Date(updatedAt);
  if (when && Number.isNaN(when.getTime())) throw new HttpError(400, 'invalid_date', 'updatedAt must be a date.');
  return {
    state, baseVersion,
    deviceId: typeof deviceId === 'string' ? deviceId.slice(0, 64) : null,
    updatedAt: when ? when.toISOString() : null,
  };
}
