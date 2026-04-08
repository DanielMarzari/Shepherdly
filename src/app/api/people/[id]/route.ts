import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: person, error } = await supabase
    .from('people')
    .select(`
      *,
      analytics:person_analytics(engagement_score, attendance_count_90d, last_attended_at, total_groups, total_teams),
      groups:group_memberships(group_id, role, groups(id, name)),
      teams:team_memberships(team_id, role, teams(id, name)),
      shepherds:shepherding_relationships!shepherding_relationships_person_id_fkey(
        id, shepherd_id, type, context_type, context_id, is_active
      )
    `)
    .eq('id', id)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 404 })
  return NextResponse.json({ person })
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: appUser } = await supabase
    .from('users').select('role, church_id').eq('user_id', user.id).single()
  if (!['super_admin', 'staff'].includes(appUser?.role || ''))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const admin = createAdminClient()

  // Update person fields
  if (body.is_leader !== undefined || body.status !== undefined) {
    const updates: Record<string, unknown> = {}
    if (body.is_leader !== undefined) updates.is_leader = body.is_leader
    if (body.status !== undefined) updates.status = body.status

    const { error } = await admin.from('people').update(updates).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Add shepherd relationship
  if (body.action === 'add_shepherd') {
    const { shepherd_id, context_type, context_id } = body
    if (!shepherd_id) return NextResponse.json({ error: 'shepherd_id required' }, { status: 400 })

    const { error } = await admin.from('shepherding_relationships').upsert({
      shepherd_id,
      person_id: id,
      type: 'shepherd',
      context_type: context_type || 'manual',
      context_id: context_id || null,
      is_active: true,
    }, { onConflict: 'shepherd_id,person_id,context_type,context_id' })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Remove shepherd relationship
  if (body.action === 'remove_shepherd') {
    const { relationship_id } = body
    if (!relationship_id) return NextResponse.json({ error: 'relationship_id required' }, { status: 400 })

    const { error } = await admin.from('shepherding_relationships')
      .update({ is_active: false })
      .eq('id', relationship_id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
