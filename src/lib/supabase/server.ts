/*
 * Drop-in replacement for the old @supabase/ssr server client.
 *
 * Returns the SQLite-backed shim; the chain API is identical so the
 * 25+ API routes that import from here keep working unchanged.
 */

import { sqliteClient } from '../supabase-shim'

export async function createClient() {
  return sqliteClient()
}
