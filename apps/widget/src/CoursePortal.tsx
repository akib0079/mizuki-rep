import { useEffect, useState } from 'react'
import { DateTime } from 'luxon'
import { STUDIO_TZ } from '@mizuki/shared'
import { Scope } from './Scope.js'
import { BookingCalendar } from './BookingCalendar.js'
import { MyBookings } from './MyBookings.js'
import { widgetApi, type PackageRow, type PublicCourse, type StudentProfile } from './api.js'

/**
 * A page for students who have already paid for a course.
 *
 * The ordinary booking page is built for someone who has not decided yet: it shows every course,
 * asks who you are, and arranges payment. None of that applies here. An IFDA student paid for the
 * whole course months ago; what they need is their balance, their dates, and a way to put a lesson
 * in the diary — so this leads with the balance and hides everything else behind one button.
 *
 * Written against a course slug rather than IFDA specifically, because Preserved Flower is sold
 * the same way and will want the same page.
 */

export function CoursePortal({ courseSlug }: { courseSlug: string }) {
  const [state, setState] = useState<'loading' | 'signed-out' | 'ready' | 'error'>('loading')
  const [student, setStudent] = useState<StudentProfile | null>(null)
  const [packages, setPackages] = useState<PackageRow[]>([])
  const [course, setCourse] = useState<PublicCourse | null>(null)
  const [booking, setBooking] = useState(false)
  const [showingBookings, setShowingBookings] = useState(false)

  async function load() {
    try {
      const courses = await widgetApi.courses()
      const found = courses.courses.find((c) => c.slug === courseSlug) ?? null
      setCourse(found)

      const me = await widgetApi.me()
      setStudent(me.student)
      setPackages(me.packages)
      setState('ready')
    } catch (err) {
      // 401 is the ordinary case here, not a failure — nobody has signed in yet.
      setState((err as { status?: number }).status === 401 ? 'signed-out' : 'error')
    }
  }

  useEffect(() => {
    void load()
  }, [courseSlug])

  /** This course's package, if they hold one. */
  const pkg = course ? packages.find((p) => p.courseTypeId === course.id && p.status === 'active') ?? null : null
  const courseName = course?.name ?? 'your course'

  if (state === 'loading') {
    return (
      <Scope>
        <div className="mzk-panel"><div className="mzk-empty">Loading…</div></div>
      </Scope>
    )
  }

  if (state === 'error') {
    return (
      <Scope>
        <div className="mzk-note mzk-note-error">
          We could not load your course just now. Please refresh the page.
        </div>
      </Scope>
    )
  }

  if (state === 'signed-out') {
    return (
      <Scope>
        <SignIn courseName={courseName} onSignedIn={() => void load()} />
      </Scope>
    )
  }

  return (
    <Scope>
      <div className="mzk-portal-head">
        <div className="mzk-portal-who">
          Hi <strong>{student?.email}</strong>
        </div>
        <button
          type="button"
          className="mzk-linkbtn"
          onClick={async () => {
            await widgetApi.signOut()
            setState('signed-out')
            setStudent(null)
            setBooking(false)
          }}
        >
          Not you? Sign out
        </button>
      </div>

      {/*
        The balance is the headline, because it is the only number that governs what they can do.
        A student with none left needs to know that before they open a calendar and pick a date.
      */}
      {pkg ? (
        <div className="mzk-portal-summary">
          <div className="mzk-portal-figure">
            <span className="mzk-portal-num">{pkg.remaining}</span>
            <span className="mzk-portal-label">
              {pkg.remaining === 1 ? 'lesson left' : 'lessons left'}
            </span>
          </div>
          <div className="mzk-portal-figure">
            <span className="mzk-portal-num">{pkg.usedSessions}</span>
            <span className="mzk-portal-label">of {pkg.totalSessions} used</span>
          </div>
          <div className="mzk-portal-period">{coursePeriod(pkg.startsAt, pkg.expiresAt)}</div>
        </div>
      ) : (
        <div className="mzk-note mzk-note-info">
          We do not have a {courseName} course on your account yet. If you have paid for one,
          please get in touch and we will add it.
        </div>
      )}

      <div className="mzk-portal-actions">
        {/*
          One button, as the studio asked. The calendar is not on screen until it is pressed —
          which keeps the page about "you have 18 lessons left" rather than about a grid.
        */}
        <button
          type="button"
          className="mzk-btn mzk-btn-primary mzk-btn-lg"
          onClick={() => {
            setBooking((b) => !b)
            setShowingBookings(false)
          }}
        >
          {booking ? 'Hide the calendar' : 'Book a lesson'}
        </button>
        <button
          type="button"
          className="mzk-btn"
          onClick={() => {
            setShowingBookings((s) => !s)
            setBooking(false)
          }}
        >
          {showingBookings ? 'Hide my lessons' : 'My lessons'}
        </button>
      </div>

      {pkg && pkg.remaining === 0 && booking && (
        <div className="mzk-note mzk-note-info">
          You have used all {pkg.totalSessions} lessons on this course. Get in touch if you would
          like more — you can still look at the dates below.
        </div>
      )}

      {/*
        No payment step anywhere in here: this course is booked with a package, so the server
        confirms the place and takes one lesson off the balance as soon as they choose a date.
      */}
      {booking && <BookingCalendar courseSlug={courseSlug} embedded />}
      {showingBookings && <MyBookings embedded />}
    </Scope>
  )
}

/**
 * Signing in.
 *
 * Deliberately not the general "book a class" form: this page is only for people the studio has
 * already enrolled, so there is nothing to fill in but the address they were enrolled with.
 */
function SignIn({ courseName, onSignedIn }: { courseName: string; onSignedIn: () => void }) {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /*
   * Come back to this page, not the general booking page.
   *
   * The link carries where to return to, so a student who signs in from here lands back on their
   * own course rather than on the calendar of everything the studio teaches.
   */
  const returnTo = `${window.location.origin}${window.location.pathname}${window.location.search}`

  // The link opens in this tab and the session cookie is set by then, so a reload signs them in.
  useEffect(() => {
    const onFocus = () => void onSignedIn()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [onSignedIn])

  return (
    <div className="mzk-panel mzk-portal-signin">
      <h2 className="mzk-portal-title">{courseName} students</h2>
      <p className="mzk-muted">
        Your lessons are included in your course fee, so there is nothing to pay here. Sign in with
        the email address you enrolled with and book whichever dates suit you.
      </p>

      {sent ? (
        <div className="mzk-note mzk-note-ok">
          If that address is enrolled with us, a sign-in link is on its way. It works once and
          lasts 30 minutes — open it on this device and you will land back here.
        </div>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            if (!email.trim()) return
            setBusy(true)
            setError(null)
            try {
              await widgetApi.requestMagicLink(email.trim(), returnTo)
              setSent(true)
            } catch {
              setError('We could not send that just now. Please try again in a moment.')
            } finally {
              setBusy(false)
            }
          }}
        >
          <label className="mzk-field">
            <span>Email</span>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              placeholder="you@example.com"
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>

          {error && <div className="mzk-note mzk-note-error">{error}</div>}

          <button type="submit" className="mzk-btn mzk-btn-primary" disabled={busy}>
            {busy ? 'Sending…' : 'Email me a sign-in link'}
          </button>
          <p className="mzk-muted mzk-small" style={{ marginTop: 10 }}>
            No password needed.
          </p>
        </form>
      )}
    </div>
  )
}

/** The period in the words a student would use, saying only what is actually set. */
function coursePeriod(startsAt: string | null, expiresAt: string | null): string {
  const fmt = (iso: string) => DateTime.fromISO(iso).setZone(STUDIO_TZ).toFormat('d LLL yyyy')
  if (startsAt && expiresAt) return `${fmt(startsAt)} – ${fmt(expiresAt)}`
  if (expiresAt) return `Finish by ${fmt(expiresAt)}`
  if (startsAt) return `From ${fmt(startsAt)}`
  return 'No end date'
}
