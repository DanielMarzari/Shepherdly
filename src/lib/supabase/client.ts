/*
 * Browser-client shim. With cookie-session auth handled server-side,
 * there's nothing for a browser client to do — every "supabase from
 * the client" use in this codebase was for auth state, and that now
 * comes from server components / route responses.
 *
 * This stub exists only so any lingering import doesn't blow up the
 * build. Calls into it throw at runtime, which surfaces the offending
 * call site quickly.
 */

export function createClient() {
  return new Proxy(
    {},
    {
      get(_t, prop) {
        throw new Error(
          `supabase/client: '${String(prop)}' is not available — auth runs server-side. Move this call to a server action / route handler.`,
        )
      },
    },
  )
}
