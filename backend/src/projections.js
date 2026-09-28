// Server-side read models, rebuilt by replaying a user's events through the same revision
// engine and deterministic merge the app uses. Devices never write these tables.
import { RevisionEngine } from '../../src/index.js';
import { buildEngine } from '../../shared/merge.js';
import { engineMetadata } from '../../shared/layout.js';
import meta from '../../app/src/data/quran-meta.json' with { type: 'json' };

export const METADATA = engineMetadata(meta);
const memoryStore = doc => ({ load: () => doc, save() {} });

export function eventRecordFromRow(row) {
  return { id: row.id, occurredAt: row.body.occurredAt, type: row.type ?? row.body.type, body: row.body, deviceId: row.device_id, config: row.config ?? undefined };
}

export function replay(records) {
  return buildEngine({ RevisionEngine, records, metadata: METADATA, makeStore: memoryStore });
}

/** Map a replayed engine to rows for each projection table. */
export function projectionRows(result) {
  const { engine, acceptedUids } = result;
  const uidOf = new Map(acceptedUids.map((uid, i) => [`event-${i + 1}`, uid]));
  // Engine ids are positional ("event-7", "event-7:2", "event-7:regression"); swap the
  // position for the event's stable id so rows keep their identity as history grows.
  const stableId = id => {
    const cut = id.indexOf(':');
    const base = cut < 0 ? id : id.slice(0, cut);
    return (uidOf.get(base) ?? base) + (cut < 0 ? '' : id.slice(cut));
  };
  const s = engine.state;
  const known = Object.values(s.pages).filter(p => p.memorizedAyahIds.length);

  const memorized = known.map(p => ({
    id: p.pageId, ayah_ids: p.memorizedAyahIds, coverage: p.coverage, enrolled_at: p.enrolledAt,
    data: { coverageVersion: p.coverageVersion },
  }));
  const pageStates = known.map(p => ({
    id: p.pageId, state: p.state, stability_days: p.stabilityDays, fluency_score: p.fluencyScore,
    next_review_at: p.nextReviewAt, last_active_recall_at: p.lastActiveRecallAt, successful_spaced_reviews: p.successfulSpacedReviews,
    data: { lastRevisedAt: p.lastRevisedAt, targetedRepair: p.targetedRepair, repairAyahIds: p.repairAyahIds, needsFullPageRepair: p.needsFullPageRepair, recentFailureCount: p.recentFailureCount },
  }));
  const cycles = s.cycles.map(c => ({
    id: stableId(c.id), half_juz_id: c.halfJuzId, stage: c.stage, status: c.status, started_at: c.startedAt, graduated_at: c.graduatedAt,
    data: { pageIds: c.pageIds, lastPassedDay: c.lastPassedDay, sessions: c.sessions },
  }));
  const sessions = Object.values(s.sessions).map(x => ({
    id: x.sessionId, occurred_at: x.occurredAt, purpose: x.purpose, actual_duration_minutes: x.actualDurationMinutes,
    data: {
      sourceEventId: x.reviews[0] ? stableId(x.reviews[0].eventId) : null,
      strengtheningResult: x.strengtheningResult ?? null,
      reviews: x.reviews.map(r => ({ pageId: r.pageId, activity: r.activity, accuracy: r.accuracy, fluency: r.fluency, scope: r.scope, ayahIds: r.ayahIds, recallQuality: r.recallQuality, stabilityBefore: r.stabilityBefore, stabilityAfter: r.stabilityAfter, mistakes: r.mistakes.length })),
    },
  }));
  const seen = new Map();
  const mistakes = s.mistakes.map(m => {
    const base = stableId(m.eventId), k = seen.get(base) ?? 0;
    seen.set(base, k + 1);
    return {
      id: `${base}#${k}`, session_id: m.sessionId, page_id: m.pageId, ayah_id: m.ayahId, mistake_type: m.type, occurred_at: m.occurredAt,
      data: { count: m.count, major: m.major, confusedWithAyahId: m.confusedWithAyahId, repeated: m.repeated, date: m.date },
    };
  });
  return { memorized, pageStates, cycles, sessions, mistakes };
}

const TABLES = {
  memorized: { table: 'memorized_material', columns: { ayah_ids: 'text[]', coverage: 'text', enrolled_at: 'timestamptz' } },
  pageStates: { table: 'page_states', columns: { state: 'text', stability_days: 'double precision', fluency_score: 'double precision', next_review_at: 'date', last_active_recall_at: 'timestamptz', successful_spaced_reviews: 'integer' } },
  cycles: { table: 'strengthening_cycles', columns: { half_juz_id: 'text', stage: 'integer', status: 'text', started_at: 'timestamptz', graduated_at: 'timestamptz' } },
  sessions: { table: 'revision_sessions', columns: { occurred_at: 'timestamptz', purpose: 'text', actual_duration_minutes: 'double precision' } },
  mistakes: { table: 'mistakes', columns: { session_id: 'text', page_id: 'text', ayah_id: 'text', mistake_type: 'text', occurred_at: 'timestamptz' } },
};

/** One bulk upsert per table; unchanged rows keep their updated_at; vanished rows are soft-deleted. */
async function writeTable(q, userId, { table, columns }, rows) {
  const names = Object.keys(columns);
  const defs = names.map(n => `${n} ${columns[n]}`).join(', ');
  await q.query(
    `insert into ${table} (user_id, id, ${names.join(', ')}, data)
     select $1, x.id, ${names.map(n => `x.${n}`).join(', ')}, x.data from jsonb_to_recordset($2::jsonb) as x(id text, ${defs}, data jsonb)
     on conflict (user_id, id) do update set ${names.map(n => `${n} = excluded.${n}`).join(', ')}, data = excluded.data, updated_at = now(), deleted_at = null
     where ${table}.data is distinct from excluded.data or ${table}.deleted_at is not null
        or (${names.map(n => `${table}.${n} is distinct from excluded.${n}`).join(' or ')})`,
    [userId, JSON.stringify(rows)]);
  await q.query(`update ${table} set deleted_at = now(), updated_at = now() where user_id = $1 and deleted_at is null and not (id = any($2::text[]))`, [userId, rows.map(r => r.id)]);
}

export async function rebuildProjections(db, userId) {
  const { rows } = await db.query('select id, type, body, config, device_id from revision_events where user_id = $1 and deleted_at is null', [userId]);
  const result = rows.length ? replay(rows.map(eventRecordFromRow)) : null;
  const projected = result ? projectionRows(result) : { memorized: [], pageStates: [], cycles: [], sessions: [], mistakes: [] };
  await db.tx(async q => {
    await q.query('select pg_advisory_xact_lock(hashtextextended($1, 1))', [userId]);
    for (const [key, spec] of Object.entries(TABLES)) await writeTable(q, userId, spec, projected[key]);
    const conflicts = result?.conflicts ?? [], duplicates = result?.duplicates ?? [];
    // Record the replay verdict without touching server_seq (devices compute it themselves).
    await q.query(`update revision_events set status = case when id = any($2::text[]) then 'conflict' when id = any($3::text[]) then 'duplicate' else 'applied' end
                    where user_id = $1 and status is distinct from (case when id = any($2::text[]) then 'conflict' when id = any($3::text[]) then 'duplicate' else 'applied' end)`, [userId, conflicts, duplicates]);
    await q.query(`insert into user_sync_state (user_id, projected_at, event_count, conflict_ids, duplicate_ids) values ($1, now(), $2, $3, $4)
                   on conflict (user_id) do update set projected_at = now(), event_count = excluded.event_count, conflict_ids = excluded.conflict_ids, duplicate_ids = excluded.duplicate_ids, updated_at = now()`,
      [userId, rows.length, conflicts, duplicates]);
  });
  return { events: rows.length, conflicts: result?.conflicts ?? [], duplicates: result?.duplicates ?? [] };
}
