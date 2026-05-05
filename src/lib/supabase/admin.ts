/*
 * Drop-in replacement for the service-role admin client.
 *
 * In Supabase, the admin client bypassed RLS. With SQLite + app-layer
 * tenancy there's no equivalent privilege boundary — every query
 * already runs against the same DB without any row-level filtering.
 * Returning the same shimmed client preserves the existing contract:
 * admin code paths still work; they just don't gain any extra power
 * they didn't already have.
 */

import { sqliteClient } from '../supabase-shim'

export function createAdminClient() {
  return sqliteClient()
}
