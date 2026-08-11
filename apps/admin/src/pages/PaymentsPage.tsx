import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../api.js'
import { Icon } from '../components/Icon.js'

/**
 * Places that have been paid for and are waiting on the studio's check.
 *
 * One screen rather than a badge that sends you hunting through the calendar: the studio's own
 * description of the job was "check the payment, then confirm the slot", and every one of these
 * is a student who has been charged and has no confirmation yet. Oldest first, because the
 * person who has waited longest is the one most likely to be about to email and ask.
 */

interface AwaitingRow {
  id: string
  waitingSince: string
  wooOrderId: number | null
  student: { id: string; name: string; email: string; phone: string }
  session: { id: string; title: string; startAt: string; when: string; courseName: string }
}

export function PaymentsPage() {
  const queryClient = useQueryClient()
  const [declining, setDeclining] = useState<AwaitingRow | null>(null)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  const { data, isPending } = useQuery({
    queryKey: ['awaiting-confirmation'],
    queryFn: () => api.get<{ bookings: AwaitingRow[] }>('/api/admin/notifications/awaiting-confirmation'),
  })

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['awaiting-confirmation'] })
    void queryClient.invalidateQueries({ queryKey: ['notifications'] })
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
  }

  const approve = useMutation({
    mutationFn: (id: string) => api.post(`/api/admin/notifications/bookings/${id}/approve`),
    onSuccess: refresh,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'That did not save.'),
  })

  const decline = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.post(`/api/admin/notifications/bookings/${id}/decline`, { reason }),
    onSuccess: () => {
      setDeclining(null)
      setReason('')
      refresh()
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'That did not save.'),
  })

  const rows = data?.bookings ?? []

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Payments to check</h1>
          <p className="muted">
            These students have paid. Check the money arrived, then confirm their place — their
            seat is held until you do.
          </p>
        </div>
      </header>

      {error && (
        <div className="note note-error" role="alert">
          {error}
        </div>
      )}

      {isPending ? (
        <div className="card"><p className="muted">Loading…</p></div>
      ) : rows.length === 0 ? (
        <div className="card empty-state">
          <Icon name="check" size={22} />
          <p><strong>Nothing waiting.</strong></p>
          <p className="muted">
            When someone pays for a course you confirm by hand, it appears here.
          </p>
        </div>
      ) : (
        <div className="stack">
          {rows.map((row) => (
            <article className="card payment-row" key={row.id}>
              <div className="payment-main">
                <h3>{row.student.name}</h3>
                <p className="muted">
                  {row.session.title} · {row.session.when}
                </p>
                <p className="muted small">
                  {row.student.email}
                  {row.student.phone && ` · ${row.student.phone}`}
                  {row.wooOrderId ? ` · shop order #${row.wooOrderId}` : ' · no shop order recorded'}
                </p>
                <p className="small waiting-since">Waiting {waitedFor(row.waitingSince)}</p>
              </div>

              <div className="payment-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    setError(null)
                    approve.mutate(row.id)
                  }}
                  disabled={approve.isPending}
                >
                  Confirm place
                </button>
                <button
                  type="button"
                  className="btn btn-quiet"
                  onClick={() => {
                    setError(null)
                    setDeclining(row)
                  }}
                >
                  No payment
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {declining && (
        <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && setDeclining(null)}>
          <div className="modal" role="dialog" aria-modal="true" aria-label="Release this place">
            <h3>Release {declining.student.name}&rsquo;s place?</h3>
            <p className="muted">
              This cancels their booking and puts the place back on the calendar. They will be
              emailed, so tell them why.
            </p>

            <label className="field">
              <span>Reason</span>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="We could not find your payment"
                autoFocus
              />
            </label>

            <div className="modal-actions">
              <button type="button" className="btn btn-quiet" onClick={() => setDeclining(null)}>
                Keep it
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => decline.mutate({ id: declining.id, reason })}
                disabled={decline.isPending}
              >
                Release the place
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function waitedFor(iso: string): string {
  const mins = Math.max(Math.round((Date.now() - new Date(iso).getTime()) / 60_000), 1)
  if (mins < 60) return `${mins} ${mins === 1 ? 'minute' : 'minutes'}`

  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'}`

  const days = Math.round(hours / 24)
  return `${days} ${days === 1 ? 'day' : 'days'}`
}
