'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

interface SyncStatus {
  hasCredentials: boolean
  lastSync: {
    status: string
    started_at: string
    completed_at: string | null
    records_synced: number
    error_message: string | null
    details: Record<string, any> | null
  } | null
  pcoLastSync: string | null
  counts: { people: number; groups: number; teams: number }
}

interface SyncProgress {
  phase: 'starting' | 'people' | 'groups' | 'teams' | 'finishing' | 'done' | 'error'
  currentResource: string
  recordsSynced: number
  totalExpected: number
  peopleSynced: number
  groupsSynced: number
  teamsSynced: number
  peopleTotalExpected: number
  groupsTotalExpected: number
  teamsTotalExpected: number
  error?: string
}

const RESOURCE_ORDER: Array<'people' | 'groups' | 'teams'> = ['people', 'groups', 'teams']
const RESOURCE_LABELS: Record<string, string> = { people: 'People', groups: 'Groups', teams: 'Teams' }

export default function PcoSyncPanel() {
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [progress, setProgress] = useState<SyncProgress | null>(null)
  const abortRef = useRef(false)

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/pco?action=status')
      const data = await res.json()
      setStatus(data)
    } catch { /* ignore */ }
    setLoading(false)
  }, [])

  useEffect(() => { fetchStatus() }, [fetchStatus])

  const handleSync = async () => {
    setSyncing(true)
    abortRef.current = false
    setProgress({
      phase: 'starting', currentResource: '', recordsSynced: 0, totalExpected: 0,
      peopleSynced: 0, groupsSynced: 0, teamsSynced: 0,
      peopleTotalExpected: 0, groupsTotalExpected: 0, teamsTotalExpected: 0,
    })

    try {
      // Step 1: Start sync — get totals and create log entry
      const startRes = await fetch('/api/pco', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync_start' }),
      })
      const startData = await startRes.json()
      if (!startRes.ok) throw new Error(startData.error || 'Failed to start sync')

      const { syncLogId, totals, updatedSince, isIncremental } = startData
      const totalExpected = (totals.people || 0) + (totals.groups || 0) + (totals.teams || 0)

      setProgress(p => p ? {
        ...p,
        totalExpected,
        peopleTotalExpected: totals.people || 0,
        groupsTotalExpected: totals.groups || 0,
        teamsTotalExpected: totals.teams || 0,
      } : p)

      let totalSynced = 0

      // Step 2: Page through each resource
      for (const resource of RESOURCE_ORDER) {
        if (abortRef.current) break

        setProgress(p => p ? { ...p, phase: resource, currentResource: RESOURCE_LABELS[resource] } : p)

        let offset = 0
        let resourceSynced = 0
        // Pass updatedSince for this resource so the API filters by it
        const resourceUpdatedSince = updatedSince?.[resource] || null

        while (true) {
          if (abortRef.current) break

          const pageRes = await fetch('/api/pco', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'sync_page', resource, offset, syncLogId, updatedSince: resourceUpdatedSince }),
          })
          const pageData = await pageRes.json()

          if (!pageRes.ok) {
            // Non-fatal for groups/teams — PCO might not have that module
            if (resource !== 'people') {
              break
            }
            throw new Error(pageData.error || `Failed syncing ${resource}`)
          }

          resourceSynced += pageData.upserted || 0
          totalSynced += pageData.upserted || 0

          setProgress(p => {
            if (!p) return p
            return {
              ...p,
              recordsSynced: totalSynced,
              [`${resource}Synced`]: resourceSynced,
            } as SyncProgress
          })

          if (!pageData.hasMore || !pageData.nextOffset) break
          offset = pageData.nextOffset
        }
      }

      // Step 3: Finish sync
      setProgress(p => p ? { ...p, phase: 'finishing' } : p)

      await fetch('/api/pco', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'sync_finish',
          syncLogId,
          totalRecords: totalSynced,
          status: abortRef.current ? 'failed' : 'success',
          error: abortRef.current ? 'Cancelled by user' : null,
        }),
      })

      setProgress(p => p ? { ...p, phase: 'done' } : p)
      fetchStatus()

    } catch (e: any) {
      setProgress(p => p ? { ...p, phase: 'error', error: e.message } : p)
    }

    setSyncing(false)
  }

  const handleCancel = () => { abortRef.current = true }

  if (loading) {
    return (
      <div className="rounded-xl border p-6" style={{ background: 'var(--card)', borderColor: 'var(--border)', boxShadow: 'var(--card-shadow)' }}>
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin"
            style={{ borderColor: 'var(--border)', borderTopColor: 'var(--primary)' }} />
          <span className="text-sm sans" style={{ color: 'var(--foreground-muted)' }}>Loading sync status&hellip;</span>
        </div>
      </div>
    )
  }

  if (!status?.hasCredentials) {
    return (
      <div className="rounded-xl border p-6" style={{ background: 'var(--card)', borderColor: 'var(--border)', boxShadow: 'var(--card-shadow)' }}>
        <h2 className="font-serif text-lg mb-2" style={{ color: 'var(--foreground)' }}>Data Sync</h2>
        <p className="text-sm sans" style={{ color: 'var(--foreground-muted)' }}>
          Save your PCO credentials above to enable data syncing.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border p-6" style={{ background: 'var(--card)', borderColor: 'var(--border)', boxShadow: 'var(--card-shadow)' }}>
      <div className="flex items-start justify-between mb-5">
        <div>
          <h2 className="font-serif text-lg" style={{ color: 'var(--foreground)' }}>Data Sync</h2>
          <p className="text-sm sans mt-0.5" style={{ color: 'var(--foreground-muted)' }}>
            Import people, groups, and teams from Planning Center.
          </p>
        </div>
        {!syncing ? (
          <button onClick={handleSync} className="btn-primary text-sm sans flex items-center gap-2">
            <SyncIcon />
            Sync Now
          </button>
        ) : (
          <button onClick={handleCancel}
            className="text-sm sans px-4 py-2 rounded-lg border font-medium"
            style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>
            Cancel
          </button>
        )}
      </div>

      {/* Live progress */}
      {progress && progress.phase !== 'done' && progress.phase !== 'error' && (
        <div className="rounded-lg p-4 mb-5" style={{ background: 'var(--primary-light)' }}>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin"
              style={{ borderColor: 'var(--green-300)', borderTopColor: 'var(--green-700)' }} />
            <span className="text-sm sans font-medium" style={{ color: 'var(--green-800)' }}>
              {progress.phase === 'starting' && 'Preparing sync\u2026'}
              {progress.phase === 'finishing' && 'Finishing up\u2026'}
              {['people', 'groups', 'teams'].includes(progress.phase) &&
                `Syncing ${progress.currentResource}\u2026`}
            </span>
          </div>

          {/* Per-resource progress bars */}
          {RESOURCE_ORDER.map(res => {
            const synced = progress[`${res}Synced` as keyof SyncProgress] as number || 0
            const total = progress[`${res}TotalExpected` as keyof SyncProgress] as number || 0
            const pct = total > 0 ? Math.min(100, (synced / total) * 100) : 0
            const isActive = progress.phase === res

            return (
              <div key={res} className="mb-2 last:mb-0">
                <div className="flex justify-between text-xs sans mb-1" style={{ color: 'var(--green-800)' }}>
                  <span style={{ fontWeight: isActive ? 600 : 400 }}>{RESOURCE_LABELS[res]}</span>
                  <span>{synced.toLocaleString()}{total > 0 ? ` / ${total.toLocaleString()}` : ''}</span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--green-200)' }}>
                  <div className="h-full rounded-full transition-all duration-300"
                    style={{ width: `${pct}%`, background: 'var(--green-600)' }} />
                </div>
              </div>
            )
          })}

          <div className="text-xs sans mt-3 text-right" style={{ color: 'var(--green-700)' }}>
            {progress.recordsSynced.toLocaleString()} records synced
          </div>
        </div>
      )}

      {/* Success message */}
      {progress?.phase === 'done' && (
        <div className="rounded-lg px-4 py-3 text-sm sans mb-5 flex items-center gap-2"
          style={{ background: '#f0fdf4', color: 'var(--green-800)' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>
          Sync complete &mdash; {progress.recordsSynced.toLocaleString()} records
          ({progress.peopleSynced.toLocaleString()} people, {progress.groupsSynced.toLocaleString()} groups, {progress.teamsSynced.toLocaleString()} teams)
        </div>
      )}

      {/* Error message */}
      {progress?.phase === 'error' && (
        <div className="rounded-lg px-4 py-3 text-sm sans mb-5 flex items-center gap-2"
          style={{ background: 'var(--danger-light)', color: '#991b1b' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          Sync failed: {progress.error}
        </div>
      )}

      {/* Record counts */}
      <div className="grid grid-cols-3 gap-4 mb-5">
        <CountCard label="People" count={status.counts.people} />
        <CountCard label="Groups" count={status.counts.groups} />
        <CountCard label="Teams" count={status.counts.teams} />
      </div>

      {/* Last sync info */}
      {status.lastSync ? (
        <div className="rounded-lg p-4" style={{ background: 'var(--background-subtle)' }}>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-2 h-2 rounded-full"
              style={{ background: status.lastSync.status === 'success' ? 'var(--success)' : status.lastSync.status === 'running' ? 'var(--gold-500)' : 'var(--danger)' }} />
            <span className="text-xs sans font-medium" style={{ color: 'var(--foreground)' }}>
              Last sync: {status.lastSync.status === 'success' ? 'Completed' : status.lastSync.status === 'running' ? 'In progress' : 'Failed'}
            </span>
          </div>
          <div className="text-xs sans" style={{ color: 'var(--foreground-muted)' }}>
            {status.lastSync.completed_at
              ? formatRelativeTime(status.lastSync.completed_at)
              : status.lastSync.started_at
                ? `Started ${formatRelativeTime(status.lastSync.started_at)}`
                : ''}
            {status.lastSync.records_synced > 0 && ` \u00b7 ${status.lastSync.records_synced.toLocaleString()} records`}
          </div>
          {status.lastSync.error_message && (
            <div className="text-xs sans mt-1" style={{ color: 'var(--danger)' }}>
              {status.lastSync.error_message}
            </div>
          )}
        </div>
      ) : !progress && (
        <div className="rounded-lg p-4 text-center" style={{ background: 'var(--background-subtle)' }}>
          <p className="text-sm sans" style={{ color: 'var(--foreground-muted)' }}>
            No syncs yet. Hit &ldquo;Sync Now&rdquo; to import your PCO data.
          </p>
        </div>
      )}
    </div>
  )
}

function CountCard({ label, count }: { label: string; count: number }) {
  return (
    <div className="rounded-lg p-3 text-center" style={{ background: 'var(--background-subtle)' }}>
      <div className="text-2xl font-serif" style={{ color: 'var(--primary)' }}>
        {count.toLocaleString()}
      </div>
      <div className="text-xs sans mt-0.5" style={{ color: 'var(--foreground-muted)' }}>{label}</div>
    </div>
  )
}

function SyncIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <polyline points="1 4 1 10 7 10"/>
      <polyline points="23 20 23 14 17 14"/>
      <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/>
    </svg>
  )
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  return `${diffDay}d ago`
}
