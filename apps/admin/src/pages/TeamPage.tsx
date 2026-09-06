import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../api.js'
import { Icon } from '../components/Icon.js'
import { PasswordField } from '../components/PasswordField.js'
import { SkeletonTable } from '../components/Skeleton.js'

/**
 * Who can run the studio, and who hears about bookings.
 *
 * Adding someone hands back a link by default rather than emailing them a password. Two reasons:
 * a password sent by email lives in two inboxes forever, and email cannot currently reach a new
 * admin at all — the studio is sending through Resend's sandbox, which only delivers to the
 * account owner. A link the inviter copies works no matter what email can do.
 *
 * Setting a password here instead is the other half, and it exists because the alternative was
 * worse. The link assumes two people who can pass one between them; the studio's case is often
 * someone sitting beside them, and refusing that turns into a shared login.
 */

const MIN_PASSWORD = 12

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
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [howToAdd, setHowToAdd] = useState<'invite' | 'password'>('invite')
  const [invite, setInvite] = useState<{ name: string; url: string; hours: number } | null>(null)
  const [added, setAdded] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recipients, setRecipients] = useState<string | null>(null)
  const [settingPasswordFor, setSettingPasswordFor] = useState<AdminRow | null>(null)

  const { data, isPending } = useQuery({
    queryKey: ['team'],
    queryFn: () => api.get<TeamResponse>('/api/admin/admins'),
  })

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['team'] })

  const addAdmin = useMutation({
    mutationFn: (body: { name: string; email: string; password?: string }) =>
      api.post<{ admin: AdminRow; inviteUrl?: string; expiresInHours?: number; passwordSet?: boolean }>(
        '/api/admin/admins',
        body,
      ),
    onSuccess: (result) => {
      if (result.passwordSet) {
        setAdded(`${form.name} can sign in now with the password you set.`)
        setInvite(null)
      } else {
        setInvite({ name: form.name, url: result.inviteUrl!, hours: result.expiresInHours! })
        setAdded(null)
      }
      setForm({ name: '', email: '', password: '' })
      setCopied(false)
      void refresh()
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'That did not save.'),
  })

  const setPassword = useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) =>
      api.post(`/api/admin/admins/${id}/set-password`, { password }),
    onSuccess: () => {
      setAdded(`Password changed for ${settingPasswordFor?.name}. They have been signed out everywhere.`)
      setSettingPasswordFor(null)
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

      {added && (
        <div className="note note-ok" role="status">
          {added}{' '}
          <button type="button" className="link-btn" onClick={() => setAdded(null)}>
            Dismiss
          </button>
        </div>
      )}

      {settingPasswordFor && (
        <SetPasswordCard
          admin={settingPasswordFor}
          busy={setPassword.isPending}
          onCancel={() => setSettingPasswordFor(null)}
          onSave={(password) => {
            setError(null)
            setPassword.mutate({ id: settingPasswordFor.id, password })
          }}
        />
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
          <SkeletonTable rows={3} cols={4} />
        ) : (
          <div className="table-wrap">
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
                            Send reset link
                          </button>
                        ))}
                      {row.active && (
                        <button
                          type="button"
                          className="link-btn"
                          onClick={() => {
                            setError(null)
                            setAdded(null)
                            setSettingPasswordFor(row)
                          }}
                        >
                          Set password
                        </button>
                      )}
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
          </div>
        )}

        <form
          className="add-admin"
          onSubmit={(e) => {
            e.preventDefault()
            setError(null)
            setAdded(null)
            addAdmin.mutate(
              howToAdd === 'password'
                ? { name: form.name, email: form.email, password: form.password }
                : { name: form.name, email: form.email },
            )
          }}
        >
          <div className="inline-form">
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
          </div>

          <fieldset className="choice-set">
            <legend>How do they get in?</legend>
            <label className="choice">
              <input
                type="radio"
                name="how-to-add"
                checked={howToAdd === 'invite'}
                onChange={() => setHowToAdd('invite')}
              />
              <span>
                <strong>Send them a link</strong>
                <span className="muted">
                  They choose their own password. Nobody else ever knows it.
                </span>
              </span>
            </label>
            <label className="choice">
              <input
                type="radio"
                name="how-to-add"
                checked={howToAdd === 'password'}
                onChange={() => setHowToAdd('password')}
              />
              <span>
                <strong>Set a password now</strong>
                <span className="muted">
                  For setting someone up in person. Ask them to change it once they are in.
                </span>
              </span>
            </label>
          </fieldset>

          {howToAdd === 'password' && (
            <PasswordField
              label="Their password"
              value={form.password}
              onChange={(password) => setForm({ ...form, password })}
              autoComplete="new-password"
              minLength={MIN_PASSWORD}
              hint={`At least ${MIN_PASSWORD} characters. Three unrelated words is easier to say out loud than a jumble, and harder to guess.`}
            />
          )}

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

/**
 * Change someone else's password from here.
 *
 * Typed twice, because the person typing it is not the person who will have to live with a typo —
 * they would be locked out of a console they were just given, with no way in but asking again.
 */
function SetPasswordCard({
  admin,
  busy,
  onCancel,
  onSave,
}: {
  admin: AdminRow
  busy: boolean
  onCancel: () => void
  onSave: (password: string) => void
}) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD
  const mismatch = confirm.length > 0 && password !== confirm
  const ready = password.length >= MIN_PASSWORD && password === confirm

  return (
    <div className="card invite-card">
      <h3>Set a password for {admin.name}</h3>
      <p className="muted">
        They will be signed out everywhere and will need this password to get back in. Tell it to
        them directly rather than by email, and ask them to change it under Settings once they are
        in.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (ready) onSave(password)
        }}
      >
        <PasswordField
          label="New password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          autoFocus
          minLength={MIN_PASSWORD}
          hint={tooShort ? `A few more characters — ${MIN_PASSWORD} at least.` : undefined}
        />
        <PasswordField
          label="Type it again"
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
          hint={mismatch ? 'Those two do not match.' : undefined}
        />
        <div className="row">
          <button type="submit" className="btn btn-primary" disabled={!ready || busy}>
            {busy ? 'Saving…' : 'Set password'}
          </button>
          <button type="button" className="btn btn-quiet" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
