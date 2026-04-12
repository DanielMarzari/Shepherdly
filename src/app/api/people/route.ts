import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: appUser } = await supabase
    .from('users')
    .select('id, role, name, church_id')
    .eq('user_id', user.id)
    .single()

  if (!appUser) return NextResponse.json({ error: 'No profile' }, { status: 403 })

  const params = request.nextUrl.searchParams
  const search = params.get('search') || ''
  const sort = params.get('sort') || 'name'
  const showAll = params.get('all') === 'true' && ['super_admin', 'staff'].includes(appUser.role)

  let query = supabase
    .from('people')
    .select(`
      *,
      analytics:person_analytics(engagement_score, attendance_count_90d, last_attended_at, total_groups, total_teams, group_attendance_rate),
      groups:group_memberships(group_id, role, groups(id, name)),
      teams:team_memberships(team_id, role, teams(id, name))
    `)
    .eq('church_id', appUser.church_id!)
    .eq('status', 'active')
    .not('name', 'like', '\\_%')
    .not('name', 'like', '-%')
    .neq('membership_type', 'SYSTEM USE - Do Not Delete')

  if (!showAll) {
    // Find current user's people record
    const { data: myPerson } = await supabase
      .from('people')
      .select('id')
      .eq('is_leader', true)
      .eq('church_id', appUser.church_id!)
      .ilike('name', appUser.name || '')
      .limit(1)
      .single()

    if (myPerson) {
      // Get person IDs this user shepherds
      const { data: relationships } = await supabase
        .from('shepherding_relationships')
        .select('person_id')
        .eq('shepherd_id', myPerson.id)
        .eq('is_active', true)

      const personIds = relationships?.map(r => r.person_id) || []
      if (personIds.length === 0) {
        return NextResponse.json({ people: [], myPersonId: myPerson.id })
      }
      query = query.in('id', personIds)
    } else {
      return NextResponse.json({ people: [], myPersonId: null })
    }
  }

  if (search) {
    query = query.ilike('name', `%${search}%`)
  }

  if (sort === 'engagement') {
    query = query.order('name') // sort client-side from analytics join
  } else if (sort === 'attendance') {
    query = query.order('name')
  } else {
    query = query.order('name')
  }

  const { data: people, error } = await query.limit(200)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Client-side sort for analytics-based sorts
  let sorted = people || []
  if (sort === 'engagement') {
    sorted = sorted.sort((a: any, b: any) => {
      const aScore = a.analytics?.[0]?.engagement_score ?? -1
      const bScore = b.analytics?.[0]?.engagement_score ?? -1
      return bScore - aScore
    })
  } else if (sort === 'attendance') {
    sorted = sorted.sort((a: any, b: any) => {
      const aDate = a.analytics?.[0]?.last_attended_at || ''
      const bDate = b.analytics?.[0]?.last_attended_at || ''
      return bDate.localeCompare(aDate)
    })
  }

  return NextResponse.json({ people: sorted })
}
