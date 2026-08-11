import { useState, type FormEvent } from 'react'
import { ApiError, api } from '../api.js'

export function LoginPage({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [totp, setTotp] = useState('')
  const [needsTotp, setNeedsTotp] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)

    try {
      await api.post('/api/auth/admin/login', {
        email,
        password,
        ...(totp ? { totp } : {}),
      })
      onSignedIn()
    } catch (err) {
      if (err instanceof ApiError && err.code === 'totp_required') {
        // Reveal the code field rather than showing this as a failure — nothing went wrong.
        setNeedsTotp(true)
        setError(null)
      } else {
        setError(err instanceof Error ? err.message : 'Sign-in failed.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <img src="/admin/mizuki-logo.png" alt="Mizuki Flora" width={56} height={56} className="login-logo" />
        <h1>Mizuki Studio</h1>
        <p>Sign in to manage classes and bookings.</p>

        {error && <div className="banner banner-danger">{error}</div>}

        <label className="field">
          <span>Email</span>
          <input
            type="email"
            value={email}
            autoComplete="username"
            required
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>

        <label className="field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            autoComplete="current-password"
            required
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        {needsTotp && (
          <label className="field">
            <span>Authenticator code</span>
            <input
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={totp}
              autoFocus
              onChange={(e) => setTotp(e.target.value.replace(/\D/g, ''))}
            />
            <div className="field-hint">The 6-digit code from your authenticator app.</div>
          </label>
        )}

        <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
