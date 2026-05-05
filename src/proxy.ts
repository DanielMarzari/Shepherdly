import { NextResponse, type NextRequest } from 'next/server'

/**
 * Edge middleware. Gates protected routes on the presence of a `sid`
 * cookie — the actual session validation happens in the route handlers
 * (which can hit the SQLite DB; this proxy can't, since middleware
 * runs in the Edge runtime where better-sqlite3 isn't available).
 *
 * The cookie-presence check is enough for redirect UX. If a stale
 * cookie reaches a route, the route's getCurrentUser() returns null
 * and the route returns 401 itself.
 */
export async function proxy(request: NextRequest) {
  const sid = request.cookies.get('sid')?.value
  const { pathname } = request.nextUrl

  // Public routes — login, the auth API, public pages.
  if (pathname.startsWith('/login') || pathname.startsWith('/api/auth')) {
    if (sid && pathname === '/login') {
      return NextResponse.redirect(new URL('/dashboard', request.url))
    }
    return NextResponse.next({ request })
  }

  // Protected routes — redirect to login if no session cookie.
  if (!sid) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  return NextResponse.next({ request })
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
