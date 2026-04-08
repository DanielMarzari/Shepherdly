'use client'

import { useState, useEffect, useCallback } from 'react'

interface PersonAnalytics {
  engagement_score: number | null
  attendance_count_90d: number | null
  last_attended_at: string | null
  total_groups: number | null
  total_teams: number | null
  group_attendance_rate: number | null
}

interface PersonRow {
  id: string
  name: string
  pco_url: string | null
  membership_type: string
  status: string
  is_leader: boolean
  analytics: PersonAnalytics[] | null
  groups: { group_id: string; role: string; groups: { id: string; name: string } | null }[]
  teams: { team_id: string; role: string; teams: { id: string; name: string } | null }[]
}

function getAnalytics(person: PersonRow): PersonAnalytics {
  return person.analytics?.[0] || {
    engagement_score: null, attendance_count_90d: null, last_attended_at: null,
    total_groups: null, total_teams: null, group_attendance_rate: null,
  }
}

function engagementColor(score: number | null): string {
  if (score === null) return '#94a3b8'
  if (score >= 80) return '#4a7c59'
  if (score >= 50) return '#c17f3e'
  return '#9b3a3a'
}

function relativeDate(date: string | null): string {
  if (!date) return 'Never'
  const days = Math.floor((Date.now() - new Date(date).getTime()) / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`
  if (days < 365) return `${Math.floor(days / 30)} months ago`
  return `${Math.floor(days / 365)}y ago`
}

export default function PeoplePage() {
  const [people, setPeople] = useState<PersonRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState('name')
  const [showAll, setShowAll] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  const fetchPeople = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ sort })
    if (search) params.set('search', search)
    if (showAll) params.set('all', 'true')
    const res = await fetch(`/api/people?${params}`)
    const data = await res.json()
    setPeople(data.people || [])
    setLoading(false)
  }, [search, sort, showAll])

  useEffect(() => { fetchPeople() }, [fetchPeople])

  return (
    <div className="p-8 max-w-6xl">
      <div className="mb-8">
        <h1 className="text-3xl font-serif" style={{ color: 'var(--foreground)' }}>My Flock</h1>
        <p className="mt-1 sans text-sm" style={{ color: 'var(--foreground-muted)' }}>
          {people.length} {people.length === 1 ? 'person' : 'people'} in your care
        </p>
      </div>

      <div className="flex flex-wrap gap-3 mb-6">
        <input type="text" placeholder="Search by name…" value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 min-w-[200px] px-4 py-2 rounded-lg border text-sm sans outline-none"
          style={{ borderColor: 'var(--border)', background: 'white' }} />
        <select value={sort} onChange={e => setSort(e.target.value)}
          className="px-3 py-2 rounded-lg border text-sm sans outline-none"
          style={{ borderColor: 'var(--border)', background: 'white' }}>
          <option value="name">Sort: Name</option>
          <option value="engagement">Sort: Engagement</option>
          <option value="attendance">Sort: Last Attended</option>
        </select>
        <label className="flex items-center gap-2 text-sm sans" style={{ color: 'var(--foreground-muted)' }}>
          <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} className="w-4 h-4 rounded" />
          Show all people
        </label>
      </div>

      {loading ? (
        <div className="text-center py-16 sans text-sm" style={{ color: 'var(--foreground-muted)' }}>Loading…</div>
      ) : people.length === 0 ? (
        <div className="text-center py-16 sans text-sm" style={{ color: 'var(--foreground-muted)' }}>
          No people found. {!showAll ? 'You may not have anyone assigned to your flock yet.' : 'Sync from PCO to import people.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {people.map(person => {
            const a = getAnalytics(person)
            return (
              <div key={person.id}
                className="rounded-xl border cursor-pointer transition-all hover:shadow-md"
                style={{ background: 'var(--card)', borderColor: expanded === person.id ? 'var(--primary)' : 'var(--border)', boxShadow: 'var(--card-shadow)' }}
                onClick={() => setExpanded(expanded === person.id ? null : person.id)}>
                <div className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium sans shrink-0"
                      style={{ background: engagementColor(a.engagement_score) + '20', color: engagementColor(a.engagement_score) }}>
                      {person.name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium sans text-sm truncate" style={{ color: 'var(--foreground)' }}>{person.name}</span>
                        {person.is_leader && (
                          <span className="text-xs sans px-1.5 py-0.5 rounded" style={{ background: '#2d604720', color: '#2d6047' }}>Leader</span>
                        )}
                      </div>
                      <div className="text-xs sans mt-0.5 truncate" style={{ color: 'var(--foreground-muted)' }}>
                        {person.membership_type}
                        {a.total_groups ? ` · ${a.total_groups} group${a.total_groups !== 1 ? 's' : ''}` : ''}
                        {a.total_teams ? ` · ${a.total_teams} team${a.total_teams !== 1 ? 's' : ''}` : ''}
                      </div>
                    </div>
                    <div className="shrink-0 flex flex-col items-center">
                      <div className="text-xs font-bold sans" style={{ color: engagementColor(a.engagement_score) }}>
                        {a.engagement_score ?? '—'}
                      </div>
                      <div className="text-[10px] sans" style={{ color: 'var(--foreground-muted)' }}>score</div>
                    </div>
                  </div>
                  <div className="mt-3 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
                    <div className="h-full rounded-full transition-all"
                      style={{ width: `${a.engagement_score ?? 0}%`, background: engagementColor(a.engagement_score) }} />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {person.groups?.filter(g => g.groups).map(g => (
                      <span key={g.group_id} className="text-[10px] sans px-2 py-0.5 rounded-full"
                        style={{ background: '#2d604712', color: '#2d6047', border: '1px solid #2d604720' }}>
                        {g.groups!.name}
                      </span>
                    ))}
                    {person.teams?.filter(t => t.teams).map(t => (
                      <span key={t.team_id} className="text-[10px] sans px-2 py-0.5 rounded-full"
                        style={{ background: '#3a5f8a12', color: '#3a5f8a', border: '1px solid #3a5f8a20' }}>
                        {t.teams!.name}
                      </span>
                    ))}
                  </div>
                  <div className="mt-3 flex items-center justify-between text-xs sans" style={{ color: 'var(--foreground-muted)' }}>
                    <span>Last attended: {relativeDate(a.last_attended_at)}</span>
                    <span>{person.membership_type}</span>
                  </div>
                </div>
                {expanded === person.id && (
                  <div className="border-t px-4 py-3 space-y-2" style={{ borderColor: 'var(--border)', background: 'var(--muted)' }}>
                    <div className="grid grid-cols-2 gap-2 text-xs sans">
                      <div><span style={{ color: 'var(--foreground-muted)' }}>Status</span><div style={{ color: 'var(--foreground)' }}>{person.status}</div></div>
                      <div><span style={{ color: 'var(--foreground-muted)' }}>Attendance (90d)</span><div style={{ color: 'var(--foreground)' }}>{a.attendance_count_90d ?? 0}</div></div>
                      <div>
                        <span style={{ color: 'var(--foreground-muted)' }}>Group Attendance Rate</span>
                        <div style={{ color: 'var(--foreground)' }}>
                          {a.group_attendance_rate != null ? `${Math.round(a.group_attendance_rate * 100)}%` : '—'}
                        </div>
                      </div>
                      <div>
                        <span style={{ color: 'var(--foreground-muted)' }}>PCO Profile</span>
                        <div>
                          {person.pco_url ? (
                            <a href={person.pco_url} target="_blank" rel="noopener noreferrer"
                              className="underline" style={{ color: 'var(--primary)' }}
                              onClick={e => e.stopPropagation()}>
                              View in PCO
                            </a>
                          ) : '—'}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
