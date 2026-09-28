-- Hifdh revision app: accounts, synced records, and server-side projections.
--
-- Synced tables hold what devices write. Each row carries a stable client-generated id,
-- created_at / updated_at / deleted_at, and a server_seq from one sequence so a device can
-- pull "everything after cursor N". Writes for one user are serialized with an advisory
-- lock, so a user's server_seq values are assigned in commit order.
--
-- Projection tables (memorized_material, page_states, strengthening_cycles,
-- revision_sessions, mistakes) are rebuilt by the server from revision_events by replaying
-- them through the same revision engine the app uses. They are read models for export and
-- reporting; devices never write them directly.

create table users (
  id             uuid primary key default gen_random_uuid(),
  username       text not null,
  username_norm  text not null unique,
  password_hash  text not null,            -- scrypt$N$r$p$salt$hash, never plaintext
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);

create table auth_sessions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  token_hash    text not null unique,       -- sha256(token); the token itself is never stored
  user_agent    text,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz not null default now(),
  expires_at    timestamptz not null
);
create index auth_sessions_user on auth_sessions (user_id);

create table auth_attempts (
  id             bigserial primary key,
  kind           text not null,             -- 'login' | 'register'
  username_norm  text,
  ip             text,
  succeeded      boolean not null,
  created_at     timestamptz not null default now()
);
create index auth_attempts_user on auth_attempts (username_norm, created_at);
create index auth_attempts_ip on auth_attempts (ip, created_at);

create sequence sync_seq;

-- Raw engine events: the durable source of truth. Immutable once written.
create table revision_events (
  user_id      uuid not null references users(id) on delete cascade,
  id           text not null,
  occurred_at  timestamptz not null,
  type         text not null,
  body         jsonb not null,              -- engine event (with its exact occurredAt string)
  config       jsonb,                       -- engine configuration, on 'initialized' events only
  device_id    text not null,
  status       text not null default 'applied', -- server replay verdict: applied | conflict | duplicate
  server_seq   bigint not null default nextval('sync_seq'),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  primary key (user_id, id)
);
create index revision_events_seq on revision_events (user_id, server_seq);

-- Word-level mistake locations (the engine records mistakes per ayah).
create table word_marks (
  user_id        uuid not null references users(id) on delete cascade,
  id             text not null,
  session_id     text,
  page           integer,
  ayah_id        text,
  word_position  integer,
  mistake_type   text,
  marked_on      date,
  data           jsonb not null,
  rev            text not null,             -- updatedAt|deviceId, for last-writer-wins
  device_id      text not null,
  server_seq     bigint not null default nextval('sync_seq'),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null,
  deleted_at     timestamptz,
  primary key (user_id, id)
);
create index word_marks_seq on word_marks (user_id, server_seq);

-- Human labels for sessions ("Juz 29 · First half").
create table session_labels (
  user_id     uuid not null references users(id) on delete cascade,
  id          text not null,                -- sessionId
  data        jsonb not null,
  rev         text not null,
  device_id   text not null,
  server_seq  bigint not null default nextval('sync_seq'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null,
  deleted_at  timestamptz,
  primary key (user_id, id)
);
create index session_labels_seq on session_labels (user_id, server_seq);

-- Tasks completed on a given day, so Today looks the same on every device.
create table day_tasks (
  user_id     uuid not null references users(id) on delete cascade,
  id          text not null,                -- sessionId
  task_date   date,
  data        jsonb not null,
  rev         text not null,
  device_id   text not null,
  server_seq  bigint not null default nextval('sync_seq'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null,
  deleted_at  timestamptz,
  primary key (user_id, id)
);
create index day_tasks_seq on day_tasks (user_id, server_seq);

create table settings (
  user_id     uuid not null references users(id) on delete cascade,
  id          text not null,                -- 'app'
  data        jsonb not null,
  rev         text not null,
  device_id   text not null,
  server_seq  bigint not null default nextval('sync_seq'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null,
  deleted_at  timestamptz,
  primary key (user_id, id)
);
create index settings_seq on settings (user_id, server_seq);

-- ---- Projections -------------------------------------------------------------

create table memorized_material (
  user_id      uuid not null references users(id) on delete cascade,
  id           text not null,               -- page id, e.g. p562
  ayah_ids     text[] not null,
  coverage     text not null,               -- complete | partial
  enrolled_at  timestamptz,
  data         jsonb not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  primary key (user_id, id)
);

create table page_states (
  user_id                    uuid not null references users(id) on delete cascade,
  id                         text not null, -- page id
  state                      text not null,
  stability_days             double precision,
  fluency_score              double precision,
  next_review_at             date,
  last_active_recall_at      timestamptz,
  successful_spaced_reviews  integer,
  data                       jsonb not null,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  deleted_at                 timestamptz,
  primary key (user_id, id)
);

create table strengthening_cycles (
  user_id       uuid not null references users(id) on delete cascade,
  id            text not null,              -- stable id of the event that started it
  half_juz_id   text not null,
  stage         integer not null,
  status        text not null,
  started_at    timestamptz,
  graduated_at  timestamptz,
  data          jsonb not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  primary key (user_id, id)
);

create table revision_sessions (
  user_id                  uuid not null references users(id) on delete cascade,
  id                       text not null,   -- sessionId
  occurred_at              timestamptz not null,
  purpose                  text not null,
  actual_duration_minutes  double precision,
  data                     jsonb not null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  deleted_at               timestamptz,
  primary key (user_id, id)
);

create table mistakes (
  user_id       uuid not null references users(id) on delete cascade,
  id            text not null,              -- stable: source event id + attempt + index
  session_id    text,
  page_id       text,
  ayah_id       text,
  mistake_type  text,
  occurred_at   timestamptz,
  data          jsonb not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  primary key (user_id, id)
);

create table user_sync_state (
  user_id          uuid primary key references users(id) on delete cascade,
  projected_at     timestamptz,
  event_count      integer not null default 0,
  conflict_ids     text[] not null default '{}',
  duplicate_ids    text[] not null default '{}',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
