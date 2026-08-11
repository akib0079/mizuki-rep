import { useEffect, useState, type FormEvent } from 'react'
import { DateTime } from 'luxon'
import { formatDuration, formatTimeRange, type PublicSession,
  toStudio,
} from '@mizuki/shared'
import { ApiError, widgetApi, type StartBookingResult } from './api.js'

/**
 * The booking form.
 *
 * Email-first rather than sign-in-first: a visitor should never have to make an account to find
 * out whether they can book. What happens next depends on the course — a paid workshop hands off
 * to the shop, a course package sends a confirmation link so nobody else can spend a student's
 * sessions, and a free class books outright.
 */
export function BookingDialog({
  session,
  onClose,
  onBooked,
}: {
  session: PublicSession
  onClose: () => void
  onBooked: () => void
}) {
  const [form, setForm] = useState({ name: '', email: '', phone: '', notes: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<StartBookingResult | null>(null)
  const [alternatives, setAlternatives] = useState<PublicSession[] | null>(null)

  // Escape closes, matching what every other dialog on the web does.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const start = toStudio(session.startAt)
  const end = toStudio(session.endAt)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)

    try {
      const outcome = await widgetApi.startBooking({
        sessionId: session.id,
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        notes: form.notes.trim(),
      })
      setResult(outcome)
      if (outcome.outcome === 'booked') onBooked()
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Something went wrong. Please try again.'
      setError(message)

      // If it filled up while they were typing, offer other dates rather than a dead end.
      if (err instanceof ApiError && err.code === 'session_full') {
        void widgetApi
          .alternatives(session.id)
          .then((data) => setAlternatives(data.alternatives.slice(0, 5)))
          .catch(() => undefined)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mzk-modal-backdrop" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="mzk mzk-modal" role="dialog" aria-modal="true" aria-label="Book this class">
        {result ? (
          <BookingOutcome result={result} session={session} onClose={onClose} />
        ) : (
          <form onSubmit={submit}>
            <h3>{session.title}</h3>
            <p className="mzk-muted mzk-small">
              {start.toFormat('cccc d LLLL yyyy')}
              <br />
              {formatTimeRange(start.toJSDate(), end.toJSDate())} · {formatDuration(session.durationMins)}
            </p>

            {session.breaks.length > 0 && (
              <p className="mzk-muted mzk-small">
                Includes a break: {session.breaks.map((b) => `${b.label} ${b.start}–${b.end}`).join(', ')}
              </p>
            )}

            {error && <div className="mzk-note mzk-note-error">{error}</div>}

            {alternatives && alternatives.length > 0 && (
              <div className="mzk-note mzk-note-info">
                <strong>Other dates with places:</strong>
                <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                  {alternatives.map((alt) => (
                    <li key={alt.id}>
                      {toStudio(alt.startAt).toFormat('ccc d LLL')} ·{' '}
                      {toStudio(alt.startAt).toFormat('h:mm a')} — {alt.seatsLeft} left
                    </li>
                  ))}
                </ul>
                <p className="mzk-small" style={{ margin: '8px 0 0' }}>
                  Close this and pick one from the calendar.
                </p>
              </div>
            )}

            <div style={{ marginTop: 16 }}>
              <label className="mzk-field">
                <span>Your name</span>
                <input
                  value={form.name}
                  required
                  autoComplete="name"
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </label>

              <label className="mzk-field">
                <span>Email</span>
                <input
                  type="email"
                  value={form.email}
                  required
                  autoComplete="email"
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
                <span className="mzk-muted mzk-small">Your confirmation and reminder go here.</span>
              </label>

              <label className="mzk-field">
                <span>Phone</span>
                <input
                  type="tel"
                  inputMode="tel"
                  value={form.phone}
                  required
                  autoComplete="tel"
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
                <span className="mzk-muted mzk-small">
                  So we can reach you quickly if a class changes at short notice.
                </span>
              </label>

              <label className="mzk-field">
                <span>Anything we should know? (optional)</span>
                <textarea
                  rows={2}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </label>
            </div>

            <div className="mzk-row" style={{ justifyContent: 'flex-end', marginTop: 4 }}>
              <button type="button" className="mzk-btn" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button type="submit" className="mzk-btn mzk-btn-primary" disabled={busy}>
                {busy && <span className="mzk-spinner" />}
                {busy ? 'Just a moment…' : 'Book this class'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

/** What the student sees once the form comes back — one screen per route through the flow. */
function BookingOutcome({
  result,
  session,
  onClose,
}: {
  result: StartBookingResult
  session: PublicSession
  onClose: () => void
}) {
  const start = toStudio(session.startAt)

  if (result.outcome === 'booked') {
    return (
      <>
        <h3>You're booked in</h3>
        <div className="mzk-note mzk-note-ok">
          <strong>{session.title}</strong>
          <br />
          {start.toFormat('cccc d LLLL yyyy')} at {start.toFormat('h:mm a')}
        </div>
        <p className="mzk-small">
          We've emailed your confirmation, with a calendar invitation attached. You'll get a
          reminder two days before.
        </p>
        {result.packageRemaining !== null && (
          <p className="mzk-small mzk-muted">
            You have {result.packageRemaining} session{result.packageRemaining === 1 ? '' : 's'} left in
            your course package.
          </p>
        )}
        <button className="mzk-btn mzk-btn-primary mzk-btn-block" style={{ marginTop: 12 }} onClick={onClose}>
          Done
        </button>
      </>
    )
  }

  if (result.outcome === 'verify_email') {
    return (
      <>
        <h3>Check your email</h3>
        <div className="mzk-note mzk-note-info">{result.message}</div>
        <p className="mzk-small">
          Click the link in that email to confirm this booking. We ask for this so nobody else can
          use the sessions in your course package.
        </p>
        <button className="mzk-btn mzk-btn-block" style={{ marginTop: 12 }} onClick={onClose}>
          Close
        </button>
      </>
    )
  }

  // Paid workshop — the shop handles payment exactly as it does today, but the place is
  // already reserved, so the countdown below is real rather than reassurance.
  return <CheckoutHandoff result={result} session={session} start={start} onClose={onClose} />
}

function CheckoutHandoff({
  result,
  session,
  start,
  onClose,
}: {
  result: Extract<StartBookingResult, { outcome: 'checkout_required' }>
  session: PublicSession
  start: DateTime
  onClose: () => void
}) {
  const [msLeft, setMsLeft] = useState(() => new Date(result.holdExpiresAt).getTime() - Date.now())
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    const id = setInterval(() => setMsLeft(new Date(result.holdExpiresAt).getTime() - Date.now()), 1000)
    return () => clearInterval(id)
  }, [result.holdExpiresAt])

  const expired = msLeft <= 0
  const minutes = Math.max(0, Math.floor(msLeft / 60_000))
  const seconds = Math.max(0, Math.floor((msLeft % 60_000) / 1000))

  /** Closing without paying returns the place immediately instead of waiting for the sweeper. */
  async function abandon() {
    setLeaving(true)
    try {
      await widgetApi.releaseHold(result.holdToken)
    } catch {
      // The sweeper will get it either way — never block the student on this.
    } finally {
      onClose()
    }
  }

  return (
    <>
      <h3>One more step</h3>
      <p className="mzk-small">
        <strong>{session.title}</strong> on {start.toFormat('ccc d LLL')} is paid for through our shop.
      </p>

      {expired ? (
        <div className="mzk-note mzk-note-error">
          Your place was held for {result.holdMinutes} minutes and has now been released. Close this
          and pick the class again if it still has places.
        </div>
      ) : (
        <div className="mzk-note mzk-note-info">
          Your place is held for{' '}
          <strong>
            {minutes}:{String(seconds).padStart(2, '0')}
          </strong>
          . If you don't finish paying, it goes back on sale automatically.
        </div>
      )}

      {!expired && (
        <a
          className="mzk-btn mzk-btn-primary mzk-btn-block"
          href={result.checkoutUrl}
          style={{ textDecoration: 'none' }}
        >
          Continue to the shop
        </a>
      )}

      <button className="mzk-btn mzk-btn-block" style={{ marginTop: 8 }} onClick={abandon} disabled={leaving}>
        {expired ? 'Close' : leaving ? 'Releasing…' : "I'll book later"}
      </button>
    </>
  )
}
