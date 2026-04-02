import { createClient } from '@/lib/supabase/server'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: appUser } = await supabase
    .from('app_users')
    .select('*')
    .eq('id', user!.id)
    .single()

  const { count: flockCount } = await supabase
    .from('shepherding_assignments')
    .select('*', { count: 'exact', head: true })
    .eq('shepherd_user_id', user!.id)
    .eq('is_active', true)

  const { count: checkinCount } = await supabase
    .from('checkins')
    .select('*', { count: 'exact', head: true })
    .eq('shepherd_user_id', user!.id)
    .gte('occurred_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())

  const now = new Date()
  const hour = now.getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  return (
    <div className="p-8 max-w-6xl">
      {/* Header */}
      <div className="mb-10">
        <h1 className="text-3xl font-serif" style={{ color: 'var(--foreground)' }}>
          {greeting}, {appUser?.full_name?.split(' ')[0] || 'friend'}
        </h1>
        <p className="mt-1 sans text-sm" style={{ color: 'var(--foreground-muted)' }}>
          Here&apos;s the health of your flock at a glance.
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-10">
        <StatCard
          label="In My Flock"
          value={flockCount ?? 0}
          icon={<FlockIcon />}
          color="var(--primary)"
          bgColor="var(--primary-light)"
        />
        <StatCard
          label="Check-ins (30 days)"
          value={checkinCount ?? 0}
          icon={<CheckIcon />}
          color="var(--success)"
          bgColor="var(--green-100)"
        />
        <StatCard
          label="Need Follow-up"
          value={0}
          icon={<AlertIcon />}
          color="var(--gold-500)"
          bgColor="#fef9ee"
        />
        <StatCard
          label="Unassigned"
          value={0}
          icon={<WarningIcon />}
          color="var(--danger)"
          bgColor="var(--danger-light)"
        />
      </div>

      {/* Content sections */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-xl border p-6" style={{ background: 'var(--card)', borderColor: 'var(--border)', boxShadow: 'var(--card-shadow)' }}>
          <h2 className="font-serif text-lg mb-4" style={{ color: 'var(--foreground)' }}>Recent Check-ins</h2>
          <div className="text-sm sans text-center py-10" style={{ color: 'var(--foreground-muted)' }}>
            No check-ins logged yet.
            <br />
            <a href="/checkins" className="inline-block mt-2 font-medium" style={{ color: 'var(--primary)' }}>
              Log your first check-in &rarr;
            </a>
          </div>
        </div>
        <div className="rounded-xl border p-6" style={{ background: 'var(--card)', borderColor: 'var(--border)', boxShadow: 'var(--card-shadow)' }}>
          <h2 className="font-serif text-lg mb-4" style={{ color: 'var(--foreground)' }}>Needs Attention</h2>
          <div className="text-sm sans text-center py-10" style={{ color: 'var(--foreground-muted)' }}>
            Everyone is accounted for. Looking good!
          </div>
        </div>
      </div>
    </div>
  )
}

function StatCard({ label, value, icon, color, bgColor }: {
  label: string; value: number; icon: React.ReactNode; color: string; bgColor: string
}) {
  return (
    <div className="rounded-xl border p-5"
      style={{ background: 'var(--card)', borderColor: 'var(--border)', boxShadow: 'var(--card-shadow)' }}>
      <div className="flex items-start justify-between mb-4">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: bgColor, color }}>
          {icon}
        </div>
      </div>
      <div className="text-3xl font-serif" style={{ color }}>{value.toLocaleString()}</div>
      <div className="text-xs sans mt-1 font-medium" style={{ color: 'var(--foreground-muted)' }}>{label}</div>
    </div>
  )
}

/* Clean SVG icons instead of emoji */
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
