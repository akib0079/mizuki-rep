import { useEffect, useRef, useState } from 'react'
import { Scope } from './Scope.js'
import { BookingCalendar } from './BookingCalendar.js'
import { MyBookings } from './MyBookings.js'
import { CourseContact, CoursePrice, CourseSections } from './CourseBody.js'
import { Enrolled, SignIn } from './StudentAccount.js'
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
      {/*
        The course's own colour drives the accents, so IFDA's page and Preserved Flower's page are
        recognisably different pages rather than the same template twice.
      */}
      <article className="mzk-cp" style={{ ['--mzk-course' as string]: course.colour }}>
        <div className={course.imageUrl?.trim() ? 'mzk-cp-hero' : 'mzk-cp-hero mzk-cp-hero-plain'}>
          {course.imageUrl?.trim() && (
            <div className="mzk-cp-figure">
              <img
                className="mzk-cp-img"
                src={course.imageUrl}
                alt=""
                onError={(e) => {
                  // Take the frame with it, or an empty box holds the column open.
                  const figure = e.currentTarget.parentElement
                  if (figure) figure.style.display = 'none'
                }}
              />
            </div>
          )}

          <header className="mzk-cp-intro">
            <p className="mzk-cp-eyebrow">Course</p>
            <h2 className="mzk-cp-title">{course.name}</h2>
            {course.description?.trim() && <p className="mzk-cp-lede">{course.description}</p>}
            <CoursePrice course={course} framed />
          </header>
        </div>

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
