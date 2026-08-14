import { useEffect, useRef, useState } from 'react'
import { DateTime } from 'luxon'
import { STUDIO_TZ } from '@mizuki/shared'
import { Scope } from './Scope.js'
import { BookingCalendar } from './BookingCalendar.js'
import { MyBookings } from './MyBookings.js'
import { CourseContact, CoursePrice, CourseSections } from './CourseBody.js'
import { widgetApi, type PackageRow, type PublicCourse, type StudentProfile, type StudioContact } from './api.js'

/**
 * A course's own page: what it is, then a way to book it.
 *
 * It reads the same to everybody. The first version put signing in in front of the whole page, so
 * anyone not already enrolled — including a student who had simply been logged out — met an email
 * box and no way to find out what IFDA even was. The course comes first now, exactly as it appears
 * in "Learn more" elsewhere, and signing in is a block further down for the people it applies to.
 *
 * Written against a course slug rather than IFDA specifically, because Preserved Flower is sold
 * the same way and will want the same page.
 */

export function CoursePortal({ courseSlug }: { courseSlug: string }) {
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [course, setCourse] = useState<PublicCourse | null>(null)
  const [studio, setStudio] = useState<StudioContact | null>(null)
  /** Null while signed out — an ordinary state here, not a failure. */
  const [student, setStudent] = useState<StudentProfile | null>(null)
  const [packages, setPackages] = useState<PackageRow[]>([])
  const [showing, setShowing] = useState<'none' | 'calendar' | 'lessons'>('none')

  const revealRef = useRef<HTMLDivElement | null>(null)

  async function load() {
    try {
      const courses = await widgetApi.courses()
      setCourse(courses.courses.find((c) => c.slug === courseSlug) ?? null)
      setStudio(courses.studio ?? null)
    } catch {
      setFailed(true)
      setLoading(false)
      return
    }

    /*
     * Whether they are signed in is a separate question, asked separately.
     *
     * A 401 here is the normal case for a visitor, so it must not take the course down with it —
     * this page has to work for somebody who has never heard of the studio.
     */
    try {
      const me = await widgetApi.me()
      setStudent(me.student)
      setPackages(me.packages)
    } catch {
      setStudent(null)
      setPackages([])
    }
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [courseSlug])

  /** This course's package, if they hold one. */
  const pkg = course ? packages.find((p) => p.courseTypeId === course.id && p.status === 'active') ?? null : null

  // Bring what opened into view, or on a long page nothing appears to have happened.
  useEffect(() => {
    if (showing === 'none') return
    const el = revealRef.current
    if (el && el.getBoundingClientRect().top > window.innerHeight - 120) {
      el.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }
  }, [showing])

  if (loading) {
    return (
      <Scope>
        <div className="mzk-panel"><div className="mzk-empty">Loading…</div></div>
      </Scope>
    )
  }

  if (failed || !course) {
    return (
      <Scope>
        <div className="mzk-note mzk-note-error">
          We could not load this course just now. Please refresh the page.
        </div>
      </Scope>
    )
  }

  return (
    <Scope>
      <article className="mzk-cp">
        {course.imageUrl?.trim() && (
          <img
            className="mzk-cp-img"
            src={course.imageUrl}
            alt=""
            onError={(e) => (e.currentTarget.style.display = 'none')}
          />
        )}

        <header className="mzk-cp-head">
          <span className="mzk-course-dot" style={{ background: course.colour }} aria-hidden />
          <h2 className="mzk-cp-title">{course.name}</h2>
        </header>

        {course.description?.trim() && <p className="mzk-cp-lede">{course.description}</p>}
        <CoursePrice course={course} />
        <CourseSections course={course} />

        {/*
          The one action on the page, and the same button whether or not they are signed in.
          Somebody not signed in can still open the calendar and see what runs when — being asked
          to log in before you are allowed to look is what sends people away.
        */}
        <div className="mzk-cp-cta">
          <button
            type="button"
            className="mzk-btn mzk-btn-primary mzk-btn-lg"
            onClick={() => setShowing((s) => (s === 'calendar' ? 'none' : 'calendar'))}
          >
            {/* No course name in here: "Book a IFDA lesson" is wrong, "an IFDA" is right, and
                the name is data — the same article trap as the empty-package notice. The heading
                directly above already says which course this is. */}
            {showing === 'calendar' ? 'Hide the calendar' : 'Book a lesson'}
          </button>

          {student && (
            <button
              type="button"
              className="mzk-btn"
              onClick={() => setShowing((s) => (s === 'lessons' ? 'none' : 'lessons'))}
            >
              {showing === 'lessons' ? 'Hide my lessons' : 'My lessons'}
            </button>
          )}
        </div>

        <div ref={revealRef}>
          {/*
            No payment step anywhere: this course is booked against a package, so the server
            confirms the place and takes one lesson off the balance as soon as a date is chosen.
          */}
          {showing === 'calendar' && <BookingCalendar courseSlug={courseSlug} embedded />}
          {showing === 'lessons' && <MyBookings embedded />}
        </div>

        {/*
          The account block. Below the course rather than in front of it: it is what a student who
          has already paid needs, and nothing at all to a visitor still reading.
        */}
        {student ? (
          <Enrolled
            student={student}
            pkg={pkg}
            courseName={course.name}
            onSignedOut={() => {
              setStudent(null)
              setPackages([])
              setShowing('none')
            }}
          />
        ) : (
          <SignIn courseName={course.name} onSignedIn={() => void load()} />
        )}

        <CourseContact studio={studio} />
      </article>
    </Scope>
  )
}

/** The signed-in block: who they are, what they have left, and how long they have to use it. */
function Enrolled({
  student,
  pkg,
  courseName,
  onSignedOut,
}: {
  student: StudentProfile
  pkg: PackageRow | null
  courseName: string
  onSignedOut: () => void
}) {
  const [busy, setBusy] = useState(false)

  return (
    <section className="mzk-cp-account">
      <div className="mzk-portal-head">
        <div className="mzk-portal-who">
          Hi <strong>{student.email}</strong>
        </div>
        <button
          type="button"
          className="mzk-linkbtn"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            await widgetApi.signOut()
            onSignedOut()
          }}
        >
          {busy ? 'Signing out…' : 'Not you? Sign out'}
        </button>
      </div>

      {pkg ? (
        <div className="mzk-portal-summary">
          {/*
            One large number. "4 lessons left" beside "4 of 8 used" set two figures of equal weight
            next to each other, which at a glance reads as "4 4" — and only the first governs what
            they can do. Used is the same fact from the other side, so it becomes a bar.
          */}
          <div className="mzk-portal-figure">
            <span className="mzk-portal-num">{pkg.remaining}</span>
            <span className="mzk-portal-label">
              {pkg.remaining === 1 ? 'lesson left' : 'lessons left'}
            </span>
          </div>

          <div className="mzk-portal-track">
            <div className="mzk-portal-bar" aria-hidden>
              <span
                style={{ width: `${pkg.totalSessions ? (pkg.usedSessions / pkg.totalSessions) * 100 : 0}%` }}
              />
            </div>
            <div className="mzk-portal-track-meta">
              <span>
                {pkg.usedSessions} of {pkg.totalSessions} used
              </span>
              <span>{coursePeriod(pkg.startsAt, pkg.expiresAt)}</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="mzk-note mzk-note-info">
          {/* No article: "a IFDA" is wrong, "an IFDA" is right, and the course name is data. */}
          There is no {courseName} course on your account yet. If you have paid for one, please get
          in touch and we will add it.
        </div>
      )}
    </section>
  )
}

/**
 * Signing in, as a block rather than a gate.
 *
 * Only asks for the address they enrolled with. This is not a form for new students — the studio
 * enrols them once the course fee is paid, so there is nothing here to sign up for.
 */
function SignIn({ courseName, onSignedIn }: { courseName: string; onSignedIn: () => void }) {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /* Come back to this page: signing in should not land them on the general booking calendar. */
  const returnTo = `${window.location.origin}${window.location.pathname}${window.location.search}`

  // The link opens in this tab, so the session exists by the time the window is looked at again.
  useEffect(() => {
    const onFocus = () => void onSignedIn()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [onSignedIn])

  return (
    <section className="mzk-cp-account">
      <h3 className="mzk-cp-signin-title">Already taking {courseName}?</h3>
      <p className="mzk-muted mzk-small">
        Your lessons are included in your course fee, so there is nothing to pay. Sign in with the
        email address you enrolled with to book them and see how many you have left.
      </p>

      {sent ? (
        <div className="mzk-note mzk-note-ok">
          If that address is enrolled with us, a sign-in link is on its way. It works once and lasts
          30 minutes — open it on this device and you will land back here.
        </div>
      ) : (
        <>
          <form
            className="mzk-cp-signin-form"
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
            <label className="mzk-field mzk-cp-signin-field">
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
            <button type="submit" className="mzk-btn mzk-btn-primary" disabled={busy}>
              {busy ? 'Sending…' : 'Email me a sign-in link'}
            </button>
          </form>
          <p className="mzk-muted mzk-small">No password needed.</p>
        </>
      )}

      {error && <div className="mzk-note mzk-note-error">{error}</div>}
    </section>
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
