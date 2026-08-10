import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { ApiError, api, type StudentSummary } from '../api.js'

/**
 * Seating a student who booked over chat.
 *
 * Search first so the studio picks the existing record rather than creating a second one for the
 * same person — duplicate students are how course balances get lost.
 */
export function AddStudentDialog({
  sessionId,
  sessionFull,
  onClose,
  onAdded,
}: {
  sessionId: string
  sessionFull: boolean
  onClose: () => void
  onAdded: () => void
}) {
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<StudentSummary | null>(null)
  const [creating, setCreating] = useState(false)
  const [newStudent, setNewStudent] = useState({ name: '', email: '', phone: '' })
  const [override, setOverride] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const results = useQuery({
    queryKey: ['student-search', search],
    queryFn: () => api.get<{ students: StudentSummary[] }>(`/api/admin/students?search=${encodeURIComponent(search)}&limit=8`),
    enabled: search.trim().length >= 2,
  })

  const addMutation = useMutation({
    mutationFn: () =>
      api.post('/api/admin/students/bookings', {
        sessionId,
        ...(selected ? { studentId: selected.id } : { student: newStudent }),
        overrideCapacity: override,
        usePackage: true,
      }),
    onSuccess: onAdded,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not add that student.'),
  })

  const canSubmit = selected !== null || (newStudent.name.trim() && newStudent.email.trim())

  return (
    <>
      <div className="drawer-backdrop" style={{ zIndex: 60 }} onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add a student"
        style={{
          position: 'fixed', zIndex: 70, top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          width: 'min(460px, calc(100vw - 32px))', maxHeight: '86vh', overflowY: 'auto',
          background: 'var(--surface)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', padding: 22,
        }}
      >
        <h2 style={{ margin: '0 0 4px', fontSize: 17 }}>Add a student</h2>
        <p className="muted small" style={{ marginTop: 0 }}>
          For students who booked over chat or in person.
        </p>

        {error && <div className="banner banner-danger">{error}</div>}

        {sessionFull && (
          <div className="banner banner-warn">
            This class is full. You can still add someone, and it will be recorded as an override.
          </div>
        )}

        {!creating ? (
          <>
            <label className="field">
              <span>Find an existing student</span>
              <input
                value={search}
                placeholder="Name, email or phone"
                onChange={(e) => { setSearch(e.target.value); setSelected(null) }}
              />
            </label>

            {selected ? (
              <div className="banner banner-info">
                <strong>{selected.name}</strong> — {selected.email}
                {selected.sessionsRemaining > 0 && (
                  <div className="small">{selected.sessionsRemaining} course session(s) remaining</div>
                )}
                <div>
                  <button className="btn btn-sm btn-ghost" style={{ paddingLeft: 0 }} onClick={() => setSelected(null)}>
                    Choose someone else
                  </button>
                </div>
              </div>
            ) : (
              search.trim().length >= 2 && (
                <div className="stack" style={{ marginBottom: 14 }}>
                  {results.isLoading && <p className="muted small">Searching…</p>}
                  {results.data?.students.length === 0 && <p className="muted small">No match.</p>}
                  {results.data?.students.map((s) => (
                    <button
                      key={s.id}
                      className="btn"
                      style={{ justifyContent: 'flex-start', textAlign: 'left' }}
                      onClick={() => setSelected(s)}
                    >
                      <span>
                        <strong>{s.name}</strong>
                        <span className="muted small"> · {s.email}</span>
                        {s.sessionsRemaining > 0 && (
                          <span className="muted small"> · {s.sessionsRemaining} left</span>
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              )
            )}

            <button className="btn btn-sm btn-ghost" style={{ paddingLeft: 0 }} onClick={() => setCreating(true)}>
              + This is someone new
            </button>
          </>
        ) : (
          <>
            <label className="field">
              <span>Name</span>
              <input value={newStudent.name} onChange={(e) => setNewStudent({ ...newStudent, name: e.target.value })} />
            </label>
            <label className="field">
              <span>Email</span>
              <input
                type="email"
                value={newStudent.email}
                onChange={(e) => setNewStudent({ ...newStudent, email: e.target.value })}
              />
              <div className="field-hint">Their confirmation and reminder go here.</div>
            </label>
            <label className="field">
              <span>Phone (optional)</span>
              <input value={newStudent.phone} onChange={(e) => setNewStudent({ ...newStudent, phone: e.target.value })} />
            </label>
            <button className="btn btn-sm btn-ghost" style={{ paddingLeft: 0 }} onClick={() => setCreating(false)}>
              ← Search existing students instead
            </button>
          </>
        )}

        {sessionFull && (
          <label className="row" style={{ marginTop: 14, gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
            <span className="small">Add anyway, over the class size</span>
          </label>
        )}

        <div className="row" style={{ marginTop: 20, justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            disabled={!canSubmit || addMutation.isPending || (sessionFull && !override)}
            onClick={() => addMutation.mutate()}
          >
            {addMutation.isPending ? 'Adding…' : 'Add to class'}
          </button>
        </div>
      </div>
    </>
  )
}
