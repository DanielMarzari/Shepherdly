import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: appUser } = await supabase
    .from('users').select('id, role, church_id').eq('user_id', user.id).single()
  if (!appUser) return NextResponse.json({ error: 'No profile' }, { status: 403 })

  const { data: reports, error } = await supabase
    .from('ministry_impact_reports')
    .select('*')
    .eq('church_id', appUser.church_id!)
    .order('reporting_period_end', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ reports: reports || [], userRole: appUser.role })
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: appUser } = await supabase
    .from('users').select('id, role, church_id').eq('user_id', user.id).single()
  if (!['super_admin', 'staff'].includes(appUser?.role || ''))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const { title, reporting_period_start, reporting_period_end, metrics, narrative, outcomes } = body
  if (!title) return NextResponse.json({ error: 'Title required' }, { status: 400 })

  const { data: report, error } = await supabase
    .from('ministry_impact_reports')
    .insert({
      title,
      reporting_period_start: reporting_period_start || null,
      reporting_period_end: reporting_period_end || null,
      metrics: metrics || {},
      narrative: narrative || null,
      outcomes: outcomes || null,
      created_by: appUser!.id,
      church_id: appUser!.church_id,
      status: 'draft',
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ report })
}
