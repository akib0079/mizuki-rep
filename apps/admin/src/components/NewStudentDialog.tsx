import { useEffect, useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { ApiError, api } from '../api.js'
import { Icon } from './Icon.js'

/**
 * Add someone to the studio's books without booking them into anything.
 *
 * Separate from the "add a student to this class" flow in the session drawer: the studio also
 * takes names at open days and over the phone before any date is agreed, and those people need
 * to exist so a course package can be put against them.
 */
export function NewStudentDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (studentId: string) => void
}) {
  const [form, setForm] = useState({ name: '', email: '', phone: '', notes: '', marketingOptIn: false })
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const create = useMutation({
    mutationFn: () => api.post<{ student: { id: string } }>('/api/admin/students', form),
    onSuccess: (data) => onCreated(data.student.id),
    onError: (err) =>
      setError(
        err instanceof ApiError
          ? // The API returns a helpful message naming who already holds that address.
            err.message
          : 'Could not add that student.',
      ),
  })

  function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    create.mutate()
  }

  // Mirrors the server rule, so the button is only live once the form would actually pass.
  const canSubmit =
    form.name.trim().length > 0 &&
    form.email.trim().length > 0 &&
    form.phone.replace(/\D/g, '').length >= 8

  return (
    <>
      <div className="drawer-backdrop" style={{ zIndex: 60 }} onClick={onClose} />
      <form className="modal" role="dialog" aria-modal="true" aria-label="Add a student" onSubmit={submit}>
        <div className="modal-head">
          <h2>Add a student</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>

        <div className="modal-body">
          {error && <div className="banner banner-danger">{error}</div>}

          <label className="field">
            <span>Name</span>
            <input
              autoFocus
              value={form.name}
              required
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>

          <label className="field">
            <span>Email</span>
            <input
              type="email"
              value={form.email}
              required
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
            <div className="field-hint">
              Confirmations, reminders and their sign-in link all go here.
            </div>
          </label>

          <label className="field">
            <span>Phone</span>
            <input
              type="tel"
              inputMode="tel"
              value={form.phone}
              required
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
            <div className="field-hint">Needed so you can reach them if a class changes.</div>
          </label>

          <label className="field">
            <span>Private notes (optional)</span>
            <textarea
              rows={3}
              value={form.notes}
              placeholder="Allergies, preferences, how they found you…"
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
            <div className="field-hint">Only you see these — never shown to the student.</div>
          </label>

          <label className="row" style={{ gap: 8, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={form.marketingOptIn}
              onChange={(e) => setForm({ ...form, marketingOptIn: e.target.checked })}
            />
            <span className="small">Happy to receive news about upcoming workshops</span>
          </label>
        </div>

        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={!canSubmit || create.isPending}>
            {create.isPending ? 'Adding…' : 'Add student'}
          </button>
        </div>
      </form>
    </>
  )
}
