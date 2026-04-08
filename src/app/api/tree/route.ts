import { createClient } from '@/lib/supabase/server'
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

  // Get all active users
  const { data: users } = await supabase
    .from('users')
    .select('id, name, email, role, photo_url, is_active, user_id')
    .eq('is_active', true)
    .order('role')

  // Get all people who are leaders (to map users to their people records)
  const { data: leaderPeople } = await supabase
    .from('people')
    .select('id, name, pco_id')
    .eq('is_leader', true)
    .eq('status', 'active')

  // Get all active shepherding relationships for flock counts + hierarchy
  const { data: relationships } = await supabase
    .from('shepherding_relationships')
    .select('shepherd_id, person_id, context_type')
    .eq('is_active', true)

  // Count flock per shepherd (people.id)
  const flockCounts: Record<string, number> = {}
  relationships?.forEach(r => {
    flockCounts[r.shepherd_id] = (flockCounts[r.shepherd_id] || 0) + 1
  })

  // Get recent check-in report counts per leader
  const { data: recentReports } = await supabase
    .from('check_in_reports')
    .select('leader_id, created_at')
    .order('created_at', { ascending: false })

  const lastCheckin: Record<string, string> = {}
  recentReports?.forEach(r => {
    if (!lastCheckin[r.leader_id]) {
      lastCheckin[r.leader_id] = r.created_at
    }
  })

  // Build supervisor map from shepherding_relationships
  // A user's supervisor is the shepherd of their people record (manual context preferred)
  const supervisorOf: Record<string, string> = {} // personId → shepherdPersonId
  relationships?.forEach(r => {
    // Prefer manual assignments for tree hierarchy
    if (!supervisorOf[r.person_id] || r.context_type === 'manual') {
      supervisorOf[r.person_id] = r.shepherd_id
    }
  })

  // Build tree nodes from users + their people records
  const nodes = users?.map(u => {
    const personRecord = leaderPeople?.find(p =>
      p.name?.toLowerCase() === u.name?.toLowerCase()
    )
    const personId = personRecord?.id

    // Find supervisor via shepherding_relationships
    let supervisorUserId: string | null = null
    if (personId && supervisorOf[personId]) {
      const supervisorPersonId = supervisorOf[personId]
      const supervisorPerson = leaderPeople?.find(p => p.id === supervisorPersonId)
      if (supervisorPerson) {
        const supervisorUser = users?.find(su =>
          su.name?.toLowerCase() === supervisorPerson.name?.toLowerCase()
        )
        supervisorUserId = supervisorUser?.id || null
      }
    }

    return {
      id: u.id,
      name: u.name || u.email.split('@')[0],
      email: u.email,
      role: u.role,
      supervisorId: supervisorUserId,
      flockCount: personId ? (flockCounts[personId] || 0) : 0,
      lastCheckin: personId ? (lastCheckin[personId] || null) : null,
      isCurrentUser: u.user_id === user.id,
    }
  }) || []

  return NextResponse.json({ nodes, currentUserRole: currentUser?.role })
}
