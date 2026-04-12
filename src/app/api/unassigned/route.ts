import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: appUser } = await supabase
    .from('users')
    .select('id, role, church_id')
    .eq('user_id', user.id)
    .single()

  if (!appUser || !['super_admin', 'staff'].includes(appUser.role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const churchId = appUser.church_id!

  // Get paginated unassigned people for display (not all 15k+)
  const { data: people } = await admin
    .from('active_unconnected_people')
    .select('*')
    .eq('church_id', churchId)
    .limit(200)

  // Stats (admin only) — use DB aggregation, not client-side counting
  let stats = null
  if (appUser.role === 'super_admin') {
    const [{ data: coverage }, { data: typeBreakdown }] = await Promise.all([
      admin.from('care_coverage_summary').select('*').limit(1).single(),
      // Get type counts directly from DB to avoid Supabase row limits
      admin.rpc('get_unconnected_type_counts', { p_church_id: churchId }),
    ])

    // Fallback: if RPC doesn't exist, compute from what we have
    let typeCounts: Record<string, number> = {}
    if (typeBreakdown && Array.isArray(typeBreakdown)) {
      for (const row of typeBreakdown) {
        typeCounts[row.membership_type || 'Unknown'] = row.cnt
      }
    } else {
      // Fallback — count from limited data (won't be complete but won't crash)
      for (const p of people || []) {
        const t = p.membership_type || 'Unknown'
        typeCounts[t] = (typeCounts[t] || 0) + 1
      }
    }

    stats = {
      totalActive: coverage?.total_active_people || 0,
      unassigned: coverage?.unconnected_active || 0,
      assigned: coverage?.has_shepherd || 0,
      connectionPct: coverage?.connection_pct || 0,
      byMembershipType: typeCounts,
    }
  }

  return NextResponse.json({
    people: people || [],
    stats,
    userRole: appUser.role,
  })
}
