import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import listPlugin from '@fullcalendar/list'
import luxonPlugin from '@fullcalendar/luxon3'
import { useIsPhone } from '../useIsPhone.js'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import type { EventDropArg } from '@fullcalendar/core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { DateTime } from 'luxon'
import { STUDIO_TZ } from '@mizuki/shared'
import { api, type AdminSession, type ClosedDate, type Course } from '../api.js'
import { MiniMonth } from '../components/MiniMonth.js'
import { SessionDrawer } from '../components/SessionDrawer.js'
import { NewSessionDialog } from '../components/NewSessionDialog.js'
import { ConfirmDialog } from '../components/ConfirmDialog.js'

/**
 * The studio's calendar.
 *
 * Built around the client's own words: "Sometimes I need to be away for outside work, so it's
 * important that I can quickly reschedule my timetable whenever necessary." Dragging a class
 * moves it; if anyone is booked, they are told before it happens, never after.
 */
export function CalendarPage() {
  const isPhone = useIsPhone()
  const calendarRef = useRef<FullCalendar>(null)
  const queryClient = useQueryClient()

  const [params, setParams] = useSearchParams()
  const [range, setRange] = useState(() => monthWindow(DateTime.now().setZone(STUDIO_TZ)))
  const [selectedId, setSelectedId] = useState<string | null>(() => params.get('session'))
  const [creatingOn, setCreatingOn] = useState<string | null>(null)

  // Deep links from the dashboard (?session=…) and Quick add (?new=1) land ready to act on.
  useEffect(() => {
    const session = params.get('session')
    const isNew = params.get('new') === '1'
    if (!session && !isNew) return

    if (session) setSelectedId(session)
    if (isNew) setCreatingOn(DateTime.now().setZone(STUDIO_TZ).toFormat('yyyy-MM-dd'))

    params.delete('session')
    params.delete('new')
    setParams(params, { replace: true })
  }, [params, setParams])
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null)
  const [courseFilter, setCourseFilter] = useState<string>('')

  /*
   * The toolbar is ours rather than FullCalendar's, so the title and the view buttons have to be
   * mirrored here — FullCalendar owns the truth, this follows it via `datesSet`.
   *
   * Two dates, not one. `cursor` is the month on screen, derived from the middle of whatever
   * range is drawn; `picked` is the day someone actually chose. Using the first for both put the
   * navigator's filled disc on the 17th — the midpoint of a grid running 27 July to 6 September,
   * and a day nobody had asked about.
   */
  const [cursor, setCursor] = useState(() => DateTime.now().setZone(STUDIO_TZ))
  const [picked, setPicked] = useState(() => DateTime.now().setZone(STUDIO_TZ))
  const [viewName, setViewName] = useState(() => (isPhone ? 'listTwoWeek' : 'dayGridMonth'))

  const sessionsQuery = useQuery({
    queryKey: ['admin-sessions', range.from, range.to, courseFilter],
    queryFn: () =>
      api.get<{ sessions: AdminSession[] }>(
        `/api/admin/sessions?from=${range.from}&to=${range.to}${courseFilter ? `&courseTypeId=${courseFilter}` : ''}`,
      ),
  })

  const closedQuery = useQuery({
    queryKey: ['closed-dates'],
    queryFn: () => api.get<{ closedDates: ClosedDate[] }>('/api/admin/closed-dates'),
  })

  const coursesQuery = useQuery({
    queryKey: ['courses'],
    queryFn: () => api.get<{ courses: Course[] }>('/api/admin/settings/courses'),
  })

  const moveMutation = useMutation({
    mutationFn: (input: { id: string; date: string; startTime: string; notifyStudents: boolean }) =>
      api.patch<{ studentsNotified: number }>(`/api/admin/sessions/${input.id}`, {
        date: input.date,
        startTime: input.startTime,
        notifyStudents: input.notifyStudents,
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin-sessions'] }),
  })

  const closedKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const closed of closedQuery.data?.closedDates ?? []) {
      let cursor = DateTime.fromISO(closed.startDate, { zone: STUDIO_TZ })
      const end = DateTime.fromISO(closed.endDate, { zone: STUDIO_TZ })
      while (cursor <= end) {
        keys.add(cursor.toFormat('yyyy-MM-dd'))
        cursor = cursor.plus({ days: 1 })
      }
    }
    return keys
  }, [closedQuery.data])

  /*
   * The heading names whatever is actually on screen.
   *
   * A month is the month; a week and a day are not, and labelling a Monday-to-Sunday grid
   * "August 2026" tells you the one thing you already knew. The week spanning a month end reads
   * "31 Aug – 6 Sep 2026", which is the case that makes the range worth spelling out at all.
   */
  const title = useMemo(() => {
    if (viewName === 'timeGridDay') return cursor.toFormat('cccc d LLLL yyyy')

    if (viewName === 'timeGridWeek' || viewName.startsWith('list')) {
      const start = viewName.startsWith('list') ? cursor.minus({ days: 7 }) : cursor.startOf('week')
      const end = viewName.startsWith('list') ? cursor.plus({ days: 6 }) : cursor.endOf('week')
      const sameMonth = start.hasSame(end, 'month')
      return sameMonth
        ? `${start.toFormat('d')} – ${end.toFormat('d LLL yyyy')}`
        : `${start.toFormat('d LLL')} – ${end.toFormat('d LLL yyyy')}`
    }

    return cursor.toFormat('LLLL yyyy')
  }, [cursor, viewName])

  /** Days with at least one class, for the dots on the mini month. */
  const busyKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const s of sessionsQuery.data?.sessions ?? []) {
      if (s.status === 'cancelled') continue
      keys.add(DateTime.fromISO(s.startAt, { zone: STUDIO_TZ }).toFormat('yyyy-MM-dd'))
    }
    return keys
  }, [sessionsQuery.data])

  /** Move both the grid and the mini month to a date, from whichever asked. */
  function goTo(date: DateTime) {
    calendarRef.current?.getApi().gotoDate(date.toJSDate())
    setCursor(date)
    setPicked(date)
  }

  function changeView(next: string) {
    calendarRef.current?.getApi().changeView(next)
    setViewName(next)
  }

  const events = useMemo(
    () =>
      (sessionsQuery.data?.sessions ?? []).map((s) => ({
        id: s.id,
        title: s.title,
        start: s.startAt,
        end: s.endAt,
        backgroundColor: s.colour,
        borderColor: s.colour,
        // A cancelled class must not be draggable — moving it would imply it is running.
        editable: s.status === 'scheduled',
        classNames: [
          s.seatsLeft === 0 && s.status === 'scheduled' ? 'is-full' : '',
          s.status === 'cancelled' ? 'is-cancelled' : '',
          s.overCapacity ? 'is-over' : '',
        ].filter(Boolean),
        extendedProps: s,
      })),
    [sessionsQuery.data],
  )

  /** A drag is a proposal: work out who it affects, then ask. */
  function handleDrop(info: EventDropArg) {
    const session = info.event.extendedProps as AdminSession
    const next = DateTime.fromJSDate(info.event.start!).setZone(STUDIO_TZ)

    const booked = session.seatsTaken
    setPendingMove({
      session,
      date: next.toFormat('yyyy-MM-dd'),
      startTime: next.toFormat('HH:mm'),
      label: next.toFormat('ccc d LLL, h:mm a'),
      bookedCount: booked,
      revert: info.revert,
    })
  }

  return (
    <>
      {/*
        One bar rather than a page heading above a toolbar above FullCalendar's own toolbar.
        Three stacked rows of controls was most of the screen before a single class appeared, and
        on a phone they wrapped into six ragged lines.
      */}
      <div className="cal-bar">
        <button
          type="button"
          className="btn"
          onClick={() => goTo(DateTime.now().setZone(STUDIO_TZ))}
        >
          Today
        </button>

        <div className="cal-steps">
          <button type="button" className="icon-btn" aria-label="Previous" onClick={() => { calendarRef.current?.getApi().prev() }}>‹</button>
          <button type="button" className="icon-btn" aria-label="Next" onClick={() => { calendarRef.current?.getApi().next() }}>›</button>
        </div>

        <h1 className="cal-title">{title}</h1>

        <div className="cal-bar-end">
          <select
            className="btn cal-filter"
            value={courseFilter}
            onChange={(e) => setCourseFilter(e.target.value)}
            aria-label="Filter by course"
          >
            <option value="">All courses</option>
            {(coursesQuery.data?.courses ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>

          <div className="seg" role="group" aria-label="Calendar view">
            {(isPhone
              ? [{ id: 'listTwoWeek', label: 'Schedule' }, { id: 'dayGridMonth', label: 'Month' }]
              : [
                  { id: 'dayGridMonth', label: 'Month' },
                  { id: 'timeGridWeek', label: 'Week' },
                  { id: 'timeGridDay', label: 'Day' },
                ]
            ).map((v) => (
              <button
                key={v.id}
                type="button"
                className={viewName === v.id ? 'seg-btn is-on' : 'seg-btn'}
                aria-pressed={viewName === v.id}
                onClick={() => changeView(v.id)}
              >
                {v.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setCreatingOn(DateTime.now().setZone(STUDIO_TZ).toFormat('yyyy-MM-dd'))}
          >
            + Add class
          </button>
        </div>
      </div>

      {sessionsQuery.isError && (
        <div className="banner banner-danger">Could not load the calendar. Please refresh.</div>
      )}

      <div className="cal-layout">
        <aside className="cal-side">
          <MiniMonth
            month={cursor}
            selected={picked}
            busyDates={busyKeys}
            closedDates={closedKeys}
            onPick={goTo}
          />

          <div className="legend legend-stack">
            {(coursesQuery.data?.courses ?? []).map((c) => (
              <span className="legend-item" key={c.id}>
                <span className="legend-dot" style={{ background: c.colour }} />
                {c.name}
              </span>
            ))}
            <span className="legend-item"><span className="legend-dot legend-dot-closed" />Closed day</span>
          </div>

          <p className="cal-hint muted small">Drag a class to move it. Click one to see who is coming.</p>
        </aside>

        <div className="calendar-wrap">
        <FullCalendar
          ref={calendarRef}
          /*
           * A month grid needs seven columns. On a phone that is 50px each, which turns every
           * class into a truncated stub — "2a IFDA", "6:30a I" — and makes the one screen the
           * studio actually opens on their phone the least readable one in the console.
           *
           * So a phone opens on a fortnight's list instead: full titles, full times, how many
           * are booked, in the order they happen. The month grid is still one tap away.
           */
          plugins={[dayGridPlugin, timeGridPlugin, listPlugin, luxonPlugin, interactionPlugin]}
          initialView={isPhone ? 'listTwoWeek' : 'dayGridMonth'}
          views={{
            listTwoWeek: { type: 'list', duration: { weeks: 2 }, buttonText: 'list' },
          }}
          // The bar above replaces this one; leaving both gave the page two sets of the same
          // controls, disagreeing about which view was active.
          headerToolbar={false}
          /*
           * The Luxon plugin is what makes this line mean anything.
           *
           * On its own FullCalendar understands exactly two timezones — 'local' and 'UTC' — and
           * silently treats any named zone as UTC. So the studio's own calendar was showing every
           * class eight hours early: a 10:00 IFDA Morning appeared at 2:00am, on every view.
           * Nothing errored, and the times looked plausible enough to read past.
           */
          timeZone={STUDIO_TZ}
          firstDay={1}
          /*
           * "MON 10", not FullCalendar's default "MON 8/10".
           *
           * That default is US month-first, so in a Singapore studio the Monday of this week read
           * as the 8th of October. The month is already in the heading above.
           */
          dayHeaderFormat={{ weekday: 'short', day: 'numeric', omitCommas: true }}
          height="auto"
          nowIndicator
          // Weekdays currently run three IFDA classes, which fits. This caps a day at three
          // so adding a fourth collapses to "+N more" rather than shrinking every row.
          dayMaxEvents={3}
          slotMinTime="08:00:00"
          slotMaxTime="22:30:00"
          events={events}
          editable
          eventDurationEditable={false}
          eventDrop={handleDrop}
          dateClick={(info) => setCreatingOn(info.dateStr.slice(0, 10))}
          eventClick={(info) => setSelectedId(info.event.id)}
          datesSet={(info) => {
            setRange({
              from: DateTime.fromJSDate(info.start).setZone(STUDIO_TZ).toFormat('yyyy-MM-dd'),
              to: DateTime.fromJSDate(info.end).setZone(STUDIO_TZ).toFormat('yyyy-MM-dd'),
            })

            /*
             * Follow whatever FullCalendar decided, however it was reached — our buttons, a swipe,
             * or a click on the mini month. `info.start` is the first cell drawn, which in a month
             * view is usually in the previous month, so the title is taken from the middle of the
             * range rather than its edge.
             */
            const middle = DateTime.fromJSDate(
              new Date((info.start.getTime() + info.end.getTime()) / 2),
            ).setZone(STUDIO_TZ)
            setCursor(middle)
            setViewName(info.view.type)
          }}
          dayCellClassNames={(arg) => {
            const key = DateTime.fromJSDate(arg.date).setZone(STUDIO_TZ).toFormat('yyyy-MM-dd')
            return closedKeys.has(key) ? ['is-closed'] : []
          }}
          /*
           * One line per class, not two.
           *
           * Every entry used to spell out "0/8 booked" on a second line, which doubled the height
           * of a month that already runs three classes a day and pushed the titles into "2:30p
           * IFDA Trial & Regular — Aftern…". The count is the same information in a quarter of the
           * space, and colouring it means how full a class is can be read without reading at all:
           * the studio scans for red, not for numbers.
           */
          /*
           * Hand the course colour to CSS as a variable.
           *
           * FullCalendar writes it as an inline background-color, which the time-grid rules have
           * to override to tint rather than fill — so the colour has to arrive by another route
           * than the one being overridden.
           */
          eventDidMount={(info) => {
            const session = info.event.extendedProps as AdminSession
            info.el.style.setProperty('--ev-colour', session.colour)
          }}
          eventContent={(arg) => (
            <CalendarEvent
              session={arg.event.extendedProps as AdminSession}
              timeText={arg.timeText}
              // The schedule has a whole row per class, so it can afford the count that the
              // month grid has to earn. Hiding it there too was habit, not a space decision.
              roomy={arg.view.type.startsWith('list')}
            />
          )}
        />

        </div>
      </div>

      {selectedId && (
        <SessionDrawer
          sessionId={selectedId}
          onClose={() => setSelectedId(null)}
          onChanged={() => void queryClient.invalidateQueries({ queryKey: ['admin-sessions'] })}
        />
      )}

      {creatingOn && (
        <NewSessionDialog
          date={creatingOn}
          courses={coursesQuery.data?.courses ?? []}
          onClose={() => setCreatingOn(null)}
          onCreated={() => {
            setCreatingOn(null)
            void queryClient.invalidateQueries({ queryKey: ['admin-sessions'] })
          }}
        />
      )}

      {pendingMove && (
        <ConfirmDialog
          title="Move this class?"
          confirmLabel="Move class"
          busy={moveMutation.isPending}
          onCancel={() => {
            pendingMove.revert()
            setPendingMove(null)
          }}
          onConfirm={async (notify) => {
            await moveMutation.mutateAsync({
              id: pendingMove.session.id,
              date: pendingMove.date,
              startTime: pendingMove.startTime,
              notifyStudents: notify,
            })
            setPendingMove(null)
          }}
          // Only offer the email toggle when there is somebody to email.
          notifyPrompt={
            pendingMove.bookedCount > 0
              ? `Email the ${pendingMove.bookedCount} student${pendingMove.bookedCount === 1 ? '' : 's'} already booked`
              : undefined
          }
          notifyDefault
        >
          <p>
            <strong>{pendingMove.session.title}</strong> moves to <strong>{pendingMove.label}</strong>.
          </p>
          {pendingMove.bookedCount > 0 ? (
            <p className="muted small">
              {pendingMove.bookedCount} student{pendingMove.bookedCount === 1 ? ' is' : 's are'} booked into this class.
              Their places move with it.
            </p>
          ) : (
            <p className="muted small">Nobody is booked into this class yet.</p>
          )}
        </ConfirmDialog>
      )}
    </>
  )
}

interface PendingMove {
  session: AdminSession
  date: string
  startTime: string
  label: string
  bookedCount: number
  revert: () => void
}

function monthWindow(now: DateTime) {
  return {
    from: now.startOf('month').minus({ days: 7 }).toFormat('yyyy-MM-dd'),
    to: now.endOf('month').plus({ days: 7 }).toFormat('yyyy-MM-dd'),
  }
}

/**
 * How one class looks in the grid.
 *
 * The occupancy pill carries the meaning: grey when nobody has booked, teal while filling, amber
 * at one place left, red when full or oversubscribed. Those are the only states worth interrupting
 * someone for, and they are the ones that change what the studio does next.
 */
function CalendarEvent({
  session,
  timeText,
  roomy = false,
}: {
  session: AdminSession
  timeText: string
  /** True in the schedule view, where there is room for the count on every row. */
  roomy?: boolean
}) {
  const cancelled = session.status === 'cancelled'
  const left = session.seatsLeft

  const tone = cancelled
    ? 'off'
    : session.overCapacity
      ? 'over'
      : left === 0
        ? 'full'
        : left <= 2
          ? 'low'
          : session.seatsTaken === 0
            ? 'empty'
            : 'ok'

  /*
   * An empty class shows no count at all.
   *
   * Most classes are empty most of the time, so "0/8" was repeated down every column — the least
   * useful thing on the screen, taking the space that was truncating the titles into "IFDA …".
   * Leaving it out means a pill appears only where somebody has actually booked, which turns
   * "who has students?" from reading every row into glancing at the month. The full numbers are
   * on the tooltip and in the class itself.
   */
  const showCount = roomy || cancelled || session.seatsTaken > 0 || session.heldBack > 0

  return (
    <div
      className="ev"
      title={`${timeText} ${session.title} — ${session.seatsTaken} of ${session.capacity} booked${
        session.heldBack > 0 ? `, ${session.heldBack} held back` : ''
      }`}
    >
      <span className="ev-dot" style={{ background: session.colour }} aria-hidden />
      <span className="ev-time">{timeText}</span>
      <span className="ev-title">{session.title}</span>
      {showCount && (
        <span className={`ev-count ev-${tone}`}>
          {cancelled
            ? 'Off'
            : session.overCapacity
              ? `${session.seatsTaken}!`
              : `${session.seatsTaken}/${session.capacity}`}
        </span>
      )}
      {session.heldBack > 0 && !cancelled && (
        <span className="ev-held" title={`${session.heldBack} place(s) held back from public booking`}>
          −{session.heldBack}
        </span>
      )}
    </div>
  )
}
