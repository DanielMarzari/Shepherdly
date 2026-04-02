'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function PcoSettingsForm({ settings }: { settings: any }) {
  const [appId, setAppId] = useState(settings?.pco_app_id || '')
  const [appSecret, setAppSecret] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    const supabase = createClient()

    const updates: any = { pco_app_id: appId, updated_at: new Date().toISOString() }
    if (appSecret) updates.pco_app_secret = appSecret

    const { error } = await supabase
      .from('church_settings')
      .update(updates)
      .eq('id', settings?.id)

    if (error) setError(error.message)
    else setSaved(true)
    setSaving(false)
    setTimeout(() => setSaved(false), 3000)
  }

  return (
    <form onSubmit={handleSave} className="rounded-xl border p-6 space-y-5"
      style={{ background: 'var(--card)', borderColor: 'var(--border)', boxShadow: 'var(--card-shadow)' }}>

      <div>
        <label className="block text-sm font-medium sans mb-1.5" style={{ color: 'var(--foreground)' }}>
          PCO Application ID
        </label>
        <input
          type="text"
          value={appId}
          onChange={e => setAppId(e.target.value)}
          placeholder="Your PCO App ID"
          className="w-full px-4 py-2.5 rounded-lg border text-sm sans outline-none transition-colors"
          style={{ borderColor: 'var(--border)', background: 'var(--background-subtle)', color: 'var(--foreground)' }}
        />
      </div>

      <div>
        <label className="block text-sm font-medium sans mb-1.5" style={{ color: 'var(--foreground)' }}>
          PCO Application Secret
        </label>
        <input
          type="password"
          value={appSecret}
          onChange={e => setAppSecret(e.target.value)}
          placeholder={settings?.pco_app_secret ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' : 'Enter your PCO App Secret'}
          className="w-full px-4 py-2.5 rounded-lg border text-sm sans outline-none transition-colors"
          style={{ borderColor: 'var(--border)', background: 'var(--background-subtle)', color: 'var(--foreground)' }}
        />
        {settings?.pco_app_secret && (
          <p className="text-xs sans mt-1.5" style={{ color: 'var(--foreground-muted)' }}>
            A secret is already saved. Leave blank to keep it unchanged.
          </p>
        )}
      </div>

      <div className="pt-1 flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="btn-primary text-sm sans disabled:opacity-50">
          {saving ? 'Saving\u2026' : 'Save Credentials'}
        </button>
        {saved && <span className="text-sm sans font-medium" style={{ color: 'var(--success)' }}>Saved!</span>}
        {error && <span className="text-sm sans" style={{ color: 'var(--danger)' }}>{error}</span>}
      </div>

      {settings?.pco_last_sync && (
        <div className="pt-3 border-t text-xs sans" style={{ borderColor: 'var(--border)', color: 'var(--foreground-muted)' }}>
          Last synced: {new Date(settings.pco_last_sync).toLocaleString()}
        </div>
      )}
    </form>
  )
}
