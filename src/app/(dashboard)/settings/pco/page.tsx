import { createClient } from '@/lib/supabase/server'
import PcoSettingsForm from './PcoSettingsForm'

export default async function PcoSettingsPage() {
  const supabase = await createClient()
  const { data: settings } = await supabase
    .from('church_settings')
    .select('*')
    .single()

  return (
    <div className="p-8 max-w-2xl">
      <h1 className="text-3xl font-serif mb-1" style={{ color: 'var(--foreground)' }}>PCO Connection</h1>
      <p className="sans text-sm mb-8" style={{ color: 'var(--foreground-muted)' }}>
        Connect Shepherdly to Planning Center Online to sync your people, groups, and attendance.
      </p>

      {/* Setup guide */}
      <div className="rounded-xl border p-6 mb-6"
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

      <PcoSettingsForm settings={settings} />
    </div>
  )
}
