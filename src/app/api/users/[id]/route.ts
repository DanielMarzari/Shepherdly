import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: caller } = await supabase.from('app_users').select('role').eq('id', user.id).single()
  if (caller?.role !== 'super_admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const admin = createAdminClient()

  const updates: Record<string, unknown> = {}
  if (body.full_name !== undefined) updates.full_name = body.full_name
  if (body.role !== undefined) updates.role = body.role
  if (body.is_active !== undefined) updates.is_active = body.is_active

  if (Object.keys(updates).length > 0) {
    const { error } = await admin.from('app_users').update(updates).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  }

  if (body.supervisor_id !== undefined) {
    await admin.from('user_hierarchy').upsert(
      { user_id: id, supervisor_id: body.supervisor_id },
      { onConflict: 'user_id' }
    )
  }

  return NextResponse.json({ success: true })
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: caller } = await supabase.from('app_users').select('role').eq('id', user.id).single()
  if (caller?.role !== 'super_admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  await admin.from('app_users').update({ is_active: false }).eq('id', id)
  return NextResponse.json({ success: true })
}
