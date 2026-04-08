import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { randomBytes } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'

/** Generate a unique 6-char alphanumeric invite code */
function generateInviteCode(): string {
  return randomBytes(3).toString('hex').toUpperCase() // e.g. "A3F1B2"
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: caller } = await supabase.from('users').select('role, church_id').eq('user_id', user.id).single()
  if (caller?.role !== 'super_admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { email, name, role } = await request.json()
  if (!email || !role) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

  const admin = createAdminClient()
  const inviteCode = generateInviteCode()

  // Create the auth user (Supabase will send an invite email)
  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback`,
    data: { name, role }
  })

  if (inviteError) return NextResponse.json({ error: inviteError.message }, { status: 400 })

  // Create the app-level user row with a personal invite code
  const { error: profileError } = await admin.from('users').insert({
    user_id: invited.user.id,
    email,
    name,
    role,
    church_id: caller.church_id,
    invite_code: inviteCode,
  })

  if (profileError) return NextResponse.json({ error: profileError.message }, { status: 400 })

  return NextResponse.json({ success: true, user_id: invited.user.id, invite_code: inviteCode })
}
