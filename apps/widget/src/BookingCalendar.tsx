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
  /**
   * Courses the student has chosen to see. Empty means all of them.
   *
   * Empty rather than "every id selected" so the default survives the studio adding a course:
   * a set built at load time would silently exclude anything published afterwards.
   */
  const [chosenCourses, setChosenCourses] = useState<Set<string>>(new Set())

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

  /**
   * Only the courses that actually have classes published.
   *
   * Offering a filter for a course with nothing on the calendar is a promise the calendar cannot
   * keep — the student picks it and gets an empty three months. It doubles as the colour key,
   * which is what this row replaced: a course with no classes has no dots to explain either.
   */
  const filterable = useMemo(() => {
    const withClasses = new Set((days ?? []).flatMap((d) => d.sessions.map((s) => s.courseTypeId)))
    return courses.filter((c) => withClasses.has(c.id))
  }, [courses, days])

  /** The calendar as the student has asked to see it. Everything below reads this, not `days`. */
  const visibleDays = useMemo(() => {
    if (chosenCourses.size === 0) return days ?? []
    return (days ?? []).map((d) => ({
      ...d,
      sessions: d.sessions.filter((session) => chosenCourses.has(session.courseTypeId)),
    }))
  }, [days, chosenCourses])

  const byDate = useMemo(() => new Map(visibleDays.map((d) => [d.date, d])), [visibleDays])

  /*
   * Let go of a day the filter has just emptied.
   *
   * Keeping it selected leaves "No classes on this day" under a date that plainly does have
   * classes — they are simply not the course being asked for — which reads as the calendar being
   * wrong rather than as a filter doing its job.
   */
  useEffect(() => {
    if (!selectedDate) return
    if ((byDate.get(selectedDate)?.sessions.length ?? 0) === 0) setSelectedDate(null)
  }, [byDate, selectedDate])

  /**
   * How far ahead the studio has published — the "next 3 months" bound.
   *
   * Taken from the unfiltered calendar on purpose: how far you may page forward is a property of
   * the studio's timetable, not of what is being shown, and reading it from the filtered set
   * would strand a student on September the moment they picked a course that runs in November.
   */
  const lastDate = days && days.length > 0 ? days[days.length - 1]?.date : undefined
  const monthCursor = today.plus({ months: monthOffset }).startOf('month')
  const canGoBack = monthOffset > 0
  const canGoForward = lastDate ? monthCursor.plus({ months: 1 }) <= DateTime.fromISO(lastDate, { zone: STUDIO_TZ }) : false

  const cells = useMemo(() => buildMonthCells(monthCursor), [monthCursor])

  /** Nothing to click anywhere in the month being shown. */
  const monthIsEmpty = cells.every((cell) => {
    if (!cell) return true
    return (byDate.get(cell.toFormat('yyyy-MM-dd'))?.sessions.length ?? 0) === 0
  })

  /** "Ikebana", or "Ikebana and Bouquet" — the filter named back in the student's own terms. */
  const chosenLabel = courses
    .filter((c) => chosenCourses.has(c.id))
    .map((c) => c.name)
    .join(' or ')

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
          <div className="mzk-cal-tools">
            {filterable.length > 1 && (
              <CourseFilter courses={filterable} chosen={chosenCourses} onChange={setChosenCourses} />
            )}
            <div className="mzk-nav">
              <button onClick={() => setMonthOffset((m) => m - 1)} disabled={!canGoBack} aria-label="Previous month">←</button>
              <button onClick={() => setMonthOffset((m) => m + 1)} disabled={!canGoForward} aria-label="Next month">→</button>
            </div>
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

        {/*
          Said under the grid rather than left to be worked out from an empty month. A student who
          filters to Ikebana in a month with none sees a blank calendar and no reason for it.
        */}
        {monthIsEmpty && chosenCourses.size > 0 && (
          <p className="mzk-filter-empty">
            No {chosenLabel} classes in {monthCursor.toFormat('LLLL')}.
            {canGoForward ? ' Try the next month.' : ''}
          </p>
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


/**
 * Pick the courses worth showing.
 *
 * This replaced the colour key that used to sit under the grid. The key already listed every
 * course beside its dot and was the natural place to look for "show me only Ikebana" — it simply
 * did not do anything when pressed.
 *
 * A dropdown rather than a row of chips, because the studio runs five courses and a chip each
 * wraps to three lines on a phone — pushing the calendar itself below the fold on the one screen
 * where it matters most. Closed, this is a single control; open, it is the same list with the
 * same dots.
 *
 * Hand-built rather than a `<select>`: a native option list cannot carry the colour that ties
 * each course to the dots on the grid, and it cannot hold more than one choice without becoming
 * a multi-select box, which on a phone is a scrolling list nobody recognises.
 *
 * Multi-select, with nothing chosen meaning everything. A student comparing two courses can hold
 * both on screen, and there is no separate "all" state to get out of sync — clearing the
 * selection is the same thing as showing everything.
 */
function CourseFilter({
  courses,
  chosen,
  onChange,
}: {
  courses: PublicCourse[]
  chosen: Set<string>
  onChange: (next: Set<string>) => void
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  const picked = courses.filter((c) => chosen.has(c.id))

  /*
   * Closing it. A panel that stays open after you have chosen — or after you have clicked away —
   * covers the first week of the calendar, which is the part most people are looking at.
   */
  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: MouseEvent) => {
      /*
       * composedPath, not `contains(event.target)`.
       *
       * The widget renders inside a shadow root, and an event that escapes one is retargeted to
       * the host element — so `event.target` for a click on an option in here is the host div,
       * which the wrapper does not contain. The check would have been true for every click
       * including the ones inside the menu, closing it before the option's own handler ran, and
       * the menu would have looked like it did nothing at all. The composed path is the real
       * one, shadow boundaries included.
       */
      if (!event.composedPath().includes(wrapRef.current as EventTarget)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      // Back to the button that opened it, or focus is left on an element that no longer exists.
      triggerRef.current?.focus()
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  function toggle(id: string) {
    const next = new Set(chosen)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange(next)
  }

  /** What the closed control says it is showing. */
  const label =
    picked.length === 0
      ? 'All classes'
      : picked.length === 1
        ? picked[0]!.name
        : `${picked.length} courses`

  return (
    <div className="mzk-filter" ref={wrapRef}>
      <button
        type="button"
        ref={triggerRef}
        className={open || picked.length > 0 ? 'mzk-filter-btn is-on' : 'mzk-filter-btn'}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        {/*
          The dots stay on the closed control, so what is being shown is readable at a glance and
          still tied to the colours on the grid. Capped at three: past that they stop being
          distinguishable and start being a smudge.
        */}
        {picked.length > 0 && (
          <span className="mzk-filter-dots" aria-hidden="true">
            {picked.slice(0, 3).map((c) => (
              <span className="mzk-chip-dot" key={c.id} style={{ background: c.colour }} />
            ))}
          </span>
        )}
        <span className="mzk-filter-label">{label}</span>
        <span className={open ? 'mzk-filter-caret is-open' : 'mzk-filter-caret'} aria-hidden="true">
          <svg viewBox="0 0 12 12" width="11" height="11" focusable="false">
            <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>

      {open && (
        <div className="mzk-filter-menu" role="listbox" aria-multiselectable="true" aria-label="Show only certain courses">
          <button
            type="button"
            role="option"
            aria-selected={chosen.size === 0}
            className={chosen.size === 0 ? 'mzk-filter-opt is-on' : 'mzk-filter-opt'}
            onClick={() => {
              onChange(new Set())
              setOpen(false)
            }}
          >
            <span className="mzk-filter-tick" aria-hidden="true">{chosen.size === 0 ? '✓' : ''}</span>
            <span className="mzk-filter-opt-name">All classes</span>
          </button>

          {courses.map((course) => {
            const on = chosen.has(course.id)
            return (
              <button
                type="button"
                key={course.id}
                role="option"
                aria-selected={on}
                className={on ? 'mzk-filter-opt is-on' : 'mzk-filter-opt'}
                // Stays open on a course, so two can be picked in a row; "All classes" closes it
                // because there is nothing left to add.
                onClick={() => toggle(course.id)}
              >
                <span className="mzk-filter-tick" aria-hidden="true">{on ? '✓' : ''}</span>
                <span className="mzk-chip-dot" style={{ background: course.colour }} />
                <span className="mzk-filter-opt-name">{course.name}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
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

  /*
   * A state, not a count.
   *
   * The studio asked for Available, Not available or Full instead of "8 places left". The number
   * was doing two jobs — telling a student whether they could book, and telling them how popular
   * the class was — and only the first is any of their business. It also meant a class with
   * places withheld for chat bookings read as "Full", which sends someone looking elsewhere when
   * a phone call would have got them in.
   */
  const availability = session.availability ?? (session.isFull ? 'full' : 'available')
  const label =
    availability === 'available' ? 'Available' : availability === 'full' ? 'Full' : 'Not available'
  const tone =
    availability === 'available' ? 'mzk-tag-ok' : availability === 'full' ? 'mzk-tag-full' : 'mzk-tag-off'

  /*
   * The row is the card; the things inside it are separate controls.
   *
   * It used to be one button wrapping everything, which cannot hold a second button — the browser
   * drops a nested one. Putting "Learn more" outside the button instead left it stranded past the
   * card's edge, floating in the margin. So the border, background and hover move up to the row,
   * and the booking button becomes the transparent area that fills most of it.
   */
  return (
    <div className={availability === 'available' ? 'mzk-session-row' : 'mzk-session-row is-full'}>
      <button className="mzk-session" onClick={onBook} disabled={availability !== 'available'}>
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
          {/* An information mark, so the pill reads as "details" before the words are read. */}
          <svg className="mzk-learn-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden focusable="false">
            <circle cx="8" cy="8" r="6.7" fill="none" stroke="currentColor" strokeWidth="1.3" />
            <circle cx="8" cy="4.9" r="0.95" fill="currentColor" />
            <path d="M8 7.3v4.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          Learn more
        </button>
      )}

      {/* Outside the button so "Learn more" can sit before it, where the eye already is. */}
      <span className="mzk-session-right">
        <span className={`mzk-tag ${tone}`}>{label}</span>
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
