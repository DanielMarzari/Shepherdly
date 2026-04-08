-- ============================================================
-- Shepherdly Data Model Refactor
-- ============================================================
-- 1. Slim people table (drop PII + computed fields)
-- 2. Enhance shepherding_relationships (multi-shepherd, context)
-- 3. New tables: group_types, group_applications, group_events,
--    group_event_attendances, service_types, team_positions,
--    service_plans, plan_team_members, person_analytics
-- 4. Modify groups (add group_type FK), teams (add service_type FK)
-- 5. Recreate views for new schema
-- 6. RLS policies on all new tables
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- STEP 1: Non-breaking additions to existing tables
-- ────────────────────────────────────────────────────────────

-- Enhance shepherding_relationships
ALTER TABLE shepherding_relationships
  ADD COLUMN IF NOT EXISTS context_type text DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS context_id uuid,
  ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Add group type FK to groups
ALTER TABLE groups
  ADD COLUMN IF NOT EXISTS group_type_id uuid,
  ADD COLUMN IF NOT EXISTS pco_group_type_id text;

-- Add service type FK to teams
ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS service_type_id uuid,
  ADD COLUMN IF NOT EXISTS pco_service_type_id text;

-- ────────────────────────────────────────────────────────────
-- STEP 2: Create new tables
-- ────────────────────────────────────────────────────────────

-- Group types
CREATE TABLE IF NOT EXISTS group_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pco_id text UNIQUE,
  name text NOT NULL,
  is_tracked boolean DEFAULT true,
  church_id uuid REFERENCES churches(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Group applications (enrollment requests)
CREATE TABLE IF NOT EXISTS group_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pco_id text UNIQUE,
  person_id uuid REFERENCES people(id) ON DELETE SET NULL,
  group_id uuid REFERENCES groups(id) ON DELETE SET NULL,
  pco_person_id text,
  pco_group_id text,
  status text DEFAULT 'pending',
  applied_at timestamptz,
  resolved_at timestamptz,
  church_id uuid REFERENCES churches(id),
  created_at timestamptz DEFAULT now()
);

-- Group events (meetings)
CREATE TABLE IF NOT EXISTS group_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pco_id text UNIQUE,
  group_id uuid REFERENCES groups(id) ON DELETE SET NULL,
  pco_group_id text,
  name text,
  starts_at timestamptz,
  ends_at timestamptz,
  church_id uuid REFERENCES churches(id),
  created_at timestamptz DEFAULT now()
);

-- Group event attendance
CREATE TABLE IF NOT EXISTS group_event_attendances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pco_id text UNIQUE,
  event_id uuid REFERENCES group_events(id) ON DELETE SET NULL,
  pco_event_id text,
  person_id uuid REFERENCES people(id) ON DELETE SET NULL,
  pco_person_id text,
  role text DEFAULT 'attendee',
  attended boolean DEFAULT true,
  church_id uuid REFERENCES churches(id),
  created_at timestamptz DEFAULT now()
);

-- Service types
CREATE TABLE IF NOT EXISTS service_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pco_id text UNIQUE,
  name text NOT NULL,
  church_id uuid REFERENCES churches(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Team positions
CREATE TABLE IF NOT EXISTS team_positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pco_id text UNIQUE,
  team_id uuid REFERENCES teams(id) ON DELETE SET NULL,
  pco_team_id text,
  name text NOT NULL,
  church_id uuid REFERENCES churches(id),
  created_at timestamptz DEFAULT now()
);

-- Service plans (specific service dates)
CREATE TABLE IF NOT EXISTS service_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pco_id text UNIQUE,
  service_type_id uuid REFERENCES service_types(id) ON DELETE SET NULL,
  pco_service_type_id text,
  title text,
  sort_date timestamptz,
  church_id uuid REFERENCES churches(id),
  created_at timestamptz DEFAULT now()
);

-- Plan team members (who is scheduled)
CREATE TABLE IF NOT EXISTS plan_team_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pco_id text UNIQUE,
  plan_id uuid REFERENCES service_plans(id) ON DELETE SET NULL,
  pco_plan_id text,
  person_id uuid REFERENCES people(id) ON DELETE SET NULL,
  pco_person_id text,
  team_id uuid REFERENCES teams(id) ON DELETE SET NULL,
  pco_team_id text,
  position_name text,
  status text DEFAULT 'U',
  accepted_at timestamptz,
  church_id uuid REFERENCES churches(id),
  created_at timestamptz DEFAULT now()
);

-- Person analytics (refreshed post-sync)
CREATE TABLE IF NOT EXISTS person_analytics (
  person_id uuid PRIMARY KEY REFERENCES people(id) ON DELETE CASCADE,
  engagement_score numeric DEFAULT 0,
  attendance_count_90d integer DEFAULT 0,
  first_attended_at timestamptz,
  last_attended_at timestamptz,
  total_groups integer DEFAULT 0,
  total_teams integer DEFAULT 0,
  total_contexts integer DEFAULT 0,
  group_attendance_rate numeric DEFAULT 0,
  team_schedule_rate numeric DEFAULT 0,
  church_id uuid REFERENCES churches(id),
  computed_at timestamptz DEFAULT now()
);

-- ────────────────────────────────────────────────────────────
-- STEP 3: Add FK constraints for new columns
-- ────────────────────────────────────────────────────────────

ALTER TABLE groups
  ADD CONSTRAINT fk_groups_group_type
  FOREIGN KEY (group_type_id) REFERENCES group_types(id) ON DELETE SET NULL;

ALTER TABLE teams
  ADD CONSTRAINT fk_teams_service_type
  FOREIGN KEY (service_type_id) REFERENCES service_types(id) ON DELETE SET NULL;

-- ────────────────────────────────────────────────────────────
-- STEP 4: Migrate data before dropping columns
-- ────────────────────────────────────────────────────────────

-- Migrate shepherd_id → shepherding_relationships
INSERT INTO shepherding_relationships (shepherd_id, person_id, type, context_type, is_active, created_at)
SELECT shepherd_id, id, 'shepherd', 'manual', true, now()
FROM people
WHERE shepherd_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Migrate computed fields → person_analytics
INSERT INTO person_analytics (person_id, engagement_score, attendance_count_90d, first_attended_at, last_attended_at, church_id)
SELECT id, COALESCE(engagement_score, 0), COALESCE(attendance_count_90d, 0), first_attended_at, last_attended_at, church_id
FROM people
ON CONFLICT (person_id) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- STEP 5: Drop PII and computed columns from people
-- ────────────────────────────────────────────────────────────

ALTER TABLE people DROP COLUMN IF EXISTS email;
ALTER TABLE people DROP COLUMN IF EXISTS phone;
ALTER TABLE people DROP COLUMN IF EXISTS birth_date;
ALTER TABLE people DROP COLUMN IF EXISTS address;
ALTER TABLE people DROP COLUMN IF EXISTS avatar_url;
ALTER TABLE people DROP COLUMN IF EXISTS shepherd_id;
ALTER TABLE people DROP COLUMN IF EXISTS is_active;
ALTER TABLE people DROP COLUMN IF EXISTS engagement_score;
ALTER TABLE people DROP COLUMN IF EXISTS attendance_count_90d;
ALTER TABLE people DROP COLUMN IF EXISTS first_attended_at;
ALTER TABLE people DROP COLUMN IF EXISTS last_attended_at;
ALTER TABLE people DROP COLUMN IF EXISTS last_seen;

-- Add generated pco_url column
ALTER TABLE people ADD COLUMN IF NOT EXISTS pco_url text
  GENERATED ALWAYS AS (
    CASE WHEN pco_id IS NOT NULL
      THEN 'https://people.planningcenteronline.com/people/' || pco_id
      ELSE NULL
    END
  ) STORED;

-- ────────────────────────────────────────────────────────────
-- STEP 6: Unique constraints and indexes
-- ────────────────────────────────────────────────────────────

-- Shepherding relationships: unique per context
ALTER TABLE shepherding_relationships
  ADD CONSTRAINT uq_shepherding_context
  UNIQUE NULLS NOT DISTINCT (shepherd_id, person_id, context_type, context_id);

CREATE INDEX IF NOT EXISTS idx_sr_person_id ON shepherding_relationships(person_id);
CREATE INDEX IF NOT EXISTS idx_sr_shepherd_id ON shepherding_relationships(shepherd_id);
CREATE INDEX IF NOT EXISTS idx_sr_context ON shepherding_relationships(context_type, context_id);

-- New table indexes
CREATE INDEX IF NOT EXISTS idx_group_types_church ON group_types(church_id);
CREATE INDEX IF NOT EXISTS idx_group_apps_church ON group_applications(church_id);
CREATE INDEX IF NOT EXISTS idx_group_apps_person ON group_applications(person_id);
CREATE INDEX IF NOT EXISTS idx_group_apps_group ON group_applications(group_id);
CREATE INDEX IF NOT EXISTS idx_group_events_church ON group_events(church_id);
CREATE INDEX IF NOT EXISTS idx_group_events_group ON group_events(group_id);
CREATE INDEX IF NOT EXISTS idx_gea_church ON group_event_attendances(church_id);
CREATE INDEX IF NOT EXISTS idx_gea_person ON group_event_attendances(person_id);
CREATE INDEX IF NOT EXISTS idx_gea_event ON group_event_attendances(event_id);
CREATE INDEX IF NOT EXISTS idx_service_types_church ON service_types(church_id);
CREATE INDEX IF NOT EXISTS idx_team_positions_team ON team_positions(team_id);
CREATE INDEX IF NOT EXISTS idx_service_plans_type ON service_plans(service_type_id);
CREATE INDEX IF NOT EXISTS idx_service_plans_date ON service_plans(sort_date);
CREATE INDEX IF NOT EXISTS idx_ptm_plan ON plan_team_members(plan_id);
CREATE INDEX IF NOT EXISTS idx_ptm_person ON plan_team_members(person_id);
CREATE INDEX IF NOT EXISTS idx_ptm_team ON plan_team_members(team_id);
CREATE INDEX IF NOT EXISTS idx_pa_church ON person_analytics(church_id);

-- Groups: index on group_type
CREATE INDEX IF NOT EXISTS idx_groups_type ON groups(group_type_id);
CREATE INDEX IF NOT EXISTS idx_teams_service_type ON teams(service_type_id);

-- ────────────────────────────────────────────────────────────
-- STEP 7: Recreate views for new schema
-- ────────────────────────────────────────────────────────────

-- Care coverage: how many active people have at least one shepherd?
CREATE OR REPLACE VIEW care_coverage_summary AS
SELECT
  COUNT(*) FILTER (WHERE p.status = 'active') AS total_active_people,
  COUNT(*) FILTER (WHERE p.status = 'active' AND p.membership_type IN ('Member', 'Attender', 'attender', 'member')) AS active_attenders,
  COUNT(*) FILTER (WHERE p.status = 'active' AND sr.shepherd_id IS NULL) AS unconnected_active,
  COUNT(*) FILTER (WHERE p.status = 'active' AND sr.shepherd_id IS NOT NULL) AS has_shepherd,
  CASE
    WHEN COUNT(*) FILTER (WHERE p.status = 'active') > 0
    THEN ROUND(
      100.0 * COUNT(*) FILTER (WHERE p.status = 'active' AND sr.shepherd_id IS NOT NULL)
      / COUNT(*) FILTER (WHERE p.status = 'active'),
      1
    )
    ELSE NULL
  END AS connection_pct
FROM people p
LEFT JOIN (
  SELECT DISTINCT person_id, shepherd_id
  FROM shepherding_relationships
  WHERE is_active = true
) sr ON sr.person_id = p.id;

-- Active unconnected people (no shepherd assigned)
CREATE OR REPLACE VIEW active_unconnected_people AS
SELECT p.id, p.name, p.pco_id, p.membership_type, p.church_id
FROM people p
LEFT JOIN shepherding_relationships sr
  ON sr.person_id = p.id AND sr.is_active = true
WHERE p.status = 'active'
  AND sr.id IS NULL
ORDER BY p.name;

-- Weekly attendance trend (from group_event_attendances)
CREATE OR REPLACE VIEW weekly_attendance_trend AS
SELECT
  date_trunc('week', ge.starts_at)::date AS week_start,
  COUNT(DISTINCT gea.person_id) AS unique_attenders,
  COUNT(gea.id) AS total_checkins
FROM group_event_attendances gea
JOIN group_events ge ON ge.id = gea.event_id
WHERE gea.attended = true
  AND ge.starts_at IS NOT NULL
GROUP BY date_trunc('week', ge.starts_at)
ORDER BY week_start;

-- Context summary: per group/team overview
CREATE OR REPLACE VIEW context_summary AS
SELECT
  'group' AS context_type,
  g.id AS context_id,
  g.name,
  g.group_type AS sub_type,
  COUNT(DISTINCT gm.person_id) FILTER (WHERE gm.is_active) AS member_count,
  COUNT(DISTINCT gm.person_id) FILTER (WHERE gm.is_active AND gm.role IN ('leader', 'Leader')) AS leader_count,
  g.church_id
FROM groups g
LEFT JOIN group_memberships gm ON gm.group_id = g.id
WHERE g.is_active = true
GROUP BY g.id, g.name, g.group_type, g.church_id

UNION ALL

SELECT
  'team' AS context_type,
  t.id AS context_id,
  t.name,
  t.team_type AS sub_type,
  COUNT(DISTINCT tm.person_id) AS member_count,
  COUNT(DISTINCT tm.person_id) FILTER (WHERE tm.role IN ('leader', 'Leader')) AS leader_count,
  t.church_id
FROM teams t
LEFT JOIN team_memberships tm ON tm.team_id = t.id
WHERE t.is_active = true
GROUP BY t.id, t.name, t.team_type, t.church_id;

-- ────────────────────────────────────────────────────────────
-- STEP 8: Create refresh_person_analytics RPC
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION refresh_person_analytics()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Clear and recompute
  DELETE FROM person_analytics;

  INSERT INTO person_analytics (
    person_id, church_id,
    engagement_score, attendance_count_90d,
    first_attended_at, last_attended_at,
    total_groups, total_teams, total_contexts,
    group_attendance_rate, team_schedule_rate,
    computed_at
  )
  SELECT
    p.id,
    p.church_id,

    -- Engagement score: weighted composite (0-100)
    LEAST(100, ROUND(
      COALESCE(grp_stats.group_count, 0) * 10 +           -- 10 pts per group (max ~50)
      COALESCE(team_stats.team_count, 0) * 10 +            -- 10 pts per team (max ~30)
      COALESCE(att_90.att_count, 0) * 2 +                  -- 2 pts per attendance in 90d (max ~20)
      CASE WHEN COALESCE(grp_att.rate, 0) > 0.5 THEN 10 ELSE 0 END +  -- bonus for >50% group attendance
      CASE WHEN COALESCE(team_sched.rate, 0) > 0.5 THEN 10 ELSE 0 END  -- bonus for >50% team confirmation
    )) AS engagement_score,

    COALESCE(att_90.att_count, 0) AS attendance_count_90d,
    att_all.first_attended AS first_attended_at,
    att_all.last_attended AS last_attended_at,
    COALESCE(grp_stats.group_count, 0) AS total_groups,
    COALESCE(team_stats.team_count, 0) AS total_teams,
    COALESCE(grp_stats.group_count, 0) + COALESCE(team_stats.team_count, 0) AS total_contexts,
    COALESCE(grp_att.rate, 0) AS group_attendance_rate,
    COALESCE(team_sched.rate, 0) AS team_schedule_rate,
    now()

  FROM people p

  -- Group membership counts
  LEFT JOIN (
    SELECT person_id, COUNT(DISTINCT group_id) AS group_count
    FROM group_memberships WHERE is_active = true
    GROUP BY person_id
  ) grp_stats ON grp_stats.person_id = p.id

  -- Team membership counts
  LEFT JOIN (
    SELECT person_id, COUNT(DISTINCT team_id) AS team_count
    FROM team_memberships
    GROUP BY person_id
  ) team_stats ON team_stats.person_id = p.id

  -- 90-day attendance from group events
  LEFT JOIN (
    SELECT person_id, COUNT(*) AS att_count
    FROM group_event_attendances
    WHERE attended = true
      AND created_at >= now() - interval '90 days'
    GROUP BY person_id
  ) att_90 ON att_90.person_id = p.id

  -- All-time attendance range
  LEFT JOIN (
    SELECT person_id,
      MIN(created_at) AS first_attended,
      MAX(created_at) AS last_attended
    FROM group_event_attendances
    WHERE attended = true
    GROUP BY person_id
  ) att_all ON att_all.person_id = p.id

  -- Group attendance rate (attended / total events for their groups)
  LEFT JOIN (
    SELECT
      gm.person_id,
      CASE WHEN COUNT(ge.id) > 0
        THEN ROUND(COUNT(gea.id)::numeric / COUNT(ge.id), 3)
        ELSE 0
      END AS rate
    FROM group_memberships gm
    JOIN group_events ge ON ge.group_id = gm.group_id
    LEFT JOIN group_event_attendances gea
      ON gea.event_id = ge.id AND gea.person_id = gm.person_id AND gea.attended = true
    WHERE gm.is_active = true
    GROUP BY gm.person_id
  ) grp_att ON grp_att.person_id = p.id

  -- Team schedule confirmation rate
  LEFT JOIN (
    SELECT
      person_id,
      CASE WHEN COUNT(*) > 0
        THEN ROUND(COUNT(*) FILTER (WHERE status = 'C')::numeric / COUNT(*), 3)
        ELSE 0
      END AS rate
    FROM plan_team_members
    GROUP BY person_id
  ) team_sched ON team_sched.person_id = p.id

  WHERE p.status = 'active';
END;
$$;

-- ────────────────────────────────────────────────────────────
-- STEP 9: RLS policies on all new tables
-- ────────────────────────────────────────────────────────────

ALTER TABLE group_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_event_attendances ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE person_analytics ENABLE ROW LEVEL SECURITY;

-- Church-scoped RLS: users can see data for their church
CREATE POLICY group_types_church ON group_types FOR ALL
  USING (church_id IN (SELECT church_id FROM users WHERE user_id = auth.uid()));

CREATE POLICY group_applications_church ON group_applications FOR ALL
  USING (church_id IN (SELECT church_id FROM users WHERE user_id = auth.uid()));

CREATE POLICY group_events_church ON group_events FOR ALL
  USING (church_id IN (SELECT church_id FROM users WHERE user_id = auth.uid()));

CREATE POLICY gea_church ON group_event_attendances FOR ALL
  USING (church_id IN (SELECT church_id FROM users WHERE user_id = auth.uid()));

CREATE POLICY service_types_church ON service_types FOR ALL
  USING (church_id IN (SELECT church_id FROM users WHERE user_id = auth.uid()));

CREATE POLICY team_positions_church ON team_positions FOR ALL
  USING (church_id IN (SELECT church_id FROM users WHERE user_id = auth.uid()));

CREATE POLICY service_plans_church ON service_plans FOR ALL
  USING (church_id IN (SELECT church_id FROM users WHERE user_id = auth.uid()));

CREATE POLICY plan_team_members_church ON plan_team_members FOR ALL
  USING (church_id IN (SELECT church_id FROM users WHERE user_id = auth.uid()));

CREATE POLICY person_analytics_church ON person_analytics FOR ALL
  USING (church_id IN (SELECT church_id FROM users WHERE user_id = auth.uid()));

-- ────────────────────────────────────────────────────────────
-- STEP 10: Drop old RPCs that are replaced
-- ────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS update_attendance_counts(date);
DROP FUNCTION IF EXISTS update_engagement_scores();
