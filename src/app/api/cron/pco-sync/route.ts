import { createAdminClient } from '@/lib/supabase/admin'
import { createPcoClient } from '@/lib/pco'
import {
  SYNC_RESOURCES,
  getResourceCount, fetchResourcePage,
  getNestedResourceInfo, fetchNestedPage,
  resolvePcoIds,
} from '@/lib/pco-sync'
import { NextRequest, NextResponse } from 'next/server'

/**
 * Vercel Cron endpoint for automated PCO sync.
 * Runs daily at 6am UTC (configured in vercel.json).
 */
export async function GET(request: NextRequest) {
  // Verify cron secret (Vercel sets this header)
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()

  // Check if auto-sync is enabled
  const { data: settings } = await admin
    .from('app_settings')
    .select('key, value')
    .in('key', ['pco_sync_enabled'])

  const enabled = settings?.find(s => s.key === 'pco_sync_enabled')?.value === 'true'
  if (!enabled) {
    return NextResponse.json({ skipped: true, reason: 'Auto-sync disabled' })
  }

  // Get active credentials
  const { data: credentials } = await admin
    .from('planning_center_credentials')
    .select('*')
    .eq('is_active', true)
    .limit(1)
    .single()

  if (!credentials?.app_id || !credentials?.app_secret) {
    return NextResponse.json({ skipped: true, reason: 'No PCO credentials' })
  }

  const client = createPcoClient(credentials.app_id, credentials.app_secret)
  const churchId = credentials.church_id

  // Create sync log
  const { data: syncLog } = await admin
    .from('pco_sync_log')
    .insert({
      sync_type: 'auto',
      status: 'running',
      started_at: new Date().toISOString(),
      records_synced: 0,
      credential_id: credentials.id,
      church_id: churchId,
    })
    .select()
    .single()

  let totalSynced = 0

  try {
    for (const resource of SYNC_RESOURCES) {
      if (resource.isNested) {
        // ── Nested resources: iterate parents ──────────────────
        const { cursor } = await getNestedResourceInfo(client, resource, admin, churchId!)
        if (cursor.parents.length === 0) continue

        // For replace strategy, delete existing
        if (resource.syncStrategy === 'replace') {
          await admin.from(resource.table).delete().eq('church_id', churchId!)
        }

        let currentCursor = cursor
        while (true) {
          const { rows, hasMore, nextCursor } = await fetchNestedPage(
            client, resource, currentCursor, 100
          )

          if (rows.length > 0) {
            let resolvedRows = rows
            if (resource.idMappings && resource.idMappings.length > 0) {
              resolvedRows = await resolvePcoIds(admin, rows, resource.idMappings, churchId!)
            }

            const rowsWithChurch = resolvedRows.map(r => ({ ...r, church_id: churchId }))
            if (rowsWithChurch.length > 0) {
              if (resource.syncStrategy === 'replace') {
                await admin.from(resource.table).insert(rowsWithChurch)
              } else {
                await admin.from(resource.table).upsert(rowsWithChurch, { onConflict: resource.onConflict })
              }
              totalSynced += rowsWithChurch.length
            }
          }

          if (!hasMore || !nextCursor) break
          currentCursor = nextCursor
        }
      } else {
        // ── Flat resources ─────────────────────────────────────
        const pcoCount = await getResourceCount(client, resource)
        if (pcoCount === 0) continue

        if (resource.syncStrategy === 'replace') {
          await admin.from(resource.table).delete().eq('church_id', churchId!)
        }

        let offset = 0
        let hasMore = true
        while (hasMore) {
          const { rows, hasMore: more } = await fetchResourcePage(client, resource, offset, 100)

          if (rows.length > 0) {
            let resolvedRows = rows
            if (resource.idMappings && resource.idMappings.length > 0) {
              resolvedRows = await resolvePcoIds(admin, rows, resource.idMappings, churchId!)
            }

            const rowsWithChurch = resolvedRows.map(r => ({ ...r, church_id: churchId }))
            if (rowsWithChurch.length > 0) {
              if (resource.syncStrategy === 'replace') {
                await admin.from(resource.table).insert(rowsWithChurch)
              } else {
                await admin.from(resource.table).upsert(rowsWithChurch, { onConflict: resource.onConflict })
              }
              totalSynced += rowsWithChurch.length
            }
          }

          hasMore = more
          offset += 100
        }
      }
    }

    // Post-sync: link FK columns
    try {
      const { data: groupTypes } = await admin
        .from('group_types').select('id, pco_id').eq('church_id', churchId!)
      for (const gt of groupTypes || []) {
        await admin.from('groups').update({ group_type_id: gt.id })
          .eq('church_id', churchId!).eq('pco_group_type_id', gt.pco_id)
      }
      const { data: serviceTypes } = await admin
        .from('service_types').select('id, pco_id').eq('church_id', churchId!)
      for (const st of serviceTypes || []) {
        await admin.from('teams').update({ service_type_id: st.id })
          .eq('church_id', churchId!).eq('pco_service_type_id', st.pco_id)
      }
    } catch (e) {
      console.error('Cron: FK linking failed:', e)
    }

    // Post-sync: refresh analytics
    try {
      await admin.rpc('refresh_person_analytics')
    } catch (e) {
      console.error('Cron: analytics refresh failed:', e)
    }

    // Mark success
    await admin.from('pco_sync_log').update({
      status: 'success',
      completed_at: new Date().toISOString(),
      records_synced: totalSynced,
    }).eq('id', syncLog!.id)

    await admin.from('planning_center_credentials').update({
      last_synced_at: new Date().toISOString(),
    }).eq('id', credentials.id)

    return NextResponse.json({ success: true, records: totalSynced })
  } catch (e: any) {
    await admin.from('pco_sync_log').update({
      status: 'failed',
      completed_at: new Date().toISOString(),
      records_synced: totalSynced,
      error_message: e.message,
    }).eq('id', syncLog!.id)

    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
