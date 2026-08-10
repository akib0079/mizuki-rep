import { useEffect, useState, type FormEvent } from 'react'
import { DateTime } from 'luxon'
import { formatDuration, formatTimeRange, type PublicSession } from '@mizuki/shared'
import { ApiError, widgetApi, type MyBookingRow, type MyBookings as MyBookingsData } from './api.js'

/**
 * The student's own page: what they have booked, how long they have left to change it, and
 * what remains in their course package.
 *
 * The reschedule deadline is shown as a date rather than a rule, because "you can change this
 * until Wednesday 10am" is something a person can act on; "72-hour policy" is not.
 */
export function MyBookings() {
  const [data, setData] = useState<MyBookingsData | null>(null)
  const [signedOut, setSignedOut] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rescheduling, setRescheduling] = useState<MyBookingRow | null>(null)

  async function load() {
    try {
      setData(await widgetApi.myBookings())
      setSignedOut(false)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setSignedOut(true)
      } else {
        setError('We could not load your bookings just now. Please refresh the page.')
      }
    }
  }

  useEffect(() => {
    void load()
  }, [])

  if (signedOut) return <SignInPanel />

  if (error) {
    return (
      <div className="mzk">
        <div className="mzk-note mzk-note-error">{error}</div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="mzk">
        <div className="mzk-panel"><div className="mzk-empty">Loading your bookings…</div></div>
      </div>
    )
  }

  const now = new Date()
  const upcoming = data.bookings.filter((b) => new Date(b.session.startAt) >= now)

  return (
    <div className="mzk">
      {data.packages.filter((p) => p.status === 'active').length > 0 && (
        <div className="mzk-panel" style={{ marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 10px', fontSize: 16 }}>Your course packages</h3>
          {data.packages
            .filter((p) => p.status === 'active')
            .map((p) => (
              <div key={p.id} className="mzk-row" style={{ justifyContent: 'space-between' }}>
                <span>
                  <strong>{p.remaining}</strong> of {p.totalSessions} sessions left
                </span>
                {p.expiresAt && (
                  <span className="mzk-muted mzk-small">
                    Expires {DateTime.fromISO(p.expiresAt).toFormat('d LLL yyyy')}
                  </span>
                )}
              </div>
            ))}
        </div>
      )}

      <h3 style={{ margin: '0 0 12px', fontSize: 16 }}>Your upcoming classes</h3>

      {upcoming.length === 0 ? (
        <div className="mzk-panel">
          <div className="mzk-empty">You have no classes booked at the moment.</div>
        </div>
      ) : (
        upcoming.map((row) => (
          <BookingCard
            key={row.id}
            row={row}
            onReschedule={() => setRescheduling(row)}
            onCancelled={() => void load()}
          />
        ))
      )}

      {rescheduling && (
        <RescheduleDialog
          row={rescheduling}
          onClose={() => setRescheduling(null)}
          onDone={() => {
            setRescheduling(null)
            void load()
          }}
        />
      )}
    </div>
  )
}

function BookingCard({
  row,
  onReschedule,
  onCancelled,
}: {
  row: MyBookingRow
  onReschedule: () => void
  onCancelled: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const start = DateTime.fromISO(row.session.startAt)
  const end = DateTime.fromISO(row.session.endAt)

  async function cancel() {
    if (!confirm(`Cancel your place in ${row.session.title} on ${start.toFormat('ccc d LLL')}?`)) return

    setBusy(true)
    setError(null)
    try {
      await widgetApi.cancel(row.id)
      onCancelled()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not cancel that. Please get in touch.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mzk-panel" style={{ marginBottom: 10 }}>
      <div className="mzk-row" style={{ alignItems: 'flex-start', gap: 12 }}>
        <span className="mzk-stripe" style={{ background: row.session.colour, minHeight: 42 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 650 }}>{row.session.title}</div>
          <div className="mzk-muted mzk-small">
            {start.toFormat('cccc d LLLL yyyy')}
            <br />
            {formatTimeRange(start.toJSDate(), end.toJSDate())} · {formatDuration(row.session.durationMins)}
          </div>
          {row.status === 'hold' && (
            <div className="mzk-tag mzk-tag-low" style={{ marginTop: 6 }}>Awaiting payment</div>
          )}
        </div>
      </div>

      {error && <div className="mzk-note mzk-note-error" style={{ marginTop: 12 }}>{error}</div>}

      <div style={{ marginTop: 12 }}>
        {row.canReschedule ? (
          <>
            <p className="mzk-muted mzk-small" style={{ marginBottom: 8 }}>
              You can change this until{' '}
              <strong>{DateTime.fromISO(row.rescheduleDeadline!).toFormat('ccc d LLL, h:mm a')}</strong>.
            </p>
            <div className="mzk-row">
              <button className="mzk-btn" onClick={onReschedule} disabled={busy}>
                Change date
              </button>
              <button className="mzk-btn" onClick={cancel} disabled={busy}>
                {busy ? 'Cancelling…' : 'Cancel'}
              </button>
            </div>
          </>
        ) : (
          <p className="mzk-muted mzk-small" style={{ margin: 0 }}>
            {row.rescheduleBlockedReason}
          </p>
        )}
      </div>
    </div>
  )
}

function RescheduleDialog({
  row,
  onClose,
  onDone,
}: {
  row: MyBookingRow
  onClose: () => void
  onDone: () => void
}) {
  const [options, setOptions] = useState<PublicSession[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    widgetApi
      .alternatives(row.session.id)
      .then((data) => setOptions(data.alternatives))
      .catch(() => setError('We could not load other dates. Please try again.'))
  }, [row.session.id])

  async function move(toSessionId: string) {
    setBusy(true)
    setError(null)
    try {
      await widgetApi.reschedule(row.id, toSessionId)
      onDone()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not move that booking.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mzk-modal-backdrop" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="mzk mzk-modal" role="dialog" aria-modal="true" aria-label="Change your date">
        <h3>Change your date</h3>
        <p className="mzk-muted mzk-small">
          Moving from {DateTime.fromISO(row.session.startAt).toFormat('ccc d LLL, h:mm a')}.
          Only {row.session.courseName} classes with places are shown.
        </p>

        {error && <div className="mzk-note mzk-note-error">{error}</div>}

        {!options ? (
          <div className="mzk-empty">Finding other dates…</div>
        ) : options.length === 0 ? (
          <div className="mzk-empty">
            There are no other dates with places at the moment. Please get in touch and we will
            find something for you.
          </div>
        ) : (
          <div style={{ marginTop: 12 }}>
            {options.map((option) => (
              <button
                key={option.id}
                className="mzk-session"
                disabled={busy}
                onClick={() => move(option.id)}
              >
                <span className="mzk-stripe" style={{ background: option.colour }} />
                <span className="mzk-session-main">
                  <span className="mzk-session-title">
                    {DateTime.fromISO(option.startAt).toFormat('ccc d LLL')}
                  </span>
                  <span className="mzk-session-meta">
                    {DateTime.fromISO(option.startAt).toFormat('h:mm a')} ·{' '}
                    {formatDuration(option.durationMins)}
                  </span>
                </span>
                <span className="mzk-session-right">
                  <span className="mzk-tag mzk-tag-ok">{option.seatsLeft} left</span>
                </span>
              </button>
            ))}
          </div>
        )}

        <button className="mzk-btn mzk-btn-block" style={{ marginTop: 10 }} onClick={onClose} disabled={busy}>
          Keep my current date
        </button>
      </div>
    </div>
  )
}

/** Shown when the visitor is not signed in — a link, not a password. */
function SignInPanel() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await widgetApi.requestMagicLink(email.trim(), window.location.href)
      setSent(true)
    } catch {
      setError('We could not send that link. Please try again shortly.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mzk">
      <div className="mzk-panel">
        {sent ? (
          <>
            <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>Check your email</h3>
            <div className="mzk-note mzk-note-ok">
              If that address is registered with us, a sign-in link is on its way. It works once and
              lasts 30 minutes.
            </div>
          </>
        ) : (
          <form onSubmit={submit}>
            <h3 style={{ margin: '0 0 4px', fontSize: 16 }}>See your bookings</h3>
            <p className="mzk-muted mzk-small">
              Enter your email and we'll send you a link — no password needed.
            </p>

            {error && <div className="mzk-note mzk-note-error">{error}</div>}

            <label className="mzk-field">
              <span>Email</span>
              <input
                type="email"
                value={email}
                required
                autoComplete="email"
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>

            <button className="mzk-btn mzk-btn-primary mzk-btn-block" disabled={busy}>
              {busy && <span className="mzk-spinner" />}
              {busy ? 'Sending…' : 'Email me a sign-in link'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
