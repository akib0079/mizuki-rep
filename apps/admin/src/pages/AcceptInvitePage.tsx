import { useState } from 'react'
import { api, ApiError } from '../api.js'
import { PasswordField } from '../components/PasswordField.js'

/**
 * Where an invited admin sets their own password.
 *
 * Reached without a session, so it lives outside the console shell. The token comes from the
 * URL and is spent the moment the password is set — the link is the credential, so leaving it
 * usable after the account exists would mean anyone with the chat message could take the
 * account over.
 */
export function AcceptInvitePage({ onSignedIn }: { onSignedIn: () => void }) {
  const token = new URLSearchParams(window.location.search).get('token') ?? ''

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const tooShort = password.length > 0 && password.length < 12
  const mismatch = confirm.length > 0 && password !== confirm

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)

    if (password !== confirm) {
      setError('Those two passwords do not match.')
      return
    }

    setBusy(true)
    try {
      await api.post('/api/auth/admin/accept-invite', { token, password })
      // Straight into the console: they came here to start working, not to sign in twice.
      onSignedIn()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not work. Please ask for a new link.')
    } finally {
      setBusy(false)
    }
  }

  if (!token) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <h1>Mizuki Flora</h1>
          <p className="note note-error">
            This invitation link is incomplete. Ask whoever invited you to send a new one.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="auth-shell">
      <form className="auth-card" onSubmit={submit}>
        <h1>Choose a password</h1>
        <p className="muted">
          You have been invited to the Mizuki Flora studio console. Pick a password and you are in.
        </p>

        {error && (
          <div className="note note-error" role="alert">
            {error}
          </div>
        )}

        <PasswordField
          label="Password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          minLength={12}
          autoFocus
          hint="At least 12 characters."
        />

        <PasswordField
          label="Password again"
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
          hint={mismatch ? 'These do not match yet.' : undefined}
        />

        <button
          type="submit"
          className="btn btn-primary btn-block"
          disabled={busy || tooShort || mismatch || !password}
        >
          {busy ? 'Setting it up…' : 'Set password and sign in'}
        </button>
      </form>
    </div>
  )
}
