import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { api, type StudentSummary } from '../api.js'
import { StudentDrawer } from '../components/StudentDrawer.js'
import { NewStudentDialog } from '../components/NewStudentDialog.js'
import { Icon } from './../components/Icon.js'

/** Students, their course packages, and the controls to top them up or extend them. */
export function StudentsPage() {
  const queryClient = useQueryClient()
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const missingPhone = params.get('missingPhone') === '1'

  // `?new=1` lets Quick add land here with the form already open, instead of dropping
  // the studio on a list and leaving them to find the button.
  useEffect(() => {
    if (params.get('new') === '1') {
      setAdding(true)
      params.delete('new')
      setParams(params, { replace: true })
    }
  }, [params, setParams])

  const listQuery = useQuery({
    queryKey: ['students', search, missingPhone],
    queryFn: () =>
      api.get<{ students: StudentSummary[] }>(
        `/api/admin/students?search=${encodeURIComponent(search)}${missingPhone ? '&missingPhone=1' : ''}`,
      ),
  })

  const students = listQuery.data?.students ?? []

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Students</h1>
          <p>Course packages, booking history and contact details.</p>
        </div>
        <div className="toolbar">
          <div className="search-field">
            <Icon name="search" size={15} />
            <input
              placeholder="Search name, email or phone"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search students"
            />
          </div>
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
            <Icon name="plus" size={15} /> Add student
          </button>
        </div>
      </div>

      {missingPhone && (
        <div className="banner banner-info">
          Showing only students with no phone number. Open each one to add it under Details.{' '}
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => { params.delete('missingPhone'); setParams(params, { replace: true }) }}
          >
            Show everyone
          </button>
        </div>
      )}

      <div className="card card-pad-0">
        {listQuery.isLoading ? (
          <div className="empty">Loading…</div>
        ) : students.length === 0 ? (
          <div className="empty">
            {search ? (
              <>No students match “{search}”.</>
            ) : (
              <>
                <p>No students yet.</p>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => setAdding(true)}>
                  <Icon name="plus" size={15} /> Add your first student
                </button>
              </>
            )}
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Contact</th>
                <th>Sessions left</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {students.map((s) => (
                <tr key={s.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedId(s.id)}>
                  <td className="row-title">{s.name}</td>
                  <td className="small muted">
                    {s.email}
                    {s.phone ? <><br />{s.phone}</> : null}
                  </td>
                  <td>
                    {s.sessionsRemaining > 0 ? (
                      <span className={s.sessionsRemaining <= 2 ? 'pill pill-warn' : 'pill pill-ok'}>
                        {s.sessionsRemaining}
                      </span>
                    ) : (
                      <span className="pill pill-muted">—</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button type="button"
                      className="btn btn-sm"
                      onClick={(e) => { e.stopPropagation(); setSelectedId(s.id) }}
                    >
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selectedId && <StudentDrawer studentId={selectedId} onClose={() => setSelectedId(null)} />}

      {adding && (
        <NewStudentDialog
          onClose={() => setAdding(false)}
          onCreated={(id) => {
            setAdding(false)
            void queryClient.invalidateQueries({ queryKey: ['students'] })
            // Straight into their profile, which is where a course package gets added.
            setSelectedId(id)
          }}
        />
      )}
    </>
  )
}
