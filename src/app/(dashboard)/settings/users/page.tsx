'use client'

import { useState, useEffect, useCallback } from 'react'
import { ROLE_ORDER, ROLE_LABELS, ROLE_COLORS } from '@/types'
import type { User, UserRole } from '@/types'

type UserRow = User

const inputClass = "w-full px-4 py-2.5 rounded-lg border text-sm sans outline-none"
const inputStyle = { borderColor: 'var(--border)', background: 'var(--muted)', color: 'var(--foreground)' }

export default function UsersPage() {
  const [users, setUsers] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [showInvite, setShowInvite] = useState(false)
  const [editUser, setEditUser] = useState<UserRow | null>(null)
  const [search, setSearch] = useState('')
  const [filterRole, setFilterRole] = useState<UserRole | 'all'>('all')

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/users')
    const data = await res.json()
    setUsers(data.users || [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchUsers() }, [fetchUsers])

  const filtered = users.filter(u => {
    const matchRole = filterRole === 'all' || u.role === filterRole
    const matchSearch = !search ||
      u.name?.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase())
    return matchRole && matchSearch
  })

  const grouped = ROLE_ORDER.reduce((acc, role) => {
    acc[role] = filtered.filter(u => u.role === role)
    return acc
  }, {} as Record<UserRole, UserRow[]>)

  const getSupervisorName = (u: UserRow) => {
    // Supervisor lookup not yet implemented (requires people.shepherd_id mapping)
    return null
  }

  return (
    <div className="p-8 max-w-5xl">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-3xl font-serif" style={{ color: 'var(--primary)' }}>Manage Users</h1>
          <p className="mt-1 sans text-sm" style={{ color: 'var(--muted-foreground)' }}>
            {users.length} leader{users.length !== 1 ? 's' : ''} with app access
          </p>
        </div>
        <button
          onClick={() => setShowInvite(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium sans"
          style={{ background: 'var(--primary)', color: 'white' }}>
          + Invite Leader
        </button>
      </div>

      <div className="flex gap-3 mb-6">
        <input type="text" placeholder="Search by name or email…" value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 px-4 py-2 rounded-lg border text-sm sans outline-none"
          style={{ borderColor: 'var(--border)', background: 'white' }} />
        <select value={filterRole} onChange={e => setFilterRole(e.target.value as UserRole | 'all')}
          className="px-3 py-2 rounded-lg border text-sm sans outline-none"
          style={{ borderColor: 'var(--border)', background: 'white' }}>
          <option value="all">All roles</option>
          {ROLE_ORDER.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="text-center py-16 sans text-sm" style={{ color: 'var(--muted-foreground)' }}>Loading users…</div>
      ) : (
        <div className="space-y-6">
          {ROLE_ORDER.map(role => {
            const group = grouped[role]
            if (!group?.length) return null
            return (
              <div key={role}>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ background: ROLE_COLORS[role] }} />
                  <h2 className="text-sm font-semibold sans uppercase tracking-wide" style={{ color: 'var(--muted-foreground)' }}>
                    {ROLE_LABELS[role]}s ({group.length})
                  </h2>
                </div>
                <div className="bg-white rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
                  {group.map((u, i) => (
                    <div key={u.id} className="flex items-center gap-4 px-5 py-3.5"
                      style={{ borderTop: i > 0 ? '1px solid var(--border)' : 'none' }}>
                      <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-medium sans shrink-0"
                        style={{ background: ROLE_COLORS[role] + '20', color: ROLE_COLORS[role] }}>
                        {(u.name || u.email).charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium sans text-sm" style={{ color: 'var(--foreground)' }}>
                            {u.name || <span style={{ color: 'var(--muted-foreground)' }}>No name set</span>}
                          </span>
                          {!u.is_active && (
                            <span className="text-xs sans px-1.5 py-0.5 rounded" style={{ background: '#fef2f2', color: 'var(--danger)' }}>
                              Inactive
                            </span>
                          )}
                        </div>
                        <div className="text-xs sans mt-0.5" style={{ color: 'var(--muted-foreground)' }}>
                          {u.email}
                          {u.person_id && <span style={{ color: 'var(--primary)' }}> · PCO linked</span>}
                          {!u.person_id && <span style={{ color: '#c17f3e' }}> · No PCO link</span>}
                        </div>
                      </div>
                      <span className="text-xs sans px-2.5 py-1 rounded-full font-medium shrink-0"
                        style={{ background: ROLE_COLORS[role] + '15', color: ROLE_COLORS[role] }}>
                        {ROLE_LABELS[role]}
                      </span>
                      <button onClick={() => setEditUser(u)}
                        className="text-xs sans px-3 py-1.5 rounded-lg shrink-0"
                        style={{ color: 'var(--muted-foreground)', background: 'var(--muted)' }}>
                        Edit
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
          {filtered.length === 0 && (
            <div className="text-center py-12 sans text-sm" style={{ color: 'var(--muted-foreground)' }}>
              No users match your search.
            </div>
          )}
        </div>
      )}

      {showInvite && <InviteModal users={users} onClose={() => setShowInvite(false)} onSuccess={() => { setShowInvite(false); fetchUsers() }} />}
      {editUser && <EditModal user={editUser} users={users} onClose={() => setEditUser(null)} onSuccess={() => { setEditUser(null); fetchUsers() }} />}
    </div>
  )
}

function InviteModal({ users, onClose, onSuccess }: { users: UserRow[]; onClose: () => void; onSuccess: () => void }) {
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState<UserRole>('leader')
  const [supervisorId, setSupervisorId] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const eligibleSupervisors = users.filter(u => ROLE_ORDER.indexOf(u.role) < ROLE_ORDER.indexOf(role))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    const res = await fetch('/api/users/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name: fullName, role, /* supervisor_id not yet implemented */ }),
    })
    const data = await res.json()
    if (data.error) { setError(data.error); setLoading(false) } else onSuccess()
  }

  return (
    <Modal title="Invite a Leader" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Full Name">
          <input type="text" value={fullName} onChange={e => setFullName(e.target.value)}
            placeholder="Jane Smith" className={inputClass} style={inputStyle} />
        </Field>
        <Field label="Email Address" required>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)}
            required placeholder="jane@faithchurch.com" className={inputClass} style={inputStyle} />
        </Field>
        <Field label="Role">
          <select value={role} onChange={e => setRole(e.target.value as UserRole)} className={inputClass} style={inputStyle}>
            {ROLE_ORDER.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
        </Field>
        {eligibleSupervisors.length > 0 && (
          <Field label="Reports To">
            <select value={supervisorId} onChange={e => setSupervisorId(e.target.value)} className={inputClass} style={inputStyle}>
              <option value="">— None —</option>
              {eligibleSupervisors.map(u => <option key={u.id} value={u.id}>{u.name || u.email} ({ROLE_LABELS[u.role]})</option>)}
            </select>
          </Field>
        )}
        {error && <p className="text-sm sans rounded-lg px-3 py-2" style={{ background: '#fef2f2', color: 'var(--danger)' }}>{error}</p>}
        <ModalButtons onClose={onClose} loading={loading} disabled={!email} label="Send Invite" loadingLabel="Sending…" />
      </form>
    </Modal>
  )
}

function EditModal({ user, users, onClose, onSuccess }: { user: UserRow; users: UserRow[]; onClose: () => void; onSuccess: () => void }) {
  const [fullName, setFullName] = useState(user.name || '')
  const [role, setRole] = useState<UserRole>(user.role)
  const [isActive, setIsActive] = useState(user.is_active)
  const [supervisorId, setSupervisorId] = useState('')
  const [personId, setPersonId] = useState<string | null>(user.person_id)
  const [personSearch, setPersonSearch] = useState('')
  const [personResults, setPersonResults] = useState<{ id: string; name: string; pco_id: string | null }[]>([])
  const [selectedPersonName, setSelectedPersonName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const eligibleSupervisors = users.filter(u => u.id !== user.id && ROLE_ORDER.indexOf(u.role) < ROLE_ORDER.indexOf(role))

  // Load linked person name on mount
  useEffect(() => {
    if (user.person_id) {
      fetch(`/api/people/${user.person_id}`).then(r => r.json()).then(data => {
        if (data.person?.name) setSelectedPersonName(data.person.name)
      }).catch(() => {})
    }
  }, [user.person_id])

  // Search PCO people
  useEffect(() => {
    if (personSearch.length < 2) { setPersonResults([]); return }
    const timeout = setTimeout(async () => {
      const res = await fetch(`/api/people?search=${encodeURIComponent(personSearch)}&all=true`)
      const data = await res.json()
      setPersonResults((data.people || []).slice(0, 8).map((p: any) => ({
        id: p.id, name: p.name, pco_id: p.pco_id,
      })))
    }, 300)
    return () => clearTimeout(timeout)
  }, [personSearch])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    const res = await fetch(`/api/users/${user.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: fullName, role, is_active: isActive, person_id: personId }),
    })
    const data = await res.json()
    if (data.error) { setError(data.error); setLoading(false) } else onSuccess()
  }

  return (
    <Modal title="Edit User" subtitle={user.email} onClose={onClose}>
      <form onSubmit={handleSave} className="space-y-4">
        <Field label="Full Name">
          <input type="text" value={fullName} onChange={e => setFullName(e.target.value)} className={inputClass} style={inputStyle} />
        </Field>
        <Field label="Role">
          <select value={role} onChange={e => setRole(e.target.value as UserRole)} className={inputClass} style={inputStyle}>
            {ROLE_ORDER.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
        </Field>
        {eligibleSupervisors.length > 0 && (
          <Field label="Reports To">
            <select value={supervisorId} onChange={e => setSupervisorId(e.target.value)} className={inputClass} style={inputStyle}>
              <option value="">— None —</option>
              {eligibleSupervisors.map(u => <option key={u.id} value={u.id}>{u.name || u.email} ({ROLE_LABELS[u.role]})</option>)}
            </select>
          </Field>
        )}
        <Field label="Linked PCO Record">
          {personId && selectedPersonName ? (
            <div className="flex items-center gap-2">
              <span className="flex-1 px-4 py-2.5 rounded-lg border text-sm sans" style={{ ...inputStyle }}>
                {selectedPersonName}
              </span>
              <button type="button" onClick={() => { setPersonId(null); setSelectedPersonName(''); setPersonSearch('') }}
                className="text-xs sans px-3 py-2 rounded-lg" style={{ color: 'var(--danger)' }}>
                Unlink
              </button>
            </div>
          ) : (
            <div className="relative">
              <input type="text" value={personSearch} onChange={e => setPersonSearch(e.target.value)}
                placeholder="Search PCO people..." className={inputClass} style={inputStyle} />
              {personResults.length > 0 && (
                <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-white rounded-lg border shadow-lg max-h-48 overflow-y-auto"
                  style={{ borderColor: 'var(--border)' }}>
                  {personResults.map(p => (
                    <button key={p.id} type="button"
                      onClick={() => { setPersonId(p.id); setSelectedPersonName(p.name); setPersonSearch(''); setPersonResults([]) }}
                      className="w-full text-left px-4 py-2 text-sm sans hover:bg-gray-50 transition-colors flex items-center justify-between"
                      style={{ color: 'var(--foreground)' }}>
                      <span>{p.name}</span>
                      {p.pco_id && <span className="text-xs" style={{ color: 'var(--muted-foreground)' }}>PCO #{p.pco_id}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </Field>
        <div className="flex items-center gap-3">
          <input type="checkbox" id="active" checked={isActive} onChange={e => setIsActive(e.target.checked)} className="w-4 h-4 rounded" />
          <label htmlFor="active" className="text-sm sans" style={{ color: 'var(--foreground)' }}>Active (can log in)</label>
        </div>
        {error && <p className="text-sm sans rounded-lg px-3 py-2" style={{ background: '#fef2f2', color: 'var(--danger)' }}>{error}</p>}
        <ModalButtons onClose={onClose} loading={loading} label="Save Changes" loadingLabel="Saving…" />
      </form>
    </Modal>
  )
}

function Modal({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(44,36,22,0.4)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6">
        <h2 className="font-serif text-xl mb-1" style={{ color: 'var(--primary)' }}>{title}</h2>
        {subtitle && <p className="text-xs sans mb-5" style={{ color: 'var(--muted-foreground)' }}>{subtitle}</p>}
        {!subtitle && <div className="mb-5" />}
        {children}
      </div>
    </div>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium sans mb-1.5" style={{ color: 'var(--foreground)' }}>
        {label}{required && <span style={{ color: 'var(--danger)' }}> *</span>}
      </label>
      {children}
    </div>
  )
}

function ModalButtons({ onClose, loading, disabled, label, loadingLabel }: { onClose: () => void; loading: boolean; disabled?: boolean; label: string; loadingLabel: string }) {
  return (
    <div className="flex gap-3 pt-2">
      <button type="button" onClick={onClose}
        className="flex-1 py-2.5 rounded-xl text-sm sans border"
        style={{ borderColor: 'var(--border)', color: 'var(--muted-foreground)' }}>
        Cancel
      </button>
      <button type="submit" disabled={loading || disabled}
        className="flex-1 py-2.5 rounded-xl text-sm font-medium sans disabled:opacity-50"
        style={{ background: 'var(--primary)', color: 'white' }}>
        {loading ? loadingLabel : label}
      </button>
    </div>
  )
}
