import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: currentUser } = await supabase
    .from('users')
    .select('id, role, church_id')
    .eq('user_id', user.id)
    .single()

  const admin = createAdminClient()
  const churchId = currentUser?.church_id

  // Get all active people (exclude system accounts with name starting with "_")
  const { data: people } = await admin
    .from('people')
    .select('id, name, pco_id, status')
    .eq('church_id', churchId!)
    .eq('status', 'active')
    .not('name', 'like', '\\_%')

  if (!people || people.length === 0) {
    return NextResponse.json({ nodes: [], currentUserRole: currentUser?.role })
  }

  const personMap = new Map(people.map(p => [p.id, p]))

  // Get group memberships with role info
  const { data: groupMemberships } = await admin
    .from('group_memberships')
    .select('person_id, group_id, role, is_active')
    .eq('church_id', churchId!)
    .eq('is_active', true)

  // Get groups
  const { data: groups } = await admin
    .from('groups')
    .select('id, name, is_active')
    .eq('church_id', churchId!)
    .eq('is_active', true)

  // Get team memberships
  const { data: teamMemberships } = await admin
    .from('team_memberships')
    .select('person_id, team_id, role, is_active')
    .eq('church_id', churchId!)
    .eq('is_active', true)

  // Get teams
  const { data: teams } = await admin
    .from('teams')
    .select('id, name, is_active')
    .eq('church_id', churchId!)
    .eq('is_active', true)

  // Get manual shepherding relationships
  const { data: manualRelationships } = await admin
    .from('shepherding_relationships')
    .select('shepherd_id, person_id, context_type')
    .eq('is_active', true)

  // Get recent check-in reports per leader
  const { data: recentReports } = await admin
    .from('check_in_reports')
    .select('leader_id, created_at')
    .order('created_at', { ascending: false })

  const lastCheckin: Record<string, string> = {}
  recentReports?.forEach(r => {
    if (!lastCheckin[r.leader_id]) lastCheckin[r.leader_id] = r.created_at
  })

  // Build shepherding edges: shepherd_person_id → [sheep_person_id]
  // Sources: group leaders, team leaders, manual assignments
  const shepherdEdges: Map<string, Set<string>> = new Map()

  const addEdge = (shepherdId: string, sheepId: string) => {
    if (shepherdId === sheepId) return
    if (!personMap.has(shepherdId) || !personMap.has(sheepId)) return
    if (!shepherdEdges.has(shepherdId)) shepherdEdges.set(shepherdId, new Set())
    shepherdEdges.get(shepherdId)!.add(sheepId)
  }

  // Group leaders shepherd their group members
  const groupMap = new Map((groups || []).map(g => [g.id, g]))
  const groupMembers: Map<string, { personId: string; role: string }[]> = new Map()
  for (const gm of groupMemberships || []) {
    if (!groupMembers.has(gm.group_id)) groupMembers.set(gm.group_id, [])
    groupMembers.get(gm.group_id)!.push({ personId: gm.person_id, role: gm.role || 'member' })
  }

  for (const [groupId, members] of groupMembers) {
    const leaders = members.filter(m => /leader/i.test(m.role))
    const nonLeaders = members.filter(m => !/leader/i.test(m.role))
    for (const leader of leaders) {
      for (const member of nonLeaders) {
        addEdge(leader.personId, member.personId)
      }
    }
  }

  // Team leaders shepherd their team members
  // PCO doesn't always have a "leader" role on team_memberships, so we also check
  // if the person is in the team_leaders relationship or has a leader-like position
  const teamMap = new Map((teams || []).map(t => [t.id, t]))
  const teamMembers: Map<string, { personId: string; role: string }[]> = new Map()
  for (const tm of teamMemberships || []) {
    if (!teamMembers.has(tm.team_id)) teamMembers.set(tm.team_id, [])
    teamMembers.get(tm.team_id)!.push({ personId: tm.person_id, role: tm.role || 'member' })
  }

  for (const [teamId, members] of teamMembers) {
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
  }

  // Build tree nodes — only include people who are shepherds or have a shepherd
  const allShepherds = new Set(shepherdEdges.keys())
  const allSheep = new Set<string>()
  for (const sheep of shepherdEdges.values()) {
    for (const s of sheep) allSheep.add(s)
  }
  const treePersonIds = new Set([...allShepherds, ...allSheep])

  // For each person, pick their "primary" shepherd for the tree hierarchy
  // Priority: manual > group leader > team leader
  const primaryShepherd: Map<string, string> = new Map()
  // First pass: group/team edges (lower priority)
  for (const [shepherdId, sheepSet] of shepherdEdges) {
    for (const sheepId of sheepSet) {
      if (!primaryShepherd.has(sheepId)) {
        primaryShepherd.set(sheepId, shepherdId)
      }
    }
  }
  // Second pass: manual overrides
  for (const r of manualRelationships || []) {
    if (treePersonIds.has(r.person_id) && treePersonIds.has(r.shepherd_id)) {
      primaryShepherd.set(r.person_id, r.shepherd_id)
    }
  }

  // Collect context labels for each shepherd
  const shepherdContexts: Map<string, Set<string>> = new Map()
  for (const [groupId, members] of groupMembers) {
    const group = groupMap.get(groupId)
    const leaders = members.filter(m => /leader/i.test(m.role))
    for (const leader of leaders) {
      if (!shepherdContexts.has(leader.personId)) shepherdContexts.set(leader.personId, new Set())
      shepherdContexts.get(leader.personId)!.add(group?.name || 'Group')
    }
  }
  for (const [teamId, members] of teamMembers) {
    const team = teamMap.get(teamId)
    const leaders = members.filter(m => /leader/i.test(m.role))
    for (const leader of leaders) {
      if (!shepherdContexts.has(leader.personId)) shepherdContexts.set(leader.personId, new Set())
      shepherdContexts.get(leader.personId)!.add(team?.name || 'Team')
    }
  }

  // Build final nodes
  const nodes = [...treePersonIds].map(personId => {
    const person = personMap.get(personId)!
    const flockCount = shepherdEdges.get(personId)?.size || 0
    const isShepherd = allShepherds.has(personId)
    const contexts = shepherdContexts.get(personId)
    const contextLabel = contexts ? [...contexts].slice(0, 3).join(', ') : null

    return {
      id: personId,
      name: person.name || 'Unknown',
      role: isShepherd ? 'shepherd' : 'member',
      supervisorId: primaryShepherd.get(personId) || null,
      flockCount,
      lastCheckin: lastCheckin[personId] || null,
      isCurrentUser: false, // we'll match below
      contextLabel,
    }
  })

  // Try to match current user to a person record
  const { data: appUsers } = await admin
    .from('users')
    .select('name')
    .eq('user_id', user.id)
    .single()

  if (appUsers?.name) {
    const match = nodes.find(n => n.name.toLowerCase() === appUsers.name.toLowerCase())
    if (match) match.isCurrentUser = true
  }

  return NextResponse.json({ nodes, currentUserRole: currentUser?.role })
}
