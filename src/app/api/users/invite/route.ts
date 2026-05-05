import { createClient } from '@/lib/supabase/server'
import { randomBytes, randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'

/** Unique 6-char alphanumeric invite code, used as the credential. */
function generateInviteCode(): string {
  return randomBytes(3).toString('hex').toUpperCase() // e.g. "A3F1B2"
}

/**
 * Create a new user with a fresh invite_code. The original Supabase
 * implementation called auth.admin.inviteUserByEmail to mail a magic
 * link; without Supabase we just provision the row and return the
 * code — admin can share it out-of-band.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: caller } = await supabase
    .from('users').select('role, church_id').eq('user_id', user.id).single()
  if (caller?.role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { email, name, role } = await request.json()
  if (!email || !role) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

  const inviteCode = generateInviteCode()
  // user_id is now an alias of users.id; we generate one explicitly so
  // we can return it for the response shape downstream code expects.
  const newUserId = randomUUID().replace(/-/g, '')

  const { error: profileError } = await supabase.from('users').insert({
    id: newUserId,
    user_id: newUserId,
    email,
    name,
    role,
    church_id: caller.church_id,
    invite_code: inviteCode,
  })

  if (profileError) return NextResponse.json({ error: profileError.message }, { status: 400 })

  return NextResponse.json({ success: true, user_id: newUserId, invite_code: inviteCode })
}
