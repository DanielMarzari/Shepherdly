import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: currentUser } = await supabase
    .from('users')
    .select('id, name, role, church_id, person_id')
    .eq('user_id', user.id)
    .single()

  const admin = createAdminClient()
  const churchId = currentUser?.church_id

  // Parallel fetch all needed data (use range to bypass 1000-row default)
  const [
    { data: people },
    { data: groupMemberships },
    { data: groups },
    { data: teamMemberships },
    { data: teams },
    { data: manualRelationships },
    { data: recentReports },
    { data: groupTypes },
    { data: serviceTypes },
  ] = await Promise.all([
    // Fetch ALL people (not just active) — group membership drives tree inclusion
    admin.from('people').select('id, name, pco_id, status, membership_type')
      .eq('church_id', churchId!)
      .not('name', 'like', '\\_%').not('name', 'like', '-%')
      .neq('membership_type', 'SYSTEM USE - Do Not Delete')
      .range(0, 49999),
    admin.from('group_memberships').select('person_id, group_id, role, is_active')
      .eq('church_id', churchId!).eq('is_active', true)
      .range(0, 49999),
    admin.from('groups').select('id, name, is_active, group_type_id, pco_group_type_id')
      .eq('church_id', churchId!).eq('is_active', true)
      .range(0, 49999),
    admin.from('team_memberships').select('person_id, team_id, role, is_active')
      .eq('church_id', churchId!).eq('is_active', true)
      .range(0, 49999),
    admin.from('teams').select('id, name, is_active, service_type_id, pco_service_type_id')
      .eq('church_id', churchId!).eq('is_active', true)
      .range(0, 49999),
    admin.from('shepherding_relationships').select('shepherd_id, person_id, context_type')
      .eq('is_active', true),
    admin.from('check_in_reports').select('leader_id, created_at')
      .order('created_at', { ascending: false }),
    admin.from('group_types').select('id, pco_id, name, is_tracked')
      .eq('church_id', churchId!).order('name'),
    admin.from('service_types').select('id, pco_id, name')
      .eq('church_id', churchId!).order('name'),
  ])

  if (!people || people.length === 0) {
    return NextResponse.json({ nodes: [], currentUserRole: currentUser?.role, groupTypes: [], serviceTypes: [] })
  }

  const personMap = new Map(people.map(p => [p.id, p]))
  const groupMap = new Map((groups || []).map(g => [g.id, g]))
  const teamMap = new Map((teams || []).map(t => [t.id, t]))
  const groupTypeMap = new Map((groupTypes || []).map(gt => [gt.id, gt]))
  // Build pco_id → group_type map too (for groups that only have pco_group_type_id)
  const groupTypePcoMap = new Map((groupTypes || []).map(gt => [gt.pco_id, gt]))

  // Resolve group → group type name
  function getGroupTypeName(group: { group_type_id?: string | null; pco_group_type_id?: string | null }): string | null {
    if (group.group_type_id) {
      const gt = groupTypeMap.get(group.group_type_id)
      if (gt) return gt.name
    }
    if (group.pco_group_type_id) {
      const gt = groupTypePcoMap.get(group.pco_group_type_id)
      if (gt) return gt.name
    }
    return null
  }

  // Resolve team → service type name
  const serviceTypeMap = new Map((serviceTypes || []).map(st => [st.id, st]))
  const serviceTypePcoMap = new Map((serviceTypes || []).map(st => [st.pco_id, st]))
  function getServiceTypeName(team: { service_type_id?: string | null; pco_service_type_id?: string | null }): string | null {
    if (team.service_type_id) {
      const st = serviceTypeMap.get(team.service_type_id)
      if (st) return st.name
    }
    if (team.pco_service_type_id) {
      const st = serviceTypePcoMap.get(team.pco_service_type_id)
      if (st) return st.name
    }
    return null
  }

  // Last check-in per person
  const lastCheckin: Record<string, string> = {}
  recentReports?.forEach(r => {
    if (!lastCheckin[r.leader_id]) lastCheckin[r.leader_id] = r.created_at
  })

  // Index memberships by group/team
  const groupMembers = new Map<string, { personId: string; role: string }[]>()
  for (const gm of groupMemberships || []) {
    if (!groupMembers.has(gm.group_id)) groupMembers.set(gm.group_id, [])
    groupMembers.get(gm.group_id)!.push({ personId: gm.person_id, role: gm.role || 'member' })
  }
  const teamMembers = new Map<string, { personId: string; role: string }[]>()
  for (const tm of teamMemberships || []) {
    if (!teamMembers.has(tm.team_id)) teamMembers.set(tm.team_id, [])
    teamMembers.get(tm.team_id)!.push({ personId: tm.person_id, role: tm.role || 'member' })
  }

  // Track contexts for ALL people (leaders AND members)
  const leaderPersonIds = new Set<string>()
  const personContexts = new Map<string, Set<string>>()

  const addContext = (personId: string, label: string) => {
    if (!personContexts.has(personId)) personContexts.set(personId, new Set())
    personContexts.get(personId)!.add(label)
  }

  for (const [groupId, members] of groupMembers) {
    const group = groupMap.get(groupId)
    if (!group) continue
    const groupTypeName = getGroupTypeName(group)
    const contextLabel = groupTypeName ? `${groupTypeName}: ${group.name}` : group.name || 'Group'

    for (const m of members) {
      if (!personMap.has(m.personId)) continue
      addContext(m.personId, contextLabel)
      if (/leader|co.?leader/i.test(m.role)) {
        leaderPersonIds.add(m.personId)
      }
    }
  }

  for (const [teamId, members] of teamMembers) {
    const team = teamMap.get(teamId)
    if (!team) continue
    const serviceTypeName = getServiceTypeName(team)
    const contextLabel = serviceTypeName ? `${serviceTypeName}: ${team.name}` : team.name || 'Team'

    for (const m of members) {
      if (!personMap.has(m.personId)) continue
      addContext(m.personId, contextLabel)
      if (/leader|co.?leader/i.test(m.role)) {
        leaderPersonIds.add(m.personId)
      }
    }
  }

  // Build shepherd → sheep edges
  const shepherdEdges = new Map<string, Set<string>>()
  const addEdge = (shepherdId: string, sheepId: string) => {
    if (shepherdId === sheepId) return
    if (!personMap.has(shepherdId) || !personMap.has(sheepId)) return
    if (!shepherdEdges.has(shepherdId)) shepherdEdges.set(shepherdId, new Set())
    shepherdEdges.get(shepherdId)!.add(sheepId)
  }

  // Group leaders → their members (anyone in the group, regardless of church membership_type)
  for (const [, members] of groupMembers) {
    const leaders = members.filter(m => /leader|co.?leader/i.test(m.role))
    const nonLeaders = members.filter(m => !/leader|co.?leader/i.test(m.role))
    for (const leader of leaders) {
      for (const member of nonLeaders) {
        addEdge(leader.personId, member.personId)
      }
    }
  }

  // Team leaders → their members
  for (const [, members] of teamMembers) {
    const leaders = members.filter(m => /leader|co.?leader/i.test(m.role))
    const nonLeaders = members.filter(m => !/leader|co.?leader/i.test(m.role))
    for (const leader of leaders) {
      for (const member of nonLeaders) {
        addEdge(leader.personId, member.personId)
      }
    }
  }

  // Manual shepherding relationships
  for (const r of manualRelationships || []) {
    addEdge(r.shepherd_id, r.person_id)
    if (personMap.has(r.shepherd_id)) leaderPersonIds.add(r.shepherd_id)
  }

  // Determine who's in the tree:
  // - All leaders (always shown)
  // - All sheep of those leaders
  // - Current user (always shown if they match a person)
  const treePersonIds = new Set<string>(leaderPersonIds)
  for (const sheepSet of shepherdEdges.values()) {
    for (const s of sheepSet) treePersonIds.add(s)
  }

  // Match current user to a person record (prefer person_id link, fallback to name)
  let currentUserPersonId: string | null = null
  if (currentUser?.person_id && personMap.has(currentUser.person_id)) {
    currentUserPersonId = currentUser.person_id
    treePersonIds.add(currentUser.person_id)
  } else if (currentUser?.name) {
    const match = people.find(p => p.name?.toLowerCase() === currentUser.name?.toLowerCase())
    if (match) {
      currentUserPersonId = match.id
      treePersonIds.add(match.id)
    }
  }

  // Assign primary shepherd for tree hierarchy
  const primaryShepherd = new Map<string, string>()

  // First: group/team edges
  for (const [shepherdId, sheepSet] of shepherdEdges) {
    for (const sheepId of sheepSet) {
      if (!primaryShepherd.has(sheepId)) {
        primaryShepherd.set(sheepId, shepherdId)
      }
    }
  }

  // Manual overrides (higher priority)
  for (const r of manualRelationships || []) {
    if (treePersonIds.has(r.person_id) && treePersonIds.has(r.shepherd_id)) {
      primaryShepherd.set(r.person_id, r.shepherd_id)
    }
  }

  // Detect cycle: if A → B → A, break it
  for (const [childId, parentId] of primaryShepherd) {
    if (primaryShepherd.get(parentId) === childId) {
      const childFlock = shepherdEdges.get(childId)?.size || 0
      const parentFlock = shepherdEdges.get(parentId)?.size || 0
      if (childFlock >= parentFlock) {
        primaryShepherd.delete(parentId)
      } else {
        primaryShepherd.delete(childId)
      }
    }
  }

  // Build nodes
  const nodes = [...treePersonIds]
    .filter(id => personMap.has(id))
    .map(personId => {
      const person = personMap.get(personId)!
      const flockCount = shepherdEdges.get(personId)?.size || 0
      const isLeader = leaderPersonIds.has(personId)
      const contexts = personContexts.get(personId)
      const contextLabel = contexts ? [...contexts].slice(0, 3).join(', ') : null
      const supervisorId = primaryShepherd.get(personId) || null
      const hasNoShepherd = isLeader && !supervisorId

      return {
        id: personId,
        name: person.name || 'Unknown',
        role: isLeader ? 'shepherd' : 'member',
        supervisorId,
        flockCount,
        lastCheckin: lastCheckin[personId] || null,
        isCurrentUser: personId === currentUserPersonId,
        contextLabel,
        warning: hasNoShepherd ? 'No assigned shepherd' : null,
      }
    })

  return NextResponse.json({
    nodes,
    currentUserRole: currentUser?.role,
    groupTypes: (groupTypes || []).map(gt => ({ id: gt.id, name: gt.name, is_tracked: gt.is_tracked })),
    serviceTypes: (serviceTypes || []).map(st => ({ id: st.id, name: st.name })),
  })
}

// POST: Bulk assign shepherd to all members of a group_type or service_type
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: currentUser } = await supabase
    .from('users')
    .select('id, name, role, church_id')
    .eq('user_id', user.id)
    .single()

  if (!currentUser || !['super_admin', 'staff'].includes(currentUser.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const { action, shepherd_id, group_type_id, service_type_id } = body

  if (action !== 'bulk_assign' || !shepherd_id) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const admin = createAdminClient()
  const churchId = currentUser.church_id

  let memberPersonIds: string[] = []

  if (group_type_id) {
    // Get all groups of this type
    const { data: groups } = await admin.from('groups')
      .select('id')
      .eq('church_id', churchId!)
      .eq('group_type_id', group_type_id)
      .eq('is_active', true)

    if (groups && groups.length > 0) {
      const groupIds = groups.map(g => g.id)
      const { data: memberships } = await admin.from('group_memberships')
        .select('person_id')
        .eq('church_id', churchId!)
        .eq('is_active', true)
        .in('group_id', groupIds)
        .range(0, 49999)

      memberPersonIds = [...new Set((memberships || []).map(m => m.person_id))]
    }
  } else if (service_type_id) {
    // Get all teams of this service type
    const { data: teams } = await admin.from('teams')
      .select('id')
      .eq('church_id', churchId!)
      .eq('service_type_id', service_type_id)
      .eq('is_active', true)

    if (teams && teams.length > 0) {
      const teamIds = teams.map(t => t.id)
      const { data: memberships } = await admin.from('team_memberships')
        .select('person_id')
        .eq('church_id', churchId!)
        .eq('is_active', true)
        .in('team_id', teamIds)
        .range(0, 49999)

      memberPersonIds = [...new Set((memberships || []).map(m => m.person_id))]
    }
  } else {
    return NextResponse.json({ error: 'Must provide group_type_id or service_type_id' }, { status: 400 })
  }

  // Filter out the shepherd themselves
  memberPersonIds = memberPersonIds.filter(id => id !== shepherd_id)

  if (memberPersonIds.length === 0) {
    return NextResponse.json({ message: 'No members found', count: 0 })
  }

  // Create shepherding relationships (upsert to avoid duplicates)
  const contextType = group_type_id ? 'group_type' : 'service_type'
  const contextId = group_type_id || service_type_id

  const rows = memberPersonIds.map(personId => ({
    shepherd_id,
    person_id: personId,
    context_type: contextType,
    context_id: contextId,
    is_active: true,
    church_id: churchId,
  }))

  // Insert in batches of 500
  let created = 0
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500)
    const { error } = await admin.from('shepherding_relationships')
      .upsert(batch, { onConflict: 'shepherd_id,person_id,context_type,context_id' })
    if (!error) created += batch.length
  }

  return NextResponse.json({ message: `Assigned ${created} members`, count: created })
}
