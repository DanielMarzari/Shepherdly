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
  endpoint: string        // PCO API path (or 'NESTED' for multi-parent resources)
  supportsUpdatedSince: boolean  // can filter by updated_at?
  syncStrategy: 'upsert' | 'replace'  // upsert on pco_id, or delete-all + insert
  mapRow: (item: any) => Record<string, any>
  nested?: NestedConfig   // for resources that require parent iteration
}

export interface NestedConfig {
  type: 'service_plans' | 'plan_people'
  // Parents are resolved at sync time
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
    syncStrategy: 'upsert',
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
    syncStrategy: 'upsert',
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
    syncStrategy: 'upsert',
    mapRow: (g) => ({
      pco_id: g.id,
      name: g.attributes.name || 'Unnamed Group',
      group_type: null,
      group_type_pco_id: g.relationships?.group_type?.data?.id || null,
      description: g.attributes.description_as_plain_text || null,
      member_count: g.attributes.memberships_count || 0,
      archived_at: g.attributes.archived_at || null,
      listed: g.attributes.listed ?? false,
      schedule: g.attributes.schedule || null,
      pco_updated_at: null,
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
    syncStrategy: 'upsert',
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
  {
    key: 'group_memberships',
    label: 'Group Memberships',
    category: 'groups',
    table: 'pco_group_memberships',
    endpoint: '/groups/v2/memberships',
    supportsUpdatedSince: false,
    syncStrategy: 'replace', // no pco_id column yet — delete all + re-insert
    mapRow: (m) => ({
      group_id: m.relationships?.group?.data?.id || null,
      person_id: m.relationships?.person?.data?.id || null,
      role: m.attributes.role || 'member',
      joined_at: m.attributes.joined_at || null,
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
    syncStrategy: 'upsert',
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
    syncStrategy: 'upsert',
    mapRow: (t) => ({
      pco_id: t.id,
      name: t.attributes.name || 'Unnamed Team',
      description: t.attributes.default_status || null,
      // service_type_pco_id added after DB migration
      archived_at: t.attributes.archived_at || null,
      pco_updated_at: t.attributes.updated_at || null,
      last_synced_at: new Date().toISOString(),
    }),
  },

  // ── Services (nested) ─────────────────────────────────────
  {
    key: 'service_plans',
    label: 'Service Plans',
    category: 'services',
    table: 'pco_service_plans',
    endpoint: 'NESTED',
    supportsUpdatedSince: false,
    syncStrategy: 'upsert',
    nested: { type: 'service_plans' },
    mapRow: (p) => ({
      pco_id: p.id,
      service_type_pco_id: p._serviceTypePcoId || null, // injected by nested fetcher
      title: p.attributes.title || null,
      dates: p.attributes.dates || null,
      sort_date: p.attributes.sort_date || null,
      series_title: p.attributes.series_title || null,
      plan_people_count: p.attributes.plan_people_count || 0,
      pco_updated_at: p.attributes.updated_at || null,
      last_synced_at: new Date().toISOString(),
    }),
  },
  {
    key: 'plan_people',
    label: 'Scheduled People',
    category: 'services',
    table: 'pco_plan_people',
    endpoint: 'NESTED',
    supportsUpdatedSince: false,
    syncStrategy: 'upsert',
    nested: { type: 'plan_people' },
    mapRow: (pp) => ({
      pco_id: pp.id,
      plan_pco_id: pp.relationships?.plan?.data?.id || null,
      person_pco_id: pp.relationships?.person?.data?.id || null,
      team_pco_id: pp.relationships?.team?.data?.id || null,
      service_type_pco_id: pp._serviceTypePcoId || null, // injected
      status: pp.attributes.status || null, // C, U, D
      team_position_name: pp.attributes.team_position_name || null,
      pco_updated_at: pp.attributes.updated_at || null,
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
    syncStrategy: 'upsert',
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

// ── Flat resource helpers ────────────────────────────────────

/** Get total count for a flat resource from PCO */
export async function getResourceCount(
  client: PcoClient,
  resource: SyncResource,
  updatedSince?: string | null,
): Promise<number> {
  if (resource.endpoint === 'NESTED') return 0 // nested resources counted separately
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

/** Fetch one page of a flat resource and return mapped rows */
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

// ── Nested resource helpers ──────────────────────────────────

export interface NestedCursor {
  parentIdx: number       // which parent we're on
  offset: number          // offset within current parent
  parents: { id: string; childCount: number; serviceTypePcoId?: string }[]
}

/**
 * Build the parent list for a nested resource.
 * Returns parents + estimated total child count.
 */
export async function getNestedResourceInfo(
  client: PcoClient,
  resource: SyncResource,
  admin: any,
): Promise<{ totalCount: number; cursor: NestedCursor }> {
  if (resource.nested?.type === 'service_plans') {
    // Parents = service_types, children = plans per service_type
    const stResult = await client.get('/services/v2/service_types', { per_page: '100' })
    const serviceTypes = stResult.data || []
    const parents: NestedCursor['parents'] = []
    let total = 0

    for (const st of serviceTypes) {
      const countRes = await client.get(
        `/services/v2/service_types/${st.id}/plans`,
        { per_page: '1' },
      )
      const count = countRes.meta?.total_count || 0
      if (count > 0) {
        parents.push({ id: st.id, childCount: count, serviceTypePcoId: st.id })
        total += count
      }
    }

    return { totalCount: total, cursor: { parentIdx: 0, offset: 0, parents } }
  }

  if (resource.nested?.type === 'plan_people') {
    // Parents = service_types (then we iterate their plans inline)
    // We estimate total by summing plan_people_count from plans in DB
    // If no plans in DB yet, estimate from service_type plan counts
    const stResult = await client.get('/services/v2/service_types', { per_page: '100' })
    const serviceTypes = stResult.data || []
    const parents: NestedCursor['parents'] = []
    let total = 0

    for (const st of serviceTypes) {
      // Get plan count for this service type
      const countRes = await client.get(
        `/services/v2/service_types/${st.id}/plans`,
        { per_page: '1' },
      )
      const planCount = countRes.meta?.total_count || 0
      if (planCount > 0) {
        // Rough estimate: ~5 people per plan (will be refined during sync)
        parents.push({ id: st.id, childCount: planCount, serviceTypePcoId: st.id })
        total += planCount * 5 // rough estimate
      }
    }

    return { totalCount: total, cursor: { parentIdx: 0, offset: 0, parents } }
  }

  return { totalCount: 0, cursor: { parentIdx: 0, offset: 0, parents: [] } }
}

/**
 * Fetch one page of a nested resource using cursor-based pagination.
 * Returns mapped rows + updated cursor.
 */
export async function fetchNestedPage(
  client: PcoClient,
  resource: SyncResource,
  cursor: NestedCursor,
  perPage: number,
): Promise<{
  rows: Record<string, any>[]
  hasMore: boolean
  nextCursor: NestedCursor | null
  upsertedEstimate: number
}> {
  if (cursor.parentIdx >= cursor.parents.length) {
    return { rows: [], hasMore: false, nextCursor: null, upsertedEstimate: 0 }
  }

  const parent = cursor.parents[cursor.parentIdx]

  if (resource.nested?.type === 'service_plans') {
    // Fetch plans for this service_type
    const result = await client.get(
      `/services/v2/service_types/${parent.id}/plans`,
      { per_page: String(perPage), offset: String(cursor.offset) },
    )
    const data = (result.data || []).map((p: any) => ({
      ...p,
      _serviceTypePcoId: parent.id,
    }))
    const rows = data.map(resource.mapRow)
    const hasMoreInParent = !!result.links?.next

    let nextCursor: NestedCursor | null
    if (hasMoreInParent) {
      nextCursor = { ...cursor, offset: cursor.offset + perPage }
    } else if (cursor.parentIdx + 1 < cursor.parents.length) {
      nextCursor = { ...cursor, parentIdx: cursor.parentIdx + 1, offset: 0 }
    } else {
      nextCursor = null
    }

    return {
      rows,
      hasMore: nextCursor !== null,
      nextCursor,
      upsertedEstimate: rows.length,
    }
  }

  if (resource.nested?.type === 'plan_people') {
    // For plan_people, we iterate service_types → plans → team_members
    // Each "page" call handles one page of plans for the current service_type,
    // fetching ALL team_members for each plan on that page
    const plansResult = await client.get(
      `/services/v2/service_types/${parent.id}/plans`,
      {
        per_page: '10', // smaller pages since we fetch team_members for each
        offset: String(cursor.offset),
        order: 'sort_date',
      },
    )
    const plans = plansResult.data || []
    const allRows: Record<string, any>[] = []

    for (const plan of plans) {
      // Fetch all team_members for this plan (usually small, <50)
      let tmOffset = 0
      while (true) {
        const tmResult = await client.get(
          `/services/v2/service_types/${parent.id}/plans/${plan.id}/team_members`,
          { per_page: '100', offset: String(tmOffset) },
        )
        const tmData = (tmResult.data || []).map((pp: any) => ({
          ...pp,
          _serviceTypePcoId: parent.id,
        }))
        allRows.push(...tmData.map(resource.mapRow))
        if (!tmResult.links?.next) break
        tmOffset += 100
      }
    }

    const hasMorePlansInParent = !!plansResult.links?.next
    let nextCursor: NestedCursor | null
    if (hasMorePlansInParent) {
      nextCursor = { ...cursor, offset: cursor.offset + 10 }
    } else if (cursor.parentIdx + 1 < cursor.parents.length) {
      nextCursor = { ...cursor, parentIdx: cursor.parentIdx + 1, offset: 0 }
    } else {
      nextCursor = null
    }

    return {
      rows: allRows,
      hasMore: nextCursor !== null,
      nextCursor,
      upsertedEstimate: allRows.length,
    }
  }

  return { rows: [], hasMore: false, nextCursor: null, upsertedEstimate: 0 }
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
  'pco_service_plans',
  'pco_plan_people',
  'pco_checkin_events',
  'pco_registrations',
  'sync_logs',
]
