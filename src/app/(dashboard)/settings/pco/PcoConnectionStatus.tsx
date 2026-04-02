'use client'

import { useState, useEffect } from 'react'

export default function PcoConnectionStatus({ hasExistingCreds }: { hasExistingCreds: boolean }) {
  const [status, setStatus] = useState<'checking' | 'connected' | 'disconnected' | 'idle'>('idle')
  const [orgName, setOrgName] = useState<string | null>(null)

  useEffect(() => {
    if (hasExistingCreds) {
      setStatus('checking')
      fetch('/api/pco?action=validate')
        .then(r => r.json())
        .then(data => {
          if (data.valid) {
            setStatus('connected')
            setOrgName(data.orgName || null)
          } else {
            setStatus('disconnected')
          }
        })
        .catch(() => setStatus('disconnected'))
    }
  }, [hasExistingCreds])

  if (status === 'connected') {
    return (
      <div className="rounded-xl border p-4 flex items-center gap-3"
        style={{ background: '#f0fdf4', borderColor: 'var(--green-200)' }}>
        <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
          style={{ background: 'var(--green-200)' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--green-700)" strokeWidth="2.5" strokeLinecap="round">
            <path d="M20 6L9 17l-5-5"/>
          </svg>
        </div>
        <div>
          <div className="text-sm font-medium sans" style={{ color: 'var(--green-800)' }}>
            Connected to Planning Center{orgName ? ` \u2014 ${orgName}` : ''}
          </div>
          <div className="text-xs sans mt-0.5" style={{ color: 'var(--green-600)' }}>
            Credentials are verified and encrypted.
          </div>
        </div>
      </div>
    )
  }

  if (status === 'checking') {
    return (
      <div className="rounded-xl border p-4 flex items-center gap-3"
        style={{ background: 'var(--background-subtle)', borderColor: 'var(--border)' }}>
        <div className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin"
          style={{ borderColor: 'var(--border)', borderTopColor: 'var(--primary)' }} />
        <span className="text-sm sans" style={{ color: 'var(--foreground-muted)' }}>
          Checking PCO connection&hellip;
        </span>
      </div>
    )
  }

  if (status === 'disconnected' && hasExistingCreds) {
    return (
      <div className="rounded-xl border p-4 flex items-center gap-3"
        style={{ background: 'var(--danger-light)', borderColor: '#fecaca' }}>
        <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
          style={{ background: '#fecaca' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </div>
        <div>
          <div className="text-sm font-medium sans" style={{ color: '#991b1b' }}>Connection failed</div>
          <div className="text-xs sans mt-0.5" style={{ color: '#b91c1c' }}>
            Saved credentials could not connect to PCO. Please re-enter them below.
          </div>
        </div>
      </div>
    )
  }

  return null
}
