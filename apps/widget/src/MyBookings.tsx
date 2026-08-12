import { useEffect, useState, type FormEvent } from 'react'
import { DateTime } from 'luxon'
import { formatDuration, formatTimeRange, type PublicSession,
  toStudio,
} from '@mizuki/shared'
import { Scope } from './Scope.js'
import {
  ApiError,
  widgetApi,
  type MyBookingRow,
  type MyBookings as MyBookingsData,
  type PackageRow,
  type PastClass,
  type StudentProfile,
} from './api.js'

/**
 * The student's own page: what they have booked, how long they have left to change it, and
 * what remains in their course package.
 *
 * The reschedule deadline is shown as a date rather than a rule, because "you can change this
 * until Wednesday 10am" is something a person can act on; "72-hour policy" is not.
 */
type PortalTab = 'upcoming' | 'past' | 'course' | 'details'

export function MyBookings({ embedded = false }: { embedded?: boolean } = {}) {
  const [data, setData] = useState<MyBookingsData | null>(null)
  const [signedOut, setSignedOut] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rescheduling, setRescheduling] = useState<MyBookingRow | null>(null)
  const [tab, setTab] = useState<PortalTab>('upcoming')
  const [profile, setProfile] = useState<StudentProfile | null>(null)

  async function load() {
    try {
      const [bookings, me] = await Promise.all([widgetApi.myBookings(), widgetApi.me()])
      setData(bookings)
      setProfile(me.student)
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

  if (signedOut) return <Scope embedded={embedded}><SignInPanel embedded /></Scope>

  if (error) {
    return (
      <Scope embedded={embedded}>
        <div className="mzk-note mzk-note-error">{error}</div>
      </Scope>
    )
  }

  if (!data) {
    return (
      <Scope embedded={embedded}>
        <div className="mzk-panel"><div className="mzk-empty">Loading your bookings…</div></div>
      </Scope>
    )
  }

  const now = new Date()
  const upcoming = data.bookings.filter((b) => new Date(b.session.startAt) >= now)
  const activePackages = data.packages.filter((p) => p.status === 'active')
  const sessionsLeft = activePackages.reduce((sum, p) => sum + p.remaining, 0)

  return (
    <Scope embedded={embedded}>
      {/* A short summary strip, so the answers to "when am I next in" and "how many
          sessions have I left" are visible before anything is clicked. */}
      <div className="mzk-summary">
        <div className="mzk-summary-item">
          <span className="mzk-summary-value">{upcoming.length}</span>
          <span className="mzk-summary-label">upcoming {upcoming.length === 1 ? 'class' : 'classes'}</span>
        </div>
        {activePackages.length > 0 && (
          <div className="mzk-summary-item">
            <span className="mzk-summary-value">{sessionsLeft}</span>
            <span className="mzk-summary-label">course {sessionsLeft === 1 ? 'session' : 'sessions'} left</span>
          </div>
        )}
        {upcoming[0] && (
          <div className="mzk-summary-item mzk-summary-next">
            <span className="mzk-summary-label">Next</span>
            <span className="mzk-summary-value-sm">
              {toStudio(upcoming[0].session.startAt).toFormat('ccc d LLL, h:mm a')}
            </span>
          </div>
        )}
      </div>

      <div className="mzk-tabs" role="tablist">
        {([
          ['upcoming', `Upcoming (${upcoming.length})`],
          ['past', 'Past classes'],
          ['course', activePackages.length > 0 ? 'My course' : ''],
          ['details', 'My details'],
        ] as [PortalTab, string][])
          .filter(([, label]) => label)
          .map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              className={tab === key ? 'mzk-tab mzk-tab-active' : 'mzk-tab'}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
      </div>

      {tab === 'upcoming' && (
        upcoming.length === 0 ? (
          <div className="mzk-panel">
            <div className="mzk-empty">
              <p>You have no classes booked at the moment.</p>
              <p className="mzk-small">Pick a date on the calendar to book one.</p>
            </div>
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
        )
      )}

      {tab === 'past' && <PastClasses />}

      {tab === 'course' && <CoursePackages packages={data.packages} />}

      {tab === 'details' && profile && (
        <ProfileForm profile={profile} onSaved={() => void load()} />
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
    </Scope>
  )
}

/** What the student has already attended — their own record, not the studio's. */
function PastClasses() {
  const [state, setState] = useState<{ classes: PastClass[]; totals: { attended: number; total: number } } | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    widgetApi.history().then(setState).catch(() => setFailed(true))
  }, [])

  if (failed) return <div className="mzk-note mzk-note-error">We could not load your past classes.</div>
  if (!state) return <div className="mzk-panel"><div className="mzk-empty">Loading…</div></div>
  if (state.classes.length === 0) {
    return (
      <div className="mzk-panel">
        <div className="mzk-empty">No past classes yet — your first one is still to come.</div>
      </div>
    )
  }

  return (
    <>
      {state.totals.attended > 0 && (
        <p className="mzk-muted mzk-small" style={{ marginBottom: 12 }}>
          You have attended <strong>{state.totals.attended}</strong> of {state.totals.total} classes.
        </p>
      )}
      {state.classes.map((c) => (
        <div className="mzk-panel mzk-past" key={c.id}>
          <span className="mzk-stripe" style={{ background: c.colour, minHeight: 34 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 650 }}>{c.title}</div>
            <div className="mzk-muted mzk-small">
              {toStudio(c.startAt).toFormat('ccc d LLL yyyy')} ·{' '}
              {formatTimeRange(toStudio(c.startAt).toJSDate(), toStudio(c.endAt).toJSDate())}
            </div>
          </div>
          {c.status === 'attended' && <span className="mzk-tag mzk-tag-ok">Attended</span>}
          {c.status === 'no_show' && <span className="mzk-tag mzk-tag-full">Missed</span>}
          {c.status === 'cancelled' && <span className="mzk-tag mzk-tag-full">Cancelled</span>}
        </div>
      ))}
    </>
  )
}

/** Course package balance, with how much has been used shown rather than just stated. */
function CoursePackages({ packages }: { packages: PackageRow[] }) {
  const active = packages.filter((p) => p.status === 'active')

  if (active.length === 0) {
    return <div className="mzk-panel"><div className="mzk-empty">You have no active course package.</div></div>
  }

  return (
    <>
      {active.map((p) => (
        <div className="mzk-panel" key={p.id} style={{ marginBottom: 10 }}>
          <div className="mzk-row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
            <strong style={{ fontSize: 18 }}>{p.remaining} of {p.totalSessions} sessions left</strong>
            {p.expiresAt && (
              <span className="mzk-muted mzk-small">
                Expires {toStudio(p.expiresAt).toFormat('d LLL yyyy')}
              </span>
            )}
          </div>

          <div className="mzk-progress">
            <span style={{ width: `${p.totalSessions ? (p.usedSessions / p.totalSessions) * 100 : 0}%` }} />
          </div>

          <p className="mzk-muted mzk-small" style={{ margin: '10px 0 0' }}>
            {p.usedSessions} used so far. Need more sessions or more time? Just ask us.
          </p>
        </div>
      ))}
    </>
  )
}

/** The student's own contact details. Email is absent by design — it is their sign-in identity. */
function ProfileForm({ profile, onSaved }: { profile: StudentProfile; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: profile.name,
    phone: profile.phone,
    marketingOptIn: profile.marketingOptIn ?? false,
  })
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function save(event: FormEvent) {
    event.preventDefault()
    setState('saving')
    setError(null)
    try {
      await widgetApi.updateMe(form)
      setState('saved')
      onSaved()
    } catch (err) {
      setState('idle')
      setError(err instanceof ApiError ? err.message : 'We could not save that. Please try again.')
    }
  }

  return (
    <form className="mzk-panel" onSubmit={save}>
      {error && <div className="mzk-note mzk-note-error">{error}</div>}
      {state === 'saved' && <div className="mzk-note mzk-note-ok">Saved.</div>}

      <label className="mzk-field">
        <span>Your name</span>
        <input value={form.name} required onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </label>

      <label className="mzk-field">
        <span>Phone</span>
        <input
          type="tel"
          inputMode="tel"
          value={form.phone}
          required
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
        />
        <span className="mzk-muted mzk-small">
          So we can reach you quickly if a class changes at short notice.
        </span>
      </label>

      <label className="mzk-field">
        <span>Email</span>
        <input value={profile.email} disabled />
        <span className="mzk-muted mzk-small">
          Your sign-in link and confirmations go here. Ask us if you need it changed.
        </span>
      </label>

      <label className="mzk-row" style={{ gap: 8, marginBottom: 14, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={form.marketingOptIn}
          onChange={(e) => setForm({ ...form, marketingOptIn: e.target.checked })}
        />
        <span className="mzk-small">Email me about upcoming workshops</span>
      </label>

      <button type="submit" className="mzk-btn mzk-btn-primary" disabled={state === 'saving'}>
        {state === 'saving' ? 'Saving…' : 'Save changes'}
      </button>
    </form>
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
  const start = toStudio(row.session.startAt)
  const end = toStudio(row.session.endAt)

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
              <strong>{toStudio(row.rescheduleDeadline!).toFormat('ccc d LLL, h:mm a')}</strong>.
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
          Moving from {toStudio(row.session.startAt).toFormat('ccc d LLL, h:mm a')}.
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
                    {toStudio(option.startAt).toFormat('ccc d LLL')}
                  </span>
                  <span className="mzk-session-meta">
                    {toStudio(option.startAt).toFormat('h:mm a')} ·{' '}
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
function SignInPanel({ embedded = false }: { embedded?: boolean }) {
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
    <Scope embedded={embedded}>
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
    </Scope>
  )
}
