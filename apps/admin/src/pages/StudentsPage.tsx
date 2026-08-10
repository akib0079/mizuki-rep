import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { DateTime } from 'luxon'
import { STUDIO_TZ } from '@mizuki/shared'
import { ApiError, api, type Course, type PackageSummary, type StudentSummary } from '../api.js'

interface StudentDetail {
  student: { id: string; name: string; email: string; phone: string; notes: string }
  packages: PackageSummary[]
  bookings: {
    id: string
    status: string
    usedPackage: boolean
    session: { id: string; title: string; startAt: string; courseName: string } | null
  }[]
}

/** Students, their course packages, and the controls to top them up or extend them. */
export function StudentsPage() {
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const listQuery = useQuery({
    queryKey: ['students', search],
    queryFn: () => api.get<{ students: StudentSummary[] }>(`/api/admin/students?search=${encodeURIComponent(search)}`),
  })

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Students</h1>
          <p>Course packages, booking history and contact details.</p>
        </div>
        <input
          className="btn"
          style={{ minWidth: 220 }}
          placeholder="Search name, email or phone"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="card">
        {listQuery.isLoading ? (
          <p className="muted">Loading…</p>
        ) : listQuery.data?.students.length === 0 ? (
          <div className="empty">{search ? 'No students match that search.' : 'No students yet.'}</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Contact</th>
                <th>Course sessions left</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(listQuery.data?.students ?? []).map((s) => (
                <tr key={s.id}>
                  <td><strong>{s.name}</strong></td>
                  <td className="small muted">{s.email}{s.phone ? <><br />{s.phone}</> : null}</td>
                  <td>
                    {s.sessionsRemaining > 0 ? (
                      <span className="pill pill-ok">{s.sessionsRemaining}</span>
                    ) : (
                      <span className="pill pill-muted">—</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn btn-sm" onClick={() => setSelectedId(s.id)}>Open</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selectedId && <StudentDrawer studentId={selectedId} onClose={() => setSelectedId(null)} />}
    </>
  )
}

function StudentDrawer({ studentId, onClose }: { studentId: string; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [granting, setGranting] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['student', studentId],
    queryFn: () => api.get<StudentDetail>(`/api/admin/students/${studentId}`),
  })

  const coursesQuery = useQuery({
    queryKey: ['courses'],
    queryFn: () => api.get<{ courses: Course[] }>('/api/admin/settings/courses'),
  })

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['student', studentId] })
    void queryClient.invalidateQueries({ queryKey: ['students'] })
  }

  const adjustMutation = useMutation({
    mutationFn: (input: { id: string; addSessions?: number; extendToDate?: string | null }) =>
      api.patch(`/api/admin/students/packages/${input.id}`, {
        addSessions: input.addSessions ?? 0,
        extendToDate: input.extendToDate ?? null,
        note: 'Adjusted from the studio console',
      }),
    onSuccess: () => { setError(null); refresh() },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not update that package.'),
  })

  const grantMutation = useMutation({
    mutationFn: (input: { courseTypeId: string; totalSessions: number; expiresAt: string | null }) =>
      api.post('/api/admin/students/packages', { studentId, ...input, note: 'Created from the studio console' }),
    onSuccess: () => { setGranting(false); refresh() },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not create that package.'),
  })

  const upcoming = (data?.bookings ?? []).filter(
    (b) => b.session && new Date(b.session.startAt) >= new Date() && b.status !== 'cancelled',
  )
  const past = (data?.bookings ?? []).filter((b) => !upcoming.includes(b))

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label="Student details">
        <div className="drawer-head">
          <div>
            <h2>{data?.student.name ?? 'Student'}</h2>
            <p className="meta">
              {data?.student.email}
              {data?.student.phone ? <><br />{data.student.phone}</> : null}
            </p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="drawer-body">
          {isLoading && <p className="muted">Loading…</p>}
          {error && <div className="banner banner-danger">{error}</div>}

          <div className="section">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div className="section-title" style={{ marginBottom: 0 }}>Course packages</div>
              <button className="btn btn-sm" onClick={() => setGranting(!granting)}>
                {granting ? 'Cancel' : '+ New package'}
              </button>
            </div>

            {granting && (
              <GrantPackageForm
                courses={(coursesQuery.data?.courses ?? []).filter((c) => c.bookingMode === 'package')}
                busy={grantMutation.isPending}
                onSubmit={(input) => grantMutation.mutate(input)}
              />
            )}

            {(data?.packages ?? []).length === 0 && !granting ? (
              <div className="empty">No course packages.</div>
            ) : (
              <div className="stack" style={{ marginTop: 10 }}>
                {(data?.packages ?? []).map((p) => (
                  <div key={p.id} className="card" style={{ padding: 14 }}>
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <div>
                        <strong>{p.courseName}</strong>
                        <div className="small">
                          {p.remaining} of {p.totalSessions} sessions left
                          {p.expiresAt && (
                            <> · expires {DateTime.fromISO(p.expiresAt).setZone(STUDIO_TZ).toFormat('d LLL yyyy')}</>
                          )}
                        </div>
                      </div>
                      <span className={`pill ${p.status === 'active' ? 'pill-ok' : 'pill-muted'}`}>{p.status}</span>
                    </div>

                    <div className="row" style={{ marginTop: 10, flexWrap: 'wrap' }}>
                      <button className="btn btn-sm" disabled={adjustMutation.isPending} onClick={() => adjustMutation.mutate({ id: p.id, addSessions: 1 })}>
                        + 1 session
                      </button>
                      <button className="btn btn-sm" disabled={adjustMutation.isPending} onClick={() => adjustMutation.mutate({ id: p.id, addSessions: 4 })}>
                        + 4 sessions
                      </button>
                      <button
                        className="btn btn-sm"
                        disabled={adjustMutation.isPending}
                        onClick={() =>
                          adjustMutation.mutate({
                            id: p.id,
                            extendToDate: DateTime.fromISO(p.expiresAt ?? DateTime.now().toISO())
                              .plus({ months: 3 })
                              .toISO(),
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
          </div>

          <div className="section">
            <div className="section-title">Upcoming classes ({upcoming.length})</div>
            {upcoming.length === 0 ? (
              <div className="empty">Nothing booked.</div>
            ) : (
              <table className="table">
                <tbody>
                  {upcoming.map((b) => (
                    <tr key={b.id}>
                      <td>
                        <strong>{b.session!.title}</strong>
                        <div className="muted small">
                          {DateTime.fromISO(b.session!.startAt).setZone(STUDIO_TZ).toFormat('ccc d LLL yyyy, h:mm a')}
                        </div>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {b.usedPackage && <span className="pill pill-muted">Course session</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="section">
            <div className="section-title">Past ({past.length})</div>
            {past.length === 0 ? (
              <div className="empty">No history yet.</div>
            ) : (
              <table className="table">
                <tbody>
                  {past.slice(0, 20).map((b) => (
                    <tr key={b.id}>
                      <td className="small">
                        {b.session?.title ?? '—'}
                        <div className="muted">
                          {b.session
                            ? DateTime.fromISO(b.session.startAt).setZone(STUDIO_TZ).toFormat('d LLL yyyy')
                            : ''}
                        </div>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <span className="pill pill-muted">{b.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </aside>
    </>
  )
}

function GrantPackageForm({
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
  const [expiresAt, setExpiresAt] = useState(
    DateTime.now().setZone(STUDIO_TZ).plus({ months: 12 }).toFormat('yyyy-MM-dd'),
  )

  if (courses.length === 0) {
    return <div className="banner banner-info">No package-based courses are set up yet.</div>
  }

  return (
    <div className="card" style={{ marginTop: 10, padding: 14 }}>
      <label className="field">
        <span>Course</span>
        <select value={courseTypeId} onChange={(e) => setCourseTypeId(e.target.value)}>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
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
      <button
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
