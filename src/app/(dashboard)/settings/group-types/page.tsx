'use client'

import { useState, useEffect } from 'react'

interface GroupType {
  id: string
  pco_id: string
  name: string
  is_tracked: boolean
  created_at: string
}

export default function GroupTypesSettingsPage() {
  const [groupTypes, setGroupTypes] = useState<GroupType[]>([])
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/group-types')
      .then(r => r.json())
      .then(data => { setGroupTypes(data.groupTypes || []); setLoading(false) })
  }, [])

  const toggleTracked = async (id: string, is_tracked: boolean) => {
    setUpdating(id)
    const res = await fetch('/api/group-types', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, is_tracked }),
    })
    if (res.ok) {
      setGroupTypes(prev => prev.map(gt => gt.id === id ? { ...gt, is_tracked } : gt))
    }
    setUpdating(null)
  }

  return (
    <div className="p-8 max-w-3xl">
      <h1 className="text-3xl font-serif mb-1" style={{ color: 'var(--foreground)' }}>Group Types</h1>
      <p className="sans text-sm mb-6" style={{ color: 'var(--foreground-muted)' }}>
        Choose which PCO group types are included in shepherding analytics and engagement scores.
        Untracked group types are still synced but won&apos;t affect metrics.
      </p>

      {loading ? (
        <div className="text-center py-16 sans text-sm" style={{ color: 'var(--foreground-muted)' }}>Loading...</div>
      ) : groupTypes.length === 0 ? (
        <div className="rounded-xl border p-8 text-center" style={{ background: 'var(--card)', borderColor: 'var(--border)' }}>
          <p className="sans text-sm" style={{ color: 'var(--foreground-muted)' }}>
            No group types found. Run a PCO sync to import group types.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border overflow-hidden" style={{ background: 'var(--card)', borderColor: 'var(--border)', boxShadow: 'var(--card-shadow)' }}>
          {groupTypes.map((gt, i) => (
            <div key={gt.id}
              className="flex items-center justify-between px-5 py-4"
              style={{ borderTop: i > 0 ? '1px solid var(--border)' : undefined }}>
              <div>
                <div className="sans text-sm font-medium" style={{ color: 'var(--foreground)' }}>{gt.name}</div>
                <div className="sans text-xs mt-0.5" style={{ color: 'var(--foreground-muted)' }}>PCO ID: {gt.pco_id}</div>
              </div>
              <button
                onClick={() => toggleTracked(gt.id, !gt.is_tracked)}
                disabled={updating === gt.id}
                className="relative w-11 h-6 rounded-full transition-colors"
                style={{ background: gt.is_tracked ? 'var(--primary)' : 'var(--border)' }}>
                <span className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform shadow-sm"
                  style={{ transform: gt.is_tracked ? 'translateX(20px)' : 'translateX(0)' }} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
