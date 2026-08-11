import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import type { EventDropArg } from '@fullcalendar/core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { DateTime } from 'luxon'
import { STUDIO_TZ } from '@mizuki/shared'
import { api, type AdminSession, type ClosedDate, type Course } from '../api.js'
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
      <div className="page-head">
        <div>
          <h1>Calendar</h1>
          <p>Drag a class to move it. Click one to see who is coming.</p>
        </div>
        <div className="toolbar">
          <select
            className="btn"
            value={courseFilter}
            onChange={(e) => setCourseFilter(e.target.value)}
            aria-label="Filter by course"
          >
            <option value="">All courses</option>
            {(coursesQuery.data?.courses ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <button type="button" className="btn btn-primary" onClick={() => setCreatingOn(DateTime.now().setZone(STUDIO_TZ).toFormat('yyyy-MM-dd'))}>
            + Add class
          </button>
        </div>
      </div>

      {sessionsQuery.isError && (
        <div className="banner banner-danger">Could not load the calendar. Please refresh.</div>
      )}

      <div className="calendar-wrap">
        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
          initialView="dayGridMonth"
          headerToolbar={{
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,timeGridWeek,timeGridDay',
          }}
          timeZone={STUDIO_TZ}
          firstDay={1}
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
          }}
          dayCellClassNames={(arg) => {
            const key = DateTime.fromJSDate(arg.date).setZone(STUDIO_TZ).toFormat('yyyy-MM-dd')
            return closedKeys.has(key) ? ['is-closed'] : []
          }}
          eventContent={(arg) => {
            const s = arg.event.extendedProps as AdminSession
            return (
              <div>
                <div className="event-title">{arg.timeText} {s.title}</div>
                <div className="event-sub">
                  {s.status === 'cancelled'
                    ? 'Cancelled'
                    : s.seatsLeft === 0
                      ? `Full · ${s.seatsTaken}/${s.capacity}`
                      : `${s.seatsTaken}/${s.capacity} booked`}
                  {s.heldBack > 0 ? ` · ${s.heldBack} held` : ''}
                </div>
              </div>
            )
          }}
        />

        <div className="legend">
          {(coursesQuery.data?.courses ?? []).map((c) => (
            <span className="legend-item" key={c.id}>
              <span className="legend-dot" style={{ background: c.colour }} />
              {c.name}
            </span>
          ))}
          <span className="legend-item"><span className="legend-dot" style={{ background: '#ece6e9' }} />Closed day</span>
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
