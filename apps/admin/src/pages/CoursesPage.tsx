import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type Course } from '../api.js'
import { QueryState } from '../components/QueryState.js'
import { ConfirmDialog } from '../components/ConfirmDialog.js'

/**
 * What each course *is*, as opposed to how it is booked.
 *
 * The rules — how it is paid for, how much notice to change, how many places — stayed on Settings,
 * because that is a table you scan across all five courses at once. This page is the opposite
 * shape: one course at a time, mostly prose, and the words here are the ones students read on the
 * booking page. Putting them in the settings table would have meant six paragraphs squeezed into
 * a row already carrying six columns.
 */

interface Draft {
  description: string
  suitableFor: string
  whatYouLearn: string
  whatToBring: string
  whatIsProvided: string
  priceNote: string
  imageUrl: string
}

const EMPTY: Draft = {
  description: '',
  suitableFor: '',
  whatYouLearn: '',
  whatToBring: '',
  whatIsProvided: '',
  priceNote: '',
  imageUrl: '',
}

const FIELDS: { key: keyof Draft; label: string; hint: string; rows?: number }[] = [
  {
    key: 'description',
    label: 'About this course',
    hint: 'A short paragraph. This is the first thing a student reads.',
    rows: 4,
  },
  {
    key: 'whatYouLearn',
    label: 'What you will learn',
    hint: 'One point per line. Shown as a list.',
    rows: 5,
  },
  {
    key: 'suitableFor',
    label: 'Who it suits',
    hint: 'Beginners, people continuing from a trial, and so on.',
    rows: 2,
  },
  {
    key: 'whatIsProvided',
    label: 'What we provide',
    hint: 'Flowers, tools, refreshments — one per line.',
    rows: 3,
  },
  {
    key: 'whatToBring',
    label: 'What to bring',
    hint: 'One per line. Leave empty if there is nothing.',
    rows: 3,
  },
  {
    key: 'priceNote',
    label: 'Price',
    hint: 'Written however you say it — "S$120 a class, or S$800 for eight".',
    rows: 2,
  },
]

export function CoursesPage() {
  const queryClient = useQueryClient()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [saved, setSaved] = useState(false)
  const [deleting, setDeleting] = useState<Course | null>(null)

  const coursesQuery = useQuery({
    queryKey: ['courses'],
    queryFn: () => api.get<{ courses: Course[] }>('/api/admin/settings/courses'),
  })

  const courses = coursesQuery.data?.courses ?? []
  const selected = courses.find((c) => c.id === selectedId) ?? courses[0] ?? null

  // Load the chosen course into the form, and reset the "Saved" flag with it.
  useEffect(() => {
    if (!selected) return
    setDraft({
      description: selected.description ?? '',
      suitableFor: selected.suitableFor ?? '',
      whatYouLearn: selected.whatYouLearn ?? '',
      whatToBring: selected.whatToBring ?? '',
      whatIsProvided: selected.whatIsProvided ?? '',
      priceNote: selected.priceNote ?? '',
      imageUrl: selected.imageUrl ?? '',
    })
    setSaved(false)
  }, [selected?.id])

  const saveMutation = useMutation({
    mutationFn: () => api.patch(`/api/admin/settings/courses/${selected!.id}`, draft),
    onSuccess: () => {
      setSaved(true)
      void queryClient.invalidateQueries({ queryKey: ['courses'] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/admin/settings/courses/${id}`),
    onSuccess: () => {
      setDeleting(null)
      setSelectedId(null)
      void queryClient.invalidateQueries({ queryKey: ['courses'] })
    },
  })

  /* Enough filled in for the student's panel to be worth opening. */
  const filledCount = Object.values(draft).filter((v) => v.trim()).length

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Courses</h1>
          <p>What students read about each course before they book.</p>
        </div>
      </div>

      <QueryState
        isLoading={coursesQuery.isLoading}
        error={coursesQuery.error}
        data={coursesQuery.data}
        skeleton={null}
        onRetry={() => void coursesQuery.refetch()}
      >
        {courses.length === 0 ? (
          <div className="card empty-state">
            <p>No courses yet. Add one on the Settings page, then describe it here.</p>
          </div>
        ) : (
          <div className="courses-layout">
            <nav className="card course-list" aria-label="Courses">
              {courses.map((c) => {
                const written = [c.description, c.whatYouLearn, c.suitableFor, c.priceNote].filter(
                  (v) => v?.trim(),
                ).length
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={c.id === selected?.id ? 'course-item course-item-active' : 'course-item'}
                    onClick={() => setSelectedId(c.id)}
                  >
                    <span className="course-item-dot" style={{ background: c.colour }} aria-hidden />
                    <span className="course-item-name">
                      {c.name}
                      {!c.active && <span className="pill pill-quiet">Archived</span>}
                    </span>
                    {/*
                      Says whether a student would see anything, not how many boxes are typed in.
                      "Nothing written yet" is the state worth flagging — that course shows no
                      Learn more button at all.
                    */}
                    <span className="course-item-meta">
                      {written === 0 ? 'Nothing written yet' : `${written} of 4 filled in`}
                    </span>
                  </button>
                )
              })}
            </nav>

            {selected && (
              <div className="card course-editor">
                <div className="course-editor-head">
                  <div>
                    <h2 className="card-title">{selected.name}</h2>
                    <p className="card-sub">
                      {filledCount === 0
                        ? 'Nothing written yet, so the booking page shows no Learn more button for this course.'
                        : 'Students see this behind Learn more on the booking page.'}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn btn-danger-quiet"
                    onClick={() => setDeleting(selected)}
                  >
                    Delete course
                  </button>
                </div>

                <label className="field">
                  <span>Photograph (web address)</span>
                  <input
                    type="url"
                    placeholder="https://mizuki.com.sg/wp-content/uploads/…"
                    value={draft.imageUrl}
                    onChange={(e) => setDraft({ ...draft, imageUrl: e.target.value })}
                  />
                  <div className="field-hint">
                    Copy the address of an image already on your website. Leave empty for no photo.
                  </div>
                </label>

                {draft.imageUrl.trim() && (
                  <img
                    className="course-preview-img"
                    src={draft.imageUrl}
                    alt=""
                    onError={(e) => (e.currentTarget.style.display = 'none')}
                    onLoad={(e) => (e.currentTarget.style.display = '')}
                  />
                )}

                {FIELDS.map((f) => (
                  <label className="field" key={f.key}>
                    <span>{f.label}</span>
                    <textarea
                      rows={f.rows ?? 3}
                      value={draft[f.key]}
                      onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                    />
                    <div className="field-hint">{f.hint}</div>
                  </label>
                ))}

                <div className="row course-editor-foot">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={saveMutation.isPending}
                    onClick={() => saveMutation.mutate()}
                  >
                    {saveMutation.isPending ? 'Saving…' : saved ? 'Saved' : 'Save changes'}
                  </button>
                  {saveMutation.isError && (
                    <span className="muted small">Could not save — please try again.</span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </QueryState>

      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting.name}?`}
          confirmLabel="Delete course"
          danger
          busy={deleteMutation.isPending}
          onCancel={() => setDeleting(null)}
          /*
           * Let it throw. ConfirmDialog catches whatever `onConfirm` rejects with and shows it
           * in place, which is exactly where the refusal belongs — it names what is still
           * attached and what to do instead. Catching it here only meant nothing was displayed.
           */
          onConfirm={async () => {
            await deleteMutation.mutateAsync(deleting.id)
          }}
        >
          <p>
            This removes the course completely. It cannot be undone.
          </p>
          <p className="muted small">
            If it has ever been used you will be told, and nothing will be deleted — archive it on
            the Settings page instead, which hides it from the website and keeps every class and
            student record.
          </p>
        </ConfirmDialog>
      )}
    </>
  )
}
