export type UserRole = 'super_admin' | 'staff' | 'coach' | 'leader'
export type InteractionType = 'in_person' | 'phone_call' | 'text' | 'email' | 'prayer' | 'home_visit' | 'other'
export type SyncStatus = 'pending' | 'running' | 'success' | 'failed'

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

export interface AppUser {
  id: string
  email: string
  full_name: string | null
  role: UserRole
  pco_person_id: string | null
  avatar_url: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface PcoPerson {
  id: string
  pco_id: string
  first_name: string | null
  last_name: string | null
  full_name: string
  membership_type: string | null
  status: string | null
  gender: string | null
  avatar_url: string | null
  last_synced_at: string
}

export interface ShepherdingAssignment {
  id: string
  shepherd_user_id: string
  person_id: string
  assigned_at: string
  is_active: boolean
  notes: string | null
}

export interface Checkin {
  id: string
  shepherd_user_id: string
  person_id: string
  interaction_type: InteractionType
  occurred_at: string
  notes: string | null
  follow_up_needed: boolean
  follow_up_notes: string | null
  created_at: string
}

export interface UserHierarchy {
  id: string
  user_id: string
  supervisor_id: string | null
}

export interface ChurchSettings {
  id: string
  church_name: string
  logo_url: string | null
  pco_app_id: string | null
  pco_app_secret: string | null
  pco_last_sync: string | null
  pco_sync_enabled: boolean
}

export interface SyncLog {
  id: string
  status: SyncStatus
  triggered_by: string | null
  started_at: string
  completed_at: string | null
  records_synced: number
  error_message: string | null
}
