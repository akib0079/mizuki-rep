import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../api.js'
import { Icon } from '../components/Icon.js'
import { SkeletonCards } from '../components/Skeleton.js'

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
  student: { id: string; reference: string; name: string; email: string; phone: string }
  paid: boolean
  session: { id: string; title: string; startAt: string; when: string; courseName: string }
}

interface HistoryRow {
  id: string
  outcome: 'confirmed' | 'declined'
  at: string | null
  reason: string
  wooOrderId: number | null
  student: { id: string; reference: string; name: string; email: string }
  session: { id: string; title: string; startAt: string; when: string }
}

/** "3 hours ago" reads faster than a timestamp when scanning a list of decisions. */
function relative(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (mins < 60) return `${Math.max(mins, 1)} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days} ${days === 1 ? 'day' : 'days'} ago`
  return new Date(iso).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })
}

export function PaymentsPage() {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<'waiting' | 'history'>('waiting')
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
    // The decision that just left the queue is the newest row in the history.
    void queryClient.invalidateQueries({ queryKey: ['payments-history'] })
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

  /*
   * Loaded alongside the queue rather than on demand, because the question it answers — "did I
   * already deal with this person?" — comes up while looking at the queue, not instead of it.
   */
  const history = useQuery({
    queryKey: ['payments-history'],
    queryFn: () => api.get<{ bookings: HistoryRow[] }>('/api/admin/notifications/history'),
  })
  const past = history.data?.bookings ?? []

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Payments</h1>
          {/* The description follows the tab: describing the queue while showing the history is
              a small lie that makes the screen harder to trust. */}
          <p className="muted">
            {tab === 'waiting'
              ? 'Everyone here is holding a place that is not confirmed yet. Some have paid and need the money checked; others asked to join and still need payment arranging. Their seats are held either way, so nobody else can take them while you sort it out.'
              : 'Places you have already confirmed or turned down, most recent first.'}
          </p>
        </div>
      </header>

      <div className="tabs tabs-standalone" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'waiting'}
          className={tab === 'waiting' ? 'tab active' : 'tab'}
          onClick={() => setTab('waiting')}
        >
          Waiting{rows.length > 0 && <span className="pill pill-warn" style={{ marginLeft: 7 }}>{rows.length}</span>}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'history'}
          className={tab === 'history' ? 'tab active' : 'tab'}
          onClick={() => setTab('history')}
        >
          History
        </button>
      </div>

      {error && (
        <div className="note note-error" role="alert">
          {error}
        </div>
      )}

      {tab === 'waiting' && (isPending ? (
        <SkeletonCards count={2} />
      ) : rows.length === 0 ? (
        <div className="card empty-state">
          <Icon name="check" size={22} />
          <p><strong>Nothing waiting.</strong></p>
          <p className="muted">
            Places waiting on a payment check, or on a student who has no course package yet,
            appear here.
          </p>
        </div>
      ) : (
        <div className="stack">
          {rows.map((row) => (
            <article className="card payment-row" key={row.id}>
              <div className="payment-main">
                <h3>
                  {row.student.name}
                  {/* Two students can share a name — this is what separates them. */}
                  {row.student.reference && <span className="student-ref">{row.student.reference}</span>}
                </h3>
                <p className="muted">
                  {row.session.title} · {row.session.when}
                </p>
                <p className="muted small">
                  {row.student.email}
                  {row.student.phone && ` · ${row.student.phone}`}
                  {row.paid
                    ? ` · paid, shop order #${row.wooOrderId}`
                    : ' · no payment yet — arrange it before confirming'}
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
      ))}

      {tab === 'history' &&
        (history.isPending ? (
          <SkeletonCards count={3} />
        ) : past.length === 0 ? (
          <div className="card empty-state">
            <p className="muted">Nothing has been confirmed or declined yet.</p>
          </div>
        ) : (
          <div className="card card-pad-0">
            <table className="table">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Class</th>
                  <th>Outcome</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {past.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <strong>{row.student.name}</strong>
                      {row.student.reference && <span className="student-ref">{row.student.reference}</span>}
                      <div className="small muted">{row.student.email}</div>
                    </td>
                    <td className="small">
                      {row.session.title}
                      <div className="muted">{row.session.when}</div>
                    </td>
                    <td>
                      {row.outcome === 'confirmed' ? (
                        <span className="pill pill-ok">Confirmed</span>
                      ) : (
                        <span className="pill pill-danger">Declined</span>
                      )}
                      {/* Why it was declined matters later, when the student asks. */}
                      {row.reason && <div className="small muted">{row.reason}</div>}
                    </td>
                    <td className="small muted">{row.at ? relative(row.at) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

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
