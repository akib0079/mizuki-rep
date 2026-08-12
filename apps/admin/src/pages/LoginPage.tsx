import { useState, type FormEvent } from 'react'
import { ApiError, api } from '../api.js'
import { PasswordField } from '../components/PasswordField.js'
import { Spinner } from '../components/Spinner.js'

/**
 * Sign in, and the two screens that hang off it.
 *
 * Forgetting a password is its own task, so it gets its own view rather than being a button on
 * the sign-in form. As an action on that form it had to borrow the email box, which meant
 * pressing it with the box empty produced "enter your email address first" — telling someone
 * off for pressing the only thing on screen that looked like it would help.
 */

type View = 'signin' | 'forgot' | 'sent'

export function LoginPage({ onSignedIn }: { onSignedIn: () => void }) {
  const [view, setView] = useState<View>('signin')

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [totp, setTotp] = useState('')
  const [needsTotp, setNeedsTotp] = useState(false)

  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [sentTo, setSentTo] = useState('')

  function go(next: View) {
    setError(null)
    setView(next)
  }

  async function signIn(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)

    try {
      await api.post('/api/auth/admin/login', { email, password, ...(totp ? { totp } : {}) })
      // Left busy on purpose: the console is about to replace this screen, and flicking the
      // button back to "Sign in" first reads as the attempt having failed.
      onSignedIn()
    } catch (err) {
      if (err instanceof ApiError && err.code === 'totp_required') {
        // Reveal the code field rather than showing this as a failure — nothing went wrong.
        setNeedsTotp(true)
        setError(null)
      } else {
        setError(err instanceof Error ? err.message : 'Sign-in failed.')
      }
      setBusy(false)
    }
  }

  async function requestReset(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)

    try {
      await api.post('/api/auth/admin/forgot-password', { email })
      setSentTo(email)
      setView('sent')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send a reset link.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <img
          src="/admin/mizuki-logo.png"
          alt="Mizuki Flora"
          width={56}
          height={56}
          className="login-logo"
        />

        {view === 'signin' && (
          <form onSubmit={signIn}>
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
                autoFocus
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>

            <PasswordField label="Password" value={password} onChange={setPassword} />

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

            <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
              {busy ? (
                <>
                  <Spinner /> Signing in…
                </>
              ) : (
                'Sign in'
              )}
            </button>

            <button type="button" className="link-btn login-alt" onClick={() => go('forgot')}>
              Forgot your password?
            </button>
          </form>
        )}

        {view === 'forgot' && (
          <form onSubmit={requestReset}>
            <h1>Reset your password</h1>
            <p>
              Enter the email address you sign in with and we will send you a link to choose a new
              password.
            </p>

            {error && <div className="banner banner-danger">{error}</div>}

            <label className="field">
              <span>Email</span>
              <input
                type="email"
                value={email}
                autoComplete="username"
                required
                autoFocus
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>

            <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
              {busy ? (
                <>
                  <Spinner /> Sending…
                </>
              ) : (
                'Send me a reset link'
              )}
            </button>

            <button type="button" className="link-btn login-alt" onClick={() => go('signin')}>
              Back to sign in
            </button>
          </form>
        )}

        {view === 'sent' && (
          <div>
            <h1>Check your email</h1>
            <p>
              If <strong>{sentTo}</strong> has a studio login, a reset link is on its way. It works
              once and lasts two hours.
            </p>

            {/*
              Says "if", and says it whether or not the address exists. Confirming which addresses
              have a login would turn this screen into a way to find out who works at the studio.
            */}
            <div className="banner banner-info">
              Not arrived after a few minutes? Check spam, or ask another admin to send you a link
              from the Team page.
            </div>

            <button type="button" className="btn btn-block" onClick={() => go('signin')}>
              Back to sign in
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
