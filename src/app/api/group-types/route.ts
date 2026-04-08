import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: appUser } = await supabase
    .from('users')
    .select('role, church_id')
    .eq('user_id', user.id)
    .single()

  if (!appUser) return NextResponse.json({ error: 'No profile' }, { status: 403 })

  const { data: groupTypes, error } = await supabase
    .from('group_types')
    .select('id, pco_id, name, is_tracked, created_at')
    .eq('church_id', appUser.church_id!)
    .order('name')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ groupTypes: groupTypes || [] })
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: appUser } = await supabase
    .from('users')
    .select('role, church_id')
    .eq('user_id', user.id)
    .single()

  if (!appUser || !['super_admin', 'staff'].includes(appUser.role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const { id, is_tracked } = body

  if (!id || typeof is_tracked !== 'boolean')
    return NextResponse.json({ error: 'id and is_tracked required' }, { status: 400 })

  const admin = createAdminClient()
  const { error } = await admin
    .from('group_types')
    .update({ is_tracked })
    .eq('id', id)
    .eq('church_id', appUser.church_id!)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
