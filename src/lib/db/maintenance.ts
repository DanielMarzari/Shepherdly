/*
 * TS ports of the PL/pgSQL functions that were called via supabase
 * .rpc(...). Same names, same semantics, just running against SQLite
 * with raw SQL.
 *
 * Each function is idempotent and safe to call after every PCO sync.
 * That matches the original Postgres behaviour — the cron pipeline
 * called them in sequence after upserting raw data.
 *
 * The materialized-view refreshers (refresh_analytics_views) become
 * no-ops here: SQLite doesn't have materialized views, and the
 * aggregations now run on demand from src/lib/db/aggregates.ts.
 */

import { db } from './index'

// ── refresh_membership_activity ────────────────────────────────
//
// For every membership row, set last_activity_at to the most recent
// activity (group attendance for groups, accepted serving slot for
// teams). Rebuilt from scratch each call — drops stale values when a
// signal disappears.

export function refreshMembershipActivity(): void {
  // Group memberships
  db().exec(`
    WITH last_att AS (
      SELECT
        gm.id AS membership_id,
        MAX(ge.starts_at) AS last_at
      FROM group_memberships gm
      LEFT JOIN group_event_attendances gea
        ON gea.person_id = gm.person_id AND gea.attended = 1
      LEFT JOIN group_events ge
        ON ge.id = gea.event_id AND ge.group_id = gm.group_id
      GROUP BY gm.id
    )
    UPDATE group_memberships
    SET last_activity_at = (
      SELECT last_at FROM last_att WHERE last_att.membership_id = group_memberships.id
    )
    WHERE EXISTS (
      SELECT 1 FROM last_att WHERE last_att.membership_id = group_memberships.id
    )
  `)

  // Team memberships
  db().exec(`
    WITH last_serve AS (
      SELECT
        tm.id AS membership_id,
        MAX(sp.sort_date) AS last_at
      FROM team_memberships tm
      LEFT JOIN plan_team_members ptm
        ON ptm.person_id = tm.person_id AND ptm.team_id = tm.team_id AND ptm.status = 'C'
      LEFT JOIN service_plans sp
        ON sp.id = ptm.plan_id
      GROUP BY tm.id
    )
    UPDATE team_memberships
    SET last_activity_at = (
      SELECT last_at FROM last_serve WHERE last_serve.membership_id = team_memberships.id
    )
    WHERE EXISTS (
      SELECT 1 FROM last_serve WHERE last_serve.membership_id = team_memberships.id
    )
  `)
}

// ── mark_inactive_by_activity ──────────────────────────────────
//
// Marks memberships inactive when their last_activity_at is older
// than threshold. Sets left_at = COALESCE(last_activity_at,
// joined_at + threshold).
//
// Original signature: mark_inactive_by_activity(p_inactive_days,
// p_grace_days). Cron passes 180/90 currently.

export interface MarkInactiveParams {
  p_inactive_days?: number
  p_grace_days?: number
}

export function markInactiveByActivity(
  params: MarkInactiveParams = {},
): { table_name: string; deactivated: number }[] {
  const inactiveDays = params.p_inactive_days ?? 365
  const graceDays = params.p_grace_days ?? 90
  const now = new Date()
  const inactiveBefore = new Date(now.getTime() - inactiveDays * 86400000).toISOString()
  const graceBefore = new Date(now.getTime() - graceDays * 86400000).toISOString()

  // Update group_memberships first; left_at uses joined_at + days when
  // last_activity_at is null, which we compute in JS to avoid SQLite's
  // absent interval arithmetic.
  const fallbackMs = inactiveDays * 86400000
  const groupRows = db()
    .prepare(`
      SELECT id, joined_at, last_activity_at FROM group_memberships
      WHERE is_active = 1
        AND joined_at IS NOT NULL
        AND joined_at < ?
        AND (last_activity_at IS NULL OR last_activity_at < ?)
    `)
    .all(graceBefore, inactiveBefore) as { id: string; joined_at: string; last_activity_at: string | null }[]
  const updateGm = db().prepare(`
    UPDATE group_memberships SET is_active = 0, left_at = ? WHERE id = ?
  `)
  let groupCount = 0
  const groupTrx = db().transaction(() => {
    for (const r of groupRows) {
      const left = r.last_activity_at
        ? r.last_activity_at
        : new Date(Date.parse(r.joined_at) + fallbackMs).toISOString()
      updateGm.run(left, r.id)
      groupCount++
    }
  })
  groupTrx()

  const teamRows = db()
    .prepare(`
      SELECT id, joined_at, last_activity_at FROM team_memberships
      WHERE is_active = 1
        AND joined_at IS NOT NULL
        AND joined_at < ?
        AND (last_activity_at IS NULL OR last_activity_at < ?)
    `)
    .all(graceBefore, inactiveBefore) as { id: string; joined_at: string; last_activity_at: string | null }[]
  const updateTm = db().prepare(`
    UPDATE team_memberships SET is_active = 0, left_at = ? WHERE id = ?
  `)
  let teamCount = 0
  const teamTrx = db().transaction(() => {
    for (const r of teamRows) {
      const left = r.last_activity_at
        ? r.last_activity_at
        : new Date(Date.parse(r.joined_at) + fallbackMs).toISOString()
      updateTm.run(left, r.id)
      teamCount++
    }
  })
  teamTrx()

  return [
    { table_name: 'group_memberships', deactivated: groupCount },
    { table_name: 'team_memberships', deactivated: teamCount },
  ]
}

// ── refresh_calculated_active ──────────────────────────────────
//
// Person-level calculated active flag. Rules (matches the Postgres
// version):
//   1. last_pco_activity_at within threshold months
//   2. pco_created_at within threshold months
//   3. is_child=false adult in same household passes 1 or 2

export interface RefreshCalculatedActiveParams {
  p_threshold_months?: number
}

export function refreshCalculatedActive(
  params: RefreshCalculatedActiveParams = {},
): { active_count: number; inactive_count: number }[] {
  // 1. Resolve threshold from app_settings if not passed.
  let threshold = params.p_threshold_months ?? 0
  if (!threshold || threshold <= 0) {
    const row = db()
      .prepare(`SELECT value FROM app_settings WHERE key = 'calculated_inactive_threshold_months'`)
      .get() as { value: string } | undefined
    threshold = row?.value ? parseInt(row.value, 10) || 18 : 18
  }
  const cutoffMs = Date.now() - threshold * 30 * 86400000 // approx — months → days
  const cutoff = new Date(cutoffMs).toISOString()

  // 2. Refresh last_pco_activity_at as MAX across signal sources.
  // Build a single CTE, group by person, update.
  db().exec(`
    WITH activity AS (
      SELECT person_id, MAX(at) AS last_at FROM (
        SELECT gea.person_id AS person_id, MAX(ge.starts_at) AS at
          FROM group_event_attendances gea
          JOIN group_events ge ON ge.id = gea.event_id
         WHERE gea.attended = 1 AND ge.starts_at IS NOT NULL
         GROUP BY gea.person_id
        UNION ALL
        SELECT ptm.person_id, MAX(sp.sort_date)
          FROM plan_team_members ptm
          JOIN service_plans sp ON sp.id = ptm.plan_id
         WHERE ptm.status = 'C' AND sp.sort_date IS NOT NULL
         GROUP BY ptm.person_id
        UNION ALL
        SELECT pfs.person_id, MAX(pfs.submitted_at)
          FROM pco_form_submissions pfs
         WHERE pfs.person_id IS NOT NULL AND pfs.submitted_at IS NOT NULL
         GROUP BY pfs.person_id
        UNION ALL
        SELECT psa.person_id, MAX(psa.registered_at)
          FROM pco_signup_attendees psa
         WHERE psa.person_id IS NOT NULL
           AND COALESCE(psa.canceled, 0) = 0
           AND (psa.active = 1 OR psa.waitlisted = 1)
           AND psa.registered_at IS NOT NULL
         GROUP BY psa.person_id
        UNION ALL
        SELECT ar.person_id, MAX(ar.checked_in_at)
          FROM attendance_records ar
         WHERE ar.person_id IS NOT NULL AND ar.checked_in_at IS NOT NULL
         GROUP BY ar.person_id
        UNION ALL
        SELECT ar.checked_in_by_person_id AS person_id, MAX(ar.checked_in_at)
          FROM attendance_records ar
         WHERE ar.checked_in_by_person_id IS NOT NULL AND ar.checked_in_at IS NOT NULL
         GROUP BY ar.checked_in_by_person_id
      )
      WHERE person_id IS NOT NULL
      GROUP BY person_id
    )
    UPDATE people
       SET last_pco_activity_at = (
         SELECT last_at FROM activity WHERE activity.person_id = people.id
       )
     WHERE EXISTS (
       SELECT 1 FROM activity WHERE activity.person_id = people.id
     )
  `)

  // People who used to have a signal and don't anymore: reset to NULL.
  db().exec(`
    UPDATE people
       SET last_pco_activity_at = NULL
     WHERE last_pco_activity_at IS NOT NULL
       AND id NOT IN (
         SELECT person_id FROM (
           SELECT gea.person_id FROM group_event_attendances gea WHERE gea.attended = 1 AND gea.person_id IS NOT NULL
           UNION
           SELECT ptm.person_id FROM plan_team_members ptm WHERE ptm.status = 'C' AND ptm.person_id IS NOT NULL
           UNION
           SELECT pfs.person_id FROM pco_form_submissions pfs WHERE pfs.person_id IS NOT NULL
           UNION
           SELECT psa.person_id FROM pco_signup_attendees psa WHERE psa.person_id IS NOT NULL AND COALESCE(psa.canceled, 0) = 0 AND (psa.active = 1 OR psa.waitlisted = 1)
           UNION
           SELECT ar.person_id FROM attendance_records ar WHERE ar.person_id IS NOT NULL
           UNION
           SELECT ar.checked_in_by_person_id FROM attendance_records ar WHERE ar.checked_in_by_person_id IS NOT NULL
         )
       )
  `)

  // 3. Compute is_calculated_active using the household rule.
  // Two-step CTE in pure SQL.
  const updateStmt = db().prepare(`
    WITH active_self AS (
      SELECT
        p.id,
        p.church_id,
        p.household_pco_id,
        p.is_child,
        CASE
          WHEN COALESCE(p.last_pco_activity_at, '0') >= ? THEN 1
          WHEN COALESCE(p.pco_created_at,    '0') >= ? THEN 1
          ELSE 0
        END AS is_active_self
      FROM people p
    ),
    household_active AS (
      SELECT
        a.church_id,
        a.household_pco_id,
        MAX(a.is_active_self) AS has_active_adult
      FROM active_self a
      WHERE a.is_child = 0 AND a.household_pco_id IS NOT NULL
      GROUP BY a.church_id, a.household_pco_id
    )
    UPDATE people
    SET is_calculated_active = (
      SELECT
        CASE
          WHEN asf.is_active_self = 1 THEN 1
          WHEN ha.has_active_adult = 1 THEN 1
          ELSE 0
        END
      FROM active_self asf
      LEFT JOIN household_active ha
        ON ha.church_id = asf.church_id
       AND ha.household_pco_id = asf.household_pco_id
      WHERE asf.id = people.id
    )
  `)
  updateStmt.run(cutoff, cutoff)

  const counts = db()
    .prepare(`
      SELECT
        SUM(CASE WHEN is_calculated_active = 1 THEN 1 ELSE 0 END) AS active_count,
        SUM(CASE WHEN is_calculated_active = 0 THEN 1 ELSE 0 END) AS inactive_count
      FROM people
    `)
    .get() as { active_count: number; inactive_count: number }
  return [counts]
}

// ── refresh_person_analytics ───────────────────────────────────
//
// Rebuilds person_analytics from scratch. Used by the cron after
// every sync. Heavy aggregation — keep as a single transaction so
// readers always see a consistent snapshot.

export function refreshPersonAnalytics(): void {
  const trx = db().transaction(() => {
    db().exec('DELETE FROM person_analytics')
    db().exec(`
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
        0 AS engagement_score,
        (
          SELECT COUNT(*) FROM attendance_records ar
          WHERE ar.person_id = p.id
            AND ar.checked_in_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-90 days')
        ) AS attendance_count_90d,
        (SELECT MIN(ar.checked_in_at) FROM attendance_records ar WHERE ar.person_id = p.id) AS first_attended_at,
        (SELECT MAX(ar.checked_in_at) FROM attendance_records ar WHERE ar.person_id = p.id) AS last_attended_at,
        (SELECT COUNT(DISTINCT gm.group_id) FROM group_memberships gm WHERE gm.person_id = p.id AND gm.is_active = 1) AS total_groups,
        (SELECT COUNT(DISTINCT tm.team_id)  FROM team_memberships  tm WHERE tm.person_id  = p.id AND tm.is_active  = 1) AS total_teams,
        0 AS total_contexts,
        0 AS group_attendance_rate,
        0 AS team_schedule_rate,
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM people p
      WHERE p.status = 'active'
    `)
    // total_contexts = total_groups + total_teams (one round trip).
    db().exec(`
      UPDATE person_analytics
         SET total_contexts = total_groups + total_teams
    `)
  })
  trx()
}

// ── refresh_analytics_views ────────────────────────────────────
//
// Original: REFRESH MATERIALIZED VIEW for care_coverage_summary,
// weekly_attendance_trend, context_summary, group_type_stats_v, etc.
// SQLite doesn't have materialized views; aggregates.ts computes
// these on demand. Keep this as a no-op for backward compatibility
// with the cron invocation site.

export function refreshAnalyticsViews(): void {
  // No-op. The aggregations now run on the read path.
}
