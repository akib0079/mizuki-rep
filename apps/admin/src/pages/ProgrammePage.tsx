import { useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { DateTime } from 'luxon'
import { STUDIO_TZ } from '@mizuki/shared'
import { api } from '../api.js'

/**
 * One course, run as a programme, with its own page.
 *
 * The shared dashboard is organised around the week: what is on today, how full it is. That is
 * the right shape for workshops, where a booking is the whole relationship. It is the wrong
 * shape for IFDA, where the student is enrolled for months and the studio's real questions are
 * about people — who is running out of sessions, whose course expires soon, who bought a place
 * and has not booked a single class since.
 *
 * So the register comes first here and the timetable second, which is the reverse of the
 * dashboard. Anyone needing action is at the top of the register, already sorted.
 */

interface ProgrammeClass {
  id: string
  title: string
  startAt: string
  dateKey: string
  seatsTaken: number
  capacity: number
  seatsLeft: number
  isFull: boolean
  overCapacity: boolean
}

type Flag = 'none' | 'low_balance' | 'expiring' | 'not_booked' | 'exhausted'

interface EnrolledStudent {
  id: string
  name: string
  email: string
  phone: string
  reference: string | null
  remaining: number
  totalSessions: number
  usedSessions: number
  startsAt: string | null
  expiresAt: string | null
  upcomingBookings: number
  nextClassAt: string | null
  flag: Flag
}

interface ProgrammeOverview {
  course: { id: string; name: string; colour: string; defaultCapacity: number; bookingMode: string }
  stats: {
    enrolled: number
    classesThisWeek: number
    studentsThisWeek: number
    placesLeftThisWeek: number
    needAttention: number
  }
  todayClasses: ProgrammeClass[]
  upcomingClasses: ProgrammeClass[]
  students: EnrolledStudent[]
}

/** What each flag means, in the studio's words rather than the database's. */
const FLAG_LABEL: Record<Exclude<Flag, 'none'>, string> = {
  exhausted: 'No sessions left',
  expiring: 'Course expiring',
  low_balance: 'Running low',
  not_booked: 'Nothing booked',
}

const FLAG_TONE: Record<Exclude<Flag, 'none'>, string> = {
  exhausted: 'pill-danger',
  expiring: 'pill-warn',
  low_balance: 'pill-warn',
  not_booked: 'pill-muted',
}

const fmtDate = (iso: string | null) =>
  iso ? DateTime.fromISO(iso, { zone: STUDIO_TZ }).toFormat('d LLL yyyy') : '—'

const fmtDateTime = (iso: string) =>
  DateTime.fromISO(iso, { zone: STUDIO_TZ }).toFormat('ccc d LLL, h:mm a')

/**
 * The course period in words.
 *
 * Most packages are sold open-ended with only an expiry, and rendering that as a range put a
 * dash where the start date would be — "— → 30 Jun 2027" — which reads as missing data rather
 * than as the normal case it actually is.
 */
function describePeriod(startsAt: string | null, expiresAt: string | null) {
  if (startsAt && expiresAt) return `${fmtDate(startsAt)} → ${fmtDate(expiresAt)}`
  if (expiresAt) return `Until ${fmtDate(expiresAt)}`
  if (startsAt) return `From ${fmtDate(startsAt)}`
  return <span className="muted">No end date</span>
}

export function ProgrammePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [onlyNeedingAttention, setOnlyNeedingAttention] = useState(false)
  const [search, setSearch] = useState('')

  const { data, isLoading, error } = useQuery({
    queryKey: ['programme', id],
    queryFn: () => api.get<ProgrammeOverview>(`/api/admin/programmes/${id}`),
    enabled: Boolean(id),
  })

  const visible = useMemo(() => {
    if (!data) return []
    const term = search.trim().toLowerCase()
    return data.students.filter((s) => {
      if (onlyNeedingAttention && s.flag === 'none') return false
      if (!term) return true
      return (
        s.name.toLowerCase().includes(term) ||
        s.email.toLowerCase().includes(term) ||
        (s.reference ?? '').toLowerCase().includes(term)
      )
    })
  }, [data, onlyNeedingAttention, search])

  if (isLoading) return <div className="empty">Loading…</div>
  if (error || !data) return <div className="banner banner-danger">Could not load this course.</div>

  const { course, stats } = data

  return (
    <>
      <div className="page-head">
        <div>
          <h1>
            <span
              className="legend-dot"
              style={{ background: course.colour, display: 'inline-block', marginRight: 10 }}
            />
            {course.name}
          </h1>
          <p>
            Everyone enrolled on {course.name}, and the classes they can book. Kept separate from
            the workshops so neither buries the other.
          </p>
        </div>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => navigate('/calendar')}>
          Open the calendar
        </button>
      </div>

      <div className="grid grid-4">
        <StatCard
          label="Students enrolled"
          value={stats.enrolled}
          foot="Holding a course package"
          icon="◍"
          tone="accent"
        />
        <StatCard
          label="Need attention"
          value={stats.needAttention}
          foot="Running out, expiring or unbooked"
          icon="!"
          tone={stats.needAttention > 0 ? 'amber' : 'green'}
        />
        <StatCard
          label="Classes · next 7 days"
          value={stats.classesThisWeek}
          foot={`${stats.studentsThisWeek} student${stats.studentsThisWeek === 1 ? '' : 's'} expected`}
          icon="▦"
          tone="blue"
        />
        <StatCard
          label="Places still free"
          value={stats.placesLeftThisWeek}
          foot="Across the next 7 days"
          icon="☺"
          tone="green"
        />
      </div>

      {/* --- The register, which is the point of this page --- */}
      <div className="card card-pad-0">
        <div className="card-head">
          <h3>Enrolled students</h3>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              className="btn btn-sm"
              type="search"
              placeholder="Search name, email or reference"
              aria-label={`Search ${course.name} students`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ minWidth: 220 }}
            />
            <label className="switch-label">
              <input
                type="checkbox"
                checked={onlyNeedingAttention}
                onChange={(e) => setOnlyNeedingAttention(e.target.checked)}
              />
              <span className="small muted">Only those needing attention</span>
            </label>
          </div>
        </div>

        {visible.length === 0 ? (
          <div className="empty">
            {data.students.length === 0
              ? `Nobody is enrolled on ${course.name} yet. Students appear here once they hold a course package.`
              : 'No students match what you typed.'}
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Sessions left</th>
                  <th>Course period</th>
                  <th>Next class</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <button
                        type="button"
                        className="link-btn"
                        onClick={() => navigate(`/students?open=${s.id}`)}
                        style={{ fontWeight: 600 }}
                      >
                        {s.name}
                      </button>
                      <div className="small muted">
                        {s.reference ? `${s.reference} · ` : ''}
                        {s.email}
                      </div>
                    </td>
                    <td>
                      <strong>{s.remaining}</strong>
                      <span className="small muted"> of {s.totalSessions}</span>
                    </td>
                    <td className="small">{describePeriod(s.startsAt, s.expiresAt)}</td>
                    <td className="small">
                      {s.nextClassAt ? (
                        <>
                          {fmtDateTime(s.nextClassAt)}
                          {s.upcomingBookings > 1 && (
                            <span className="muted"> +{s.upcomingBookings - 1} more</span>
                          )}
                        </>
                      ) : (
                        <span className="muted">Nothing booked</span>
                      )}
                    </td>
                    <td>
                      {s.flag === 'none' ? (
                        <span className="pill pill-ok">On track</span>
                      ) : (
                        <span className={`pill ${FLAG_TONE[s.flag]}`}>{FLAG_LABEL[s.flag]}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* --- The timetable, second because it is the smaller question here --- */}
      <div className="grid grid-2-1">
        <div className="card card-pad-0">
          <div className="card-head"><h3>Today's {course.name} classes</h3></div>
          {data.todayClasses.length === 0 ? (
            <div className="empty">No {course.name} classes today.</div>
          ) : (
            <ClassTable rows={data.todayClasses} onOpen={(cid) => navigate(`/calendar?session=${cid}`)} showDate={false} />
          )}
        </div>

        <div className="card card-pad-0">
          <div className="card-head"><h3>Coming up</h3></div>
          {data.upcomingClasses.length === 0 ? (
            <div className="empty">Nothing scheduled.</div>
          ) : (
            <ClassTable rows={data.upcomingClasses} onOpen={(cid) => navigate(`/calendar?session=${cid}`)} showDate />
          )}
        </div>
      </div>
    </>
  )
}

function ClassTable({
  rows,
  onOpen,
  showDate,
}: {
  rows: ProgrammeClass[]
  onOpen: (id: string) => void
  showDate: boolean
}) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Class</th>
            <th>{showDate ? 'When' : 'Time'}</th>
            <th>Booked</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>
                <button type="button" className="link-btn" onClick={() => onOpen(row.id)}>
                  {row.title}
                </button>
              </td>
              <td className="small">
                {showDate
                  ? fmtDateTime(row.startAt)
                  : DateTime.fromISO(row.startAt, { zone: STUDIO_TZ }).toFormat('h:mm a')}
              </td>
              <td>
                <span
                  className={`pill ${row.overCapacity ? 'pill-danger' : row.isFull ? 'pill-warn' : 'pill-ok'}`}
                >
                  {row.seatsTaken}/{row.capacity}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Same markup as the dashboard's, so the two pages read as one console. */
function StatCard({
  label,
  value,
  foot,
  icon,
  tone,
}: {
  label: string
  value: number
  foot: string
  icon: string
  tone: 'accent' | 'green' | 'blue' | 'amber'
}) {
  return (
    <div className="stat-card">
      <div className="head">
        <div className="label">{label}</div>
        <div className={`stat-icon ${tone}`}>{icon}</div>
      </div>
      <div className="value">{value}</div>
      <div className="foot">{foot}</div>
    </div>
  )
}
