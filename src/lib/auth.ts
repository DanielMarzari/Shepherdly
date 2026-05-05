/*
 * Cookie-session auth, invite-code flavour.
 *
 * Replaces Supabase Auth + the email/magic-link dance the original
 * /api/auth/login route used as a kludge to get a cookie. Same UX:
 * user submits email + invite_code, we set a session cookie.
 *
 * No passwords. invite_code is the credential. Codes are
 * case-insensitive and presumed reasonably unguessable (12+ chars).
 *
 * Sessions live in `auth_sessions`, keyed on a 64-char random hex id
 * stored in the `sid` cookie. Lifetime: 30 days, sliding (every
 * successful read bumps expires_at forward).
 *
 * Public surface used by API routes:
 *   getCurrentUser()  → AppUser | null
 *   requireUser()     → AppUser  (throws UnauthorizedError on miss)
 *   loginByInviteCode(email, code) → AppUser | null  (sets cookie on success)
 *   logout()
 */

import { randomBytes } from 'node:crypto'
import { cookies } from 'next/headers'
import { db } from './db'

const SESSION_COOKIE = 'sid'
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

export interface AppUser {
  id: string
  user_id: string         // alias of id; preserved for legacy code paths
  church_id: string | null
  email: string
  name: string | null
  role: string
  person_id: string | null
  is_active: number
}

export interface Session {
  id: string
  user_id: string
  expires_at: string
}

// ── Session lifecycle ──────────────────────────────────────────

function newSessionId(): string {
  return randomBytes(32).toString('hex')
}

function sessionExpiry(): string {
  return new Date(Date.now() + SESSION_TTL_MS).toISOString()
}

export function createSession(userId: string): Session {
  const id = newSessionId()
  const expires_at = sessionExpiry()
  db()
    .prepare('INSERT INTO auth_sessions (id, user_id, expires_at) VALUES (?, ?, ?)')
    .run(id, userId, expires_at)
  return { id, user_id: userId, expires_at }
}

export function deleteSession(sessionId: string): void {
  db().prepare('DELETE FROM auth_sessions WHERE id = ?').run(sessionId)
}

/**
 * Resolve session → user. Returns null on missing/expired. Bumps
 * expires_at on every successful read.
 */
export function validateSession(sessionId: string): AppUser | null {
  const row = db()
    .prepare(`
      SELECT
        s.id            AS session_id,
        s.expires_at    AS session_expires_at,
        u.id, u.user_id, u.church_id, u.email, u.name, u.role,
        u.person_id, u.is_active
      FROM auth_sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.id = ?
    `)
    .get(sessionId) as (AppUser & { session_id: string; session_expires_at: string }) | undefined
  if (!row) return null
  if (Date.parse(row.session_expires_at) < Date.now()) {
    deleteSession(row.session_id)
    return null
  }
  if (!row.is_active) return null
  // Slide expiry forward.
  db()
    .prepare('UPDATE auth_sessions SET expires_at = ? WHERE id = ?')
    .run(sessionExpiry(), row.session_id)
  const { session_id: _s, session_expires_at: _e, ...user } = row
  void _s; void _e
  return user
}

// ── Cookie helpers ─────────────────────────────────────────────

const cookieFlags = () => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: SESSION_TTL_MS / 1000,
})

export async function setSessionCookie(sessionId: string): Promise<void> {
  const jar = await cookies()
  jar.set(SESSION_COOKIE, sessionId, cookieFlags())
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies()
  jar.set(SESSION_COOKIE, '', { ...cookieFlags(), maxAge: 0 })
}

export async function readSessionCookie(): Promise<string | null> {
  const jar = await cookies()
  return jar.get(SESSION_COOKIE)?.value ?? null
}

// ── High-level helpers used by API routes ──────────────────────

export async function getCurrentUser(): Promise<AppUser | null> {
  const sid = await readSessionCookie()
  if (!sid) return null
  return validateSession(sid)
}

export class UnauthorizedError extends Error {
  constructor(public reason: string = 'Unauthorized') { super(reason) }
}

export async function requireUser(): Promise<AppUser> {
  const user = await getCurrentUser()
  if (!user) throw new UnauthorizedError()
  return user
}

// ── Login / logout ─────────────────────────────────────────────

/**
 * Validate email + invite_code and start a session. Returns the
 * AppUser on success, null on bad credentials, and sets the cookie
 * via setSessionCookie. Case-insensitive on both inputs.
 */
export async function loginByInviteCode(email: string, code: string): Promise<AppUser | null> {
  const e = email.trim().toLowerCase()
  const c = code.trim()
  if (!e || !c) return null
  const user = db()
    .prepare(`
      SELECT id, user_id, church_id, email, name, role, person_id, is_active
      FROM users
      WHERE LOWER(email) = ?
        AND LOWER(invite_code) = LOWER(?)
        AND is_active = 1
      LIMIT 1
    `)
    .get(e, c) as AppUser | undefined
  if (!user) return null
  const session = createSession(user.id)
  await setSessionCookie(session.id)
  return user
}

export async function logout(): Promise<void> {
  const sid = await readSessionCookie()
  if (sid) deleteSession(sid)
  await clearSessionCookie()
}

/** Drop expired sessions. Call from cron — table doesn't grow unbounded. */
export function purgeExpiredSessions(): number {
  return db()
    .prepare(`DELETE FROM auth_sessions WHERE expires_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`)
    .run().changes
}
