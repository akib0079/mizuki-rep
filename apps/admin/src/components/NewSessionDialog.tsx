import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { DateTime } from 'luxon'
import { STUDIO_TZ } from '@mizuki/shared'
import { ApiError, api, type Course } from '../api.js'

/** Add a one-off class — a weekend workshop, or a make-up session for someone who missed one. */
export function NewSessionDialog({
  date,
  courses,
  onClose,
  onCreated,
}: {
  date: string
  courses: Course[]
  onClose: () => void
  onCreated: () => void
}) {
  const [form, setForm] = useState({
    courseTypeId: courses[0]?.id ?? '',
    date,
    startTime: '10:00',
    durationMins: courses[0]?.defaultDurationMins ?? 150,
    capacity: courses[0]?.defaultCapacity ?? 8,
    title: '',
    notes: '',
  })
  const [error, setError] = useState<string | null>(null)

  // Picking a course pulls in that course's usual length and class size, so the common
  // case is one click rather than four fields.
  useEffect(() => {
    const course = courses.find((c) => c.id === form.courseTypeId)
    if (!course) return
    setForm((f) => ({
      ...f,
      durationMins: course.defaultDurationMins,
      capacity: course.defaultCapacity,
      title: f.title || course.name,
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.courseTypeId])

  const createMutation = useMutation({
    mutationFn: () => api.post('/api/admin/sessions', form),
    onSuccess: onCreated,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not add that class.'),
  })

  const endsAt = DateTime.fromISO(`${form.date}T${form.startTime}`, { zone: STUDIO_TZ })
    .plus({ minutes: form.durationMins })
    .toFormat('h:mm a')

  return (
    <>
      {/*
        On .modal rather than a hand-written copy of it.

        This dialog carried its own inline position, width, radius and shadow — a duplicate of the
        stylesheet's, and the reason it appeared with no movement at all while every other dialog
        rose into place: the animation lives on the class it was not using. Sharing the class also
        gets it the bottom-sheet treatment on a phone, which it never had.
      */}
      <div className="drawer-backdrop" style={{ zIndex: 60 }} onClick={onClose} />
      {/* Scrolls on itself: .modal caps its height and leaves scrolling to a .modal-body, and
          this form is a flat list of fields rather than a head/body/foot. */}
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Add a class"
        style={{ padding: 22, overflowY: 'auto' }}
      >
        <h2 style={{ margin: '0 0 14px', fontSize: 17 }}>Add a class</h2>

        {error && <div className="banner banner-danger">{error}</div>}

        <label className="field">
          <span>Course</span>
          <select value={form.courseTypeId} onChange={(e) => setForm({ ...form, courseTypeId: e.target.value })}>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>

        <div className="field-row">
          <label className="field">
            <span>Date</span>
            <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </label>
          <label className="field">
            <span>Start time</span>
            <input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} />
          </label>
        </div>

        <div className="field-row">
          <label className="field">
            <span>Length (minutes)</span>
            <input
              type="number"
              min={15}
              max={600}
              step={15}
              value={form.durationMins}
              onChange={(e) => setForm({ ...form, durationMins: Number(e.target.value) })}
            />
            <div className="field-hint">Ends {endsAt}</div>
          </label>
          <label className="field">
            <span>Class size</span>
            <input
              type="number"
              min={1}
              max={200}
              value={form.capacity}
              onChange={(e) => setForm({ ...form, capacity: Number(e.target.value) })}
            />
          </label>
        </div>

        <label className="field">
          <span>Title</span>
          <input
            value={form.title}
            placeholder="Ikebana Workshop — Morning"
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </label>

        <label className="field">
          <span>Notes (only you see these)</span>
          <textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </label>

        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button"
            className="btn btn-primary"
            disabled={!form.courseTypeId || createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            {createMutation.isPending ? 'Adding…' : 'Add class'}
          </button>
        </div>
      </div>
    </>
  )
}
