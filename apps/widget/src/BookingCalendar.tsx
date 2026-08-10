import { useEffect, useMemo, useState } from 'react'
import { DateTime } from 'luxon'
import {
  STUDIO_TZ,
  formatDuration,
  formatTimeRange,
  type PublicCalendarDay,
  type PublicSession,
} from '@mizuki/shared'
import { widgetApi } from './api.js'
import { BookingDialog } from './BookingDialog.js'

/**
 * "Students see the next 3 months of classes on your site. They click a date, see every session
 * that day with the time, length and places left, and book. Full classes are marked so nobody
 * is disappointed."
 *
 * A hand-built month grid rather than a calendar library: the whole embed has to stay small
 * enough to drop into a WordPress page without slowing it down.
 */
export function BookingCalendar({ courseSlug }: { courseSlug?: string }) {
  const [days, setDays] = useState<PublicCalendarDay[] | null>(null)
  const [courses, setCourses] = useState<{ id: string; name: string; slug: string; colour: string }[]>([])
  const [error, setError] = useState<string | null>(null)
  const [monthOffset, setMonthOffset] = useState(0)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [booking, setBooking] = useState<PublicSession | null>(null)

  const today = useMemo(() => DateTime.now().setZone(STUDIO_TZ).startOf('day'), [])

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
      <div className="mzk">
        <div className="mzk-note mzk-note-error">{error}</div>
      </div>
    )
  }

  if (!days) {
    return (
      <div className="mzk">
        <div className="mzk-panel"><div className="mzk-empty">Loading classes…</div></div>
      </div>
    )
  }

  return (
    <div className="mzk">
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
          <h3 className="mzk-day-title">
            {DateTime.fromISO(selectedDay.date, { zone: STUDIO_TZ }).toFormat('cccc d LLLL yyyy')}
          </h3>

          {selectedDay.isClosed ? (
            <div className="mzk-note mzk-note-info">The studio is closed on this day.</div>
          ) : selectedDay.sessions.length === 0 ? (
            <div className="mzk-empty">No classes on this day.</div>
          ) : (
            selectedDay.sessions.map((session) => (
              <SessionRow key={session.id} session={session} onBook={() => setBooking(session)} />
            ))
          )}
        </>
      )}

      {!selectedDay && (
        <p className="mzk-muted mzk-small" style={{ marginTop: 14, textAlign: 'center' }}>
          Pick a highlighted date to see the classes running that day.
        </p>
      )}

      {booking && (
        <BookingDialog
          session={booking}
          onClose={() => setBooking(null)}
          onBooked={() => {
            setBooking(null)
            // Reload so the places-left counts reflect the booking just made.
            void widgetApi.calendar().then((c) => setDays(c.days))
          }}
        />
      )}
    </div>
  )
}

function SessionRow({ session, onBook }: { session: PublicSession; onBook: () => void }) {
  const start = DateTime.fromISO(session.startAt)
  const end = DateTime.fromISO(session.endAt)
  const low = session.seatsLeft > 0 && session.seatsLeft <= 2

  return (
    <button className="mzk-session" onClick={onBook} disabled={session.isFull}>
      <span className="mzk-stripe" style={{ background: session.colour }} />
      <span className="mzk-session-main">
        <span className="mzk-session-title">{session.title}</span>
        <span className="mzk-session-meta">
          {formatTimeRange(start.toJSDate(), end.toJSDate())} · {formatDuration(session.durationMins)}
          {session.breaks.length > 0 && ` · includes a break`}
        </span>
      </span>
      <span className="mzk-session-right">
        {session.isFull ? (
          <span className="mzk-tag mzk-tag-full">Full</span>
        ) : (
          <span className={`mzk-tag ${low ? 'mzk-tag-low' : 'mzk-tag-ok'}`}>
            {session.seatsLeft} {session.seatsLeft === 1 ? 'place' : 'places'} left
          </span>
        )}
      </span>
    </button>
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
