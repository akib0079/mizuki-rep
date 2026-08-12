import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { DateTime } from 'luxon'
import { STUDIO_TZ } from '@mizuki/shared'
import { api } from '../api.js'
import { SkeletonStats } from '../components/Skeleton.js'
import { QueryState } from '../components/QueryState.js'

/**
 * The studio's landing page.
 *
 * Modelled on the agency panel the studio already works in, but the thing being managed is
 * classes rather than invoices, so the numbers are people and places. What stays is the shape:
 * decisions first, then the figures, then the detail — because the useful question on opening
 * this page is "is anything wrong today", not "what is the total".
 */

interface DashboardAction {
  kind: string
  severity: 'urgent' | 'attention' | 'info'
  title: string
  subtitle: string
  href: string
}

interface ClassRow {
  id: string
  title: string
  courseName: string
  colour: string
  startAt: string
  dateKey: string
  seatsTaken: number
  capacity: number
  seatsLeft: number
  heldBack: number
  isFull: boolean
  overCapacity: boolean
}

interface Dashboard {
  today: string
  stats: {
    classesToday: number
    studentsToday: number
    studentsThisWeek: number
    placesLeftThisWeek: number
    bookingsThisMonth: number
    activeStudents: number
  }
  actions: DashboardAction[]
  todayClasses: ClassRow[]
  upcomingClasses: ClassRow[]
  bookingMix: { confirmed: number; held: number; cancelled: number }
  weekFill: { booked: number; capacity: number; percent: number }
  packagesLow: { studentName: string; courseName: string; remaining: number; expiresAt: string | null }[]
  recentActivity: { id: string; action: string; actor: string; reason: string; at: string }[]
}

export function DashboardPage() {
  const navigate = useNavigate()
  const [openSections, setOpenSections] = useState({ today: true, detail: true, activity: true })

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<Dashboard>('/api/admin/settings/dashboard'),
    refetchInterval: 60_000,
  })

  /*
   * `isLoading || !data` was the condition here, which renders the skeleton forever when the
   * request fails: the flag clears, the data never arrives, and the page waits for something
   * that is not coming. Failure has to be its own state.
   */
  if (error || isLoading || !data) {
    return (
      <>
        <div className="page-head">
          <div><h1>Dashboard</h1><p>Your studio at a glance.</p></div>
        </div>
        {error ? (
          <QueryState
            isLoading={false}
            error={error}
            data={undefined}
            skeleton={null}
            onRetry={() => void refetch()}
          >
            {null}
          </QueryState>
        ) : (
          <SkeletonStats />
        )}
      </>
    )
  }

  const toggle = (key: keyof typeof openSections) =>
    setOpenSections((s) => ({ ...s, [key]: !s[key] }))

  const today = DateTime.fromISO(data.today, { zone: STUDIO_TZ })

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p>Your studio at a glance — {today.toFormat('cccc d LLLL yyyy')}.</p>
        </div>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => navigate('/calendar')}>
          Open the calendar
        </button>
      </div>

      {/* Decisions before figures. */}
      <div className="actions-panel">
        <h2>
          {data.actions.length > 0
            ? `${data.actions.length} thing${data.actions.length === 1 ? '' : 's'} need${data.actions.length === 1 ? 's' : ''} you today`
            : 'Nothing needs you today'}
        </h2>

        {data.actions.length === 0 ? (
          <div className="all-clear">Everything is in order — no classes over capacity, no packages running out.</div>
        ) : (
          <div className="actions-grid">
            {data.actions.map((action, i) => (
              <button type="button" key={`${action.kind}-${i}`} className="action-item" onClick={() => navigate(action.href)}>
                <span className={`action-dot ${action.severity}`} />
                <span className="action-body">
                  <span className="action-title">{action.title}</span>
                  <span className="action-sub">{action.subtitle}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-4">
        <StatCard
          label="Classes today"
          value={data.stats.classesToday}
          foot={`${data.stats.studentsToday} student${data.stats.studentsToday === 1 ? '' : 's'} expected`}
          icon="▦"
          tone="accent"
        />
        <StatCard
          label="Students · next 7 days"
          value={data.stats.studentsThisWeek}
          foot={`${data.stats.placesLeftThisWeek} places still free`}
          icon="☺"
          tone="green"
        />
        <StatCard
          label="Bookings this month"
          value={data.stats.bookingsThisMonth}
          foot="Confirmed and held"
          icon="↗"
          tone="blue"
        />
        <StatCard
          label="Students on file"
          value={data.stats.activeStudents}
          foot="All time"
          icon="◍"
          tone="amber"
        />
      </div>

      {/* --- Today --- */}
      <button type="button" className="section-label" aria-expanded={openSections.today} onClick={() => toggle('today')}>
        <span className="chev">▾</span> Today
      </button>

      {openSections.today && (
        <div className="grid grid-2-1">
          <div className="card card-pad-0">
            <div className="card-head"><h3>Today's classes</h3></div>
            {data.todayClasses.length === 0 ? (
              <div className="empty">No classes scheduled today.</div>
            ) : (
              <table className="table">
                <thead>
                  <tr><th>Class</th><th>Time</th><th>Booked</th></tr>
                </thead>
                <tbody>
                  {data.todayClasses.map((row) => (
                    <tr key={row.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/calendar?session=${row.id}`)}>
                      <td>
                        <div className="row" style={{ gap: 8 }}>
                          <span className="legend-dot" style={{ background: row.colour }} />
                          <div>
                            <div className="row-title">{row.title}</div>
                            <div className="row-sub">{row.courseName}</div>
                          </div>
                        </div>
                      </td>
                      <td className="nowrap">
                        {DateTime.fromISO(row.startAt).setZone(STUDIO_TZ).toFormat('h:mm a')}
                      </td>
                      <td><SeatPill row={row} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="card">
            <h3 className="card-title">How full is the week</h3>
            <p className="card-sub">Across the next 7 days.</p>
            <Donut
              percent={data.weekFill.percent}
              label={`${data.weekFill.booked}/${data.weekFill.capacity}`}
            />
            <div className="donut-legend" style={{ marginTop: 4 }}>
              <span><i className="legend-dot" style={{ background: 'var(--ok)' }} /> Booked {data.weekFill.booked}</span>
              <span><i className="legend-dot" style={{ background: '#e6e9ee' }} /> Free {Math.max(0, data.weekFill.capacity - data.weekFill.booked)}</span>
            </div>
          </div>
        </div>
      )}

      {/* --- Coming up --- */}
      <button type="button" className="section-label" aria-expanded={openSections.detail} onClick={() => toggle('detail')}>
        <span className="chev">▾</span> Coming up
      </button>

      {openSections.detail && (
        <div className="grid grid-2-1">
          <div className="card card-pad-0">
            <div className="card-head"><h3>Next classes</h3></div>
            {data.upcomingClasses.length === 0 ? (
              <div className="empty">Nothing scheduled.</div>
            ) : (
              <table className="table">
                <thead>
                  <tr><th>Class</th><th>When</th><th>Booked</th></tr>
                </thead>
                <tbody>
                  {data.upcomingClasses.map((row) => (
                    <tr key={row.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/calendar?session=${row.id}`)}>
                      <td>
                        <div className="row" style={{ gap: 8 }}>
                          <span className="legend-dot" style={{ background: row.colour }} />
                          <div>
                            <div className="row-title">{row.title}</div>
                            <div className="row-sub">{row.courseName}</div>
                          </div>
                        </div>
                      </td>
                      <td className="nowrap small muted">
                        {DateTime.fromISO(row.startAt).setZone(STUDIO_TZ).toFormat('ccc d LLL, h:mm a')}
                      </td>
                      <td><SeatPill row={row} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="card card-pad-0">
            <div className="card-head"><h3>Course packages running low</h3></div>
            {data.packagesLow.length === 0 ? (
              <div className="empty">Nobody is close to running out.</div>
            ) : (
              <table className="table">
                <tbody>
                  {data.packagesLow.map((pkg, i) => (
                    <tr key={`${pkg.studentName}-${i}`} style={{ cursor: 'pointer' }} onClick={() => navigate('/students')}>
                      <td>
                        <div className="row-title">{pkg.studentName}</div>
                        <div className="row-sub">
                          {pkg.courseName}
                          {pkg.expiresAt &&
                            ` · expires ${DateTime.fromISO(pkg.expiresAt).setZone(STUDIO_TZ).toFormat('d LLL')}`}
                        </div>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <span className={pkg.remaining === 0 ? 'pill pill-danger' : 'pill pill-warn'}>
                          {pkg.remaining} left
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* --- Activity --- */}
      <button type="button" className="section-label" aria-expanded={openSections.activity} onClick={() => toggle('activity')}>
        <span className="chev">▾</span> Recent activity
      </button>

      {openSections.activity && (
        <div className="card card-pad-0">
          {data.recentActivity.length === 0 ? (
            <div className="empty">Nothing recorded yet.</div>
          ) : (
            <div className="feed">
              {data.recentActivity.map((entry) => (
                <div className="feed-item" key={entry.id}>
                  <span className="feed-icon">{iconFor(entry.action)}</span>
                  <div className="feed-body">
                    <div className="feed-title">
                      {describeAction(entry.action)}
                      {entry.actor && entry.actor !== 'system' && <span className="faint"> · {entry.actor}</span>}
                    </div>
                    <div className="feed-time">
                      {DateTime.fromISO(entry.at).setZone(STUDIO_TZ).toRelative()}
                      {entry.reason && ` · ${entry.reason}`}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  )
}

function StatCard({
  label,
  value,
  foot,
  icon,
  tone,
}: {
  label: string
  value: number | string
  foot: string
  icon: string
  tone: 'green' | 'amber' | 'accent' | 'blue'
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

function SeatPill({ row }: { row: ClassRow }) {
  if (row.overCapacity) {
    return <span className="pill pill-danger">{row.seatsTaken}/{row.capacity} over</span>
  }
  if (row.isFull) {
    return <span className="pill pill-muted">Full · {row.seatsTaken}/{row.capacity}</span>
  }
  return (
    <span className={row.seatsLeft <= 2 ? 'pill pill-warn' : 'pill pill-ok'}>
      {row.seatsTaken}/{row.capacity} booked
    </span>
  )
}

/** A plain SVG ring — one number, no charting library for the sake of it. */
function Donut({ percent, label }: { percent: number; label: string }) {
  const radius = 54
  const circumference = 2 * Math.PI * radius
  const filled = (Math.min(100, Math.max(0, percent)) / 100) * circumference

  return (
    <div className="donut-wrap">
      <svg width="150" height="150" viewBox="0 0 150 150" role="img" aria-label={`${percent}% booked`}>
        <circle cx="75" cy="75" r={radius} fill="none" stroke="#e6e9ee" strokeWidth="16" />
        <circle
          cx="75" cy="75" r={radius} fill="none"
          stroke="var(--ok)" strokeWidth="16" strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference - filled}`}
          transform="rotate(-90 75 75)"
        />
        <text x="75" y="70" textAnchor="middle" fontSize="26" fontWeight="700" fill="var(--ink)">
          {percent}%
        </text>
        <text x="75" y="90" textAnchor="middle" fontSize="12" fill="var(--ink-faint)">
          {label}
        </text>
      </svg>
    </div>
  )
}

function iconFor(action: string): string {
  if (action.startsWith('booking')) return '☺'
  if (action.startsWith('session')) return '▦'
  if (action.startsWith('package')) return '◍'
  if (action.startsWith('closedDate')) return '⊘'
  if (action.startsWith('series')) return '❋'
  return '•'
}

function describeAction(action: string): string {
  const labels: Record<string, string> = {
    'booking.create': 'Booking added',
    'booking.create.override': 'Booking added over the class size',
    'booking.cancel': 'Booking cancelled',
    'booking.reschedule': 'Booking moved',
    'booking.reschedule.override': 'Booking moved past the notice period',
    'session.create': 'Class added',
    'session.update': 'Class changed',
    'session.cancel': 'Class cancelled',
    'session.restore': 'Class put back on',
    'session.delete': 'Class deleted',
    'closedDate.create': 'Days marked closed',
    'closedDate.delete': 'Closed days reopened',
    'package.grant': 'Course package created',
    'package.adjust': 'Course package changed',
    'course.rescheduleWindowChanged': 'Notice period changed',
    'series.book': 'Set course booked',
    'series.create': 'Set course created',
    'series.update': 'Set course changed',
    'scheduleRule.deactivate': 'Weekly slot stopped',
    'maintenance.repairSeatDrift': 'Place counts corrected',
  }
  return labels[action] ?? action
}
