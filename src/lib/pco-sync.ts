import { PcoClient } from './pco'

/**
 * PCO Sync resource definitions.
 * 13 resources synced in dependency order:
 *   people → group_types → groups → group_memberships/applications/events
 *   → group_event_attendances → service_types → teams → team_positions
 *   → service_plans → plan_team_members → attendance
 *
 * DB tables: people, group_types, groups, group_memberships, group_applications,
 * group_events, group_event_attendances, service_types, teams, team_positions,
 * team_memberships, service_plans, plan_team_members, attendance_records, person_analytics
 */

// ── Types ───────────────────────────────────────────────────

export interface SyncResource {
  key: string
  label: string
  category: string
  table: string
  endpoint: string
  queryParams?: Record<string, string>
  supportsUpdatedSince: boolean
  syncStrategy: 'upsert' | 'replace'
  onConflict: string
  mapRow: (item: any, included?: any[]) => Record<string, any>
  /** Nested resource: fetched per-parent from another table */
  isNested?: boolean
  nestedParentTable?: string
  nestedEndpointTemplate?: string   // e.g. '/groups/v2/groups/{parentId}/memberships'
  /** Doubly-nested: child cursor within parent */
  isDoublyNested?: boolean
  nestedChildTable?: string
  nestedChildEndpointTemplate?: string  // e.g. '/services/v2/service_types/{parentId}/plans/{childId}/team_members'
  /** PCO ID resolution mappings — applied post-fetch */
  idMappings?: IdMapping[]
}

export interface IdMapping {
  field: string      // target column: 'person_id'
  pcoField: string   // temp column: '_pco_person_id'
  table: string      // lookup table: 'people'
}

export interface NestedCursor {
  parentIdx: number
  childIdx?: number
  offset: number
  parents: { id: string; pcoId: string; childCount: number }[]
  children?: { id: string; pcoId: string; childCount: number }[]
}

export const SYNC_CATEGORIES = [
  { key: 'people', label: 'People' },
  { key: 'groups', label: 'Groups' },
  { key: 'teams', label: 'Teams' },
] as const

// ── Resource Definitions ────────────────────────────────────

export const SYNC_RESOURCES: SyncResource[] = [
  // ── 1. People ─────────────────────────────────────────────
  {
    key: 'people',
    label: 'People',
    category: 'people',
    table: 'people',
    endpoint: '/people/v2/people',
    supportsUpdatedSince: true,
    syncStrategy: 'upsert',
    onConflict: 'pco_id',
    mapRow: (p) => ({
      pco_id: p.id,
      name: [p.attributes.first_name, p.attributes.last_name].filter(Boolean).join(' ') || 'Unknown',
      membership_type: p.attributes.membership || 'attender',
      status: p.attributes.status || 'active',
      is_leader: false,
    }),
  },

  // ── 2. Group Types ────────────────────────────────────────
  {
    key: 'group_types',
    label: 'Group Types',
    category: 'groups',
    table: 'group_types',
    endpoint: '/groups/v2/group_types',
    supportsUpdatedSince: false,
    syncStrategy: 'upsert',
    onConflict: 'pco_id',
    mapRow: (gt) => ({
      pco_id: gt.id,
      name: gt.attributes.name || 'Unknown Type',
    }),
  },

  // ── 3. Groups ─────────────────────────────────────────────
  {
    key: 'groups',
    label: 'Groups',
    category: 'groups',
    table: 'groups',
    endpoint: '/groups/v2/groups',
    supportsUpdatedSince: false,
    syncStrategy: 'upsert',
    onConflict: 'pco_id',
    mapRow: (g) => ({
      pco_id: g.id,
      name: g.attributes.name || 'Unnamed Group',
      description: g.attributes.description || null,
      group_type: g.attributes.group_type || 'small_group',
      pco_group_type_id: g.relationships?.group_type?.data?.id || null,
      schedule: g.attributes.schedule || null,
      is_pco_synced: true,
      is_active: !g.attributes.archived_at,
    }),
  },

  // ── 4. Group Memberships (nested per group) ───────────────
  {
    key: 'group_memberships',
    label: 'Group Members',
    category: 'groups',
    table: 'group_memberships',
    endpoint: '',  // unused — nested
    supportsUpdatedSince: false,
    syncStrategy: 'replace',
    onConflict: 'pco_id',
    isNested: true,
    nestedParentTable: 'groups',
    nestedEndpointTemplate: '/groups/v2/groups/{parentId}/memberships',
    mapRow: (m) => ({
      pco_id: m.id,
      _pco_person_id: m.relationships?.person?.data?.id || null,
      _pco_group_id: m.attributes?._parentPcoId || null,
      role: m.attributes.role || 'member',
      joined_at: m.attributes.joined_at || null,
      is_active: true,
    }),
    idMappings: [
      { field: 'person_id', pcoField: '_pco_person_id', table: 'people' },
      { field: 'group_id', pcoField: '_pco_group_id', table: 'groups' },
    ],
  },

  // ── 5. Group Applications / Enrollments (nested per group) ─
  {
    key: 'group_applications',
    label: 'Group Applications',
    category: 'groups',
    table: 'group_applications',
    endpoint: '',
    supportsUpdatedSince: false,
    syncStrategy: 'upsert',
    onConflict: 'pco_id',
    isNested: true,
    nestedParentTable: 'groups',
    nestedEndpointTemplate: '/groups/v2/groups/{parentId}/applications',
    mapRow: (e) => ({
      pco_id: e.id,
      pco_person_id: e.relationships?.person?.data?.id || null,
      pco_group_id: e.attributes?._parentPcoId || null,
      status: e.attributes.status || 'pending',
      applied_at: e.attributes.created_at || null,
      resolved_at: e.attributes.resolved_at || null,
    }),
    idMappings: [
      { field: 'person_id', pcoField: 'pco_person_id', table: 'people' },
      { field: 'group_id', pcoField: 'pco_group_id', table: 'groups' },
    ],
  },

  // ── 6. Group Events (nested per group) ────────────────────
  {
    key: 'group_events',
    label: 'Group Events',
    category: 'groups',
    table: 'group_events',
    endpoint: '',
    supportsUpdatedSince: false,
    syncStrategy: 'upsert',
    onConflict: 'pco_id',
    isNested: true,
    nestedParentTable: 'groups',
    nestedEndpointTemplate: '/groups/v2/groups/{parentId}/events',
    mapRow: (ev) => ({
      pco_id: ev.id,
      pco_group_id: ev.attributes?._parentPcoId || null,
      name: ev.attributes.name || null,
      starts_at: ev.attributes.starts_at || null,
      ends_at: ev.attributes.ends_at || null,
    }),
    idMappings: [
      { field: 'group_id', pcoField: 'pco_group_id', table: 'groups' },
    ],
  },

  // ── 7. Group Event Attendances (nested per group_event) ───
  {
    key: 'group_event_attendances',
    label: 'Group Attendance',
    category: 'groups',
    table: 'group_event_attendances',
    endpoint: '',
    supportsUpdatedSince: false,
    syncStrategy: 'upsert',
    onConflict: 'pco_id',
    isNested: true,
    nestedParentTable: 'group_events',
    nestedEndpointTemplate: '/groups/v2/events/{parentId}/attendances',
    mapRow: (a) => ({
      pco_id: a.id,
      pco_event_id: a.attributes?._parentPcoId || null,
      pco_person_id: a.relationships?.person?.data?.id || null,
      role: a.attributes.role || 'attendee',
      attended: a.attributes.attended ?? true,
    }),
    idMappings: [
      { field: 'event_id', pcoField: 'pco_event_id', table: 'group_events' },
      { field: 'person_id', pcoField: 'pco_person_id', table: 'people' },
    ],
  },

  // ── 8. Attendance / Check-Ins ──────────────────────────────
  {
    key: 'attendance',
    label: 'Check-ins',
    category: 'groups',
    table: 'attendance_records',
    endpoint: '/check-ins/v2/check_ins',
    supportsUpdatedSince: false,
    syncStrategy: 'upsert',
    onConflict: 'pco_event_id',
    mapRow: (c) => ({
      pco_event_id: c.id,
      pco_person_id: c.relationships?.person?.data?.id || null,
      event_date: c.attributes.created_at?.substring(0, 10) || null,
      service_type: null,
      checked_in_at: c.attributes.created_at || null,
    }),
    idMappings: [
      { field: 'person_id', pcoField: 'pco_person_id', table: 'people' },
    ],
  },

  // ── 9. Service Types ──────────────────────────────────────
  {
    key: 'service_types',
    label: 'Service Types',
    category: 'teams',
    table: 'service_types',
    endpoint: '/services/v2/service_types',
    supportsUpdatedSince: false,
    syncStrategy: 'upsert',
    onConflict: 'pco_id',
    mapRow: (st) => ({
      pco_id: st.id,
      name: st.attributes.name || 'Unknown Service',
    }),
  },

  // ── 9. Teams ──────────────────────────────────────────────
  {
    key: 'teams',
    label: 'Teams',
    category: 'teams',
    table: 'teams',
    endpoint: '/services/v2/teams',
    supportsUpdatedSince: false,
    syncStrategy: 'upsert',
    onConflict: 'pco_id',
    mapRow: (t) => ({
      pco_id: t.id,
      name: t.attributes.name || 'Unnamed Team',
      description: t.attributes.default_status || null,
      team_type: 'general',
      pco_service_type_id: t.relationships?.service_type?.data?.id || null,
      is_pco_synced: true,
      is_active: !t.attributes.archived_at,
    }),
  },

  // ── 10. Team Memberships (nested per team via person_team_position_assignments)
  {
    key: 'team_memberships',
    label: 'Team Members',
    category: 'teams',
    table: 'team_memberships',
    endpoint: '',
    supportsUpdatedSince: false,
    syncStrategy: 'upsert',
    onConflict: 'pco_id',
    isNested: true,
    nestedParentTable: 'teams',
    nestedEndpointTemplate: '/services/v2/teams/{parentId}/person_team_position_assignments',
    queryParams: { include: 'team_position' },
    mapRow: (ptpa, included) => {
      const positionId = ptpa.relationships?.team_position?.data?.id
      const position = included?.find((i: any) => i.type === 'TeamPosition' && i.id === positionId)
      const positionName = position?.attributes?.name || null
      // Derive role: if position contains "leader" (case-insensitive), mark as leader
      const isLeader = positionName && /leader/i.test(positionName)
      return {
        pco_id: ptpa.id,
        _pco_person_id: ptpa.relationships?.person?.data?.id || null,
        _pco_team_id: ptpa.attributes?._parentPcoId || null,
        role: isLeader ? 'Leader' : 'member',
        position: positionName,
        joined_at: ptpa.attributes.created_at || null,
        is_active: true,
      }
    },
    idMappings: [
      { field: 'person_id', pcoField: '_pco_person_id', table: 'people' },
      { field: 'team_id', pcoField: '_pco_team_id', table: 'teams' },
    ],
  },

  // ── 11. Team Positions (nested per team) ──────────────────
  {
    key: 'team_positions',
    label: 'Team Positions',
    category: 'teams',
    table: 'team_positions',
    endpoint: '',
    supportsUpdatedSince: false,
    syncStrategy: 'upsert',
    onConflict: 'pco_id',
    isNested: true,
    nestedParentTable: 'teams',
    nestedEndpointTemplate: '/services/v2/teams/{parentId}/team_positions',
    mapRow: (tp) => ({
      pco_id: tp.id,
      pco_team_id: tp.attributes?._parentPcoId || null,
      name: tp.attributes.name || 'Unknown Position',
    }),
    idMappings: [
      { field: 'team_id', pcoField: 'pco_team_id', table: 'teams' },
    ],
  },

  // ── 11. Service Plans (nested per service_type) ───────────
  {
    key: 'service_plans',
    label: 'Service Plans',
    category: 'teams',
    table: 'service_plans',
    endpoint: '',
    supportsUpdatedSince: false,
    syncStrategy: 'upsert',
    onConflict: 'pco_id',
    isNested: true,
    nestedParentTable: 'service_types',
    nestedEndpointTemplate: '/services/v2/service_types/{parentId}/plans',
    mapRow: (pl) => ({
      pco_id: pl.id,
      pco_service_type_id: pl.attributes?._parentPcoId || null,
      title: pl.attributes.title || pl.attributes.dates || null,
      sort_date: pl.attributes.sort_date || null,
    }),
    idMappings: [
      { field: 'service_type_id', pcoField: 'pco_service_type_id', table: 'service_types' },
    ],
  },

  // ── 12. Plan Team Members (doubly nested: service_type → plan → team_members)
  {
    key: 'plan_team_members',
    label: 'Scheduled Members',
    category: 'teams',
    table: 'plan_team_members',
    endpoint: '',
    supportsUpdatedSince: false,
    syncStrategy: 'upsert',
    onConflict: 'pco_id',
    isNested: true,
    isDoublyNested: true,
    nestedParentTable: 'service_types',
    nestedChildTable: 'service_plans',
    nestedEndpointTemplate: '/services/v2/service_types/{parentId}/plans/{childId}/team_members',
    mapRow: (tm) => ({
      pco_id: tm.id,
      pco_plan_id: tm.attributes?._childPcoId || null,
      pco_person_id: tm.relationships?.person?.data?.id || null,
      pco_team_id: tm.relationships?.team?.data?.id || null,
      position_name: tm.attributes.team_position_name || null,
      status: tm.attributes.status || 'U',
      accepted_at: tm.attributes.accepted_at || null,
    }),
    idMappings: [
      { field: 'plan_id', pcoField: 'pco_plan_id', table: 'service_plans' },
      { field: 'person_id', pcoField: 'pco_person_id', table: 'people' },
      { field: 'team_id', pcoField: 'pco_team_id', table: 'teams' },
    ],
  },

]

// ── Flat Resource Helpers ───────────────────────────────────

/** Get total count for a flat resource from PCO */
export async function getResourceCount(
  client: PcoClient,
  resource: SyncResource,
  updatedSince?: string | null,
): Promise<number> {
  if (resource.isNested) return 0  // nested counts come from getNestedResourceInfo
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
    ...(resource.queryParams || {}),
  }
  if (updatedSince && resource.supportsUpdatedSince) {
    params['where[updated_at][gte]'] = updatedSince
    params['order'] = 'updated_at'
  }

  const result = await client.get(resource.endpoint, params)
  const data = result.data || []
  const included = result.included || []
  const rows = data.map((item: any) => resource.mapRow(item, included))

  return {
    rows,
    hasMore: !!result.links?.next,
    totalCount: result.meta?.total_count || 0,
  }
}

// ── Nested Resource Helpers ─────────────────────────────────

/** Get info for a nested resource: total child count across all parents */
export async function getNestedResourceInfo(
  client: PcoClient,
  resource: SyncResource,
  admin: any,
  churchId: string,
): Promise<{ totalCount: number; cursor: NestedCursor }> {
  if (!resource.isNested || !resource.nestedParentTable || !resource.nestedEndpointTemplate) {
    return { totalCount: 0, cursor: { parentIdx: 0, offset: 0, parents: [] } }
  }

  // Get parent records from our DB
  const { data: parentRows } = await admin
    .from(resource.nestedParentTable)
    .select('id, pco_id')
    .eq('church_id', churchId)
    .not('pco_id', 'is', null)

  if (!parentRows || parentRows.length === 0) {
    return { totalCount: 0, cursor: { parentIdx: 0, offset: 0, parents: [] } }
  }

  // For doubly-nested, we also need child records
  let children: { id: string; pcoId: string; childCount: number }[] | undefined
  if (resource.isDoublyNested && resource.nestedChildTable) {
    const { data: childRows } = await admin
      .from(resource.nestedChildTable)
      .select('id, pco_id')
      .eq('church_id', churchId)
      .not('pco_id', 'is', null)
      .order('sort_date', { ascending: false })
      .limit(500) // limit to recent plans for performance

    children = (childRows || []).map((c: any) => ({
      id: c.id, pcoId: c.pco_id, childCount: 0,
    }))
  }

  // Estimate total count (we don't ping every parent — too slow)
  // Instead, use parent count * estimated avg children
  const estimatedTotal = parentRows.length * 10

  const parents = parentRows.map((p: any) => ({
    id: p.id, pcoId: p.pco_id, childCount: 0,
  }))

  return {
    totalCount: estimatedTotal,
    cursor: { parentIdx: 0, offset: 0, parents, children },
  }
}

/** Fetch one page of a nested resource using cursor */
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
  if (!resource.nestedEndpointTemplate || cursor.parents.length === 0) {
    return { rows: [], hasMore: false, nextCursor: null, upsertedEstimate: 0 }
  }

  // Doubly nested: iterate parent × child
  if (resource.isDoublyNested && cursor.children && cursor.children.length > 0) {
    return fetchDoublyNestedPage(client, resource, cursor, perPage)
  }

  const parent = cursor.parents[cursor.parentIdx]
  if (!parent) {
    return { rows: [], hasMore: false, nextCursor: null, upsertedEstimate: 0 }
  }

  const endpoint = resource.nestedEndpointTemplate.replace('{parentId}', parent.pcoId)

  try {
    const result = await client.get(endpoint, {
      per_page: String(perPage),
      offset: String(cursor.offset),
      ...(resource.queryParams || {}),
    })

    const data = result.data || []
    const included = result.included || []
    // Inject parent PCO ID into each row so mapRow can use it
    const rows = data.map((item: any) => {
      item.attributes = item.attributes || {}
      item.attributes._parentPcoId = parent.pcoId
      return resource.mapRow(item, included)
    })

    const pageHasMore = !!result.links?.next
    let nextCursor: NestedCursor | null = null

    if (pageHasMore) {
      // More pages for this parent
      nextCursor = { ...cursor, offset: cursor.offset + perPage }
    } else if (cursor.parentIdx + 1 < cursor.parents.length) {
      // Move to next parent
      nextCursor = { ...cursor, parentIdx: cursor.parentIdx + 1, offset: 0 }
    }

    return {
      rows,
      hasMore: nextCursor !== null,
      nextCursor,
      upsertedEstimate: rows.length,
    }
  } catch (e: any) {
    // Skip this parent on error (e.g. 404), move to next
    console.warn(`Nested fetch failed for ${endpoint}:`, e.message)
    if (cursor.parentIdx + 1 < cursor.parents.length) {
      return {
        rows: [],
        hasMore: true,
        nextCursor: { ...cursor, parentIdx: cursor.parentIdx + 1, offset: 0 },
        upsertedEstimate: 0,
      }
    }
    return { rows: [], hasMore: false, nextCursor: null, upsertedEstimate: 0 }
  }
}

/** Fetch page for doubly-nested resource (e.g. service_type → plan → team_members) */
async function fetchDoublyNestedPage(
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
  const children = cursor.children!
  const parent = cursor.parents[cursor.parentIdx]
  const childIdx = cursor.childIdx ?? 0
  const child = children[childIdx]

  if (!parent || !child) {
    return { rows: [], hasMore: false, nextCursor: null, upsertedEstimate: 0 }
  }

  const endpoint = (resource.nestedEndpointTemplate || '')
    .replace('{parentId}', parent.pcoId)
    .replace('{childId}', child.pcoId)

  try {
    const result = await client.get(endpoint, {
      per_page: String(perPage),
      offset: String(cursor.offset),
      ...(resource.queryParams || {}),
    })

    const data = result.data || []
    const included = result.included || []
    const rows = data.map((item: any) => {
      item.attributes = item.attributes || {}
      item.attributes._parentPcoId = parent.pcoId
      item.attributes._childPcoId = child.pcoId
      return resource.mapRow(item, included)
    })

    const pageHasMore = !!result.links?.next
    let nextCursor: NestedCursor | null = null

    if (pageHasMore) {
      nextCursor = { ...cursor, childIdx, offset: cursor.offset + perPage }
    } else if (childIdx + 1 < children.length) {
      nextCursor = { ...cursor, childIdx: childIdx + 1, offset: 0 }
    }
    // Note: we only iterate children within one "parent" batch at a time.
    // The sync_page caller will need to manage parent iteration externally
    // or we flatten parent×child into the children array.

    return {
      rows,
      hasMore: nextCursor !== null,
      nextCursor,
      upsertedEstimate: rows.length,
    }
  } catch (e: any) {
    console.warn(`Doubly-nested fetch failed for ${endpoint}:`, e.message)
    if (childIdx + 1 < children.length) {
      return {
        rows: [],
        hasMore: true,
        nextCursor: { ...cursor, childIdx: childIdx + 1, offset: 0 },
        upsertedEstimate: 0,
      }
    }
    return { rows: [], hasMore: false, nextCursor: null, upsertedEstimate: 0 }
  }
}

// ── Generic PCO ID Resolution ───────────────────────────────

/**
 * Resolve PCO IDs to DB UUIDs for all configured mappings.
 * Drops rows where any required FK can't be resolved.
 */
export async function resolvePcoIds(
  admin: any,
  rows: Record<string, any>[],
  mappings: IdMapping[],
  churchId: string,
): Promise<Record<string, any>[]> {
  if (mappings.length === 0 || rows.length === 0) return rows

  // Build lookup maps for each mapping
  const lookupMaps: Map<string, Map<string, string>> = new Map()

  for (const mapping of mappings) {
    const pcoIds = [...new Set(
      rows.map(r => r[mapping.pcoField]).filter(Boolean)
    )]

    if (pcoIds.length === 0) {
      lookupMaps.set(mapping.pcoField, new Map())
      continue
    }

    // Batch lookup — Supabase IN filter has a limit, chunk if needed
    const allResults: any[] = []
    for (let i = 0; i < pcoIds.length; i += 500) {
      const chunk = pcoIds.slice(i, i + 500)
      const { data } = await admin
        .from(mapping.table)
        .select('id, pco_id')
        .eq('church_id', churchId)
        .in('pco_id', chunk)
      if (data) allResults.push(...data)
    }

    lookupMaps.set(
      mapping.pcoField,
      new Map(allResults.map((r: any) => [r.pco_id, r.id]))
    )
  }

  // Map rows, resolving IDs and dropping unresolvable ones
  return rows
    .map(row => {
      const resolved = { ...row }
      for (const mapping of mappings) {
        const map = lookupMaps.get(mapping.pcoField)!
        const pcoVal = row[mapping.pcoField]
        if (pcoVal) {
          const uuid = map.get(pcoVal)
          if (!uuid) return null // can't resolve — drop row
          resolved[mapping.field] = uuid
        }
        // Remove the temp pco field if it starts with _
        if (mapping.pcoField.startsWith('_')) {
          delete resolved[mapping.pcoField]
        }
      }
      return resolved
    })
    .filter(Boolean) as Record<string, any>[]
}

// ── Post-sync FK linking ────────────────────────────────────

/**
 * Link FK columns that reference other synced tables via PCO IDs.
 * E.g. groups.group_type_id from groups.pco_group_type_id → group_types.pco_id
 */
export async function linkForeignKeys(admin: any, churchId: string) {
  // Link groups.group_type_id from pco_group_type_id → group_types.pco_id
  const { data: groupTypes } = await admin
    .from('group_types')
    .select('id, pco_id')
    .eq('church_id', churchId)

  if (groupTypes && groupTypes.length > 0) {
    for (const gt of groupTypes) {
      await admin
        .from('groups')
        .update({ group_type_id: gt.id })
        .eq('church_id', churchId)
        .eq('pco_group_type_id', gt.pco_id)
    }
  }

  // Link teams.service_type_id from pco_service_type_id → service_types.pco_id
  const { data: serviceTypes } = await admin
    .from('service_types')
    .select('id, pco_id')
    .eq('church_id', churchId)

  if (serviceTypes && serviceTypes.length > 0) {
    for (const st of serviceTypes) {
      await admin
        .from('teams')
        .update({ service_type_id: st.id })
        .eq('church_id', churchId)
        .eq('pco_service_type_id', st.pco_id)
    }
  }
}

// ── Tables to purge ─────────────────────────────────────────

/** All tables that hold PCO-synced data (delete in FK-safe order) */
export const PCO_TABLES = [
  'plan_team_members',
  'service_plans',
  'team_positions',
  'team_memberships',
  'group_event_attendances',
  'group_events',
  'group_applications',
  'group_memberships',
  'attendance_records',
  'person_analytics',
  'shepherding_relationships',
  'teams',
  'groups',
  'group_types',
  'service_types',
  'people',
]
