import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../api.js'
import { Icon } from '../components/Icon.js'

/**
 * Who can run the studio, and who hears about bookings.
 *
 * Adding someone hands back a link rather than emailing them a password. Two reasons: a
 * password sent by email lives in two inboxes forever, and email cannot currently reach a new
 * admin at all — the studio is sending through Resend's sandbox, which only delivers to the
 * account owner. A link the inviter copies works no matter what email can do.
 */

interface AdminRow {
  id: string
  name: string
  email: string
  active: boolean
  totpEnabled: boolean
  lastLoginAt: string | null
  invitePending: boolean
  createdAt: string
}

interface TeamResponse {
  admins: AdminRow[]
  extraRecipients: string[]
  effectiveRecipients: string[]
}

export function TeamPage({ currentAdminId }: { currentAdminId: string }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState({ name: '', email: '' })
  const [invite, setInvite] = useState<{ name: string; url: string; hours: number } | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recipients, setRecipients] = useState<string | null>(null)

  const { data, isPending } = useQuery({
    queryKey: ['team'],
    queryFn: () => api.get<TeamResponse>('/api/admin/admins'),
  })

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['team'] })

  const addAdmin = useMutation({
    mutationFn: (body: { name: string; email: string }) =>
      api.post<{ admin: AdminRow; inviteUrl: string; expiresInHours: number }>('/api/admin/admins', body),
    onSuccess: (result) => {
      setInvite({ name: form.name, url: result.inviteUrl, hours: result.expiresInHours })
      setForm({ name: '', email: '' })
      setCopied(false)
      void refresh()
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'That did not save.'),
  })

  const reinvite = useMutation({
    mutationFn: (row: AdminRow) =>
      api
        .post<{ inviteUrl: string; expiresInHours: number }>(`/api/admin/admins/${row.id}/reinvite`)
        .then((r) => ({ ...r, name: row.name })),
    onSuccess: (r) => {
      setInvite({ name: r.name, url: r.inviteUrl, hours: r.expiresInHours })
      setCopied(false)
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'That did not work.'),
  })

  const resetPassword = useMutation({
    mutationFn: (row: AdminRow) =>
      api
        .post<{ resetUrl: string; expiresInHours: number }>(`/api/admin/admins/${row.id}/reset-password`)
        .then((r) => ({ ...r, name: row.name })),
    onSuccess: (r) => {
      setInvite({ name: r.name, url: r.resetUrl, hours: r.expiresInHours })
      setCopied(false)
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'That did not work.'),
  })

  const setActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api.patch(`/api/admin/admins/${id}`, { active }),
    onSuccess: refresh,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'That did not save.'),
  })

  const saveRecipients = useMutation({
    mutationFn: (emails: string[]) => api.put('/api/admin/admins/recipients', { emails }),
    onSuccess: () => {
      setRecipients(null)
      void refresh()
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'That did not save.'),
  })

  const admins = data?.admins ?? []
  const extra = data?.extraRecipients ?? []

  async function copyInvite(url: string) {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
    } catch {
      // Clipboard access can be refused; the link is on screen and selectable either way.
      setCopied(false)
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Team</h1>
          <p className="muted">Who can sign in, and where booking alerts go.</p>
        </div>
      </header>

      {error && (
        <div className="note note-error" role="alert">
          {error}
        </div>
      )}

      {invite && (
        <div className="card invite-card">
          <h3>Invitation for {invite.name}</h3>
          <p className="muted">
            Send them this link. It works once, expires in {invite.hours} hours, and lets them
            choose their own password.
          </p>
          <div className="invite-row">
            <input readOnly value={invite.url} onFocus={(e) => e.target.select()} />
            <button type="button" className="btn btn-primary" onClick={() => copyInvite(invite.url)}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <button type="button" className="link-btn" onClick={() => setInvite(null)}>
            Done
          </button>
        </div>
      )}

      <section className="card">
        <h2>Admins</h2>
        <p className="muted">Everyone here has full access to bookings, students and settings.</p>

        {isPending ? (
          <p className="muted">Loading…</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {admins.map((row) => (
                <tr key={row.id} className={row.active ? '' : 'row-inactive'}>
                  <td>
                    <strong>{row.name}</strong>
                    {row.id === currentAdminId && <span className="pill pill-muted" style={{ marginLeft: 7 }}>You</span>}
                  </td>
                  <td>{row.email}</td>
                  <td>
                    {!row.active ? (
                      <span className="pill pill-muted">No access</span>
                    ) : row.invitePending ? (
                      <span className="pill pill-warn">Invitation not used</span>
                    ) : (
                      <span className="pill pill-ok">Active</span>
                    )}
                  </td>
                  <td className="row-actions">
                    {row.active &&
                      (row.invitePending ? (
                        <button type="button" className="link-btn" onClick={() => reinvite.mutate(row)}>
                          New link
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="link-btn"
                          onClick={() => {
                            // Ends their sessions, so make sure that is what was meant.
                            if (
                              confirm(
                                `Reset ${row.name}'s password? They will be signed out everywhere and need the new link to get back in.`,
                              )
                            ) {
                              resetPassword.mutate(row)
                            }
                          }}
                        >
                          Reset password
                        </button>
                      ))}
                    {row.id !== currentAdminId &&
                      (row.active ? (
                        <button
                          type="button"
                          className="link-btn link-danger"
                          onClick={() => setActive.mutate({ id: row.id, active: false })}
                        >
                          Remove access
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="link-btn"
                          onClick={() => setActive.mutate({ id: row.id, active: true })}
                        >
                          Restore
                        </button>
                      ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault()
            setError(null)
            addAdmin.mutate(form)
          }}
        >
          <label className="field">
            <span>Name</span>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              placeholder="Hana Tan"
            />
          </label>
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
              placeholder="hana@mizuki.com.sg"
            />
          </label>
          <button type="submit" className="btn btn-primary" disabled={addAdmin.isPending}>
            <Icon name="plus" size={14} /> Add admin
          </button>
        </form>
      </section>

      <section className="card">
        <h2>Where booking alerts go</h2>
        <p className="muted">
          Every admin above is emailed automatically. Add anyone else who should hear about
          bookings but does not need to sign in.
        </p>

        {recipients === null ? (
          <>
            <ul className="pill-list">
              {(data?.effectiveRecipients ?? []).map((email) => (
                <li key={email} className="recipient-pill">
                  {email}
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="btn btn-quiet"
              onClick={() => setRecipients(extra.join('\n'))}
            >
              Edit extra addresses
            </button>
          </>
        ) : (
          <>
            <label className="field">
              <span>Extra addresses, one per line</span>
              <textarea
                rows={4}
                value={recipients}
                onChange={(e) => setRecipients(e.target.value)}
                placeholder="bookings@mizuki.com.sg"
              />
            </label>
            <div className="row">
              <button
                type="button"
                className="btn btn-primary"
                disabled={saveRecipients.isPending}
                onClick={() =>
                  saveRecipients.mutate(
                    recipients
                      .split('\n')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  )
                }
              >
                Save
              </button>
              <button type="button" className="btn btn-quiet" onClick={() => setRecipients(null)}>
                Cancel
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  )
}
