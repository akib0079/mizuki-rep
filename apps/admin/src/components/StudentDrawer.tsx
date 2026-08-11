import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { DateTime } from 'luxon'
import { STUDIO_TZ } from '@mizuki/shared'
import { ApiError, api, type Course, type PackageSummary } from '../api.js'
import { Icon } from './Icon.js'

/**
 * Everything the studio knows about one student.
 *
 * Built around the questions actually asked mid-conversation — has she been before, did she turn
 * up last time, how many sessions has she left, what has she booked — rather than a contact card.
 * Anything editable is editable in place; nothing here sends the studio to another screen.
 */

interface BookingRow {
  id: string
  status: string
  source: string
  usedPackage: boolean
  capacityOverridden: boolean
  notes: string
  adminNotes: string
  bookedAt: string
  cancelledAt: string | null
  cancelReason: string
  wooOrderId: number | null
  session: {
    id: string
    title: string
    startAt: string
    endAt: string
    dateKey: string
    status: string
    courseName: string
    colour: string
  } | null
}

interface StudentDetail {
  student: {
    id: string
    name: string
    email: string
    phone: string
    notes: string
    marketingOptIn: boolean
    lastLoginAt: string | null
    wooCustomerId: number | null
    joinedAt: string
    firstBookedAt: string | null
  }
  stats: {
    totalBookings: number
    upcoming: number
    attended: number
    noShows: number
    cancelled: number
    attendanceRate: number | null
    sessionsRemaining: number
  }
  coursesTaken: { courseName: string; count: number }[]
  packages: (PackageSummary & { courseName: string })[]
  bookings: BookingRow[]
}

type Tab = 'overview' | 'bookings' | 'packages' | 'notes'

export function StudentDrawer({ studentId, onClose }: { studentId: string; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>('overview')
  const [message, setMessage] = useState<{ kind: 'ok' | 'danger'; text: string } | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['student', studentId],
    queryFn: () => api.get<StudentDetail>(`/api/admin/students/${studentId}`),
  })

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['student', studentId] })
    void queryClient.invalidateQueries({ queryKey: ['students'] })
  }

  if (isLoading || !data) {
    return (
      <>
        <div className="drawer-backdrop" onClick={onClose} />
        <aside className="drawer"><div className="drawer-body"><p className="muted">Loading…</p></div></aside>
      </>
    )
  }

  const { student, stats } = data
  const initials = student.name.split(' ').map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
  const now = new Date()
  const upcoming = data.bookings.filter(
    (b) => b.session && new Date(b.session.startAt) >= now && b.status !== 'cancelled',
  )
  const history = data.bookings.filter((b) => !upcoming.includes(b))

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer drawer-wide" role="dialog" aria-label={`${student.name} — student details`}>
        <div className="drawer-head">
          <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
            <div className="avatar avatar-lg">{initials || '·'}</div>
            <div style={{ minWidth: 0 }}>
              <h2>{student.name}</h2>
              <p className="meta">
                <a href={`mailto:${student.email}`} className="link">{student.email}</a>
                {student.phone && (
                  <>
                    <br />
                    <a href={`tel:${student.phone.replace(/\s/g, '')}`} className="link">{student.phone}</a>
                  </>
                )}
              </p>
              <div className="row" style={{ gap: 5, marginTop: 7, flexWrap: 'wrap' }}>
                {stats.sessionsRemaining > 0 && (
                  <span className="pill pill-ok">{stats.sessionsRemaining} sessions left</span>
                )}
                {stats.upcoming > 0 && <span className="pill pill-info">{stats.upcoming} upcoming</span>}
                {stats.noShows > 0 && <span className="pill pill-warn">{stats.noShows} no-show</span>}
                {student.marketingOptIn && <span className="pill pill-muted">Marketing opt-in</span>}
                {student.wooCustomerId && <span className="pill pill-muted">Shop #{student.wooCustomerId}</span>}
              </div>
            </div>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </div>

        <div className="tabs" role="tablist">
          {([
            ['overview', 'Overview'],
            ['bookings', `Bookings (${data.bookings.length})`],
            ['packages', `Packages (${data.packages.length})`],
            ['notes', 'Details'],
          ] as [Tab, string][]).map(([key, label]) => (
            <button type="button"
              key={key}
              role="tab"
              aria-selected={tab === key}
              className={tab === key ? 'tab active' : 'tab'}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="drawer-body">
          {message && <div className={`banner banner-${message.kind}`}>{message.text}</div>}

          {tab === 'overview' && (
            <>
              <div className="grid grid-2" style={{ marginBottom: 18 }}>
                <MiniStat label="Classes booked" value={stats.totalBookings} />
                <MiniStat label="Attended" value={stats.attended} />
                <MiniStat
                  label="Attendance"
                  value={stats.attendanceRate === null ? '—' : `${stats.attendanceRate}%`}
                  hint={stats.attendanceRate === null ? 'No classes yet' : `${stats.noShows} missed`}
                />
                <MiniStat label="Cancelled" value={stats.cancelled} />
              </div>

              {data.coursesTaken.length > 0 && (
                <div className="section">
                  <div className="section-title">Courses taken</div>
                  <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                    {data.coursesTaken.map((c) => (
                      <span className="pill pill-muted" key={c.courseName}>
                        {c.courseName} · {c.count}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="section">
                <div className="section-title">Next classes</div>
                {upcoming.length === 0 ? (
                  <div className="empty">Nothing booked.</div>
                ) : (
                  upcoming.slice(0, 5).map((b) => <BookingLine key={b.id} booking={b} />)
                )}
              </div>

              <div className="section">
                <div className="section-title">On file since</div>
                <p className="small muted" style={{ margin: 0 }}>
                  Added {DateTime.fromISO(student.joinedAt).setZone(STUDIO_TZ).toFormat('d LLLL yyyy')}
                  {student.firstBookedAt &&
                    ` · first booked ${DateTime.fromISO(student.firstBookedAt).setZone(STUDIO_TZ).toFormat('d LLL yyyy')}`}
                  {student.lastLoginAt
                    ? ` · last signed in ${DateTime.fromISO(student.lastLoginAt).setZone(STUDIO_TZ).toRelative()}`
                    : ' · has never signed in'}
                </p>
              </div>
            </>
          )}

          {tab === 'bookings' && (
            <>
              <div className="section">
                <div className="section-title">Upcoming ({upcoming.length})</div>
                {upcoming.length === 0 ? (
                  <div className="empty">Nothing booked.</div>
                ) : (
                  upcoming.map((b) => <BookingLine key={b.id} booking={b} detailed />)
                )}
              </div>
              <div className="section">
                <div className="section-title">History ({history.length})</div>
                {history.length === 0 ? (
                  <div className="empty">No history yet.</div>
                ) : (
                  history.map((b) => <BookingLine key={b.id} booking={b} detailed />)
                )}
              </div>
            </>
          )}

          {tab === 'packages' && (
            <PackagesTab
              studentId={studentId}
              packages={data.packages}
              onChanged={refresh}
              onMessage={setMessage}
            />
          )}

          {tab === 'notes' && (
            <DetailsTab student={student} onChanged={refresh} onMessage={setMessage} />
          )}
        </div>
      </aside>
    </>
  )
}

function MiniStat({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="mini-stat">
      <div className="mini-stat-value">{value}</div>
      <div className="mini-stat-label">{label}</div>
      {hint && <div className="mini-stat-hint">{hint}</div>}
    </div>
  )
}

function BookingLine({ booking, detailed = false }: { booking: BookingRow; detailed?: boolean }) {
  const session = booking.session
  if (!session) return null

  const start = DateTime.fromISO(session.startAt).setZone(STUDIO_TZ)

  return (
    <div className="booking-line">
      <span className="booking-stripe" style={{ background: session.colour }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="row-title">{session.title}</div>
        <div className="row-sub">
          {start.toFormat('ccc d LLL yyyy, h:mm a')} · {session.courseName}
        </div>
        {detailed && (
          <div className="row" style={{ gap: 5, marginTop: 5, flexWrap: 'wrap' }}>
            <StatusPill status={booking.status} />
            {booking.usedPackage && <span className="pill pill-muted">Course session</span>}
            {booking.source === 'admin_manual' && <span className="pill pill-muted">Added by studio</span>}
            {booking.source === 'woo_order' && <span className="pill pill-muted">Shop order</span>}
            {booking.capacityOverridden && <span className="pill pill-warn">Over capacity</span>}
            {booking.wooOrderId && <span className="pill pill-muted">Order #{booking.wooOrderId}</span>}
          </div>
        )}
        {detailed && booking.notes && <div className="row-sub" style={{ marginTop: 4 }}>“{booking.notes}”</div>}
        {detailed && booking.cancelReason && (
          <div className="row-sub" style={{ marginTop: 4 }}>Cancelled — {booking.cancelReason}</div>
        )}
      </div>
      {!detailed && <StatusPill status={booking.status} />}
    </div>
  )
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    confirmed: ['pill-ok', 'Confirmed'],
    hold: ['pill-warn', 'Awaiting payment'],
    attended: ['pill-ok', 'Attended'],
    no_show: ['pill-danger', 'No show'],
    cancelled: ['pill-muted', 'Cancelled'],
  }
  const [cls, label] = map[status] ?? ['pill-muted', status]
  return <span className={`pill ${cls}`}>{label}</span>
}

function PackagesTab({
  studentId,
  packages,
  onChanged,
  onMessage,
}: {
  studentId: string
  packages: (PackageSummary & { courseName: string })[]
  onChanged: () => void
  onMessage: (m: { kind: 'ok' | 'danger'; text: string }) => void
}) {
  const [granting, setGranting] = useState(false)

  const coursesQuery = useQuery({
    queryKey: ['courses'],
    queryFn: () => api.get<{ courses: Course[] }>('/api/admin/settings/courses'),
  })

  const adjust = useMutation({
    mutationFn: (input: { id: string; addSessions?: number; extendToDate?: string | null }) =>
      api.patch(`/api/admin/students/packages/${input.id}`, {
        addSessions: input.addSessions ?? 0,
        extendToDate: input.extendToDate ?? null,
        note: 'Adjusted from the studio console',
      }),
    onSuccess: () => { onMessage({ kind: 'ok', text: 'Package updated.' }); onChanged() },
    onError: (err) => onMessage({ kind: 'danger', text: err instanceof ApiError ? err.message : 'Could not update.' }),
  })

  const grant = useMutation({
    mutationFn: (input: { courseTypeId: string; totalSessions: number; expiresAt: string | null }) =>
      api.post('/api/admin/students/packages', { studentId, ...input, note: 'Created from the studio console' }),
    onSuccess: () => { setGranting(false); onMessage({ kind: 'ok', text: 'Package created.' }); onChanged() },
    onError: (err) => onMessage({ kind: 'danger', text: err instanceof ApiError ? err.message : 'Could not create.' }),
  })

  const packageCourses = (coursesQuery.data?.courses ?? []).filter((c) => c.bookingMode === 'package')

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <div className="section-title" style={{ marginBottom: 0 }}>Course packages</div>
        <button type="button" className="btn btn-sm" onClick={() => setGranting(!granting)}>
          {granting ? 'Cancel' : '+ New package'}
        </button>
      </div>

      {granting && <GrantForm courses={packageCourses} busy={grant.isPending} onSubmit={(i) => grant.mutate(i)} />}

      {packages.length === 0 && !granting ? (
        <div className="empty">No course packages.</div>
      ) : (
        <div className="stack">
          {packages.map((p) => (
            <div key={p.id} className="card" style={{ padding: 14 }}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <strong>{p.courseName}</strong>
                  <div className="small muted">
                    {p.remaining} of {p.totalSessions} left · {p.usedSessions} used
                    {p.expiresAt && ` · expires ${DateTime.fromISO(p.expiresAt).setZone(STUDIO_TZ).toFormat('d LLL yyyy')}`}
                  </div>
                </div>
                <span className={`pill ${p.status === 'active' ? 'pill-ok' : 'pill-muted'}`}>{p.status}</span>
              </div>

              <div className="progress" style={{ marginTop: 10 }}>
                <span style={{ width: `${p.totalSessions ? (p.usedSessions / p.totalSessions) * 100 : 0}%` }} />
              </div>

              <div className="row" style={{ marginTop: 11, flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-sm" disabled={adjust.isPending} onClick={() => adjust.mutate({ id: p.id, addSessions: 1 })}>+ 1 session</button>
                <button type="button" className="btn btn-sm" disabled={adjust.isPending} onClick={() => adjust.mutate({ id: p.id, addSessions: 4 })}>+ 4 sessions</button>
                <button type="button"
                  className="btn btn-sm"
                  disabled={adjust.isPending}
                  onClick={() =>
                    adjust.mutate({
                      id: p.id,
                      extendToDate: DateTime.fromISO(p.expiresAt ?? DateTime.now().toISO(), { zone: STUDIO_TZ }).plus({ months: 3 }).toISO(),
                    })
                  }
                >
                  + 3 months
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

function GrantForm({
  courses,
  busy,
  onSubmit,
}: {
  courses: Course[]
  busy: boolean
  onSubmit: (input: { courseTypeId: string; totalSessions: number; expiresAt: string | null }) => void
}) {
  const [courseTypeId, setCourseTypeId] = useState(courses[0]?.id ?? '')
  const [totalSessions, setTotalSessions] = useState(8)
  const [expiresAt, setExpiresAt] = useState(DateTime.now().setZone(STUDIO_TZ).plus({ months: 12 }).toFormat('yyyy-MM-dd'))

  if (courses.length === 0) return <div className="banner banner-info">No package-based courses are set up yet.</div>

  return (
    <div className="card" style={{ padding: 14, marginBottom: 12 }}>
      <label className="field">
        <span>Course</span>
        <select value={courseTypeId} onChange={(e) => setCourseTypeId(e.target.value)}>
          {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <div className="field-row">
        <label className="field">
          <span>Sessions</span>
          <input type="number" min={1} value={totalSessions} onChange={(e) => setTotalSessions(Number(e.target.value))} />
        </label>
        <label className="field">
          <span>Expires</span>
          <input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
        </label>
      </div>
      <button type="button"
        className="btn btn-primary btn-sm"
        disabled={busy || !courseTypeId}
        onClick={() =>
          onSubmit({
            courseTypeId,
            totalSessions,
            expiresAt: expiresAt ? DateTime.fromISO(expiresAt, { zone: STUDIO_TZ }).endOf('day').toISO() : null,
          })
        }
      >
        {busy ? 'Creating…' : 'Create package'}
      </button>
    </div>
  )
}

function DetailsTab({
  student,
  onChanged,
  onMessage,
}: {
  student: StudentDetail['student']
  onChanged: () => void
  onMessage: (m: { kind: 'ok' | 'danger'; text: string }) => void
}) {
  const [form, setForm] = useState({
    name: student.name,
    email: student.email,
    phone: student.phone,
    notes: student.notes,
    marketingOptIn: student.marketingOptIn,
  })

  const save = useMutation({
    mutationFn: () => api.patch(`/api/admin/students/${student.id}`, form),
    onSuccess: () => { onMessage({ kind: 'ok', text: 'Saved.' }); onChanged() },
    onError: (err) => onMessage({ kind: 'danger', text: err instanceof ApiError ? err.message : 'Could not save.' }),
  })

  return (
    <>
      <label className="field">
        <span>Name</span>
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </label>
      <label className="field">
        <span>Email</span>
        <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <div className="field-hint">Confirmations, reminders and sign-in links all go here.</div>
      </label>
      <label className="field">
        <span>Phone</span>
        <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
      </label>
      <label className="field">
        <span>Private notes</span>
        <textarea
          rows={5}
          value={form.notes}
          placeholder="Allergies, preferences, anything worth remembering…"
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
        />
        <div className="field-hint">Only you see these — never shown to the student.</div>
      </label>
      <label className="row" style={{ gap: 8, marginBottom: 16, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={form.marketingOptIn}
          onChange={(e) => setForm({ ...form, marketingOptIn: e.target.checked })}
        />
        <span className="small">Happy to receive news about upcoming workshops</span>
      </label>

      <button type="button" className="btn btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>
        {save.isPending ? 'Saving…' : 'Save changes'}
      </button>
    </>
  )
}
