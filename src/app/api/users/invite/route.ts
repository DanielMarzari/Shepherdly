import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: caller } = await supabase.from('app_users').select('role').eq('id', user.id).single()
  if (caller?.role !== 'super_admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { email, full_name, role, supervisor_id } = await request.json()
  if (!email || !role) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

  const admin = createAdminClient()

  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback`,
    data: { full_name, role }
  })

  if (inviteError) return NextResponse.json({ error: inviteError.message }, { status: 400 })

  const { error: profileError } = await admin.from('app_users').insert({
    id: invited.user.id,
    email,
    full_name,
    role,
  })

  if (profileError) return NextResponse.json({ error: profileError.message }, { status: 400 })

  if (supervisor_id) {
    await admin.from('user_hierarchy').insert({ user_id: invited.user.id, supervisor_id })
  }

  return NextResponse.json({ success: true, user_id: invited.user.id })
}
