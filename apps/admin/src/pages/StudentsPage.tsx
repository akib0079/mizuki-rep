import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { STUDIO_COUNTRY, flagEmoji } from '@mizuki/shared'
import { ApiError, api, type StudentSummary } from '../api.js'
import { StudentDrawer } from '../components/StudentDrawer.js'
import { NewStudentDialog } from '../components/NewStudentDialog.js'
import { Icon } from './../components/Icon.js'
import { SkeletonTable } from '../components/Skeleton.js'

/** Students, their course packages, and the controls to top them up or extend them. */
interface DuplicateGroup {
  reason: string
  students: { id: string; reference: string; name: string; email: string; phone: string; phoneCountry: string }[]
}

export function StudentsPage() {
  const queryClient = useQueryClient()
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [mergeMessage, setMergeMessage] = useState<string | null>(null)
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

  /*
   * Accounts that look like one person.
   *
   * Surfaced rather than left to be noticed: the studio found their three copies of one student
   * by scrolling the list and recognising the name, which only works while the list is short.
   */
  const duplicates = useQuery({
    queryKey: ['duplicates'],
    queryFn: () => api.get<{ groups: DuplicateGroup[] }>('/api/admin/students/duplicates'),
  })

  const merge = useMutation({
    mutationFn: (body: { keepId: string; mergeId: string }) =>
      api.post<{ bookingsMoved: number; packagesMoved: number }>('/api/admin/students/merge', body),
    onSuccess: (r) => {
      setMergeMessage(`Joined. ${r.bookingsMoved} booking(s) and ${r.packagesMoved} course package(s) moved.`)
      void queryClient.invalidateQueries({ queryKey: ['duplicates'] })
      void queryClient.invalidateQueries({ queryKey: ['students'] })
    },
    onError: (err) => setMergeMessage(err instanceof ApiError ? err.message : 'Could not join those accounts.'),
  })

  const groups = duplicates.data?.groups ?? []

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

      {groups.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2 className="card-title">Possible duplicate accounts</h2>
          <p className="card-sub">
            These look like the same person booking more than once — usually a mistyped email.
            Joining moves their bookings and course sessions onto one account. Nothing is deleted.
          </p>

          {mergeMessage && <div className="banner banner-ok">{mergeMessage}</div>}

          {groups.map((group, i) => (
            <div key={i} className="dupe-group">
              <p className="small muted">{group.reason}</p>
              {group.students.map((s, index) => (
                <div className="dupe-row" key={s.id}>
                  <div>
                    <strong>{s.name}</strong>
                    {s.reference && <span className="student-ref">{s.reference}</span>}
                    <div className="small muted">
                      {s.email}
                      {s.phone && <> · <PhoneWithFlag phone={s.phone} country={s.phoneCountry} /></>}
                    </div>
                  </div>
                  {index === 0 ? (
                    // The oldest is kept by default — it is the one with the longest history.
                    <span className="pill pill-ok">Keep this one</span>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={merge.isPending}
                      onClick={() => {
                        if (
                          confirm(
                            `Move ${s.name}'s bookings and course sessions onto ${group.students[0]!.name}? This cannot be undone automatically.`,
                          )
                        ) {
                          setMergeMessage(null)
                          merge.mutate({ keepId: group.students[0]!.id, mergeId: s.id })
                        }
                      }}
                    >
                      Join into the one above
                    </button>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      <div className="card card-pad-0">
        {listQuery.isLoading ? (
          <SkeletonTable rows={6} cols={4} />
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
          <div className="table-wrap">
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
                    <td className="row-title">
                      {s.name}
                      {/* Two students can share a name; the reference is what separates them. */}
                      {s.reference && <span className="student-ref">{s.reference}</span>}
                    </td>
                    <td className="small muted">
                      {s.email}
                      {s.phone ? <><br /><PhoneWithFlag phone={s.phone} country={s.phoneCountry} /></> : null}
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
          </div>
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

/**
 * A number with where it is from.
 *
 * A local number needs no decoration — nearly every student is Singaporean, and flagging all of
 * them would make the one thing worth noticing invisible. A foreign number is flagged, because
 * the studio has to know before they dial, and because the number alone does not say.
 */
function PhoneWithFlag({ phone, country }: { phone: string; country?: string }) {
  if (!country || country === STUDIO_COUNTRY) return <>{phone}</>
  return (
    <span title={country}>
      <span aria-hidden>{flagEmoji(country)}</span> {phone}
    </span>
  )
}
