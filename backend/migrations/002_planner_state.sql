-- Revision planner: one saved document per account.
--
-- The planner app keeps its whole state (section classifications, queues, today's plan and
-- settings) as a single small JSON document. Each successful save bumps `version`; a device
-- sends the version it last saw, so a save based on stale data is rejected rather than
-- silently overwriting another device's changes.
--
-- Tables from 001 (the previous app's event log and projections) are left untouched.

create table planner_state (
  user_id            uuid primary key references users(id) on delete cascade,
  data               jsonb not null,
  version            integer not null default 1,
  device_id          text,
  client_updated_at  timestamptz,             -- when the device last changed the data
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
