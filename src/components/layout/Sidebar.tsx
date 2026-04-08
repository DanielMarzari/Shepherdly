'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import type { User } from '@/types'

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Administrator',
  staff: 'Staff',
  coach: 'Coach',
  leader: 'Leader',
}

const ROLE_COLORS: Record<string, string> = {
  super_admin: 'var(--role-super-admin)',
  staff: 'var(--role-staff)',
  coach: 'var(--role-coach)',
  leader: 'var(--role-leader)',
}

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: GridIcon },
  { href: '/tree', label: 'Shepherd Tree', icon: TreeIcon },
  { href: '/people', label: 'My Flock', icon: PeopleIcon },
  { href: '/checkins', label: 'Check-ins', icon: CheckIcon },
  { href: '/surveys', label: 'Surveys', icon: SurveyIcon },
  { href: '/mir', label: 'Impact Reports', icon: MirIcon },
]

const SETTINGS_ITEMS = [
  { href: '/settings/users', label: 'Manage Users', icon: UsersIcon, roles: ['super_admin'] },
  { href: '/settings/pco', label: 'PCO Connection', icon: SyncIcon, roles: ['super_admin'] },
  { href: '/settings/group-types', label: 'Group Types', icon: GroupTypeIcon, roles: ['super_admin', 'staff'] },
]

export default function Sidebar({ user }: { user: User }) {
  const pathname = usePathname()
  const router = useRouter()

  const handleSignOut = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  const visibleSettings = SETTINGS_ITEMS.filter(item =>
    item.roles.includes(user.role)
  )

  return (
    <aside className="w-64 flex flex-col border-r shrink-0"
      style={{ background: 'var(--sidebar-bg)', borderColor: 'rgba(255,255,255,0.1)' }}>

      {/* Logo */}
      <div className="px-6 py-5 border-b" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full flex items-center justify-center"
            style={{ background: 'var(--accent)' }}>
            <ShepherdIcon />
          </div>
          <div>
            <div className="text-white font-serif text-lg leading-none">Shepherdly</div>
            <div className="text-xs mt-0.5 sans" style={{ color: 'rgba(255,255,255,0.5)' }}>Faith Church</div>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.map(item => {
          const active = pathname === item.href || pathname.startsWith(item.href + '/')
          const Icon = item.icon
          return (
            <Link key={item.href} href={item.href}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm sans transition-all"
              style={{
                color: active ? 'white' : 'rgba(255,255,255,0.65)',
                background: active ? 'rgba(255,255,255,0.15)' : 'transparent',
              }}>
              <Icon size={18} />
              {item.label}
            </Link>
          )
        })}

        {visibleSettings.length > 0 && (
          <>
            <div className="pt-4 pb-1 px-3">
              <span className="text-xs font-medium sans uppercase tracking-wider"
                style={{ color: 'rgba(255,255,255,0.35)' }}>Settings</span>
            </div>
            {visibleSettings.map(item => {
              const active = pathname.startsWith(item.href)
              const Icon = item.icon
              return (
                <Link key={item.href} href={item.href}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm sans transition-all"
                  style={{
                    color: active ? 'white' : 'rgba(255,255,255,0.65)',
                    background: active ? 'rgba(255,255,255,0.15)' : 'transparent',
                  }}>
                  <Icon size={18} />
                  {item.label}
                </Link>
              )
            })}
          </>
        )}
      </nav>

      {/* User profile */}
      <div className="px-4 py-4 border-t" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-medium sans shrink-0"
            style={{ background: ROLE_COLORS[user.role] || 'var(--accent)', color: 'white' }}>
            {(user.name || user.email).charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-white text-sm font-medium sans truncate">
              {user.name || 'Set your name'}
            </div>
            <div className="text-xs sans" style={{ color: 'rgba(255,255,255,0.5)' }}>
              {ROLE_LABELS[user.role]}
            </div>
          </div>
          <button
            onClick={handleSignOut}
            className="shrink-0 p-1.5 rounded-lg transition-all"
            style={{ color: 'rgba(255,255,255,0.4)' }}
            title="Sign out">
            <SignOutIcon size={16} />
          </button>
        </div>
      </div>
    </aside>
  )
}

// Icons
function ShepherdIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 32 32" fill="none">
      <path d="M20 4C20 4 24 6 24 10C24 14 20 14 20 18V28" stroke="white" strokeWidth="2.5" strokeLinecap="round"/>
      <circle cx="12" cy="12" r="4" stroke="white" strokeWidth="2"/>
      <path d="M12 16V28" stroke="white" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  )
}
function GridIcon({ size }: { size: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
}
function TreeIcon({ size }: { size: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="4" r="2"/><circle cx="5" cy="18" r="2"/><circle cx="19" cy="18" r="2"/><path d="M12 6v4M12 10l-5 6M12 10l5 6"/></svg>
}
function PeopleIcon({ size }: { size: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="9" cy="7" r="3"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/><circle cx="18" cy="7" r="2"/><path d="M21 21v-2a3 3 0 0 0-2-2.83"/></svg>
}
function CheckIcon({ size }: { size: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
}
function SurveyIcon({ size }: { size: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14,2 14,8 20,8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>
}
function UsersIcon({ size }: { size: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
}
function SyncIcon({ size }: { size: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="1 4 1 10 7 10"/><polyline points="23 20 23 14 17 14"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/></svg>
}
function MirIcon({ size }: { size: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
}
function GroupTypeIcon({ size }: { size: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><path d="M12 8v8"/></svg>
}
function SignOutIcon({ size }: { size: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
}
