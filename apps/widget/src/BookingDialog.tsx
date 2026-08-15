import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { DateTime } from 'luxon'
import {
  STUDIO_COUNTRY,
  countryList,
  formatDuration,
  formatInternational,
  formatTimeRange,
  toStudio,
  type PublicSession,
} from '@mizuki/shared'
import { CountryFlag } from './CountryFlag.js'
import { ApiError, widgetApi, type StartBookingResult, type StudentProfile } from './api.js'

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
  onSeeBookings,
}: {
  session: PublicSession
  onClose: () => void
  onBooked: () => void
  /** Offered after a successful booking, so the next step is one click rather than a hunt. */
  onSeeBookings?: () => void
}) {
  const [form, setForm] = useState({ name: '', email: '', phone: '', phoneCountry: '', notes: '', attendeeName: '' })
  /** Ticked when the number is not Singaporean, which swaps in the country picker. */
  const [abroad, setAbroad] = useState(false)

  // Built once: two hundred entries and an Intl lookup each is not work to repeat on every keystroke.
  const countries = useMemo(() => countryList(), [])
  const dialPreview = useMemo(
    () => formatInternational(form.phoneCountry || STUDIO_COUNTRY, form.phone || '…'),
    [form.phoneCountry, form.phone],
  )
  const [bookingForSomeoneElse, setBookingForSomeoneElse] = useState(false)
  /** Set when they have seen a possible duplicate and told us it is not them. */
  const [confirmedNewAccount, setConfirmedNewAccount] = useState(false)
  const [busy, setBusy] = useState(false)
  const [linkSent, setLinkSent] = useState(false)

  /*
   * Whether this person is already signed in.
   *
   * It changes the form completely: a signed-in student is asked only what is different about
   * this booking, because the server takes their identity from the session and ignores anything
   * the form sends. Asking again would be a chance for the two to disagree — which is how one
   * person ended up on the register under three names.
   */
  const [account, setAccount] = useState<StudentProfile | null | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    widgetApi
      .me()
      .then((r) => !cancelled && setAccount(r.student))
      .catch(() => !cancelled && setAccount(null))
    return () => {
      cancelled = true
    }
  }, [])
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
      const attendeeName = bookingForSomeoneElse ? form.attendeeName.trim() : ''

      const outcome = await widgetApi.startBooking(
        account
          ? { sessionId: session.id, notes: form.notes.trim(), attendeeName }
          : {
              sessionId: session.id,
              name: form.name.trim(),
              email: form.email.trim(),
              /*
               * Sent international when it is not Singaporean, so the studio can dial it as
               * written and the duplicate check compares like with like.
               */
              phone: abroad
                ? formatInternational(form.phoneCountry || STUDIO_COUNTRY, form.phone.trim())
                : form.phone.trim(),
              phoneCountry: abroad ? form.phoneCountry || STUDIO_COUNTRY : '',
              notes: form.notes.trim(),
              attendeeName,
              confirmedNewAccount,
            },
      )
      setResult(outcome)
      // Both of these take a real place, so the calendar's counts are now stale either way.
      // A held place is as unavailable to the next student as a confirmed one.
      if (outcome.outcome === 'booked' || outcome.outcome === 'awaiting_confirmation') onBooked()
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
          <BookingOutcome
            result={result}
            session={session}
            onClose={onClose}
            onSeeBookings={onSeeBookings}
            onNotMe={() => {
              // Only a near miss can be got past this way; an exact match ignores the flag.
              setConfirmedNewAccount(true)
              setResult(null)
            }}
          />
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
              {account ? (
                /*
                 * Signed in, so we already know who they are. Asking again would only invite the
                 * form and the account to disagree — and the server ignores these fields anyway.
                 */
                <div className="mzk-note mzk-note-info" style={{ marginBottom: 12 }}>
                  Booking as <strong>{account.name}</strong> ({account.email})
                </div>
              ) : (
                <>
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

                  {/*
                    Singapore by default, with a way out.
                    
                    Nearly every student is local, so the plain field is what nearly everyone
                    sees. Putting a country picker in front of all of them would tax the many for
                    the few — the tick moves the cost onto the people it applies to.
                  */}
                  {abroad ? (
                    <div className="mzk-field">
                      <span>Phone</span>
                      <div className="mzk-phone-row">
                        {/*
                          Closed, this shows a flag and two letters and nothing else, so the
                          number keeps the line. Open, it has to show two hundred country names,
                          or nobody can find theirs.

                          A native menu cannot do both — it draws whatever the chosen option says.
                          So the select is stretched over this box and made invisible: it still
                          takes the click, still opens the platform's own list with the full names
                          in it, and still gives a phone its scroll wheel. What is drawn is ours.
                        */}
                        <label className="mzk-phone-country">
                          <span className="mzk-sr">Country</span>
                          <select
                            value={form.phoneCountry || STUDIO_COUNTRY}
                            onChange={(e) => setForm({ ...form, phoneCountry: e.target.value })}
                          >
                            {countries.map((c) => (
                              <option key={c.code} value={c.code}>
                                {c.name} ({c.code}) +{c.dial}
                              </option>
                            ))}
                          </select>
                          <span className="mzk-phone-chosen" aria-hidden>
                            <CountryFlag code={form.phoneCountry || STUDIO_COUNTRY} />
                            <span className="mzk-phone-code">{form.phoneCountry || STUDIO_COUNTRY}</span>
                            <svg className="mzk-phone-caret" viewBox="0 0 12 8" width="10" height="7">
                              <path d="M1 1.5 6 6.5 11 1.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </span>
                        </label>
                        <input
                          type="tel"
                          inputMode="tel"
                          className="mzk-phone-number"
                          value={form.phone}
                          required
                          autoComplete="tel-national"
                          aria-label="Phone number"
                          placeholder="Number without the country code"
                          onChange={(e) => setForm({ ...form, phone: e.target.value })}
                        />
                      </div>
                      <span className="mzk-muted mzk-small">
                        We will save it as {dialPreview}. Leave off the leading zero.
                      </span>
                    </div>
                  ) : (
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
                  )}

                  <label className="mzk-check mzk-abroad">
                    <input
                      type="checkbox"
                      checked={abroad}
                      onChange={(e) => {
                        setAbroad(e.target.checked)
                        /*
                         * Clear the number when switching.
                         *
                         * "9123 4567" typed as a Singapore number is not the same number once the
                         * country changes, and carrying it over would quietly produce a wrong one
                         * that looks right.
                         */
                        setForm((f) => ({ ...f, phone: '', phoneCountry: e.target.checked ? '' : '' }))
                      }}
                    />
                    {/* Split so the spacing either side of the flag comes from one gap rather
                        than from a literal space on one side and none on the other. */}
                    <span>
                      {'Not from'}
                      <CountryFlag code={STUDIO_COUNTRY} />
                      {'Singapore?'}
                    </span>
                  </label>
                </>
              )}

              {/*
                One account per email, so a parent booking for a child would otherwise put the
                parent's name on the register. This keeps the account whole and still gets the
                right name onto the day's list.
              */}
              <label className="mzk-check">
                <input
                  type="checkbox"
                  checked={bookingForSomeoneElse}
                  onChange={(e) => setBookingForSomeoneElse(e.target.checked)}
                />
                <span>This place is for someone else</span>
              </label>

              {bookingForSomeoneElse && (
                <label className="mzk-field">
                  <span>Who is coming?</span>
                  <input
                    value={form.attendeeName}
                    required
                    placeholder="Their name"
                    onChange={(e) => setForm({ ...form, attendeeName: e.target.value })}
                  />
                  <span className="mzk-muted mzk-small">
                    We will put this name on the class list. The booking stays on your account.
                  </span>
                </label>
              )}

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
  onSeeBookings,
  onNotMe,
}: {
  result: StartBookingResult
  session: PublicSession
  onClose: () => void
  onSeeBookings?: () => void
  /** "That is not me" — go back to the form and book a genuinely new account. */
  onNotMe: () => void
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
        <div className="mzk-row" style={{ marginTop: 12 }}>
          {onSeeBookings && (
            <button
              type="button"
              className="mzk-btn mzk-btn-primary"
              style={{ flex: 1 }}
              onClick={() => { onClose(); onSeeBookings() }}
            >
              See my bookings
            </button>
          )}
          <button type="button" className="mzk-btn" style={{ flex: 1 }} onClick={onClose}>
            Book another
          </button>
        </div>
      </>
    )
  }

  if (result.outcome === 'awaiting_confirmation') {
    return (
      <>
        <h3>Your place is reserved</h3>
        <div className="mzk-note mzk-note-ok">{result.message}</div>
        <p className="mzk-small">
          We have held this place for you. Nobody else can take it while we sort out your course
          package — you do not need to book again.
        </p>
        <div className="mzk-row" style={{ marginTop: 14 }}>
          {onSeeBookings && (
            <button className="mzk-btn" onClick={onSeeBookings}>
              See my bookings
            </button>
          )}
          <button className="mzk-btn mzk-btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </>
    )
  }

  if (result.outcome === 'sign_in_required') {
    return <SignInRequired result={result} onClose={onClose} />
  }

  if (result.outcome === 'possible_duplicate') {
    return (
      <PossibleDuplicate result={result} onClose={onClose} onNotMe={onNotMe} />
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

/**
 * The address or number is already ours.
 *
 * Not an error, and deliberately not a dead end: the reason we stopped is that we cannot prove
 * this is their inbox, and the sign-in link is exactly how they prove it. Sending it from here
 * means the way out is one press rather than "go and find the other tab".
 */
function SignInRequired({
  result,
  onClose,
}: {
  result: Extract<StartBookingResult, { outcome: 'sign_in_required' }>
  onClose: () => void
}) {
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [failed, setFailed] = useState(false)

  // Only offered when we know the real address. On a phone match it is masked, and a masked
  // address cannot be emailed — they have to type the one they remember.
  const canSend = result.reason === 'email_known'

  async function send() {
    setSending(true)
    setFailed(false)
    try {
      await widgetApi.requestMagicLink(result.email, `${window.location.origin}${window.location.pathname}?tab=bookings`)
      setSent(true)
    } catch {
      setFailed(true)
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <h3>You have booked with us before</h3>
      <p className="mzk-muted mzk-small">{result.message}</p>

      {sent ? (
        <div className="mzk-note mzk-note-ok">
          Check your email — we have sent a sign-in link to <strong>{result.email}</strong>. Open it
          and you can finish booking straight away.
        </div>
      ) : (
        <>
          {failed && (
            <div className="mzk-note mzk-note-error">
              We could not send that link just now. Please try again shortly.
            </div>
          )}

          {canSend ? (
            <button
              type="button"
              className="mzk-btn mzk-btn-primary mzk-btn-block"
              onClick={send}
              disabled={sending}
            >
              {sending && <span className="mzk-spinner" />}
              {sending ? 'Sending…' : `Email a sign-in link to ${result.email}`}
            </button>
          ) : (
            <div className="mzk-note mzk-note-info">
              Open <strong>My bookings</strong> and sign in with that address to carry on.
            </div>
          )}
        </>
      )}

      <div className="mzk-row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
        <button type="button" className="mzk-btn" onClick={onClose}>
          Close
        </button>
      </div>
    </>
  )
}

/**
 * We think they already have an account, but we are guessing.
 *
 * This is the case that actually creates duplicates: gmal for gmail, a letter dropped from the
 * address, the same name typed again. Every field differs, so nothing exact catches it, and the
 * studio ends up with one person spread across three accounts and three course balances.
 *
 * It asks rather than decides, because two people genuinely do share a name. Signing in is the
 * prominent option; carrying on is available and quiet, so the easy path is the right one.
 */
function PossibleDuplicate({
  result,
  onClose,
  onNotMe,
}: {
  result: Extract<StartBookingResult, { outcome: 'possible_duplicate' }>
  onClose: () => void
  onNotMe: () => void
}) {
  return (
    <>
      <h3>You may already have an account</h3>
      <p className="mzk-muted mzk-small">{result.message}</p>

      <div className="mzk-note mzk-note-info">
        Signing in keeps your bookings and any course package together. Booking again under a new
        account splits them, and the studio has to join them back up by hand.
      </div>

      <button
        type="button"
        className="mzk-btn mzk-btn-primary mzk-btn-block"
        onClick={onClose}
        style={{ marginTop: 4 }}
      >
        I will sign in from My bookings
      </button>

      <button type="button" className="mzk-link-btn mzk-block-link" onClick={onNotMe}>
        That is not me — this is my first booking
      </button>
    </>
  )
}
