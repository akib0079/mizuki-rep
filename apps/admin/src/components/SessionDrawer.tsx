import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { DateTime } from 'luxon'
import { STUDIO_TZ } from '@mizuki/shared'
import { ApiError, api, type RosterEntry } from '../api.js'
import { AddStudentDialog } from './AddStudentDialog.js'
import { ConfirmDialog } from './ConfirmDialog.js'

interface SessionDetail {
  session: {
    id: string
    courseTypeId: string
    courseName: string
    title: string
    startAt: string
    endAt: string
    dateKey: string
    capacity: number
    heldBack: number
    seatsTaken: number
    seatsLeft: number
    overCapacity: boolean
    status: 'scheduled' | 'cancelled'
    notes: string
    isRecurring: boolean
  }
  roster: RosterEntry[]
}

/**
 * Everything about one class in a side panel: who is coming, how many places are on sale,
 * and the two controls the client asked for by name — adding a chat booking by hand, and the
 * minus button that withholds places without pretending the room got smaller.
 */
export function SessionDrawer({
  sessionId,
  onClose,
  onChanged,
}: {
  sessionId: string
  onClose: () => void
  onChanged: () => void
}) {
  const queryClient = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => api.get<SessionDetail>(`/api/admin/sessions/${sessionId}`),
  })

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['session', sessionId] })
    onChanged()
  }

  const heldBackMutation = useMutation({
    mutationFn: (delta: number) => api.post(`/api/admin/sessions/${sessionId}/held-back`, { delta }),
    onSuccess: () => { setError(null); refresh() },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not change held-back places.'),
  })

  const capacityMutation = useMutation({
    mutationFn: (capacity: number) => api.patch(`/api/admin/sessions/${sessionId}`, { capacity }),
    onSuccess: () => { setError(null); refresh() },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not change the class size.'),
  })

  const removeMutation = useMutation({
    mutationFn: (bookingId: string) => api.post(`/api/admin/students/bookings/${bookingId}/cancel`, { reason: 'Removed by the studio' }),
    onSuccess: refresh,
  })

  const attendanceMutation = useMutation({
    mutationFn: (input: { bookingId: string; status: string }) =>
      api.post(`/api/admin/students/bookings/${input.bookingId}/attendance`, { status: input.status }),
    onSuccess: refresh,
  })

  const cancelSessionMutation = useMutation({
    mutationFn: (notifyStudents: boolean) =>
      api.post<{ studentsNotified: number }>(`/api/admin/sessions/${sessionId}/cancel`, {
        reason: '',
        notifyStudents,
      }),
    onSuccess: () => { setCancelling(false); refresh() },
  })

  /** Undo a cancellation — puts the class back on and re-books whoever it removed. */
  const restoreMutation = useMutation({
    mutationFn: () =>
      api.post<{ studentsRestored: number; couldNotFit: { name: string; email: string }[] }>(
        `/api/admin/sessions/${sessionId}/restore`,
        { rebookStudents: true },
      ),
    onSuccess: (data) => {
      setError(
        data.couldNotFit.length > 0
          ? `Class restored, but ${data.couldNotFit.map((s) => s.name).join(', ')} could not be fitted back in — the class is now too small. Please contact them.`
          : null,
      )
      refresh()
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not put that class back on.'),
  })

  const session = data?.session
  const roster = data?.roster ?? []
  const liveRoster = roster.filter((r) => r.status !== 'cancelled')

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label="Class details">
        <div className="drawer-head">
          <div>
            <h2>{session?.title ?? 'Class'}</h2>
            {session && (
              <p className="meta">
                {DateTime.fromISO(session.startAt).setZone(STUDIO_TZ).toFormat('cccc d LLLL yyyy')}
                <br />
                {DateTime.fromISO(session.startAt).setZone(STUDIO_TZ).toFormat('h:mm a')} –{' '}
                {DateTime.fromISO(session.endAt).setZone(STUDIO_TZ).toFormat('h:mm a')} · {session.courseName}
              </p>
            )}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="drawer-body">
          {isLoading && <p className="muted">Loading…</p>}
          {error && <div className="banner banner-danger">{error}</div>}

          {session?.status === 'cancelled' && (
            <div className="banner banner-danger">
              This class has been cancelled.
              <div style={{ marginTop: 8 }}>
                <button type="button"
                  className="btn btn-sm"
                  disabled={restoreMutation.isPending}
                  onClick={() => restoreMutation.mutate()}
                >
                  {restoreMutation.isPending ? 'Putting it back…' : 'Put this class back on'}
                </button>
              </div>
            </div>
          )}

          {session?.overCapacity && (
            <div className="banner banner-warn">
              More students are booked than this class now holds. Nobody has been removed — move or
              cancel someone below to bring it back within the limit.
            </div>
          )}

          {session && (
            <>
              <div className="section">
                <div className="stat-row">
                  <div className="stat">
                    <div className="n">{session.seatsTaken}</div>
                    <div className="l">Booked</div>
                  </div>
                  <div className="stat">
                    <div className="n">{session.seatsLeft}</div>
                    <div className="l">On sale</div>
                  </div>
                  <div className="stat">
                    <div className="n">{session.heldBack}</div>
                    <div className="l">Held back</div>
                  </div>
                  <div className="stat">
                    <div className="n">{session.capacity}</div>
                    <div className="l">Class size</div>
                  </div>
                </div>
              </div>

              <div className="section">
                <div className="section-title">Class size</div>
                <div className="stepper">
                  <button type="button"
                    onClick={() => capacityMutation.mutate(session.capacity - 1)}
                    disabled={session.capacity <= 1 || capacityMutation.isPending}
                    aria-label="Reduce class size"
                  >−</button>
                  <span className="value">{session.capacity}</span>
                  <button type="button"
                    onClick={() => capacityMutation.mutate(session.capacity + 1)}
                    disabled={capacityMutation.isPending}
                    aria-label="Increase class size"
                  >+</button>
                  <span className="muted small">places in the room</span>
                </div>
              </div>

              <div className="section">
                <div className="section-title">Held back for chat bookings</div>
                <div className="stepper">
                  <button type="button"
                    onClick={() => heldBackMutation.mutate(-1)}
                    disabled={session.heldBack === 0 || heldBackMutation.isPending}
                    aria-label="Release a held-back place"
                  >−</button>
                  <span className="value">{session.heldBack}</span>
                  <button type="button"
                    onClick={() => heldBackMutation.mutate(1)}
                    disabled={session.seatsLeft === 0 || heldBackMutation.isPending}
                    aria-label="Hold back a place"
                  >+</button>
                  <span className="muted small">kept off the website</span>
                </div>
                <div className="field-hint">
                  Held-back places stay yours to fill by hand. Students cannot book them online.
                </div>
              </div>

              <div className="section">
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <div className="section-title" style={{ marginBottom: 0 }}>
                    Who is coming ({liveRoster.length})
                  </div>
                  <button type="button" className="btn btn-sm" onClick={() => setAdding(true)}>+ Add student</button>
                </div>

                {liveRoster.length === 0 ? (
                  <div className="empty">Nobody booked yet.</div>
                ) : (
                  <div className="table-wrap">
                    <table className="table" style={{ marginTop: 10 }}>
                      <tbody>
                        {liveRoster.map((entry) => (
                          <tr key={entry.bookingId}>
                            <td>
                              <div style={{ fontWeight: 600 }}>
                                {entry.name}
                                {/* Whose account this sits on, when the attendee is someone else. */}
                                {entry.bookedBy && (
                                  <span className="small muted" style={{ marginLeft: 6, fontWeight: 400 }}>
                                    booked by {entry.bookedBy}
                                  </span>
                                )}
                              </div>
                              <div className="muted small">{entry.email}{entry.phone ? ` · ${entry.phone}` : ''}</div>
                              <div style={{ marginTop: 4, display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                                {entry.status === 'hold' && <span className="pill pill-warn">Awaiting payment</span>}
                                {entry.status === 'attended' && <span className="pill pill-ok">Attended</span>}
                                {entry.status === 'no_show' && <span className="pill pill-danger">No show</span>}
                                {entry.usedPackage && <span className="pill pill-muted">Course session</span>}
                                {entry.source === 'admin_manual' && <span className="pill pill-muted">Added by you</span>}
                                {entry.capacityOverridden && <span className="pill pill-warn">Over capacity</span>}
                              </div>
                            </td>
                            <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                              <button type="button"
                                className="btn btn-sm"
                                onClick={() =>
                                  attendanceMutation.mutate({
                                    bookingId: entry.bookingId,
                                    status: entry.status === 'attended' ? 'confirmed' : 'attended',
                                  })
                                }
                                title="Mark attendance"
                              >
                                {entry.status === 'attended' ? 'Undo' : '✓'}
                              </button>{' '}
                              <button type="button"
                                className="btn btn-sm"
                                onClick={() => {
                                  if (confirm(`Remove ${entry.name} from this class? Any course session they used is returned.`)) {
                                    removeMutation.mutate(entry.bookingId)
                                  }
                                }}
                              >
                                Remove
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {session.notes && (
                <div className="section">
                  <div className="section-title">Notes</div>
                  <p className="small">{session.notes}</p>
                </div>
              )}
            </>
          )}
        </div>

        <div className="drawer-foot">
          {/* Grouped, so the footer's space-between keeps Done on its own at the far end. */}
          <div className="row" style={{ gap: 8 }}>
            <button type="button"
              className="btn btn-danger btn-sm"
              disabled={session?.status === 'cancelled'}
              onClick={() => setCancelling(true)}
            >
              Cancel class
            </button>
            {/*
              Quieter than Cancel, which is the one the studio wants nearly every time —
              cancelling tells the students and gives their course sessions back; this does
              neither.
            */}
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => setDeleting(true)}>
              Delete
            </button>
          </div>
          <button type="button" className="btn btn-sm" onClick={onClose}>Done</button>
        </div>
      </aside>

      {adding && session && (
        <AddStudentDialog
          sessionId={session.id}
          sessionFull={session.seatsLeft === 0}
          onClose={() => setAdding(false)}
          onAdded={() => { setAdding(false); refresh() }}
        />
      )}

      {deleting && session && (
        <DeleteClassDialog
          sessionId={session.id}
          title={session.title}
          onCancel={() => setDeleting(false)}
          onDeleted={() => {
            setDeleting(false)
            onChanged()
            onClose()
          }}
        />
      )}

      {cancelling && session && (
        <ConfirmDialog
          title="Cancel this class?"
          confirmLabel="Cancel class"
          danger
          busy={cancelSessionMutation.isPending}
          onCancel={() => setCancelling(false)}
          onConfirm={(notify) => cancelSessionMutation.mutateAsync(notify).then(() => undefined)}
          notifyPrompt={
            liveRoster.length > 0
              ? `Email the ${liveRoster.length} student${liveRoster.length === 1 ? '' : 's'} booked in`
              : undefined
          }
          notifyDefault
        >
          <p>
            <strong>{session.title}</strong> on{' '}
            {DateTime.fromISO(session.startAt).setZone(STUDIO_TZ).toFormat('ccc d LLL')} will be cancelled.
          </p>
          {liveRoster.length > 0 && (
            <p className="muted small">
              {liveRoster.length} booking{liveRoster.length === 1 ? '' : 's'} will be cancelled and any course
              sessions used will be returned to those students.
            </p>
          )}
        </ConfirmDialog>
      )}
    </>
  )
}

interface ClassDeletionPreview {
  title: string
  startAt: string
  isPast: boolean
  cancelled: boolean
  liveBookings: number
  totalBookings: number
  attended: number
  studentNames: string[]
  fromWeeklyRule: boolean
  blockedReason: string | null
}

/**
 * Taking a class off the calendar for good.
 *
 * The preview is asked for before the confirmation is shown, because the thing worth stopping
 * for is invisible from the calendar: a class from the weekly timetable will stop being
 * generated on that date, and a class already taught takes its register with it.
 *
 * When it cannot be deleted the dialog says why and offers nothing but a way out — a refusal
 * arriving after the press, as a red banner, teaches people that the button is unreliable.
 */
function DeleteClassDialog({
  sessionId,
  title,
  onCancel,
  onDeleted,
}: {
  sessionId: string
  title: string
  onCancel: () => void
  onDeleted: () => void
}) {
  const [error, setError] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['session-deletion', sessionId],
    queryFn: () => api.get<ClassDeletionPreview>(`/api/admin/sessions/${sessionId}/deletion`),
    /*
     * Never from cache. Everything else in the console tolerates being thirty seconds old; the
     * one screen that cannot is the one asking "shall I destroy this", because the answer is
     * built entirely from what it says. Cancelling a class and immediately pressing Delete used
     * to be met with "cancel it first" — the refusal it had just satisfied.
     */
    staleTime: 0,
    refetchOnMount: 'always',
  })

  const remove = useMutation({
    mutationFn: () => api.delete(`/api/admin/sessions/${sessionId}`),
    onSuccess: onDeleted,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'That did not work.'),
  })

  const blocked = Boolean(data?.blockedReason)

  return (
    <ConfirmDialog
      title={`Delete ${title}?`}
      confirmLabel="Delete permanently"
      // Nothing to offer when it cannot be done: the dialog is explaining why, so it says so
      // and gets out of the way rather than showing a button that refuses.
      hideConfirm={blocked}
      cancelLabel={blocked ? 'Close' : 'Keep as is'}
      danger
      busy={remove.isPending || isLoading}
      onCancel={onCancel}
      onConfirm={async () => {
        await remove.mutateAsync()
      }}
    >
      {isLoading ? (
        <p className="muted">Checking what this would remove…</p>
      ) : blocked ? (
        <>
          <div className="banner banner-danger">{data!.blockedReason}</div>
          <p className="muted small">
            Cancelling is almost always what is wanted here — it keeps the class on the calendar
            with a reason, which is what anyone looking back will need.
          </p>
        </>
      ) : (
        <>
          <p>
            This removes the class from the calendar for good. It cannot be undone, and nobody is
            emailed.
          </p>

          {data!.totalBookings > 0 && (
            <div className="banner banner-warn">
              <strong>
                {data!.totalBookings} booking{data!.totalBookings === 1 ? '' : 's'} will go with it
                {data!.attended > 0 ? `, including ${data!.attended} marked as attended` : ''}.
              </strong>
              {data!.studentNames.length > 0 && (
                <div className="small" style={{ marginTop: 4 }}>
                  {data!.studentNames.join(', ')}
                </div>
              )}
              {data!.isPast && (
                <div className="small" style={{ marginTop: 4 }}>
                  This class has already been taught, so course sessions already used stay used.
                </div>
              )}
            </div>
          )}

          {data!.fromWeeklyRule && (
            <p className="muted small">
              This class comes from your weekly timetable. Deleting it removes only this date —
              the rest of the weekly pattern carries on, and this one will not be created again.
            </p>
          )}
        </>
      )}

      {error && <div className="banner banner-danger" style={{ marginTop: 10 }}>{error}</div>}
    </ConfirmDialog>
  )
}
