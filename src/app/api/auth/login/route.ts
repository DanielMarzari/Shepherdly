import { NextRequest, NextResponse } from 'next/server'
import { loginByInviteCode } from '@/lib/auth'

/**
 * Login with email + invite_code. The original Supabase implementation
 * used the magic-link flow as a kludge to set a session cookie — we
 * just check the credential and set our own `sid` cookie via
 * loginByInviteCode.
 */
export async function POST(request: NextRequest) {
  const { code, email } = await request.json()
  if (!code?.trim()) return NextResponse.json({ error: 'Code is required' }, { status: 400 })
  if (!email?.trim()) return NextResponse.json({ error: 'Email is required' }, { status: 400 })

  const user = await loginByInviteCode(email, code)
  if (!user) {
    return NextResponse.json({ error: 'Invalid code or email.' }, { status: 401 })
  }
  return NextResponse.json({ success: true })
}
