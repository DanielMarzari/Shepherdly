'use client'

import { useState } from 'react'

export default function PcoSettingsForm({ hasExistingCreds }: { hasExistingCreds: boolean }) {
  const [appId, setAppId] = useState('')
  const [appSecret, setAppSecret] = useState('')
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!appId.trim()) { setResult({ type: 'error', message: 'Application ID is required.' }); return }

    setSaving(true)
    setResult(null)

    try {
      const res = await fetch('/api/pco', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save_credentials',
          appId: appId.trim(),
          appSecret: appSecret.trim() || undefined,
        }),
      })
      const data = await res.json()

      if (data.success) {
        setResult({ type: 'success', message: data.orgName ? `Connected to ${data.orgName}` : 'Credentials verified and saved!' })
        setAppId('')
        setAppSecret('')
      } else {
        setResult({ type: 'error', message: data.error || 'Failed to save credentials.' })
      }
    } catch {
      setResult({ type: 'error', message: 'Network error. Please try again.' })
    }
    setSaving(false)
  }

  return (
    <form onSubmit={handleSave} className="rounded-xl border p-6 space-y-5"
      style={{ background: 'var(--card)', borderColor: 'var(--border)', boxShadow: 'var(--card-shadow)' }}>

      <div className="text-sm font-medium sans" style={{ color: 'var(--foreground)' }}>
        {hasExistingCreds ? 'Update credentials' : 'Enter your PCO credentials'}
      </div>

      <div>
        <label className="block text-sm sans mb-1.5" style={{ color: 'var(--foreground-muted)' }}>
          Application ID
        </label>
        <input
          type="text"
          value={appId}
          onChange={e => { setAppId(e.target.value); setResult(null) }}
          placeholder={hasExistingCreds ? 'Enter new ID to update' : 'Paste your PCO App ID'}
          className="w-full px-4 py-2.5 rounded-lg border text-sm sans outline-none transition-colors"
          style={{ borderColor: 'var(--border)', background: 'var(--background-subtle)', color: 'var(--foreground)' }}
        />
      </div>

      <div>
        <label className="block text-sm sans mb-1.5" style={{ color: 'var(--foreground-muted)' }}>
          Application Secret
        </label>
        <input
          type="password"
          value={appSecret}
          onChange={e => { setAppSecret(e.target.value); setResult(null) }}
          placeholder={hasExistingCreds ? 'Enter new secret to update' : 'Paste your PCO App Secret'}
          className="w-full px-4 py-2.5 rounded-lg border text-sm sans outline-none transition-colors"
          style={{ borderColor: 'var(--border)', background: 'var(--background-subtle)', color: 'var(--foreground)' }}
        />
      </div>

      {result && (
        <div className="rounded-lg px-4 py-3 text-sm sans flex items-center gap-2"
          style={{
            background: result.type === 'success' ? '#f0fdf4' : 'var(--danger-light)',
            color: result.type === 'success' ? 'var(--green-800)' : '#991b1b',
          }}>
          {result.type === 'success' ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          )}
          {result.message}
        </div>
      )}

      <div className="pt-1">
        <button
          type="submit"
          disabled={saving || !appId.trim()}
          className="btn-primary text-sm sans disabled:opacity-40">
          {saving ? 'Validating & saving\u2026' : 'Save Credentials'}
        </button>
      </div>
    </form>
  )
}
