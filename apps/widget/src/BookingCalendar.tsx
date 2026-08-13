import { useEffect, useMemo, useRef, useState } from 'react'
import { DateTime } from 'luxon'
import {
  STUDIO_TZ,
  formatDuration,
  formatTimeRange,
  type PublicCalendarDay,
  type PublicSession,
  toStudio,
} from '@mizuki/shared'
import { Scope } from './Scope.js'
import { hasCourseDetail, widgetApi, type PublicCourse, type StudioContact } from './api.js'
import { CourseDetail } from './CourseDetail.js'
import { BookingDialog } from './BookingDialog.js'

/**
 * "Students see the next 3 months of classes on your site. They click a date, see every session
 * that day with the time, length and places left, and book. Full classes are marked so nobody
 * is disappointed."
 *
 * A hand-built month grid rather than a calendar library: the whole embed has to stay small
 * enough to drop into a WordPress page without slowing it down.
 */
export function BookingCalendar({
  courseSlug,
  logoUrl,
  embedded = false,
  onSeeBookings,
}: {
  courseSlug?: string
  logoUrl?: string
  /** True when rendered inside MizukiApp, which already provides the .mzk scope. */
  embedded?: boolean
  onSeeBookings?: () => void
}) {
  const [days, setDays] = useState<PublicCalendarDay[] | null>(null)
  const [courses, setCourses] = useState<PublicCourse[]>([])
  const [studio, setStudio] = useState<StudioContact | null>(null)
  /* The course being read about, plus the class it was opened from so Book can carry straight on. */
  const [learning, setLearning] = useState<{ course: PublicCourse; session: PublicSession } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [monthOffset, setMonthOffset] = useState(0)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [booking, setBooking] = useState<PublicSession | null>(null)

  const today = useMemo(() => DateTime.now().setZone(STUDIO_TZ).startOf('day'), [])

  /*
   * Bring the chosen day's classes into view.
   *
   * On a laptop the month grid fills the window and the class list opens underneath it, so
   * clicking a date looked like it had done nothing at all — the one thing that changed was off
   * the bottom of the screen. Moving focus as well as scrolling means a keyboard or screen-reader
   * user is taken to the classes too, rather than being left up in the grid.
   */
  const dayTitleRef = useRef<HTMLHeadingElement | null>(null)

  useEffect(() => {
    if (!selectedDate) return
    const el = dayTitleRef.current
    if (!el) return
    if (el.getBoundingClientRect().bottom > window.innerHeight) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
    el.focus({ preventScroll: true })
  }, [selectedDate])

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const [calendar, courseList] = await Promise.all([widgetApi.calendar(), widgetApi.courses()])
        if (cancelled) return

        const filtered = courseSlug
          ? courseList.courses.filter((c) => c.slug === courseSlug)
          : courseList.courses
        const allowed = new Set(filtered.map((c) => c.id))

        setCourses(filtered)
        setStudio(courseList.studio ?? null)
        setDays(
          courseSlug
            ? calendar.days.map((d) => ({ ...d, sessions: d.sessions.filter((s) => allowed.has(s.courseTypeId)) }))
            : calendar.days,
        )
      } catch {
        if (!cancelled) setError('We could not load the class calendar just now. Please refresh the page.')
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [courseSlug])

  const byDate = useMemo(() => new Map((days ?? []).map((d) => [d.date, d])), [days])

  /** How far ahead the studio has published — the "next 3 months" bound. */
  const lastDate = days && days.length > 0 ? days[days.length - 1]?.date : undefined
  const monthCursor = today.plus({ months: monthOffset }).startOf('month')
  const canGoBack = monthOffset > 0
  const canGoForward = lastDate ? monthCursor.plus({ months: 1 }) <= DateTime.fromISO(lastDate, { zone: STUDIO_TZ }) : false

  const cells = useMemo(() => buildMonthCells(monthCursor), [monthCursor])

  const selectedDay = selectedDate ? byDate.get(selectedDate) : null

  if (error) {
    return (
      <Scope embedded={embedded}>
        <div className="mzk-note mzk-note-error">{error}</div>
      </Scope>
    )
  }

  if (!days) {
    return (
      <Scope embedded={embedded}>
        <div className="mzk-panel"><div className="mzk-empty">Loading classes…</div></div>
      </Scope>
    )
  }

  return (
    <Scope embedded={embedded}>
      {/* Optional: the page usually has the studio's branding already, so this is off by default. */}
      {logoUrl && (
        <div className="mzk-brandbar">
          <img src={logoUrl} alt="Mizuki Flora" width={34} height={34} />
          <span>Choose a date to see the classes running that day.</span>
        </div>
      )}

      <div className="mzk-panel">
        <div className="mzk-cal-head">
          <h2 className="mzk-month">{monthCursor.toFormat('LLLL yyyy')}</h2>
          <div className="mzk-nav">
            <button onClick={() => setMonthOffset((m) => m - 1)} disabled={!canGoBack} aria-label="Previous month">←</button>
            <button onClick={() => setMonthOffset((m) => m + 1)} disabled={!canGoForward} aria-label="Next month">→</button>
          </div>
        </div>

        <div className="mzk-grid" role="grid">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
            <div className="mzk-dow" key={d}>{d}</div>
          ))}

          {cells.map((cell, index) => {
            if (!cell) return <div className="mzk-day outside" key={`pad-${index}`} />

            const key = cell.toFormat('yyyy-MM-dd')
            const day = byDate.get(key)
            const isPast = cell < today
            const hasClasses = (day?.sessions.length ?? 0) > 0
            const isClosed = day?.isClosed ?? false
            // Nothing to open on a day with no classes, so it is not a button you can press.
            const disabled = isPast || !hasClasses

            const dotColours = [...new Set((day?.sessions ?? []).map((s) => s.colour))].slice(0, 3)

            return (
              <button
                key={key}
                className={[
                  'mzk-day',
                  hasClasses ? 'has-classes' : '',
                  selectedDate === key ? 'selected' : '',
                  cell.hasSame(today, 'day') ? 'today' : '',
                  isClosed ? 'closed' : '',
                ].filter(Boolean).join(' ')}
                disabled={disabled}
                onClick={() => setSelectedDate(key)}
                aria-label={`${cell.toFormat('cccc d LLLL')}${hasClasses ? `, ${day!.sessions.length} classes` : isClosed ? ', closed' : ', no classes'}`}
              >
                <span className="mzk-day-num">{cell.day}</span>
                <span className="mzk-dots">
                  {dotColours.map((colour) => (
                    <span className="mzk-dot" key={colour} style={{ background: colour }} />
                  ))}
                </span>
              </button>
            )
          })}
        </div>

        {courses.length > 1 && (
          <div className="mzk-legend">
            {courses.map((c) => (
              <span className="mzk-legend-item" key={c.id}>
                <span className="mzk-dot" style={{ background: c.colour, width: 8, height: 8 }} />
                {c.name}
              </span>
            ))}
          </div>
        )}
      </div>

      {selectedDay && (
        <>
          <h3 className="mzk-day-title" ref={dayTitleRef} tabIndex={-1}>
            {DateTime.fromISO(selectedDay.date, { zone: STUDIO_TZ }).toFormat('cccc d LLLL yyyy')}
          </h3>

          {selectedDay.isClosed ? (
            <div className="mzk-note mzk-note-info">The studio is closed on this day.</div>
          ) : selectedDay.sessions.length === 0 ? (
            <div className="mzk-empty">No classes on this day.</div>
          ) : (
            selectedDay.sessions.map((session) => {
              const course = courses.find((c) => c.id === session.courseTypeId)
              return (
                <SessionRow
                  key={session.id}
                  session={session}
                  onBook={() => setBooking(session)}
                  onLearnMore={
                    hasCourseDetail(course) ? () => setLearning({ course: course!, session }) : undefined
                  }
                />
              )
            })
          )}
        </>
      )}

      {!selectedDay && (
        <p className="mzk-muted mzk-small" style={{ marginTop: 14, textAlign: 'center' }}>
          Pick a highlighted date to see the classes running that day.
        </p>
      )}

      {learning && (
        <CourseDetail
          course={learning.course}
          studio={studio}
          canBook={!learning.session.isFull}
          // Straight from reading about it to booking it, without hunting for the row again.
          onBook={() => {
            setBooking(learning.session)
            setLearning(null)
          }}
          onClose={() => setLearning(null)}
        />
      )}

      {booking && (
        <BookingDialog
          session={booking}
          onClose={() => setBooking(null)}
          onSeeBookings={onSeeBookings}
          onBooked={() => {
            /*
             * Refresh the counts, but leave the dialog open.
             *
             * This used to close it, which unmounted the dialog the instant the booking
             * succeeded — so the confirmation it had just rendered was never on screen. From the
             * student's side a successful booking and a form that silently vanished look
             * identical, and the natural response to that is to book again.
             *
             * The dialog closes when they close it.
             */
            void widgetApi.calendar().then((c) => setDays(c.days))
          }}
        />
      )}
    </Scope>
  )
}


function SessionRow({
  session,
  onBook,
  onLearnMore,
}: {
  session: PublicSession
  onBook: () => void
  /** Absent when the studio has written nothing about this course yet. */
  onLearnMore?: () => void
}) {
  const start = toStudio(session.startAt)
  const end = toStudio(session.endAt)
  const low = session.seatsLeft > 0 && session.seatsLeft <= 2

  /*
   * The row is the card; the things inside it are separate controls.
   *
   * It used to be one button wrapping everything, which cannot hold a second button — the browser
   * drops a nested one. Putting "Learn more" outside the button instead left it stranded past the
   * card's edge, floating in the margin. So the border, background and hover move up to the row,
   * and the booking button becomes the transparent area that fills most of it.
   */
  return (
    <div className={session.isFull ? 'mzk-session-row is-full' : 'mzk-session-row'}>
      <button className="mzk-session" onClick={onBook} disabled={session.isFull}>
        <span className="mzk-stripe" style={{ background: session.colour }} />
        <span className="mzk-session-main">
          <span className="mzk-session-title">{session.title}</span>
          <span className="mzk-session-meta">
            {formatTimeRange(start.toJSDate(), end.toJSDate())} · {formatDuration(session.durationMins)}
            {session.breaks.length > 0 && ` · includes a break`}
          </span>
        </span>
      </button>

      {onLearnMore && (
        <button
          type="button"
          className="mzk-learn"
          onClick={onLearnMore}
          // The visible words are the same on every row, so the class has to be named for anyone
          // who navigates by button.
          aria-label={`Learn more about ${session.courseName}`}
        >
          Learn more
        </button>
      )}

      {/* Outside the button so "Learn more" can sit before it, where the eye already is. */}
      <span className="mzk-session-right">
        {session.isFull ? (
          <span className="mzk-tag mzk-tag-full">Full</span>
        ) : (
          <span className={`mzk-tag ${low ? 'mzk-tag-low' : 'mzk-tag-ok'}`}>
            {session.seatsLeft} {session.seatsLeft === 1 ? 'place' : 'places'} left
          </span>
        )}
      </span>
    </div>
  )
}

/** Monday-first month grid, padded so the 1st lands under the right weekday. */
function buildMonthCells(month: DateTime): (DateTime | null)[] {
  const first = month.startOf('month')
  const daysInMonth = month.daysInMonth ?? 30
  const leading = first.weekday - 1

  return [
    ...Array.from({ length: leading }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => first.plus({ days: i })),
  ]
}
