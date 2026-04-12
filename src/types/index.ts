// ── Roles & Constants ────────────────────────────────────────

export type UserRole = 'super_admin' | 'staff' | 'coach' | 'leader'
export type SyncStatus = 'pending' | 'running' | 'success' | 'failed'
export type CheckInStatus = 'new' | 'reviewed' | 'resolved'

export const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: 'Admin',
  staff: 'Staff',
  coach: 'Coach',
  leader: 'Leader',
}

export const ROLE_COLORS: Record<UserRole, string> = {
  super_admin: '#2d6047',
  staff: '#3a5f8a',
  coach: '#6b4c9e',
  leader: '#c17f3e',
}

export const ROLE_ORDER: UserRole[] = ['super_admin', 'staff', 'coach', 'leader']

// ── Core Tables ──────────────────────────────────────────────

/** `users` table — app users linked to auth.users */
export interface User {
  id: string
  user_id: string          // FK to auth.users
  church_id: string | null
  name: string | null
  email: string
  role: UserRole
  photo_url: string | null
  invite_code: string | null
  person_id: string | null // FK to people (PCO record)
  is_active: boolean
  created_at: string
  updated_at: string
}

/** `churches` table */
export interface Church {
  id: string
  name: string
  owner_user_id: string | null
  invite_code: string
  created_at: string
  updated_at: string
}

/** `people` table — congregation members synced from PCO (no PII) */
export interface Person {
  id: string
  pco_id: string | null
  name: string
  pco_url: string | null     // generated from pco_id
  is_leader: boolean
  status: string              // 'active' | 'inactive'
  membership_type: string
  church_id: string | null
  created_at: string
  updated_at: string
}

// ── Groups ──────────────────────────────────────────────────

/** `group_types` table — PCO group types, some excluded from analytics */
export interface GroupType {
  id: string
  pco_id: string | null
  name: string
  is_tracked: boolean
  church_id: string | null
  created_at: string
  updated_at: string
}

/** `groups` table */
export interface Group {
  id: string
  pco_id: string | null
  name: string
  description: string | null
  group_type: string
  group_type_id: string | null   // FK to group_types
  pco_group_type_id: string | null
  schedule: string | null
  location: string | null
  is_pco_synced: boolean
  is_active: boolean
  church_id: string | null
  created_at: string
  updated_at: string
}

/** `group_memberships` table */
export interface GroupMembership {
  id: string
  person_id: string
  group_id: string
  role: string
  pco_id: string | null
  joined_at: string | null
  left_at: string | null
  is_active: boolean
  created_at: string
}

/** `group_applications` table — enrollment requests */
export interface GroupApplication {
  id: string
  pco_id: string | null
  person_id: string | null
  group_id: string | null
  pco_person_id: string | null
  pco_group_id: string | null
  status: string              // 'pending' | 'accepted' | 'rejected'
  applied_at: string | null
  resolved_at: string | null
  church_id: string | null
  created_at: string
}

/** `group_events` table — individual group meetings */
export interface GroupEvent {
  id: string
  pco_id: string | null
  group_id: string | null
  pco_group_id: string | null
  name: string | null
  starts_at: string | null
  ends_at: string | null
  church_id: string | null
  created_at: string
}

/** `group_event_attendances` table */
export interface GroupEventAttendance {
  id: string
  pco_id: string | null
  event_id: string | null
  pco_event_id: string | null
  person_id: string | null
  pco_person_id: string | null
  role: string
  attended: boolean
  church_id: string | null
  created_at: string
}

// ── Services & Teams ────────────────────────────────────────

/** `service_types` table */
export interface ServiceType {
  id: string
  pco_id: string | null
  name: string
  church_id: string | null
  created_at: string
  updated_at: string
}

/** `teams` table */
export interface Team {
  id: string
  pco_id: string | null
  name: string
  description: string | null
  team_type: string
  service_type_id: string | null   // FK to service_types
  pco_service_type_id: string | null
  is_pco_synced: boolean
  is_active: boolean
  church_id: string | null
  created_at: string
  updated_at: string
}

/** `team_memberships` table */
export interface TeamMembership {
  id: string
  person_id: string
  team_id: string
  role: string
  position: string | null
  pco_id: string | null
  created_at: string
}

/** `team_positions` table */
export interface TeamPosition {
  id: string
  pco_id: string | null
  team_id: string | null
  pco_team_id: string | null
  name: string
  church_id: string | null
  created_at: string
}

/** `service_plans` table — specific service instances */
export interface ServicePlan {
  id: string
  pco_id: string | null
  service_type_id: string | null
  pco_service_type_id: string | null
  title: string | null
  sort_date: string | null
  church_id: string | null
  created_at: string
}

/** `plan_team_members` table — who is scheduled */
export interface PlanTeamMember {
  id: string
  pco_id: string | null
  plan_id: string | null
  pco_plan_id: string | null
  person_id: string | null
  pco_person_id: string | null
  team_id: string | null
  pco_team_id: string | null
  position_name: string | null
  status: string              // 'C' confirmed, 'D' declined, 'U' unconfirmed
  accepted_at: string | null
  church_id: string | null
  created_at: string
}

// ── Shepherding ─────────────────────────────────────────────

/** `shepherding_relationships` table — multi-shepherd with context */
export interface ShepherdingRelationship {
  id: string
  shepherd_id: string        // FK to people
  person_id: string          // FK to people
  type: string | null
  context_type: string       // 'group' | 'team' | 'manual'
  context_id: string | null  // FK to groups or teams
  is_active: boolean
  created_at: string
  updated_at: string
}

// ── Analytics ───────────────────────────────────────────────

/** `person_analytics` table — refreshed post-sync via RPC */
export interface PersonAnalytics {
  person_id: string
  engagement_score: number
  attendance_count_90d: number
  first_attended_at: string | null
  last_attended_at: string | null
  total_groups: number
  total_teams: number
  total_contexts: number
  group_attendance_rate: number
  team_schedule_rate: number
  church_id: string | null
  computed_at: string
}

// ── Attendance ──────────────────────────────────────────────

/** `attendance_records` table — from PCO Check-Ins */
export interface AttendanceRecord {
  id: string
  person_id: string
  pco_person_id: string | null
  event_date: string | null
  service_type: string | null
  pco_event_id: string | null
  pco_event_period_id: string | null
  checked_in_at: string | null
  church_id: string | null
  created_at: string
}

// ── Check-in Reports ────────────────────────────────────────

/** `check_in_reports` table — leader reports about their flock */
export interface CheckInReport {
  id: string
  leader_id: string        // FK to people
  group_name: string | null
  going_well: string | null
  needs_attention: string | null
  prayer_requests: string | null
  is_urgent: boolean
  status: CheckInStatus
  context_type: string
  context_id: string | null
  respondent_id: string | null  // FK to users
  church_id: string | null
  report_date: string
  created_at: string
  updated_at: string
}

// ── Surveys ─────────────────────────────────────────────────

/** `surveys` table */
export interface Survey {
  id: string
  title: string
  questions: Record<string, unknown>[]
  target_role: string
  is_active: boolean
  created_by: string | null  // FK to users
  church_id: string | null
  created_at: string
  updated_at: string
}

/** `survey_responses` table */
export interface SurveyResponse {
  id: string
  survey_id: string
  respondent_id: string | null  // FK to users
  target_person_id: string | null  // FK to people
  context_type: string | null
  context_id: string | null
  answers: Record<string, unknown>
  is_urgent: boolean
  church_id: string | null
  created_at: string
}

// ── Ministry Impact Reports ─────────────────────────────────

/** `ministry_impact_reports` table */
export interface MinistryImpactReport {
  id: string
  church_id: string | null
  title: string
  reporting_period_start: string | null
  reporting_period_end: string | null
  metrics: Record<string, string | number>
  narrative: string | null
  outcomes: string | null
  created_by: string | null
  status: 'draft' | 'submitted' | 'approved'
  created_at: string
  updated_at: string
}

// ── Configuration ───────────────────────────────────────────

/** `planning_center_credentials` table */
export interface PlanningCenterCredential {
  id: string
  user_id: string
  app_id: string | null
  app_secret: string | null
  is_active: boolean
  last_synced_at: string | null
  church_id: string | null
  created_at: string
  updated_at: string
}

/** `pco_sync_log` table */
export interface PcoSyncLog {
  id: string
  sync_type: string | null
  started_at: string | null
  completed_at: string | null
  records_synced: number
  status: SyncStatus
  error_message: string | null
  credential_id: string | null  // FK to planning_center_credentials
  church_id: string | null
  created_at: string
}

/** `resources` table */
export interface Resource {
  id: string
  title: string
  description: string | null
  type: string | null
  category: string | null
  author: string | null
  url: string | null
  image_url: string | null
  church_id: string | null
  created_at: string
  updated_at: string
}
