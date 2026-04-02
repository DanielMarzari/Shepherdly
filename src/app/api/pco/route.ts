import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { encrypt, decrypt } from '@/lib/crypto'
import { PcoClient, createPcoClient } from '@/lib/pco'
import {
  SYNC_RESOURCES, SYNC_CATEGORIES, PCO_TABLES,
  getResourceCount, fetchResourcePage,
  getNestedResourceInfo, fetchNestedPage,
  type NestedCursor,
} from '@/lib/pco-sync'
import { NextRequest, NextResponse } from 'next/server'

/** Helper: require super_admin, return admin client + settings */
async function requireAdmin(request?: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const { data: appUser } = await supabase
    .from('app_users').select('role').eq('id', user.id).single()
  if (appUser?.role !== 'super_admin') throw new Error('Admin only')

  const admin = createAdminClient()
  const { data: settings } = await admin.from('church_settings').select('*').limit(1).single()

  return { user, admin, settings }
}

// ═══════════════════════════════════════════════════════════════
// GET /api/pco?action=validate|status|auto_sync_settings
// ═══════════════════════════════════════════════════════════════
export async function GET(request: NextRequest) {
  try {
    const { admin, settings } = await requireAdmin(request)
    const action = request.nextUrl.searchParams.get('action') || 'status'

    if (action === 'validate') {
      if (!settings?.pco_app_id || !settings?.pco_app_secret) {
        return NextResponse.json({ valid: false, error: 'No credentials saved' })
      }
      const client = createPcoClient(settings.pco_app_id, settings.pco_app_secret)
      return NextResponse.json(await client.validate())
    }

    if (action === 'status') {
      const { data: lastSync } = await admin
        .from('sync_logs').select('*')
        .order('started_at', { ascending: false }).limit(1).single()

      // Count all resource tables (skip tables that don't exist)
      const counts: Record<string, number> = {}
      for (const res of SYNC_RESOURCES) {
        try {
          const { count } = await admin.from(res.table).select('*', { count: 'exact', head: true })
          counts[res.key] = count || 0
        } catch {
          counts[res.key] = 0
        }
      }

      return NextResponse.json({
        hasCredentials: !!(settings?.pco_app_id && settings?.pco_app_secret),
        lastSync: lastSync || null,
        counts,
        categories: SYNC_CATEGORIES,
        resources: SYNC_RESOURCES.map(r => ({ key: r.key, label: r.label, category: r.category })),
      })
    }

    if (action === 'auto_sync_settings') {
      return NextResponse.json({
        enabled: settings?.pco_sync_enabled ?? false,
        frequency: (settings as any)?.pco_sync_frequency ?? 'daily',
      })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (e: any) {
    const status = e.message === 'Unauthorized' ? 401 : e.message === 'Admin only' ? 403 : 500
    return NextResponse.json({ error: e.message }, { status })
  }
}

// ═══════════════════════════════════════════════════════════════
// POST /api/pco — save creds, auto-sync, start/page/finish sync, purge
// ═══════════════════════════════════════════════════════════════
export async function POST(request: NextRequest) {
  try {
    const { user, admin, settings } = await requireAdmin(request)
    const body = await request.json()

    // ── Save credentials ───────────────────────────────────────
    if (body.action === 'save_credentials') {
      const { appId, appSecret } = body
      if (!appId?.trim()) return NextResponse.json({ error: 'App ID is required' }, { status: 400 })

      const testClient = new PcoClient({
        appId: appId.trim(),
        appSecret: appSecret?.trim() || tryDecrypt(settings?.pco_app_secret),
      })
      const validation = await testClient.validate()
      if (!validation.valid) {
        return NextResponse.json({ error: `Invalid credentials: ${validation.error}` }, { status: 400 })
      }

      const updates: Record<string, any> = {
        pco_app_id: encrypt(appId.trim()),
        updated_at: new Date().toISOString(),
      }
      if (appSecret?.trim()) updates.pco_app_secret = encrypt(appSecret.trim())

      const { error } = await admin.from('church_settings').update(updates).eq('id', settings!.id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ success: true, orgName: validation.orgName })
    }

    // ── Save auto-sync settings ────────────────────────────────
    if (body.action === 'save_auto_sync') {
      const { error } = await admin.from('church_settings').update({
        pco_sync_enabled: !!body.enabled,
        pco_sync_frequency: body.frequency || 'daily',
        updated_at: new Date().toISOString(),
      }).eq('id', settings!.id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ success: true })
    }

    // ── Start sync ─────────────────────────────────────────────
    if (body.action === 'sync_start') {
      if (!settings?.pco_app_id || !settings?.pco_app_secret) {
        return NextResponse.json({ error: 'No PCO credentials configured' }, { status: 400 })
      }

      const client = createPcoClient(settings.pco_app_id, settings.pco_app_secret)

      const resourceInfo: Record<string, {
        pcoCount: number
        dbCount: number
        toSync: number
        updatedSince: string | null
        isNested: boolean
        cursor?: NestedCursor
      }> = {}

      for (const res of SYNC_RESOURCES) {
        // Get DB count
        let dbCount = 0
        try {
          const { count } = await admin.from(res.table).select('*', { count: 'exact', head: true })
          dbCount = count || 0
        } catch { /* table might not exist */ }

        if (res.nested) {
          // Nested resource — get parent list and estimated count
          try {
            const { totalCount, cursor } = await getNestedResourceInfo(client, res, admin)
            resourceInfo[res.key] = {
              pcoCount: totalCount,
              dbCount,
              toSync: totalCount, // always sync all for nested (cursor handles incremental)
              updatedSince: null,
              isNested: true,
              cursor,
            }
          } catch {
            // Table/endpoint might not exist — skip gracefully
            resourceInfo[res.key] = {
              pcoCount: 0, dbCount: 0, toSync: 0,
              updatedSince: null, isNested: true,
            }
          }
        } else {
          // Flat resource
          const pcoCount = await getResourceCount(client, res)

          let toSync: number
          let updatedSince: string | null = null

          if (res.supportsUpdatedSince) {
            // Incremental: only fetch records modified since last sync
            updatedSince = await getLastPcoUpdated(admin, res.table)
            toSync = updatedSince
              ? await getResourceCount(client, res, updatedSince)
              : pcoCount
          } else {
            // No updatedSince filter — compare counts
            // Skip if PCO count matches DB count (nothing new)
            toSync = pcoCount === dbCount ? 0 : pcoCount
          }

          resourceInfo[res.key] = {
            pcoCount,
            dbCount,
            toSync,
            updatedSince,
            isNested: false,
          }
        }
      }

      const { data: syncLog } = await admin
        .from('sync_logs')
        .insert({
          status: 'running',
          triggered_by: user.id,
          started_at: new Date().toISOString(),
          records_synced: 0,
          details: { resourceInfo },
        })
        .select().single()

      return NextResponse.json({ syncLogId: syncLog!.id, resourceInfo })
    }

    // ── Sync one page ──────────────────────────────────────────
    if (body.action === 'sync_page') {
      const { resourceKey, offset = 0, syncLogId, updatedSince, cursor } = body
      const resource = SYNC_RESOURCES.find(r => r.key === resourceKey)
      if (!resource) return NextResponse.json({ error: 'Invalid resource' }, { status: 400 })
      if (!settings?.pco_app_id || !settings?.pco_app_secret) {
        return NextResponse.json({ error: 'No credentials' }, { status: 400 })
      }

      const client = createPcoClient(settings.pco_app_id, settings.pco_app_secret)

      // ── Nested resources (cursor-based) ──────────────────────
      if (resource.nested && cursor) {
        const { rows, hasMore, nextCursor, upsertedEstimate } = await fetchNestedPage(
          client, resource, cursor as NestedCursor, 100,
        )

        let upserted = 0
        if (rows.length > 0) {
          const { error: upsertErr } = await admin
            .from(resource.table)
            .upsert(rows, { onConflict: 'pco_id' })

          if (upsertErr) {
            // Table might not exist — non-fatal
            return NextResponse.json({
              error: `${resource.label}: ${upsertErr.message}`,
              upserted: 0,
              hasMore: false,
              nextCursor: null,
            }, { status: 500 })
          }
          upserted = rows.length
        }

        if (syncLogId && upserted > 0) {
          await incrementSyncLog(admin, syncLogId, upserted)
        }

        return NextResponse.json({
          upserted,
          hasMore,
          nextCursor,
        })
      }

      // ── Replace strategy (memberships) ───────────────────────
      if (resource.syncStrategy === 'replace' && offset === 0) {
        // Delete all existing rows before inserting fresh data
        await admin.from(resource.table).delete().neq('id', '00000000-0000-0000-0000-000000000000')
      }

      // ── Flat resources (offset-based) ────────────────────────
      const { rows, hasMore, totalCount } = await fetchResourcePage(
        client, resource, offset, 100, updatedSince,
      )

      let upserted = 0
      if (rows.length > 0) {
        if (resource.syncStrategy === 'replace') {
          const { error: insertErr } = await admin.from(resource.table).insert(rows)
          if (insertErr) {
            return NextResponse.json({
              error: `${resource.label} insert failed: ${insertErr.message}`,
            }, { status: 500 })
          }
        } else {
          const { error: upsertErr } = await admin
            .from(resource.table)
            .upsert(rows, { onConflict: 'pco_id' })
          if (upsertErr) {
            return NextResponse.json({
              error: `${resource.label} upsert failed: ${upsertErr.message}`,
            }, { status: 500 })
          }
        }
        upserted = rows.length
      }

      if (syncLogId && upserted > 0) {
        await incrementSyncLog(admin, syncLogId, upserted)
      }

      return NextResponse.json({
        upserted,
        hasMore,
        nextOffset: hasMore ? offset + 100 : null,
        totalCount,
      })
    }

    // ── Finish sync ────────────────────────────────────────────
    if (body.action === 'sync_finish') {
      const { syncLogId, totalRecords, status: syncStatus, error: syncError } = body
      if (syncLogId) {
        await admin.from('sync_logs').update({
          status: syncStatus || 'success',
          completed_at: new Date().toISOString(),
          records_synced: totalRecords || 0,
          error_message: syncError || null,
        }).eq('id', syncLogId)
      }
      if (syncStatus !== 'failed') {
        await admin.from('church_settings').update({
          pco_last_sync: new Date().toISOString(),
        }).eq('id', settings!.id)
      }
      return NextResponse.json({ success: true })
    }

    // ── Purge all PCO data ─────────────────────────────────────
    if (body.action === 'purge') {
      for (const table of PCO_TABLES) {
        try {
          await admin.from(table).delete().neq('id', '00000000-0000-0000-0000-000000000000')
        } catch { /* table might not exist */ }
      }
      await admin.from('church_settings').update({ pco_last_sync: null }).eq('id', settings!.id)
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (e: any) {
    const status = e.message === 'Unauthorized' ? 401 : e.message === 'Admin only' ? 403 : 500
    return NextResponse.json({ error: e.message }, { status })
  }
}

async function getLastPcoUpdated(admin: any, table: string): Promise<string | null> {
  const { data } = await admin
    .from(table).select('pco_updated_at')
    .order('pco_updated_at', { ascending: false }).limit(1).single()
  return data?.pco_updated_at || null
}

async function incrementSyncLog(admin: any, syncLogId: string, count: number) {
  const { data: log } = await admin.from('sync_logs')
    .select('records_synced').eq('id', syncLogId).single()
  if (log) {
    await admin.from('sync_logs')
      .update({ records_synced: (log.records_synced || 0) + count })
      .eq('id', syncLogId)
  }
}

function tryDecrypt(value: string | null): string {
  if (!value) return ''
  try { return decrypt(value) } catch { return value }
}
