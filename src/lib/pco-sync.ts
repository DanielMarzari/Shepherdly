import { PcoClient } from './pco'

/**
 * PCO Sync resource definitions.
 * Each resource knows how to fetch from PCO and map to our DB schema.
 */

export interface SyncResource {
  key: string             // unique key for this resource
  label: string           // human label
  category: string        // grouping for UI
  table: string           // supabase table name
  endpoint: string        // PCO API path
  supportsUpdatedSince: boolean  // can filter by updated_at?
  mapRow: (item: any) => Record<string, any>
}

export const SYNC_CATEGORIES = [
  { key: 'people', label: 'People' },
  { key: 'groups', label: 'Groups' },
  { key: 'services', label: 'Services' },
  { key: 'checkins', label: 'Check-ins' },
] as const

export const SYNC_RESOURCES: SyncResource[] = [
  // ── People ─────────────────────────────────────────────────
  {
    key: 'people',
    label: 'People',
    category: 'people',
    table: 'pco_people',
    endpoint: '/people/v2/people',
    supportsUpdatedSince: true,
    mapRow: (p) => ({
      pco_id: p.id,
      first_name: p.attributes.first_name || null,
      last_name: p.attributes.last_name || null,
      membership_type: p.attributes.membership || null,
      status: p.attributes.status || null,
      gender: p.attributes.gender || null,
      pco_created_at: p.attributes.created_at,
      pco_updated_at: p.attributes.updated_at,
      last_synced_at: new Date().toISOString(),
    }),
  },

  // ── Groups ─────────────────────────────────────────────────
  {
    key: 'group_types',
    label: 'Group Types',
    category: 'groups',
    table: 'pco_group_types',
    endpoint: '/groups/v2/group_types',
    supportsUpdatedSince: false,
    mapRow: (gt) => ({
      pco_id: gt.id,
      name: gt.attributes.name || 'Unnamed',
      color: gt.attributes.color || null,
      description: gt.attributes.description || null,
      position: gt.attributes.position ?? null,
      church_center_visible: gt.attributes.church_center_visible ?? false,
      last_synced_at: new Date().toISOString(),
    }),
  },
  {
    key: 'groups',
    label: 'Groups',
    category: 'groups',
    table: 'pco_groups',
    endpoint: '/groups/v2/groups',
    supportsUpdatedSince: false,
    mapRow: (g) => ({
      pco_id: g.id,
      name: g.attributes.name || 'Unnamed Group',
      group_type: null, // set below from relationship
      group_type_pco_id: g.relationships?.group_type?.data?.id || null,
      description: g.attributes.description_as_plain_text || null,
      member_count: g.attributes.memberships_count || 0,
      archived_at: g.attributes.archived_at || null,
      listed: g.attributes.listed ?? false,
      schedule: g.attributes.schedule || null,
      pco_updated_at: null, // groups API doesn't expose updated_at on list
      last_synced_at: new Date().toISOString(),
    }),
  },
  {
    key: 'group_events',
    label: 'Group Meetings',
    category: 'groups',
    table: 'pco_group_events',
    endpoint: '/groups/v2/events',
    supportsUpdatedSince: false,
    mapRow: (e) => ({
      pco_id: e.id,
      group_pco_id: e.relationships?.group?.data?.id || null,
      name: e.attributes.name || null,
      starts_at: e.attributes.starts_at || null,
      ends_at: e.attributes.ends_at || null,
      canceled: e.attributes.canceled ?? false,
      attendance_requests_enabled: e.attributes.attendance_requests_enabled ?? false,
      last_synced_at: new Date().toISOString(),
    }),
  },

  // ── Services ───────────────────────────────────────────────
  {
    key: 'service_types',
    label: 'Service Types',
    category: 'services',
    table: 'pco_service_types',
    endpoint: '/services/v2/service_types',
    supportsUpdatedSince: false,
    mapRow: (st) => ({
      pco_id: st.id,
      name: st.attributes.name || 'Unnamed',
      frequency: st.attributes.frequency || null,
      archived_at: st.attributes.archived_at || null,
      pco_updated_at: st.attributes.updated_at || null,
      last_synced_at: new Date().toISOString(),
    }),
  },
  {
    key: 'teams',
    label: 'Teams',
    category: 'services',
    table: 'pco_teams',
    endpoint: '/services/v2/teams',
    supportsUpdatedSince: false,
    mapRow: (t) => ({
      pco_id: t.id,
      name: t.attributes.name || 'Unnamed Team',
      description: t.attributes.default_status || null,
      archived_at: t.attributes.archived_at || null,
      pco_updated_at: t.attributes.updated_at || null,
      last_synced_at: new Date().toISOString(),
    }),
  },

  // ── Check-ins ──────────────────────────────────────────────
  {
    key: 'checkin_events',
    label: 'Check-in Events',
    category: 'checkins',
    table: 'pco_checkin_events',
    endpoint: '/check-ins/v2/events',
    supportsUpdatedSince: false,
    mapRow: (e) => ({
      pco_id: e.id,
      name: e.attributes.name || 'Unnamed Event',
      frequency: e.attributes.frequency || null,
      archived_at: e.attributes.archived_at || null,
      pco_updated_at: e.attributes.updated_at || null,
      last_synced_at: new Date().toISOString(),
    }),
  },
]

/** Get total count for a resource from PCO */
export async function getResourceCount(
  client: PcoClient,
  resource: SyncResource,
  updatedSince?: string | null,
): Promise<number> {
  try {
    const params: Record<string, string> = { per_page: '1' }
    if (updatedSince && resource.supportsUpdatedSince) {
      params['where[updated_at][gte]'] = updatedSince
      params['order'] = 'updated_at'
    }
    const result = await client.get(resource.endpoint, params)
    return result.meta?.total_count || 0
  } catch {
    return 0
  }
}

/** Fetch one page of a resource and return mapped rows */
export async function fetchResourcePage(
  client: PcoClient,
  resource: SyncResource,
  offset: number,
  perPage: number,
  updatedSince?: string | null,
): Promise<{ rows: Record<string, any>[]; hasMore: boolean; totalCount: number }> {
  const params: Record<string, string> = {
    per_page: String(perPage),
    offset: String(offset),
  }
  if (updatedSince && resource.supportsUpdatedSince) {
    params['where[updated_at][gte]'] = updatedSince
    params['order'] = 'updated_at'
  }
  // Include relationships for groups (to get group_type)
  if (resource.key === 'groups') {
    params['include'] = 'group_type'
  }

  const result = await client.get(resource.endpoint, params)
  const data = result.data || []
  const rows = data.map(resource.mapRow)

  return {
    rows,
    hasMore: !!result.links?.next,
    totalCount: result.meta?.total_count || 0,
  }
}

/** All tables that hold PCO data (for purge) */
export const PCO_TABLES = [
  'pco_people',
  'pco_groups',
  'pco_group_types',
  'pco_group_events',
  'pco_group_memberships',
  'pco_teams',
  'pco_team_memberships',
  'pco_service_types',
  'pco_checkin_events',
  'pco_registrations',
  'sync_logs',
]
