import { useEffect, useState } from 'react'
import { DateTime } from 'luxon'
import { STUDIO_TZ } from '@mizuki/shared'
import { Scope } from './Scope.js'
import { widgetApi, type PackageRow, type StudentProfile } from './api.js'

/**
 * The student's account block: sign in, or what you have left.
 *
 * Lifted out of the course page so it can also stand on its own. On a page built in Elementor the
 * studio decides where this goes — usually under the calendar — and it has to work there without
 * the rest of the course page around it.
 *
 * Two shapes of the same thing. `SignIn` and `Enrolled` take what they need and are used by the
 * course page, which has already loaded the student. `StudentAccount` loads for itself, for when
 * it is dropped on a page alone.
 */

/** The signed-in block: who they are, what they have left, and how long they have to use it. */
export function Enrolled({
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
 *
 * The heading and the sentence under it can be replaced, because on a page the studio has laid
 * out themselves our wording may not be the wording around it.
 */
export function SignIn({
  courseName,
  heading,
  intro,
  onSignedIn,
}: {
  courseName: string
  heading?: string
  intro?: string
  onSignedIn: () => void
}) {
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
      <h3 className="mzk-cp-signin-title">
        {heading || (courseName ? `Already taking ${courseName}?` : 'Already a student?')}
      </h3>
      <p className="mzk-muted mzk-small">
        {intro ||
          'Your lessons are included in your course fee, so there is nothing to pay. Sign in with the email address you enrolled with to book them and see how many you have left.'}
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

/**
 * The block on its own, loading what it needs.
 *
 * Signed out is the ordinary state here, not a failure — most people who see this block have
 * never signed in. So a 401 renders the form rather than an error.
 */
export function StudentAccount({
  courseSlug,
  heading,
  intro,
}: {
  courseSlug?: string
  heading?: string
  intro?: string
}) {
  const [loading, setLoading] = useState(true)
  const [student, setStudent] = useState<StudentProfile | null>(null)
  const [packages, setPackages] = useState<PackageRow[]>([])
  const [courseName, setCourseName] = useState('')
  const [courseId, setCourseId] = useState('')

  async function load() {
    if (courseSlug) {
      try {
        const { courses } = await widgetApi.courses()
        const course = courses.find((c) => c.slug === courseSlug)
        setCourseName(course?.name ?? '')
        setCourseId(course?.id ?? '')
      } catch {
        // A course we cannot name is not a reason to withhold the sign-in form.
        setCourseName('')
        setCourseId('')
      }
    }

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

  if (loading) {
    return (
      <Scope>
        <div className="mzk-panel"><div className="mzk-empty">Loading…</div></div>
      </Scope>
    )
  }

  const pkg = courseId
    ? packages.find((p) => p.courseTypeId === courseId && p.status === 'active') ?? null
    : packages.find((p) => p.status === 'active') ?? null

  return (
    <Scope>
      {student ? (
        <Enrolled
          student={student}
          pkg={pkg}
          courseName={courseName || 'that'}
          onSignedOut={() => {
            setStudent(null)
            setPackages([])
          }}
        />
      ) : (
        <SignIn courseName={courseName} heading={heading} intro={intro} onSignedIn={() => void load()} />
      )}
    </Scope>
  )
}

/** The period in the words a student would use, saying only what is actually set. */
export function coursePeriod(startsAt: string | null, expiresAt: string | null): string {
  const fmt = (iso: string) => DateTime.fromISO(iso).setZone(STUDIO_TZ).toFormat('d LLL yyyy')
  if (startsAt && expiresAt) return `${fmt(startsAt)} – ${fmt(expiresAt)}`
  if (expiresAt) return `Finish by ${fmt(expiresAt)}`
  if (startsAt) return `From ${fmt(startsAt)}`
  return 'No end date'
}
