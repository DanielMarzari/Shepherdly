import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: appUser } = await supabase
    .from('users').select('church_id').eq('user_id', user.id).single()
  if (!appUser) return NextResponse.json({ error: 'No profile' }, { status: 403 })

  const params = request.nextUrl.searchParams
  const detail = params.get('detail') // 'group' or 'team'
  const contextId = params.get('context_id')

  // Detail view for a specific group or team
  if (detail && contextId) {
    if (detail === 'group') {
      const [groupRes, membersRes, eventsRes] = await Promise.all([
        supabase.from('groups').select('id, name, group_type, description').eq('id', contextId).single(),
        supabase.from('group_memberships')
          .select('person_id, role, joined_at, is_active, people(id, name)')
          .eq('group_id', contextId)
          .order('joined_at', { ascending: false }),
        supabase.from('group_events')
          .select('id, name, starts_at')
          .eq('group_id', contextId)
          .order('starts_at', { ascending: false })
          .limit(20),
      ])

      // Attendance rate per recent event
      const eventIds = (eventsRes.data || []).map(e => e.id)
      let eventAttendance: Record<string, number> = {}
      if (eventIds.length > 0) {
        const { data: att } = await supabase
          .from('group_event_attendances')
          .select('event_id')
          .in('event_id', eventIds)
          .eq('attended', true)
        att?.forEach(a => { eventAttendance[a.event_id] = (eventAttendance[a.event_id] || 0) + 1 })
      }

      const activeMembers = (membersRes.data || []).filter((m: any) => m.is_active !== false)
      return NextResponse.json({
        group: groupRes.data,
        members: membersRes.data || [],
        activeMemberCount: activeMembers.length,
        recentEvents: (eventsRes.data || []).map(e => ({
          ...e,
          attendeeCount: eventAttendance[e.id] || 0,
        })),
      })
    }

    if (detail === 'team') {
      const [teamRes, membersRes, plansRes] = await Promise.all([
        supabase.from('teams').select('id, name, team_type').eq('id', contextId).single(),
        supabase.from('team_memberships')
          .select('person_id, role, people(id, name)')
          .eq('team_id', contextId),
        supabase.from('plan_team_members')
          .select('person_id, status, plan_id, position_name, service_plans(sort_date, title)')
          .eq('team_id', contextId)
          .order('created_at', { ascending: false })
          .limit(50),
      ])

      const confirmed = (plansRes.data || []).filter((p: any) => p.status === 'C').length
      const total = (plansRes.data || []).length

      return NextResponse.json({
        team: teamRes.data,
        members: membersRes.data || [],
        recentSchedules: plansRes.data || [],
        confirmationRate: total > 0 ? confirmed / total : null,
      })
    }
  }

  // Default: overview analytics
  const [coverageRes, trendRes, unconnectedRes, contextRes] = await Promise.all([
    supabase.from('care_coverage_summary').select('*').limit(1).single(),
    supabase.from('weekly_attendance_trend').select('*').order('week_start', { ascending: true }),
    supabase.from('active_unconnected_people').select('*').limit(20),
    supabase.from('context_summary').select('*'),
  ])

  return NextResponse.json({
    coverage: coverageRes.data || { total_active: 0, total_attenders: 0, unconnected_active: 0, has_shepherd: 0, connection_percentage: 0 },
    attendanceTrend: trendRes.data || [],
    unconnectedPeople: unconnectedRes.data || [],
    contextSummary: contextRes.data || [],
  })
}
