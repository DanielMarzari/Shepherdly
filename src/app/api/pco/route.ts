import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { encrypt, decrypt } from '@/lib/crypto'
import { PcoClient, createPcoClient } from '@/lib/pco'
import { NextRequest, NextResponse } from 'next/server'

/**
 * Single /api/pco route — handles validate, status, save, and sync.
 *
 * Sync is CLIENT-DRIVEN: the frontend calls sync_page repeatedly,
 * each call fetches one page of data (~100 records) and upserts it.
 * This keeps every request well under Supabase/Vercel timeouts.
 */

/** GET /api/pco?action=validate|status */
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: appUser } = await supabase
    .from('app_users').select('role').eq('id', user.id).single()
  if (appUser?.role !== 'super_admin') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 })
  }

  const action = request.nextUrl.searchParams.get('action') || 'status'
  const admin = createAdminClient()

  const { data: settings } = await admin.from('church_settings').select('*').limit(1).single()
  if (!settings) return NextResponse.json({ error: 'No church settings found' }, { status: 404 })

  if (action === 'validate') {
    if (!settings.pco_app_id || !settings.pco_app_secret) {
      return NextResponse.json({ valid: false, error: 'No credentials saved' })
    }
    const client = createPcoClient(settings.pco_app_id, settings.pco_app_secret)
    const result = await client.validate()
    return NextResponse.json(result)
  }

  if (action === 'status') {
    const { data: lastSync } = await admin
      .from('sync_logs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(1)
      .single()

    const { count: peopleCount } = await admin.from('pco_people').select('*', { count: 'exact', head: true })
    const { count: groupCount } = await admin.from('pco_groups').select('*', { count: 'exact', head: true })
    const { count: teamCount } = await admin.from('pco_teams').select('*', { count: 'exact', head: true })

    return NextResponse.json({
      hasCredentials: !!(settings.pco_app_id && settings.pco_app_secret),
      lastSync: lastSync || null,
      pcoLastSync: settings.pco_last_sync,
      counts: { people: peopleCount || 0, groups: groupCount || 0, teams: teamCount || 0 },
    })
  }

  if (action === 'auto_sync_settings') {
    return NextResponse.json({
      enabled: settings.pco_sync_enabled ?? false,
      frequency: (settings as any).pco_sync_frequency ?? 'daily',
    })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}

/** POST /api/pco — save credentials, start sync, or sync one page */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: appUser } = await supabase
    .from('app_users').select('role').eq('id', user.id).single()
  if (appUser?.role !== 'super_admin') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 })
  }

  const body = await request.json()
  const admin = createAdminClient()
  const { data: settings } = await admin.from('church_settings').select('*').limit(1).single()
  if (!settings) return NextResponse.json({ error: 'No church settings' }, { status: 404 })

  // ── Save credentials ──────────────────────────────────────────
  if (body.action === 'save_credentials') {
    const { appId, appSecret } = body
    if (!appId?.trim()) return NextResponse.json({ error: 'App ID is required' }, { status: 400 })

    const testClient = new PcoClient({
      appId: appId.trim(),
      appSecret: appSecret?.trim() || tryDecrypt(settings.pco_app_secret),
    })
    const validation = await testClient.validate()
    if (!validation.valid) {
      return NextResponse.json({ error: `Invalid credentials: ${validation.error}` }, { status: 400 })
    }

    const updates: Record<string, any> = {
      pco_app_id: encrypt(appId.trim()),
      updated_at: new Date().toISOString(),
    }
    if (appSecret?.trim()) {
      updates.pco_app_secret = encrypt(appSecret.trim())
    }

    const { error } = await admin
      .from('church_settings')
      .update(updates)
      .eq('id', settings.id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true, orgName: validation.orgName })
  }

  // ── Save auto-sync settings ─────────────────────────────────
  if (body.action === 'save_auto_sync') {
    const { enabled, frequency } = body
    const { error } = await admin
      .from('church_settings')
      .update({
        pco_sync_enabled: !!enabled,
        pco_sync_frequency: frequency || 'daily',
        updated_at: new Date().toISOString(),
      })
      .eq('id', settings.id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  }

  // ── Start sync (creates log entry, returns totals for planning) ──
  if (body.action === 'sync_start') {
    if (!settings.pco_app_id || !settings.pco_app_secret) {
      return NextResponse.json({ error: 'No PCO credentials configured' }, { status: 400 })
    }

    const client = createPcoClient(settings.pco_app_id, settings.pco_app_secret)

    // Determine last sync timestamps per resource for incremental sync
    const updatedSince: Record<string, string | null> = {}
    updatedSince.people = await getLastPcoUpdated(admin, 'pco_people')
    updatedSince.groups = await getLastPcoUpdated(admin, 'pco_groups')
    updatedSince.teams = await getLastPcoUpdated(admin, 'pco_teams')

    const isIncremental = !!(updatedSince.people || updatedSince.groups || updatedSince.teams)

    // Get total counts — filtered by updated_at if incremental
    const totals: Record<string, number> = {}
    try {
      const params: Record<string, string> = { per_page: '1', order: 'updated_at' }
      if (updatedSince.people) params['where[updated_at][gte]'] = updatedSince.people
      const peopleRes = await client.get('/people/v2/people', params)
      totals.people = peopleRes.meta?.total_count || 0
    } catch { totals.people = 0 }

    try {
      // Groups API doesn't support where[] filters the same way,
      // so we fetch all and let upsert handle deduplication.
      // For incremental, we still track the count.
      const groupsRes = await client.get('/groups/v2/groups', { per_page: '1' })
      totals.groups = groupsRes.meta?.total_count || 0
    } catch { totals.groups = 0 }

    try {
      const teamsRes = await client.get('/services/v2/teams', { per_page: '1' })
      totals.teams = teamsRes.meta?.total_count || 0
    } catch { totals.teams = 0 }

    // Create sync log
    const { data: syncLog } = await admin
      .from('sync_logs')
      .insert({
        status: 'running',
        triggered_by: user.id,
        started_at: new Date().toISOString(),
        records_synced: 0,
        details: { totals, isIncremental, updatedSince },
      })
      .select()
      .single()

    return NextResponse.json({ syncLogId: syncLog!.id, totals, updatedSince, isIncremental })
  }

  // ── Sync one page of a resource ──────────────────────────────
  if (body.action === 'sync_page') {
    const { resource, offset = 0, syncLogId, updatedSince } = body
    if (!['people', 'groups', 'teams'].includes(resource)) {
      return NextResponse.json({ error: 'Invalid resource' }, { status: 400 })
    }
    if (!settings.pco_app_id || !settings.pco_app_secret) {
      return NextResponse.json({ error: 'No credentials' }, { status: 400 })
    }

    const client = createPcoClient(settings.pco_app_id, settings.pco_app_secret)
    const perPage = 100

    try {
      let upserted = 0
      let hasMore = false
      let nextOffset = offset + perPage
      let totalCount = 0

      if (resource === 'people') {
        const params: Record<string, string> = {
          per_page: String(perPage),
          offset: String(offset),
          order: 'updated_at',
        }
        // Incremental: only fetch records updated since our last sync
        if (updatedSince) {
          params['where[updated_at][gte]'] = updatedSince
        }

        const result = await client.get('/people/v2/people', params)
        totalCount = result.meta?.total_count || 0
        const data = result.data || []

        if (data.length > 0) {
          const rows = data.map((p: any) => ({
            pco_id: p.id,
            first_name: p.attributes.first_name || null,
            last_name: p.attributes.last_name || null,
            full_name: p.attributes.name || `${p.attributes.first_name || ''} ${p.attributes.last_name || ''}`.trim(),
            membership_type: p.attributes.membership || null,
            status: p.attributes.status || null,
            gender: p.attributes.gender || null,
            birthdate: p.attributes.birthdate || null,
            anniversary: p.attributes.anniversary || null,
            avatar_url: p.attributes.avatar || null,
            pco_created_at: p.attributes.created_at,
            pco_updated_at: p.attributes.updated_at,
            last_synced_at: new Date().toISOString(),
          }))
          await admin.from('pco_people').upsert(rows, { onConflict: 'pco_id' })
          upserted = rows.length
        }

        hasMore = !!result.links?.next
      }

      if (resource === 'groups') {
        const result = await client.get('/groups/v2/groups', {
          per_page: String(perPage),
          offset: String(offset),
        })
        totalCount = result.meta?.total_count || 0
        const data = result.data || []

        if (data.length > 0) {
          const rows = data.map((g: any) => ({
            pco_id: g.id,
            name: g.attributes.name || 'Unnamed Group',
            group_type: g.attributes.group_type || null,
            description: g.attributes.description || null,
            member_count: g.attributes.memberships_count || 0,
            pco_updated_at: g.attributes.updated_at || null,
            last_synced_at: new Date().toISOString(),
          }))
          await admin.from('pco_groups').upsert(rows, { onConflict: 'pco_id' })
          upserted = rows.length
        }

        hasMore = !!result.links?.next
      }

      if (resource === 'teams') {
        const result = await client.get('/services/v2/teams', {
          per_page: String(perPage),
          offset: String(offset),
        })
        totalCount = result.meta?.total_count || 0
        const data = result.data || []

        if (data.length > 0) {
          const rows = data.map((t: any) => ({
            pco_id: t.id,
            name: t.attributes.name || 'Unnamed Team',
            description: t.attributes.sequence || null,
            pco_updated_at: t.attributes.updated_at || null,
            last_synced_at: new Date().toISOString(),
          }))
          await admin.from('pco_teams').upsert(rows, { onConflict: 'pco_id' })
          upserted = rows.length
        }

        hasMore = !!result.links?.next
      }

      // Update running total in sync log
      if (syncLogId && upserted > 0) {
        const { data: log } = await admin.from('sync_logs')
          .select('records_synced')
          .eq('id', syncLogId)
          .single()
        if (log) {
          await admin.from('sync_logs')
            .update({ records_synced: (log.records_synced || 0) + upserted })
            .eq('id', syncLogId)
        }
      }

      return NextResponse.json({
        upserted,
        hasMore,
        nextOffset: hasMore ? nextOffset : null,
        totalCount,
      })
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: 500 })
    }
  }

  // ── Finish sync (update log + last sync timestamp) ────────────
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
      }).eq('id', settings.id)
    }

    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}

/** Get the most recent pco_updated_at from a table */
async function getLastPcoUpdated(admin: any, table: string): Promise<string | null> {
  const { data } = await admin
    .from(table)
    .select('pco_updated_at')
    .order('pco_updated_at', { ascending: false })
    .limit(1)
    .single()
  return data?.pco_updated_at || null
}

/** Try to decrypt, fall back to returning as-is */
function tryDecrypt(value: string | null): string {
  if (!value) return ''
  try { return decrypt(value) } catch { return value }
}
