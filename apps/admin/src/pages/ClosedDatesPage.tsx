import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { DateTime } from 'luxon'
import { STUDIO_TZ } from '@mizuki/shared'
import { ApiError, api, type AwayPreview, type ClosedDate } from '../api.js'

/**
 * "Mark the days you're closed and they disappear from the calendar instantly."
 *
 * Because the teacher travels for outside work, closing a range shows exactly which classes and
 * which students it touches before anything is saved. Closing hides the days; cancelling the
 * classes on them is a second, deliberate step, so a mistyped date cannot wipe out a weekend.
 */
export function ClosedDatesPage() {
  const queryClient = useQueryClient()
  const today = DateTime.now().setZone(STUDIO_TZ).toFormat('yyyy-MM-dd')

  const [form, setForm] = useState({ startDate: today, endDate: today, reason: '' })
  const [preview, setPreview] = useState<AwayPreview | null>(null)
  const [error, setError] = useState<string | null>(null)

  const closedQuery = useQuery({
    queryKey: ['closed-dates'],
    queryFn: () => api.get<{ closedDates: ClosedDate[] }>('/api/admin/closed-dates'),
  })

  const previewMutation = useMutation({
    mutationFn: () => api.post<AwayPreview>('/api/admin/closed-dates/preview', form),
    onSuccess: (data) => { setPreview(data); setError(null) },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not check those dates.'),
  })

  const createMutation = useMutation({
    mutationFn: () => api.post<{ sessionsHidden: number }>('/api/admin/closed-dates', form),
    onSuccess: () => {
      setPreview(null)
      setForm({ startDate: today, endDate: today, reason: '' })
      void queryClient.invalidateQueries({ queryKey: ['closed-dates'] })
      void queryClient.invalidateQueries({ queryKey: ['admin-sessions'] })
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not save those dates.'),
  })

  const cancelSessionMutation = useMutation({
    mutationFn: (sessionId: string) =>
      api.post(`/api/admin/sessions/${sessionId}/cancel`, { reason: form.reason || 'Studio closed', notifyStudents: true }),
    onSuccess: () => {
      void previewMutation.mutateAsync()
      void queryClient.invalidateQueries({ queryKey: ['admin-sessions'] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/admin/closed-dates/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['closed-dates'] })
      void queryClient.invalidateQueries({ queryKey: ['admin-sessions'] })
    },
  })

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Closed dates</h1>
          <p>Days the studio is shut. They drop off the booking calendar straight away.</p>
        </div>
      </div>

      <div className="card">
        <h2 className="card-title">Close some days</h2>
        <p className="card-sub">Use this for holidays, or when you are away for outside work.</p>

        {error && <div className="banner banner-danger">{error}</div>}

        <div className="field-row">
          <label className="field">
            <span>From</span>
            <input
              type="date"
              value={form.startDate}
              onChange={(e) => {
                const startDate = e.target.value
                setPreview(null)
                // Keep the range valid as the start moves past the end.
                setForm((f) => ({ ...f, startDate, endDate: f.endDate < startDate ? startDate : f.endDate }))
              }}
            />
          </label>
          <label className="field">
            <span>To</span>
            <input
              type="date"
              min={form.startDate}
              value={form.endDate}
              onChange={(e) => { setPreview(null); setForm({ ...form, endDate: e.target.value }) }}
            />
          </label>
        </div>

        <label className="field">
          <span>Reason (only you see this)</span>
          <input
            value={form.reason}
            placeholder="Away for outside work"
            onChange={(e) => setForm({ ...form, reason: e.target.value })}
          />
        </label>

        <div className="row">
          <button className="btn" onClick={() => previewMutation.mutate()} disabled={previewMutation.isPending}>
            {previewMutation.isPending ? 'Checking…' : 'Check what this affects'}
          </button>
          <button className="btn btn-primary" onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
            {createMutation.isPending ? 'Saving…' : 'Close these days'}
          </button>
        </div>
      </div>

      {preview && (
        <div className="card">
          <h2 className="card-title">What this affects</h2>
          <p className="card-sub">
            {preview.days} day{preview.days === 1 ? '' : 's'} · {preview.sessionCount} class
            {preview.sessionCount === 1 ? '' : 'es'} · {preview.affectedStudentCount} student
            {preview.affectedStudentCount === 1 ? '' : 's'} booked
          </p>

          {preview.sessionCount === 0 ? (
            <div className="banner banner-ok">Nothing is scheduled on those days — closing them affects nobody.</div>
          ) : preview.affectedStudentCount === 0 ? (
            <div className="banner banner-ok">
              These classes will disappear from the booking calendar. Nobody is booked into them, so no
              one needs to be told.
            </div>
          ) : (
            <div className="banner banner-warn">
              Closing these days hides the classes from students, but does <strong>not</strong> cancel
              existing bookings. Cancel each class below to tell those students and return any course
              sessions they used.
            </div>
          )}

          {preview.sessions.length > 0 && (
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Class</th>
                  <th>Booked</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {preview.sessions.map((s) => (
                  <tr key={s.id}>
                    <td className="small">
                      {DateTime.fromISO(s.startAt).setZone(STUDIO_TZ).toFormat('ccc d LLL, h:mm a')}
                    </td>
                    <td>
                      {s.title}
                      {s.students.length > 0 && (
                        <div className="muted small">{s.students.map((st) => st.name).join(', ')}</div>
                      )}
                    </td>
                    <td>
                      {s.bookedCount > 0 ? (
                        <span className="pill pill-warn">{s.bookedCount}</span>
                      ) : (
                        <span className="pill pill-muted">0</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        className="btn btn-sm btn-danger"
                        disabled={cancelSessionMutation.isPending}
                        onClick={() => cancelSessionMutation.mutate(s.id)}
                      >
                        Cancel {s.bookedCount > 0 ? '& notify' : ''}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <div className="card">
        <h2 className="card-title">Already closed</h2>
        {closedQuery.data?.closedDates.length === 0 ? (
          <div className="empty">No closed dates yet.</div>
        ) : (
          <table className="table">
            <tbody>
              {(closedQuery.data?.closedDates ?? []).map((c) => (
                <tr key={c.id}>
                  <td>
                    <strong>
                      {c.startDate === c.endDate
                        ? DateTime.fromISO(c.startDate).toFormat('ccc d LLL yyyy')
                        : `${DateTime.fromISO(c.startDate).toFormat('d LLL')} – ${DateTime.fromISO(c.endDate).toFormat('d LLL yyyy')}`}
                    </strong>
                    {c.reason && <div className="muted small">{c.reason}</div>}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn btn-sm" onClick={() => deleteMutation.mutate(c.id)}>
                      Reopen
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
