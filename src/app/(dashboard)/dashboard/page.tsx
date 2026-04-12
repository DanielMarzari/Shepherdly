import { createClient } from '@/lib/supabase/server'
import AttendanceTrend from '@/components/charts/AttendanceTrend'
import CareCoverage from '@/components/charts/CareCoverage'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: appUser } = await supabase
    .from('users')
    .select('*, person_id')
    .eq('user_id', user!.id)
    .single()

  // Find user's people record (prefer person_id link, fallback to name)
  let myPerson: { id: string } | null = null
  if (appUser?.person_id) {
    const { data } = await supabase.from('people').select('id').eq('id', appUser.person_id).single()
    myPerson = data
  }
  if (!myPerson && appUser?.name) {
    const { data } = await supabase
      .from('people')
      .select('id')
      .eq('is_leader', true)
      .eq('status', 'active')
      .ilike('name', appUser.name)
      .limit(1)
      .single()
    myPerson = data
  }

  let flockCount = 0
  let checkinCount = 0

  if (myPerson) {
    // Count flock via shepherding_relationships
    const { count } = await supabase
      .from('shepherding_relationships')
      .select('*', { count: 'exact', head: true })
      .eq('shepherd_id', myPerson.id)
      .eq('is_active', true)
    flockCount = count || 0

    const { count: cCount } = await supabase
      .from('check_in_reports')
      .select('*', { count: 'exact', head: true })
      .eq('leader_id', myPerson.id)
      .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
    checkinCount = cCount || 0
  }

  // Urgent reports needing follow-up
  const { count: urgentCount } = await supabase
    .from('check_in_reports')
    .select('*', { count: 'exact', head: true })
    .eq('church_id', appUser?.church_id!)
    .eq('is_urgent', true)
    .neq('status', 'resolved')

  // Unconnected people — get count + a few for display
  const { count: unconnectedCount } = await supabase
    .from('active_unconnected_people')
    .select('*', { count: 'exact', head: true })

  const { data: unconnected } = await supabase
    .from('active_unconnected_people')
    .select('*')
    .limit(5)

  // Attendance trend
  const { data: trend } = await supabase
    .from('weekly_attendance_trend')
    .select('*')
    .order('week_start', { ascending: true })

  // Care coverage
  const { data: coverage } = await supabase
    .from('care_coverage_summary')
    .select('*')
    .limit(1)
    .single()

  // Recent check-ins
  const { data: recentCheckins } = await supabase
    .from('check_in_reports')
    .select('id, group_name, status, is_urgent, report_date, created_at')
    .eq('church_id', appUser?.church_id!)
    .order('created_at', { ascending: false })
    .limit(5)

  const now = new Date()
  const hour = now.getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  return (
    <div className="p-8 max-w-6xl">
      <div className="mb-10">
        <h1 className="text-3xl font-serif" style={{ color: 'var(--foreground)' }}>
          {greeting}, {appUser?.name?.split(' ')[0] || 'friend'}
        </h1>
        <p className="mt-1 sans text-sm" style={{ color: 'var(--foreground-muted)' }}>
          Here&apos;s the health of your flock at a glance.
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-10">
        <StatCard label="In My Flock" value={flockCount} icon={<FlockIcon />} color="var(--primary)" bgColor="var(--primary-light)" />
        <StatCard label="Check-ins (30 days)" value={checkinCount} icon={<CheckIcon />} color="var(--success)" bgColor="var(--green-100)" />
        <StatCard label="Need Follow-up" value={urgentCount ?? 0} icon={<AlertIcon />} color="var(--gold-500)" bgColor="#fef9ee" />
        <StatCard label="Unassigned" value={unconnectedCount ?? 0} icon={<WarningIcon />} color="var(--danger)" bgColor="var(--danger-light)" />
      </div>

      {/* Charts */}
      {(trend && trend.length > 0) && (
        <div className="rounded-xl border p-6 mb-6" style={{ background: 'var(--card)', borderColor: 'var(--border)', boxShadow: 'var(--card-shadow)' }}>
          <h2 className="font-serif text-lg mb-4" style={{ color: 'var(--foreground)' }}>Attendance Trend</h2>
          <AttendanceTrend data={trend} />
        </div>
      )}

      {coverage && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <div className="rounded-xl border p-6" style={{ background: 'var(--card)', borderColor: 'var(--border)', boxShadow: 'var(--card-shadow)' }}>
            <h2 className="font-serif text-lg mb-2" style={{ color: 'var(--foreground)' }}>Care Coverage</h2>
            <CareCoverage data={coverage} />
            <div className="flex justify-center gap-6 mt-2">
              <div className="flex items-center gap-1.5 text-xs sans" style={{ color: 'var(--foreground-muted)' }}>
                <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#2d6047' }} />
                Connected ({coverage?.has_shepherd || 0})
              </div>
              <div className="flex items-center gap-1.5 text-xs sans" style={{ color: 'var(--foreground-muted)' }}>
                <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#dc4a4a' }} />
                Unconnected ({coverage?.unconnected_active || 0})
              </div>
            </div>
          </div>
          <div className="rounded-xl border p-6" style={{ background: 'var(--card)', borderColor: 'var(--border)', boxShadow: 'var(--card-shadow)' }}>
            <h2 className="font-serif text-lg mb-4" style={{ color: 'var(--foreground)' }}>Quick Stats</h2>
            <div className="grid grid-cols-3 gap-4">
              <QuickStat label="Total Active" value={coverage.total_active_people || 0} />
              <QuickStat label="Attenders" value={coverage.active_attenders || 0} />
              <QuickStat label="With Shepherd" value={coverage.has_shepherd || 0} />
              <QuickStat label="Coverage" value={`${Math.round(coverage.connection_pct || 0)}%`} />
              <QuickStat label="Unassigned" value={coverage.unconnected_active || 0} />
              <QuickStat label="Inactive" value={coverage.total_inactive || 0} />
            </div>
          </div>
        </div>
      )}

      {/* Content sections */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-xl border p-6" style={{ background: 'var(--card)', borderColor: 'var(--border)', boxShadow: 'var(--card-shadow)' }}>
          <h2 className="font-serif text-lg mb-4" style={{ color: 'var(--foreground)' }}>Recent Check-ins</h2>
          {recentCheckins && recentCheckins.length > 0 ? (
            <div className="space-y-2">
              {recentCheckins.map(c => (
                <a key={c.id} href="/checkins" className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 transition-colors">
                  {c.is_urgent && <span className="w-2 h-2 rounded-full shrink-0" style={{ background: '#dc4a4a' }} />}
                  {!c.is_urgent && <span className="w-2 h-2 rounded-full shrink-0" style={{ background: c.status === 'resolved' ? '#4a7c59' : '#c17f3e' }} />}
                  <span className="text-sm sans truncate" style={{ color: 'var(--foreground)' }}>{c.group_name || 'General'}</span>
                  <span className="text-xs sans ml-auto shrink-0" style={{ color: 'var(--foreground-muted)' }}>
                    {new Date(c.report_date || c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                </a>
              ))}
            </div>
          ) : (
            <div className="text-sm sans text-center py-10" style={{ color: 'var(--foreground-muted)' }}>
              No check-ins logged yet.
              <br />
              <a href="/checkins" className="inline-block mt-2 font-medium" style={{ color: 'var(--primary)' }}>
                Log your first check-in &rarr;
              </a>
            </div>
          )}
        </div>
        <div className="rounded-xl border p-6" style={{ background: 'var(--card)', borderColor: 'var(--border)', boxShadow: 'var(--card-shadow)' }}>
          <h2 className="font-serif text-lg mb-4" style={{ color: 'var(--foreground)' }}>Needs Attention</h2>
          {unconnected && unconnected.length > 0 ? (
            <div className="space-y-2">
              {unconnected.map((p: any) => (
                <div key={p.id} className="flex items-center gap-3 p-2 rounded-lg">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: '#dc4a4a' }} />
                  <span className="text-sm sans" style={{ color: 'var(--foreground)' }}>{p.name}</span>
                  <span className="text-xs sans ml-auto" style={{ color: 'var(--foreground-muted)' }}>No shepherd assigned</span>
                </div>
              ))}
              <a href="/unassigned" className="block text-center text-xs font-medium sans mt-2 py-1" style={{ color: 'var(--primary)' }}>
                View all unassigned &rarr;
              </a>
            </div>
          ) : (
            <div className="text-sm sans text-center py-10" style={{ color: 'var(--foreground-muted)' }}>
              Everyone is accounted for. Looking good!
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function StatCard({ label, value, icon, color, bgColor }: {
  label: string; value: number | string; icon: React.ReactNode; color: string; bgColor: string
}) {
  return (
    <div className="rounded-xl border p-5"
      style={{ background: 'var(--card)', borderColor: 'var(--border)', boxShadow: 'var(--card-shadow)' }}>
      <div className="flex items-start justify-between mb-4">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: bgColor, color }}>
          {icon}
        </div>
      </div>
      <div className="text-3xl font-serif" style={{ color }}>{typeof value === 'number' ? value.toLocaleString() : value}</div>
      <div className="text-xs sans mt-1 font-medium" style={{ color: 'var(--foreground-muted)' }}>{label}</div>
    </div>
  )
}

function QuickStat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <div className="text-2xl font-serif" style={{ color: 'var(--foreground)' }}>{typeof value === 'number' ? value.toLocaleString() : value}</div>
      <div className="text-xs sans mt-0.5" style={{ color: 'var(--foreground-muted)' }}>{label}</div>
    </div>
  )
}

function FlockIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="9" cy="7" r="3"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/>
      <circle cx="18" cy="7" r="2"/><path d="M21 21v-2a3 3 0 0 0-2-2.83"/>
    </svg>
  )
}
function CheckIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
    </svg>
  )
}
function AlertIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
    </svg>
  )
}
function WarningIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
      <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
  )
}
