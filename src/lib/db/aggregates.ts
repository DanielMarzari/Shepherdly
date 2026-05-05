/*
 * On-demand aggregations.
 *
 * These were materialized views in Postgres (group_type_stats_v,
 * team_type_stats_v, staff_per_type_v, person_engagement_status,
 * care_coverage_summary, active_unconnected_people, context_summary,
 * weekly_attendance_trend, ...) and PL/pgSQL RPCs
 * (get_person_engagement_counts, get_unconnected_type_counts,
 * get_event_attendance_counts).
 *
 * SQLite has no materialized views. Each function here runs the
 * aggregation live against the base tables. Performance is fine on
 * the data sizes the original codebase targets (10K–100K rows per
 * table); if a hot path needs caching we add a 60s in-process cache
 * here, not at the call site.
 *
 * Names match the original where possible so the supabase-shim's RPC
 * dispatcher can find them.
 */

import { db } from './index'

// ── get_person_engagement_counts(p_church_id) ──────────────────
//
// Original: classified each active person as excluded / shepherded /
// active / present and returned counts. The full classifier is
// reproduced in personEngagementStatus() below; this RPC just runs
// it and returns counts.

export function getPersonEngagementCounts(params: { p_church_id: string }): { status: string; count: number }[] {
  const rows = personEngagementStatus(params.p_church_id)
  const counts = new Map<string, number>()
  for (const r of rows) counts.set(r.status, (counts.get(r.status) ?? 0) + 1)
  return [...counts.entries()].map(([status, count]) => ({ status, count }))
}

// person_engagement_status materialized-view replacement
type EngagementStatus = 'excluded' | 'shepherded' | 'active' | 'present'

export function personEngagementStatus(churchId: string): { person_id: string; church_id: string; status: EngagementStatus }[] {
  return db()
    .prepare(`
      WITH p_signals AS (
        SELECT
          p.id AS person_id,
          p.church_id,
          p.membership_type,
          EXISTS (SELECT 1 FROM group_memberships gm WHERE gm.person_id = p.id AND gm.is_active = 1) AS in_group,
          EXISTS (SELECT 1 FROM team_memberships tm  WHERE tm.person_id  = p.id AND tm.is_active  = 1) AS in_team,
          EXISTS (
            SELECT 1 FROM attendance_records ar
             WHERE ar.person_id = p.id
               AND ar.checked_in_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-12 months')
          ) AS recent_checkin,
          EXISTS (
            SELECT 1 FROM pco_signup_attendees a
             WHERE a.person_id = p.id
               AND a.registered_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-12 months')
               AND COALESCE(a.canceled, 0) = 0
               AND (COALESCE(a.active, 0) = 1 OR COALESCE(a.waitlisted, 0) = 1)
          ) AS recent_registration,
          EXISTS (
            SELECT 1 FROM pco_form_submissions fs
              JOIN pco_form_sync_config fc ON fc.form_pco_id = fs.form_pco_id AND fc.church_id = fs.church_id
             WHERE fs.person_id = p.id
               AND fs.submitted_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-12 months')
               AND fc.purpose = 'prayer'
               AND fc.is_active = 1
          ) AS recent_prayer
        FROM people p
        WHERE p.church_id = ?
          AND p.status = 'active'
          AND p.is_calculated_active = 1
          AND substr(p.name, 1, 1) NOT IN ('_', '-')
      )
      SELECT
        person_id, church_id,
        CASE
          WHEN membership_type IN ('SYSTEM USE - Do Not Delete', 'Former Member') THEN 'excluded'
          WHEN in_group OR in_team
            OR membership_type = 'Outreach Partner'
            OR recent_checkin THEN 'shepherded'
          WHEN recent_registration
            OR recent_prayer
            OR membership_type IN ('Benevolence Only', 'Activity Only', 'Parent Only', 'Online Submission Only') THEN 'active'
          ELSE 'present'
        END AS status
      FROM p_signals
    `)
    .all(churchId) as { person_id: string; church_id: string; status: EngagementStatus }[]
}

// ── get_unconnected_type_counts(p_church_id) ────────────────────

export function getUnconnectedTypeCounts(params: { p_church_id: string }): { membership_type: string; cnt: number }[] {
  return db()
    .prepare(`
      SELECT
        COALESCE(p.membership_type, 'Unknown') AS membership_type,
        COUNT(*) AS cnt
      FROM people p
      LEFT JOIN shepherding_relationships sr
        ON sr.person_id = p.id AND sr.is_active = 1
      WHERE p.church_id = ?
        AND p.status = 'active'
        AND p.is_calculated_active = 1
        AND sr.id IS NULL
        AND substr(p.name, 1, 1) NOT IN ('_', '-')
        AND COALESCE(p.membership_type, '') <> 'SYSTEM USE - Do Not Delete'
      GROUP BY COALESCE(p.membership_type, 'Unknown')
      ORDER BY cnt DESC
    `)
    .all(params.p_church_id) as { membership_type: string; cnt: number }[]
}

// ── get_event_attendance_counts(p_event_ids) ────────────────────

export function getEventAttendanceCounts(params: { p_event_ids: string[] }): { event_id: string; attendee_count: number }[] {
  const ids = params.p_event_ids ?? []
  if (ids.length === 0) return []
  const placeholders = ids.map(() => '?').join(', ')
  return db()
    .prepare(`
      SELECT event_id, COUNT(*) AS attendee_count
      FROM group_event_attendances
      WHERE event_id IN (${placeholders}) AND attended = 1
      GROUP BY event_id
    `)
    .all(...ids) as { event_id: string; attendee_count: number }[]
}

// ── care_coverage_summary view ─────────────────────────────────
// Single row of aggregate stats. Read by /api/analytics and
// /api/unassigned through the table-shim's `from('care_coverage_summary')`.

export function careCoverageSummary(): {
  total_active_people: number
  active_attenders: number
  unconnected_active: number
  has_shepherd: number
  total_inactive: number
  connection_pct: number | null
} {
  return db()
    .prepare(`
      SELECT
        SUM(CASE WHEN p.status = 'active' AND p.is_calculated_active = 1 AND substr(p.name, 1, 1) NOT IN ('_', '-') AND COALESCE(p.membership_type, '') <> 'SYSTEM USE - Do Not Delete' THEN 1 ELSE 0 END) AS total_active_people,
        SUM(CASE WHEN p.status = 'active' AND p.is_calculated_active = 1 AND substr(p.name, 1, 1) NOT IN ('_', '-') AND COALESCE(p.membership_type, '') <> 'SYSTEM USE - Do Not Delete' AND LOWER(p.membership_type) IN ('member', 'attender') THEN 1 ELSE 0 END) AS active_attenders,
        SUM(CASE WHEN p.status = 'active' AND p.is_calculated_active = 1 AND substr(p.name, 1, 1) NOT IN ('_', '-') AND COALESCE(p.membership_type, '') <> 'SYSTEM USE - Do Not Delete' AND sr.shepherd_id IS NULL THEN 1 ELSE 0 END) AS unconnected_active,
        SUM(CASE WHEN p.status = 'active' AND p.is_calculated_active = 1 AND substr(p.name, 1, 1) NOT IN ('_', '-') AND COALESCE(p.membership_type, '') <> 'SYSTEM USE - Do Not Delete' AND sr.shepherd_id IS NOT NULL THEN 1 ELSE 0 END) AS has_shepherd,
        SUM(CASE WHEN p.status = 'inactive' AND substr(p.name, 1, 1) NOT IN ('_', '-') AND COALESCE(p.membership_type, '') <> 'SYSTEM USE - Do Not Delete' THEN 1 ELSE 0 END) AS total_inactive,
        CASE
          WHEN SUM(CASE WHEN p.status = 'active' AND p.is_calculated_active = 1 AND substr(p.name, 1, 1) NOT IN ('_', '-') AND COALESCE(p.membership_type, '') <> 'SYSTEM USE - Do Not Delete' THEN 1 ELSE 0 END) > 0
          THEN ROUND(
            100.0 * SUM(CASE WHEN p.status = 'active' AND p.is_calculated_active = 1 AND substr(p.name, 1, 1) NOT IN ('_', '-') AND COALESCE(p.membership_type, '') <> 'SYSTEM USE - Do Not Delete' AND sr.shepherd_id IS NOT NULL THEN 1 ELSE 0 END)
            / SUM(CASE WHEN p.status = 'active' AND p.is_calculated_active = 1 AND substr(p.name, 1, 1) NOT IN ('_', '-') AND COALESCE(p.membership_type, '') <> 'SYSTEM USE - Do Not Delete' THEN 1 ELSE 0 END),
            1
          )
          ELSE NULL
        END AS connection_pct
      FROM people p
      LEFT JOIN (
        SELECT DISTINCT person_id, shepherd_id FROM shepherding_relationships WHERE is_active = 1
      ) sr ON sr.person_id = p.id
    `)
    .get() as {
      total_active_people: number
      active_attenders: number
      unconnected_active: number
      has_shepherd: number
      total_inactive: number
      connection_pct: number | null
    }
}
