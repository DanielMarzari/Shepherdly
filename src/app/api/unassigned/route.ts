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

  // Get all unassigned active people (no shepherd relationship, excluding system accounts)
  const { data: people } = await admin
    .from('active_unconnected_people')
    .select('*')
    .eq('church_id', churchId)

  // Stats (admin only)
  let stats = null
  if (appUser.role === 'super_admin') {
    const { data: coverage } = await admin
      .from('care_coverage_summary')
      .select('*')
      .limit(1)
      .single()

    // Breakdown by membership type
    const typeCounts: Record<string, number> = {}
    for (const p of people || []) {
      const t = p.membership_type || 'Unknown'
      typeCounts[t] = (typeCounts[t] || 0) + 1
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
