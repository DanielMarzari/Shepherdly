'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [code, setCode] = useState('')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const codeRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  useEffect(() => { codeRef.current?.focus() }, [])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (code.trim().length < 4 || !email.trim()) return
    setLoading(true)
    setError('')

    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code.trim(), email: email.trim() }),
    })

    const data = await res.json()

    if (data.error) {
      setError(data.error)
      setLoading(false)
    } else {
      router.push('/dashboard')
      router.refresh()
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden"
      style={{ background: 'linear-gradient(135deg, #1a3a2a 0%, #234d38 40%, #2d6047 100%)' }}>

      {/* Leaf pattern background */}
      <div className="absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='80' height='80' viewBox='0 0 80 80' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Cpath d='M40 10 C40 10 55 25 55 40 C55 55 40 55 40 55 C40 55 25 55 25 40 C25 25 40 10 40 10Z'/%3E%3Cpath d='M40 10 L40 55' stroke='%23ffffff' stroke-width='0.5' fill='none'/%3E%3Cpath d='M32 25 L40 32' stroke='%23ffffff' stroke-width='0.3' fill='none'/%3E%3Cpath d='M48 25 L40 32' stroke='%23ffffff' stroke-width='0.3' fill='none'/%3E%3Cpath d='M30 35 L40 40' stroke='%23ffffff' stroke-width='0.3' fill='none'/%3E%3Cpath d='M50 35 L40 40' stroke='%23ffffff' stroke-width='0.3' fill='none'/%3E%3C/g%3E%3C/svg%3E")`
        }} />

      {/* Subtle radial glow */}
      <div className="absolute inset-0"
        style={{ background: 'radial-gradient(ellipse at center, rgba(106,184,142,0.15) 0%, transparent 70%)' }} />

      <div className="relative w-full max-w-sm px-6">
        {/* Logo */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4"
            style={{ background: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(8px)' }}>
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <path d="M16 4C16 4 26 10 26 20C26 26 20 28 16 28C12 28 6 26 6 20C6 10 16 4 16 4Z"
                fill="rgba(106,184,142,0.4)" stroke="white" strokeWidth="1.5"/>
              <path d="M16 8V26" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
              <path d="M11 14L16 18" stroke="white" strokeWidth="1" strokeLinecap="round" opacity="0.7"/>
              <path d="M21 14L16 18" stroke="white" strokeWidth="1" strokeLinecap="round" opacity="0.7"/>
              <path d="M10 20L16 23" stroke="white" strokeWidth="1" strokeLinecap="round" opacity="0.7"/>
              <path d="M22 20L16 23" stroke="white" strokeWidth="1" strokeLinecap="round" opacity="0.7"/>
            </svg>
          </div>
          <h1 className="text-3xl font-serif text-white">Shepherdly</h1>
          <p className="mt-1.5 text-sm sans" style={{ color: 'rgba(255,255,255,0.55)' }}>
            Faith Church &middot; Pastoral Care
          </p>
        </div>

        {/* Card */}
        <div className="rounded-2xl p-8"
          style={{
            background: 'rgba(255,255,255,0.1)',
            backdropFilter: 'blur(16px)',
            border: '1px solid rgba(255,255,255,0.15)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
          }}>
          <h2 className="text-xl font-serif mb-1 text-white">Sign in</h2>
          <p className="text-sm sans mb-6" style={{ color: 'rgba(255,255,255,0.55)' }}>
            Enter your personal invite code and email address.
          </p>

          <form onSubmit={handleLogin} className="space-y-4">
            <input
              ref={codeRef}
              type="text"
              value={code}
              onChange={e => setCode(e.target.value.toUpperCase())}
              placeholder="Invite code"
              maxLength={12}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              className="w-full px-4 py-3 rounded-lg text-center text-xl font-mono tracking-widest outline-none transition-all"
              style={{
                background: 'rgba(255,255,255,0.1)',
                border: `1px solid ${error ? '#ef4444' : 'rgba(255,255,255,0.2)'}`,
                color: 'white',
                letterSpacing: '0.2em',
              }}
            />

            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="Email address"
              autoComplete="email"
              className="w-full px-4 py-3 rounded-lg text-sm sans outline-none transition-all"
              style={{
                background: 'rgba(255,255,255,0.1)',
                border: `1px solid ${error ? '#ef4444' : 'rgba(255,255,255,0.2)'}`,
                color: 'white',
              }}
            />

            {error && (
              <p className="text-sm sans rounded-lg px-3 py-2 text-center"
                style={{ background: 'rgba(220,74,74,0.15)', color: '#fca5a5' }}>
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading || code.trim().length < 4 || !email.trim()}
              className="w-full py-3 px-4 rounded-lg text-sm font-semibold sans transition-all disabled:opacity-40"
              style={{
                background: 'rgba(255,255,255,0.95)',
                color: 'var(--green-800, #234d38)',
              }}>
              {loading ? 'Signing in\u2026' : 'Sign In'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs mt-6 sans" style={{ color: 'rgba(255,255,255,0.4)' }}>
          Don&apos;t have a code? Contact your church administrator.
        </p>
      </div>
    </div>
  )
}
