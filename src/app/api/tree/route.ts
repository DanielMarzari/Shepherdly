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

  // Parallel fetch all needed data
  const [
    { data: people },
    { data: groupMemberships },
    { data: groups },
    { data: teamMemberships },
    { data: teams },
    { data: manualRelationships },
    { data: recentReports },
  ] = await Promise.all([
    admin.from('people').select('id, name, pco_id, status')
      .eq('church_id', churchId!).eq('status', 'active')
      .not('name', 'like', '\\_%').not('name', 'like', '-%')
      .neq('membership_type', 'SYSTEM USE - Do Not Delete'),
    admin.from('group_memberships').select('person_id, group_id, role, is_active')
      .eq('church_id', churchId!).eq('is_active', true),
    admin.from('groups').select('id, name, is_active')
      .eq('church_id', churchId!).eq('is_active', true),
    admin.from('team_memberships').select('person_id, team_id, role, is_active')
      .eq('church_id', churchId!).eq('is_active', true),
    admin.from('teams').select('id, name, is_active')
      .eq('church_id', churchId!).eq('is_active', true),
    admin.from('shepherding_relationships').select('shepherd_id, person_id, context_type')
      .eq('is_active', true),
    admin.from('check_in_reports').select('leader_id, created_at')
      .order('created_at', { ascending: false }),
  ])

  if (!people || people.length === 0) {
    return NextResponse.json({ nodes: [], currentUserRole: currentUser?.role })
  }

  const personMap = new Map(people.map(p => [p.id, p]))
  const groupMap = new Map((groups || []).map(g => [g.id, g]))
  const teamMap = new Map((teams || []).map(t => [t.id, t]))

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

  // Identify all leaders (group or team)
  const leaderPersonIds = new Set<string>()
  const shepherdContexts = new Map<string, Set<string>>()

  for (const [groupId, members] of groupMembers) {
    const group = groupMap.get(groupId)
    for (const m of members) {
      if (/leader/i.test(m.role) && personMap.has(m.personId)) {
        leaderPersonIds.add(m.personId)
        if (!shepherdContexts.has(m.personId)) shepherdContexts.set(m.personId, new Set())
        shepherdContexts.get(m.personId)!.add(group?.name || 'Group')
      }
    }
  }
  for (const [teamId, members] of teamMembers) {
    const team = teamMap.get(teamId)
    for (const m of members) {
      if (/leader/i.test(m.role) && personMap.has(m.personId)) {
        leaderPersonIds.add(m.personId)
        if (!shepherdContexts.has(m.personId)) shepherdContexts.set(m.personId, new Set())
        shepherdContexts.get(m.personId)!.add(team?.name || 'Team')
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

  // Group leaders → their members
  for (const [, members] of groupMembers) {
    const leaders = members.filter(m => /leader/i.test(m.role))
    const nonLeaders = members.filter(m => !/leader/i.test(m.role))
    for (const leader of leaders) {
      for (const member of nonLeaders) {
        addEdge(leader.personId, member.personId)
      }
    }
  }

  // Team leaders → their members
  for (const [, members] of teamMembers) {
    const leaders = members.filter(m => /leader/i.test(m.role))
    const nonLeaders = members.filter(m => !/leader/i.test(m.role))
    for (const leader of leaders) {
      for (const member of nonLeaders) {
        addEdge(leader.personId, member.personId)
      }
    }
  }

  // Manual shepherding relationships
  for (const r of manualRelationships || []) {
    addEdge(r.shepherd_id, r.person_id)
    // Manual shepherds are also "leaders" for the tree
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
  // Priority: manual > group/team leader edges
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
      // Break the cycle — keep the one with more flock
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
      const contexts = shepherdContexts.get(personId)
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

  return NextResponse.json({ nodes, currentUserRole: currentUser?.role })
}
