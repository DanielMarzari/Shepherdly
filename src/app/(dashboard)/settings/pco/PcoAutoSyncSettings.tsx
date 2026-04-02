'use client'

import { useState, useEffect } from 'react'

interface AutoSyncSettings {
  enabled: boolean
  frequency: 'daily' | 'weekly' | 'monthly'
}

const FREQ_LABELS: Record<string, string> = {
  daily: 'Once a day (midnight)',
  weekly: 'Once a week (Sunday midnight)',
  monthly: 'Once a month (1st at midnight)',
}

export default function PcoAutoSyncSettings() {
  const [settings, setSettings] = useState<AutoSyncSettings>({ enabled: false, frequency: 'daily' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch('/api/pco?action=auto_sync_settings')
      .then(r => r.json())
      .then(data => {
        if (data.enabled !== undefined) {
          setSettings({ enabled: data.enabled, frequency: data.frequency || 'daily' })
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const handleSave = async (newSettings: AutoSyncSettings) => {
    setSettings(newSettings)
    setSaving(true)
    setSaved(false)
    try {
      await fetch('/api/pco', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save_auto_sync',
          enabled: newSettings.enabled,
          frequency: newSettings.frequency,
        }),
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch { /* ignore */ }
    setSaving(false)
  }

  if (loading) return null

  return (
    <div className="rounded-xl border p-5" style={{ background: 'var(--card)', borderColor: 'var(--border)', boxShadow: 'var(--card-shadow)' }}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-serif text-base" style={{ color: 'var(--foreground)' }}>Auto Sync</h3>
          <p className="text-xs sans mt-0.5" style={{ color: 'var(--foreground-muted)' }}>
            Automatically keep PCO data up to date.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {saved && (
            <span className="text-xs sans font-medium" style={{ color: 'var(--success)' }}>Saved</span>
          )}
          <button
            onClick={() => handleSave({ ...settings, enabled: !settings.enabled })}
            disabled={saving}
            className="relative w-11 h-6 rounded-full transition-colors duration-200"
            style={{ background: settings.enabled ? 'var(--primary)' : 'var(--neutral-300)' }}
            aria-label={settings.enabled ? 'Disable auto sync' : 'Enable auto sync'}>
            <span className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200"
              style={{ transform: settings.enabled ? 'translateX(20px)' : 'translateX(0)' }} />
          </button>
        </div>
      </div>

      {settings.enabled && (
        <div className="space-y-2">
          {(['daily', 'weekly', 'monthly'] as const).map(freq => (
            <label key={freq}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors"
              style={{
                background: settings.frequency === freq ? 'var(--primary-light)' : 'transparent',
                border: `1px solid ${settings.frequency === freq ? 'var(--green-200)' : 'transparent'}`,
              }}>
              <input
                type="radio"
                name="sync-frequency"
                checked={settings.frequency === freq}
                onChange={() => handleSave({ ...settings, frequency: freq })}
                className="sr-only"
              />
              <div className="w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0"
                style={{ borderColor: settings.frequency === freq ? 'var(--primary)' : 'var(--neutral-400)' }}>
                {settings.frequency === freq && (
                  <div className="w-2 h-2 rounded-full" style={{ background: 'var(--primary)' }} />
                )}
              </div>
              <span className="text-sm sans" style={{ color: settings.frequency === freq ? 'var(--green-800)' : 'var(--foreground-muted)' }}>
                {FREQ_LABELS[freq]}
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
