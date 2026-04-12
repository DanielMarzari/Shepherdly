'use client'

import { useState, useEffect } from 'react'

interface UnassignedPerson {
  id: string
  name: string
  pco_id: string | null
  membership_type: string | null
}

interface Stats {
  totalActive: number
  unassigned: number
  assigned: number
  connectionPct: number
  byMembershipType: Record<string, number>
}

export default function UnassignedPage() {
  const [people, setPeople] = useState<UnassignedPerson[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    fetch('/api/unassigned')
      .then(r => r.json())
      .then(data => {
        setPeople(data.people || [])
        setStats(data.stats || null)
        setLoading(false)
      })
  }, [])

  const filtered = search
    ? people.filter(p => p.name.toLowerCase().includes(search.toLowerCase()))
    : people

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[50vh]">
        <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
          style={{ borderColor: 'var(--border)', borderTopColor: 'var(--primary)' }} />
      </div>
    )
  }

  return (
    <div className="p-8 max-w-5xl">
      <h1 className="text-3xl font-serif mb-1" style={{ color: 'var(--foreground)' }}>Unassigned People</h1>
      <p className="sans text-sm mb-6" style={{ color: 'var(--foreground-muted)' }}>
        Active people who don&apos;t have a shepherd assigned through any group, team, or manual relationship.
      </p>

      {/* Stats cards — admin only */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <StatCard label="Total Active" value={stats.totalActive} />
          <StatCard label="Unassigned" value={stats.unassigned} color="var(--danger)" />
          <StatCard label="Assigned" value={stats.assigned} color="#4a7c59" />
          <StatCard label="Connected" value={`${stats.connectionPct}%`} color="var(--primary)" />
        </div>
      )}

      {/* Membership type breakdown — admin only */}
      {stats && Object.keys(stats.byMembershipType).length > 0 && (
        <div className="rounded-xl border p-5 mb-6" style={{ background: 'var(--card)', borderColor: 'var(--border)', boxShadow: 'var(--card-shadow)' }}>
          <h2 className="font-serif text-base mb-3" style={{ color: 'var(--foreground)' }}>Unassigned by Type</h2>
          <div className="flex flex-wrap gap-3">
            {Object.entries(stats.byMembershipType)
              .sort(([, a], [, b]) => b - a)
              .map(([type, count]) => (
                <span key={type} className="inline-flex items-center gap-2 text-sm sans px-3 py-1.5 rounded-lg"
                  style={{ background: 'var(--muted)', color: 'var(--foreground)' }}>
                  <span className="font-medium">{count}</span>
                  <span style={{ color: 'var(--foreground-muted)' }}>{type}</span>
                </span>
              ))}
          </div>
        </div>
      )}

      {/* Search */}
      <div className="mb-4">
        <input
          type="text"
          placeholder="Search by name..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full max-w-sm px-4 py-2 rounded-lg border text-sm sans"
          style={{ background: 'var(--card)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
        />
      </div>

      {/* People list */}
      <div className="rounded-xl border overflow-hidden" style={{ background: 'var(--card)', borderColor: 'var(--border)', boxShadow: 'var(--card-shadow)' }}>
        {filtered.length === 0 ? (
          <div className="p-8 text-center sans text-sm" style={{ color: 'var(--foreground-muted)' }}>
            {search ? 'No matches found.' : 'Everyone has a shepherd assigned!'}
          </div>
        ) : (
          <>
            <div className="px-5 py-3 border-b flex items-center gap-4 text-xs sans font-medium"
              style={{ borderColor: 'var(--border)', color: 'var(--foreground-muted)', background: 'var(--muted)' }}>
              <span className="flex-1">Name</span>
              <span className="w-32">Type</span>
              <span className="w-24 text-right">PCO</span>
            </div>
            <div className="max-h-[60vh] overflow-y-auto">
              {filtered.map(p => (
                <div key={p.id} className="px-5 py-3 border-b flex items-center gap-4 hover:bg-gray-50/50 transition-colors"
                  style={{ borderColor: 'var(--border)' }}>
                  <div className="flex-1 flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium sans shrink-0"
                      style={{ background: 'var(--danger-light)', color: 'var(--danger)' }}>
                      {p.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                    </div>
                    <span className="text-sm sans font-medium" style={{ color: 'var(--foreground)' }}>{p.name}</span>
                  </div>
                  <span className="w-32 text-xs sans" style={{ color: 'var(--foreground-muted)' }}>
                    {p.membership_type || 'Unknown'}
                  </span>
                  <span className="w-24 text-right">
                    {p.pco_id && (
                      <a href={`https://people.planningcenteronline.com/people/${p.pco_id}`}
                        target="_blank" rel="noopener noreferrer"
                        className="text-xs sans font-medium" style={{ color: 'var(--primary)' }}>
                        View in PCO
                      </a>
                    )}
                  </span>
                </div>
              ))}
            </div>
            <div className="px-5 py-2 text-xs sans text-right" style={{ color: 'var(--foreground-muted)', background: 'var(--muted)' }}>
              {filtered.length === people.length
                ? `${people.length} unassigned`
                : `${filtered.length} of ${people.length} shown`}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="rounded-xl border p-4" style={{ background: 'var(--card)', borderColor: 'var(--border)', boxShadow: 'var(--card-shadow)' }}>
      <div className="text-2xl font-serif" style={{ color: color || 'var(--foreground)' }}>{value}</div>
      <div className="text-xs sans mt-1" style={{ color: 'var(--foreground-muted)' }}>{label}</div>
    </div>
  )
}
