-- Shepherdly initial schema (SQLite port).
--
-- Migrated from 30 Postgres migrations + Supabase Auth into a single
-- SQLite-flavored DDL. Differences from the Postgres source:
--
--   * UUIDs are TEXT, default lower(hex(randomblob(16))). The fact
--     that they're hyphenless doesn't matter to the app — every
--     PK/FK is opaque.
--   * Timestamps are TEXT in ISO-8601 ('2026-04-29T12:34:56.000Z').
--     Most rows stamp from JS via `new Date().toISOString()`; a few
--     defaults use strftime to match.
--   * Booleans are INTEGER 0/1 (SQLite has no bool type).
--   * No RLS. Tenancy enforced in the app layer via church_id checks
--     in every API route (already there from the Supabase code).
--   * No materialized views, no PL/pgSQL, no array_agg / bool_or.
--     Aggregations that used to live in materialized views now run
--     in TS (src/lib/db/aggregates.ts) on the read path with a small
--     in-process cache. Triggered refresh logic
--     (refresh_calculated_active, mark_inactive_by_activity, etc.) is
--     in src/lib/db/maintenance.ts and called from cron.
--   * Auth users (was supabase.auth.users) replaced by an `auth_users`
--     table here, driven by Lucia. The application-level `users`
--     table still links to people via person_id and stores role +
--     church_id; the only change is auth_users.id is the FK target.
--
-- Schema is applied verbatim by db/migrate.ts at app boot. Migrations
-- past 0001 use sequential numbering and the same applier.

BEGIN;

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- ────────────────────────────────────────────────────────────
-- Tenant: churches
-- ────────────────────────────────────────────────────────────

CREATE TABLE churches (
  id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ────────────────────────────────────────────────────────────
-- Application users + sessions.
--
-- Was Supabase Auth + a users mirror table joined by user_id. Now a
-- single users table where invite_code IS the credential (matches
-- the existing login flow — there are no passwords). Sessions live
-- in auth_sessions and reference users.id directly. The legacy
-- column `user_id` is preserved as an alias for users.id so existing
-- queries keyed on `user_id` keep working.
--
-- person_id optionally links the logged-in user to their PCO person
-- record so the app can scope "people I shepherd" to the current user.
-- ────────────────────────────────────────────────────────────

CREATE TABLE users (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id     TEXT NOT NULL UNIQUE,                              -- legacy alias of id; kept as TEXT for back-compat queries
  church_id   TEXT REFERENCES churches(id) ON DELETE SET NULL,
  email       TEXT NOT NULL,
  name        TEXT,
  role        TEXT NOT NULL DEFAULT 'member',                    -- super_admin, staff, leader, member
  person_id   TEXT,                                              -- references people(id); soft FK to avoid circular create
  invite_code TEXT,                                              -- alphanumeric; case-insensitive match
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_users_church ON users(church_id);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_invite ON users(lower(invite_code)) WHERE invite_code IS NOT NULL;

CREATE TABLE auth_sessions (
  id         TEXT PRIMARY KEY,                              -- random; cookie value
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL                                  -- ISO; checked per request
);

CREATE INDEX idx_auth_sessions_user ON auth_sessions(user_id);

-- ────────────────────────────────────────────────────────────
-- People (PCO mirror).
-- Slim shape after migration 2's PII purge. Computed columns
-- (last_pco_activity_at, is_calculated_active) come from migration 29.
-- ────────────────────────────────────────────────────────────

CREATE TABLE people (
  id                    TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  pco_id                TEXT UNIQUE,
  church_id             TEXT REFERENCES churches(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  membership_type       TEXT DEFAULT 'attender',
  status                TEXT DEFAULT 'active',
  is_leader             INTEGER NOT NULL DEFAULT 0,
  is_staff              INTEGER NOT NULL DEFAULT 0,
  is_lead_pastor        INTEGER NOT NULL DEFAULT 0,
  pco_url               TEXT,
  is_child              INTEGER NOT NULL DEFAULT 0,
  household_pco_id      TEXT,
  pco_created_at        TEXT,
  last_pco_activity_at  TEXT,
  is_calculated_active  INTEGER NOT NULL DEFAULT 1,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at            TEXT
);

CREATE INDEX idx_people_church_status      ON people(church_id, status);
CREATE INDEX idx_people_calc_active        ON people(church_id, is_calculated_active);
CREATE INDEX idx_people_household_pco_id   ON people(church_id, household_pco_id) WHERE household_pco_id IS NOT NULL;
CREATE INDEX idx_people_name               ON people(church_id, lower(name));

-- ────────────────────────────────────────────────────────────
-- Groups + group types + group memberships + group events
-- ────────────────────────────────────────────────────────────

CREATE TABLE group_types (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  pco_id      TEXT UNIQUE,
  church_id   TEXT REFERENCES churches(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  is_tracked  INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT
);

CREATE TABLE groups (
  id                  TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  pco_id              TEXT UNIQUE,
  church_id           TEXT REFERENCES churches(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  description         TEXT,
  group_type          TEXT,                          -- legacy free-text label
  group_type_id       TEXT REFERENCES group_types(id) ON DELETE SET NULL,
  pco_group_type_id   TEXT,
  schedule            TEXT,
  is_pco_synced       INTEGER NOT NULL DEFAULT 0,
  is_active           INTEGER NOT NULL DEFAULT 1,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_groups_church ON groups(church_id, is_active);

CREATE TABLE group_memberships (
  id                   TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  pco_id               TEXT UNIQUE,
  church_id            TEXT REFERENCES churches(id) ON DELETE CASCADE,
  person_id            TEXT REFERENCES people(id) ON DELETE SET NULL,
  pco_person_id        TEXT,
  group_id             TEXT REFERENCES groups(id) ON DELETE SET NULL,
  pco_group_id         TEXT,
  role                 TEXT,
  joined_at            TEXT,
  left_at              TEXT,
  is_active            INTEGER NOT NULL DEFAULT 1,
  last_activity_at     TEXT,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_group_memberships_person  ON group_memberships(person_id);
CREATE INDEX idx_group_memberships_group   ON group_memberships(group_id);
CREATE INDEX idx_group_memberships_active  ON group_memberships(church_id, is_active);
CREATE INDEX idx_group_memberships_last_activity
  ON group_memberships(church_id, last_activity_at) WHERE is_active = 1;

CREATE TABLE group_applications (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  pco_id          TEXT UNIQUE,
  church_id       TEXT REFERENCES churches(id) ON DELETE CASCADE,
  person_id       TEXT REFERENCES people(id) ON DELETE SET NULL,
  group_id        TEXT REFERENCES groups(id) ON DELETE SET NULL,
  pco_person_id   TEXT,
  pco_group_id    TEXT,
  status          TEXT DEFAULT 'pending',
  applied_at      TEXT,
  resolved_at     TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE group_events (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  pco_id        TEXT UNIQUE,
  church_id     TEXT REFERENCES churches(id) ON DELETE CASCADE,
  group_id      TEXT REFERENCES groups(id) ON DELETE SET NULL,
  pco_group_id  TEXT,
  name          TEXT,
  starts_at     TEXT,
  ends_at       TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_group_events_starts_at ON group_events(church_id, starts_at);
CREATE INDEX idx_group_events_group     ON group_events(group_id);

CREATE TABLE group_event_attendances (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  pco_id          TEXT UNIQUE,
  church_id       TEXT REFERENCES churches(id) ON DELETE CASCADE,
  event_id        TEXT REFERENCES group_events(id) ON DELETE SET NULL,
  pco_event_id    TEXT,
  person_id       TEXT REFERENCES people(id) ON DELETE SET NULL,
  pco_person_id   TEXT,
  role            TEXT DEFAULT 'attendee',
  attended        INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_group_event_atts_event   ON group_event_attendances(event_id);
CREATE INDEX idx_group_event_atts_person  ON group_event_attendances(person_id);
CREATE INDEX idx_group_event_atts_attended
  ON group_event_attendances(church_id, attended);

-- ────────────────────────────────────────────────────────────
-- Teams + service types + plans + scheduled members
-- ────────────────────────────────────────────────────────────

CREATE TABLE service_types (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  pco_id      TEXT UNIQUE,
  church_id   TEXT REFERENCES churches(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  is_tracked  INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT
);

CREATE TABLE teams (
  id                    TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  pco_id                TEXT UNIQUE,
  church_id             TEXT REFERENCES churches(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  team_type             TEXT,                          -- legacy free-text
  service_type_id       TEXT REFERENCES service_types(id) ON DELETE SET NULL,
  pco_service_type_id   TEXT,
  is_active             INTEGER NOT NULL DEFAULT 1,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_teams_church ON teams(church_id, is_active);

CREATE TABLE team_memberships (
  id                  TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  pco_id              TEXT UNIQUE,
  church_id           TEXT REFERENCES churches(id) ON DELETE CASCADE,
  person_id           TEXT REFERENCES people(id) ON DELETE SET NULL,
  pco_person_id       TEXT,
  team_id             TEXT REFERENCES teams(id) ON DELETE SET NULL,
  pco_team_id         TEXT,
  role                TEXT,
  joined_at           TEXT,
  left_at             TEXT,
  is_active           INTEGER NOT NULL DEFAULT 1,
  last_activity_at    TEXT,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_team_memberships_person ON team_memberships(person_id);
CREATE INDEX idx_team_memberships_team   ON team_memberships(team_id);
CREATE INDEX idx_team_memberships_active ON team_memberships(church_id, is_active);
CREATE INDEX idx_team_memberships_last_activity
  ON team_memberships(church_id, last_activity_at) WHERE is_active = 1;

CREATE TABLE team_positions (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  pco_id      TEXT UNIQUE,
  church_id   TEXT REFERENCES churches(id) ON DELETE CASCADE,
  team_id     TEXT REFERENCES teams(id) ON DELETE SET NULL,
  pco_team_id TEXT,
  name        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE service_plans (
  id                    TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  pco_id                TEXT UNIQUE,
  church_id             TEXT REFERENCES churches(id) ON DELETE CASCADE,
  service_type_id       TEXT REFERENCES service_types(id) ON DELETE SET NULL,
  pco_service_type_id   TEXT,
  title                 TEXT,
  sort_date             TEXT,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_service_plans_sort_date ON service_plans(church_id, sort_date);

CREATE TABLE plan_team_members (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  pco_id          TEXT UNIQUE,
  church_id       TEXT REFERENCES churches(id) ON DELETE CASCADE,
  plan_id         TEXT REFERENCES service_plans(id) ON DELETE SET NULL,
  pco_plan_id     TEXT,
  person_id       TEXT REFERENCES people(id) ON DELETE SET NULL,
  pco_person_id   TEXT,
  team_id         TEXT REFERENCES teams(id) ON DELETE SET NULL,
  pco_team_id     TEXT,
  position_name   TEXT,
  status          TEXT DEFAULT 'U',     -- C confirmed, D declined, U unconfirmed
  accepted_at     TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_plan_team_members_plan   ON plan_team_members(plan_id);
CREATE INDEX idx_plan_team_members_person ON plan_team_members(person_id);
CREATE INDEX idx_plan_team_members_status ON plan_team_members(church_id, status);

-- ────────────────────────────────────────────────────────────
-- Attendance records (PCO check-ins)
-- ────────────────────────────────────────────────────────────

CREATE TABLE attendance_records (
  id                            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  pco_id                        TEXT UNIQUE,
  church_id                     TEXT REFERENCES churches(id) ON DELETE CASCADE,
  person_id                     TEXT REFERENCES people(id) ON DELETE SET NULL,
  pco_person_id                 TEXT,
  pco_event_id                  TEXT,
  event_date                    TEXT,
  service_type                  TEXT,
  checked_in_at                 TEXT,
  checked_in_by_person_id       TEXT REFERENCES people(id) ON DELETE SET NULL,
  pco_checked_in_by_person_id   TEXT,
  created_at                    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_attendance_church_at  ON attendance_records(church_id, checked_in_at);
CREATE INDEX idx_attendance_person_at  ON attendance_records(church_id, person_id, checked_in_at);
CREATE INDEX idx_attendance_checked_in_by
  ON attendance_records(church_id, checked_in_by_person_id, checked_in_at)
  WHERE checked_in_by_person_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────
-- Person analytics (refreshed by cron)
-- ────────────────────────────────────────────────────────────

CREATE TABLE person_analytics (
  person_id              TEXT PRIMARY KEY REFERENCES people(id) ON DELETE CASCADE,
  church_id              TEXT REFERENCES churches(id) ON DELETE CASCADE,
  engagement_score       REAL DEFAULT 0,
  attendance_count_90d   INTEGER DEFAULT 0,
  first_attended_at      TEXT,
  last_attended_at       TEXT,
  total_groups           INTEGER DEFAULT 0,
  total_teams            INTEGER DEFAULT 0,
  total_contexts         INTEGER DEFAULT 0,
  group_attendance_rate  REAL DEFAULT 0,
  team_schedule_rate     REAL DEFAULT 0,
  computed_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_person_analytics_church ON person_analytics(church_id);

-- ────────────────────────────────────────────────────────────
-- Shepherding relationships (manual + computed)
-- ────────────────────────────────────────────────────────────

CREATE TABLE shepherding_relationships (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  church_id       TEXT REFERENCES churches(id) ON DELETE CASCADE,
  shepherd_id     TEXT REFERENCES people(id) ON DELETE CASCADE,
  person_id       TEXT REFERENCES people(id) ON DELETE CASCADE,
  context_type    TEXT NOT NULL DEFAULT 'manual',         -- manual / mapping / rule
  context_id      TEXT,
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at      TEXT
);

CREATE INDEX idx_shep_rel_shepherd  ON shepherding_relationships(shepherd_id, is_active);
CREATE INDEX idx_shep_rel_person    ON shepherding_relationships(person_id, is_active);
CREATE INDEX idx_shep_rel_church    ON shepherding_relationships(church_id, is_active);

-- ────────────────────────────────────────────────────────────
-- Tree (custom shepherding hierarchy)
-- ────────────────────────────────────────────────────────────

CREATE TABLE tree_layers (
  id                 TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  church_id          TEXT REFERENCES churches(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  rank               INTEGER NOT NULL,
  category           TEXT,
  is_congregational  INTEGER NOT NULL DEFAULT 0,
  is_hidden          INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_tree_layers_church_rank ON tree_layers(church_id, rank);

CREATE TABLE tree_assignments (
  id                    TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  church_id             TEXT REFERENCES churches(id) ON DELETE CASCADE,
  person_id             TEXT REFERENCES people(id) ON DELETE CASCADE,
  layer_id              TEXT REFERENCES tree_layers(id) ON DELETE CASCADE,
  supervisor_person_id  TEXT REFERENCES people(id) ON DELETE SET NULL,
  sort_order            INTEGER DEFAULT 0,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_tree_assignments_church ON tree_assignments(church_id);
CREATE INDEX idx_tree_assignments_person ON tree_assignments(person_id);

CREATE TABLE tree_oversight (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  church_id     TEXT REFERENCES churches(id) ON DELETE CASCADE,
  person_id     TEXT REFERENCES people(id) ON DELETE CASCADE,
  context_type  TEXT NOT NULL CHECK (context_type IN ('group', 'team', 'department')),
  context_id    TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_tree_oversight_church ON tree_oversight(church_id);

CREATE TABLE tree_layer_exclusions (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  church_id   TEXT REFERENCES churches(id) ON DELETE CASCADE,
  person_id   TEXT REFERENCES people(id) ON DELETE CASCADE,
  layer_id    TEXT REFERENCES tree_layers(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(person_id, layer_id)
);

CREATE TABLE tree_layer_inclusions (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  church_id   TEXT REFERENCES churches(id) ON DELETE CASCADE,
  person_id   TEXT REFERENCES people(id) ON DELETE CASCADE,
  layer_id    TEXT REFERENCES tree_layers(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(person_id, layer_id)
);

CREATE TABLE tree_metric_buckets (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  church_id   TEXT REFERENCES churches(id) ON DELETE CASCADE,
  label       TEXT NOT NULL,
  full_name   TEXT,
  color       TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE tree_metric_bucket_layers (
  id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  church_id    TEXT REFERENCES churches(id) ON DELETE CASCADE,
  bucket_id    TEXT REFERENCES tree_metric_buckets(id) ON DELETE CASCADE,
  layer_id     TEXT REFERENCES tree_layers(id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(bucket_id, layer_id)
);

CREATE TABLE group_team_layer_mappings (
  id                 TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  church_id          TEXT REFERENCES churches(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  kind               TEXT NOT NULL CHECK (kind IN ('groups', 'teams')),
  leader_layer_id    TEXT REFERENCES tree_layers(id) ON DELETE SET NULL,
  member_layer_id    TEXT REFERENCES tree_layers(id) ON DELETE SET NULL,
  auto_connect       INTEGER NOT NULL DEFAULT 0,
  count_mode         TEXT NOT NULL DEFAULT 'all' CHECK (count_mode IN ('all', 'split', 'split_round')),
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at         TEXT
);

CREATE TABLE group_team_layer_mapping_items (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  church_id   TEXT REFERENCES churches(id) ON DELETE CASCADE,
  mapping_id  TEXT REFERENCES group_team_layer_mappings(id) ON DELETE CASCADE,
  item_id     TEXT NOT NULL,                     -- group_id or team_id depending on mapping.kind
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(mapping_id, item_id)
);

CREATE TABLE shepherd_over_rules (
  id                  TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  church_id           TEXT REFERENCES churches(id) ON DELETE CASCADE,
  parent_person_id    TEXT REFERENCES people(id) ON DELETE CASCADE,
  parent_layer_id     TEXT REFERENCES tree_layers(id) ON DELETE CASCADE,
  rule_type           TEXT NOT NULL CHECK (rule_type IN ('group', 'team', 'group_type', 'team_type', 'layer')),
  rule_value          TEXT NOT NULL,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_shepherd_over_rules_church ON shepherd_over_rules(church_id);

CREATE TABLE tree_connections (
  id                  TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  church_id           TEXT REFERENCES churches(id) ON DELETE CASCADE,
  parent_person_id    TEXT REFERENCES people(id) ON DELETE CASCADE,
  parent_layer_id     TEXT REFERENCES tree_layers(id) ON DELETE CASCADE,
  child_person_id     TEXT REFERENCES people(id) ON DELETE CASCADE,
  child_layer_id      TEXT REFERENCES tree_layers(id) ON DELETE CASCADE,
  context_group_id    TEXT REFERENCES groups(id) ON DELETE CASCADE,
  context_team_id     TEXT REFERENCES teams(id) ON DELETE CASCADE,
  source_mapping_id   TEXT REFERENCES group_team_layer_mappings(id) ON DELETE CASCADE,
  source_rule_id      TEXT REFERENCES shepherd_over_rules(id) ON DELETE CASCADE,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_tree_connections_church ON tree_connections(church_id);
CREATE INDEX idx_tree_connections_parent ON tree_connections(parent_person_id);
CREATE INDEX idx_tree_connections_child  ON tree_connections(child_person_id);

-- ────────────────────────────────────────────────────────────
-- Departments (manual grouping for tree oversight)
-- ────────────────────────────────────────────────────────────

CREATE TABLE departments (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  church_id   TEXT REFERENCES churches(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  color       TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE department_members (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  church_id       TEXT REFERENCES churches(id) ON DELETE CASCADE,
  department_id   TEXT REFERENCES departments(id) ON DELETE CASCADE,
  person_id       TEXT REFERENCES people(id) ON DELETE CASCADE,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(department_id, person_id)
);

-- ────────────────────────────────────────────────────────────
-- PCO lists & list-layer links
-- ────────────────────────────────────────────────────────────

CREATE TABLE pco_lists (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  pco_id        TEXT UNIQUE,
  church_id     TEXT REFERENCES churches(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  description   TEXT,
  total_people  INTEGER DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE pco_list_people (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  church_id   TEXT REFERENCES churches(id) ON DELETE CASCADE,
  list_id     TEXT REFERENCES pco_lists(id) ON DELETE CASCADE,
  person_id   TEXT REFERENCES people(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(list_id, person_id)
);

CREATE TABLE pco_list_layer_links (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  church_id   TEXT REFERENCES churches(id) ON DELETE CASCADE,
  list_id     TEXT REFERENCES pco_lists(id) ON DELETE CASCADE,
  layer_id    TEXT REFERENCES tree_layers(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(list_id, layer_id)
);

-- ────────────────────────────────────────────────────────────
-- PCO signups + form submissions
-- ────────────────────────────────────────────────────────────

CREATE TABLE pco_signups (
  id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  pco_id       TEXT UNIQUE,
  church_id    TEXT REFERENCES churches(id) ON DELETE CASCADE,
  name         TEXT,
  description  TEXT,
  open_at      TEXT,
  close_at     TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE pco_signup_attendees (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  pco_id          TEXT UNIQUE,
  church_id       TEXT REFERENCES churches(id) ON DELETE CASCADE,
  signup_id       TEXT REFERENCES pco_signups(id) ON DELETE CASCADE,
  pco_signup_id   TEXT,
  person_id       TEXT REFERENCES people(id) ON DELETE SET NULL,
  pco_person_id   TEXT,
  registered_at   TEXT,
  active          INTEGER DEFAULT 0,
  waitlisted      INTEGER DEFAULT 0,
  canceled        INTEGER DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_pco_signup_atts_person ON pco_signup_attendees(person_id);
CREATE INDEX idx_pco_signup_atts_reg_at ON pco_signup_attendees(church_id, registered_at);

CREATE TABLE pco_form_sync_config (
  id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  church_id    TEXT REFERENCES churches(id) ON DELETE CASCADE,
  form_pco_id  TEXT NOT NULL,
  label        TEXT NOT NULL,
  purpose      TEXT,
  is_active    INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(church_id, form_pco_id)
);

CREATE TABLE pco_form_submissions (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  pco_id          TEXT UNIQUE,
  church_id       TEXT REFERENCES churches(id) ON DELETE CASCADE,
  form_pco_id     TEXT NOT NULL,
  person_id       TEXT REFERENCES people(id) ON DELETE SET NULL,
  pco_person_id   TEXT,
  submitted_at    TEXT,
  payload         TEXT,                       -- JSON blob, parsed in app
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_pco_form_subs_person  ON pco_form_submissions(person_id);
CREATE INDEX idx_pco_form_subs_form    ON pco_form_submissions(church_id, form_pco_id, submitted_at);

-- ────────────────────────────────────────────────────────────
-- PCO sync log
-- ────────────────────────────────────────────────────────────

CREATE TABLE planning_center_credentials (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  church_id       TEXT REFERENCES churches(id) ON DELETE CASCADE,
  app_id          TEXT,
  app_secret      TEXT,
  is_active       INTEGER NOT NULL DEFAULT 1,
  last_synced_at  TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE pco_sync_log (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  church_id       TEXT REFERENCES churches(id) ON DELETE CASCADE,
  credential_id   TEXT REFERENCES planning_center_credentials(id) ON DELETE SET NULL,
  sync_type       TEXT,                                      -- auto / manual
  status          TEXT NOT NULL DEFAULT 'running',           -- running / success / failed
  started_at      TEXT,
  completed_at    TEXT,
  records_synced  INTEGER DEFAULT 0,
  error_message   TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_pco_sync_log_church ON pco_sync_log(church_id, started_at);

CREATE TABLE pco_sync_resource_log (
  id                          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  church_id                   TEXT REFERENCES churches(id) ON DELETE CASCADE,
  sync_log_id                 TEXT REFERENCES pco_sync_log(id) ON DELETE CASCADE,
  resource_table              TEXT NOT NULL,
  status                      TEXT NOT NULL DEFAULT 'running',
  started_at                  TEXT,
  finished_at                 TEXT,
  duration_ms                 INTEGER,
  rows_seen                   INTEGER DEFAULT 0,
  rows_upserted               INTEGER DEFAULT 0,
  rows_skipped_unresolvable_fk INTEGER DEFAULT 0,
  error_message               TEXT,
  created_at                  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_pco_sync_resource_log_run ON pco_sync_resource_log(sync_log_id);

-- ────────────────────────────────────────────────────────────
-- Reports + check-ins + surveys
-- ────────────────────────────────────────────────────────────

CREATE TABLE ministry_impact_reports (
  id                       TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  church_id                TEXT REFERENCES churches(id) ON DELETE CASCADE,
  title                    TEXT NOT NULL,
  reporting_period_start   TEXT,
  reporting_period_end     TEXT,
  metrics                  TEXT DEFAULT '{}',          -- JSON blob
  narrative                TEXT,
  outcomes                 TEXT,
  created_by               TEXT REFERENCES users(id) ON DELETE SET NULL,
  status                   TEXT NOT NULL DEFAULT 'draft',
  created_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at               TEXT
);

CREATE INDEX idx_mir_church ON ministry_impact_reports(church_id, created_at);
CREATE INDEX idx_mir_status ON ministry_impact_reports(status);

CREATE TABLE check_in_reports (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  church_id     TEXT REFERENCES churches(id) ON DELETE CASCADE,
  leader_id     TEXT REFERENCES people(id) ON DELETE SET NULL,
  content       TEXT,                                   -- JSON blob
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_check_in_reports_leader ON check_in_reports(leader_id, created_at);

CREATE TABLE surveys (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  church_id     TEXT REFERENCES churches(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  description   TEXT,
  questions     TEXT,                                   -- JSON: [{id, kind, prompt, ...}]
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE survey_responses (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  church_id     TEXT REFERENCES churches(id) ON DELETE CASCADE,
  survey_id     TEXT REFERENCES surveys(id) ON DELETE CASCADE,
  person_id     TEXT REFERENCES people(id) ON DELETE SET NULL,
  answers       TEXT,                                   -- JSON: {questionId: answer}
  submitted_at  TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ────────────────────────────────────────────────────────────
-- App settings (key/value)
-- ────────────────────────────────────────────────────────────

CREATE TABLE app_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Default app settings
INSERT INTO app_settings (key, value) VALUES
  ('pco_sync_enabled', 'false'),
  ('calculated_inactive_threshold_months', '18');

-- User invite codes (deferred — users.invite_code is the working column)
-- Migration 1 added invite_code; no separate table.

COMMIT;
