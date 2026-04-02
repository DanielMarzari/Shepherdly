import { createClient } from '@/lib/supabase/server'
import PcoConnectionStatus from './PcoConnectionStatus'
import PcoSettingsForm from './PcoSettingsForm'
import PcoAutoSyncSettings from './PcoAutoSyncSettings'
import PcoSyncPanel from './PcoSyncPanel'

export default async function PcoSettingsPage() {
  const supabase = await createClient()
  const { data: settings } = await supabase
    .from('church_settings')
    .select('*')
    .limit(1)
    .single()

  const hasCreds = !!(settings?.pco_app_id && settings?.pco_app_secret)

  return (
    <div className="p-8">
      <h1 className="text-3xl font-serif mb-1" style={{ color: 'var(--foreground)' }}>PCO Connection</h1>
      <p className="sans text-sm mb-6" style={{ color: 'var(--foreground-muted)' }}>
        Connect Shepherdly to Planning Center Online to sync your people, groups, and attendance.
      </p>

      {/* Connection status — full width, above everything */}
      <div className="mb-6">
        <PcoConnectionStatus hasExistingCreds={hasCreds} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* Left column — Credentials */}
        <div>
          {/* Setup guide */}
          <div className="rounded-xl border p-5 mb-5"
            style={{ background: 'var(--primary-light)', borderColor: 'var(--green-200)' }}>
            <h2 className="font-serif text-base mb-3" style={{ color: 'var(--green-800)' }}>
              How to get your PCO credentials
            </h2>
            <ol className="sans text-sm space-y-2" style={{ color: 'var(--green-900)', listStyleType: 'none', padding: 0 }}>
              <li className="flex gap-3">
                <span className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
                  style={{ background: 'var(--green-200)', color: 'var(--green-800)' }}>1</span>
                <span>
                  Go to the{' '}
                  <a href="https://api.planningcenteronline.com/personal_access_tokens"
                    target="_blank" rel="noopener noreferrer"
                    className="font-medium underline underline-offset-2"
                    style={{ color: 'var(--green-700)' }}>
                    PCO Personal Access Tokens
                  </a>{' '}
                  page and sign in with your PCO admin account.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
                  style={{ background: 'var(--green-200)', color: 'var(--green-800)' }}>2</span>
                <span>Click <strong>&ldquo;Create a Personal Access Token.&rdquo;</strong> Give it a name like &ldquo;Shepherdly.&rdquo;</span>
              </li>
              <li className="flex gap-3">
                <span className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
                  style={{ background: 'var(--green-200)', color: 'var(--green-800)' }}>3</span>
                <span>Copy the <strong>Application ID</strong> and <strong>Secret</strong> that PCO generates.</span>
              </li>
              <li className="flex gap-3">
                <span className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
                  style={{ background: 'var(--green-200)', color: 'var(--green-800)' }}>4</span>
                <span>Paste them into the fields below and hit <strong>Save Credentials.</strong></span>
              </li>
            </ol>
            <p className="sans text-xs mt-3" style={{ color: 'var(--green-700)', opacity: 0.7 }}>
              The secret is only shown once by PCO, so save it somewhere safe.
            </p>
          </div>

          <PcoSettingsForm hasExistingCreds={hasCreds} />
        </div>

        {/* Right column — Auto-sync settings + Manual sync */}
        <div className="space-y-5">
          <PcoAutoSyncSettings />
          <PcoSyncPanel />
        </div>
      </div>
    </div>
  )
}
