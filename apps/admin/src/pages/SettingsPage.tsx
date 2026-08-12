import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { DateTime } from 'luxon'
import { STUDIO_TZ } from '@mizuki/shared'
import { ApiError, api, type Course } from '../api.js'
import { PasswordField } from '../components/PasswordField.js'

interface SeatDrift {
  sessionId: string
  dateKey: string
  title: string
  storedSeatsTaken: number
  actualSeatsTaken: number
}

/** Course policy, phone alerts, and the maintenance levers. */
export function SettingsPage({ totpEnabled }: { totpEnabled: boolean }) {
  const queryClient = useQueryClient()
  const [message, setMessage] = useState<{ kind: 'ok' | 'danger'; text: string } | null>(null)

  const coursesQuery = useQuery({
    queryKey: ['courses'],
    queryFn: () => api.get<{ courses: Course[] }>('/api/admin/settings/courses'),
  })

  const driftQuery = useQuery({
    queryKey: ['seat-drift'],
    queryFn: () => api.get<{ drift: SeatDrift[] }>('/api/admin/settings/seat-drift'),
  })

  const courseMutation = useMutation({
    mutationFn: (input: { id: string; patch: Partial<Course> }) =>
      api.patch(`/api/admin/settings/courses/${input.id}`, input.patch),
    onSuccess: () => {
      setMessage({ kind: 'ok', text: 'Saved.' })
      void queryClient.invalidateQueries({ queryKey: ['courses'] })
    },
    onError: (err) => setMessage({ kind: 'danger', text: err instanceof ApiError ? err.message : 'Could not save.' }),
  })

  const repairMutation = useMutation({
    mutationFn: () => api.post<{ repaired: number }>('/api/admin/settings/seat-drift/repair'),
    onSuccess: (data) => {
      setMessage({ kind: 'ok', text: `Corrected ${data.repaired} class(es).` })
      void queryClient.invalidateQueries({ queryKey: ['seat-drift'] })
    },
  })

  const generateMutation = useMutation({
    mutationFn: () => api.post<{ created: number }>('/api/admin/settings/schedule-rules/generate', {}),
    onSuccess: (data) => {
      setMessage({ kind: 'ok', text: `Added ${data.created} class(es) from your weekly timetable.` })
      void queryClient.invalidateQueries({ queryKey: ['admin-sessions'] })
    },
  })

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p>Course rules, phone alerts and maintenance.</p>
        </div>
      </div>

      {message && <div className={`banner banner-${message.kind}`}>{message.text}</div>}

      <div className="card">
        <h2 className="card-title">Courses</h2>
        <p className="card-sub">
          How each course is paid for, and how late a student may change their booking.
        </p>

        <table className="table">
          <thead>
            <tr>
              <th>Course</th>
              <th>Booked with</th>
              <th>Shop product</th>
              <th>Confirm by hand</th>
              <th>Notice to change</th>
              <th>Default class size</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(coursesQuery.data?.courses ?? []).map((c) => (
              <tr key={c.id} className={c.active ? '' : 'row-inactive'}>
                <td>
                  <span className="legend-dot" style={{ background: c.colour, display: 'inline-block', marginRight: 8 }} />
                  <strong>{c.name}</strong>
                </td>
                <td>
                  <span className="pill pill-muted">
                    {c.bookingMode === 'package' ? 'Course package' : c.bookingMode === 'paid' ? 'Shop payment' : 'Free'}
                  </span>
                </td>
                <td>
                  {/*
                    Empty is meaningful, not merely unset: with no product the shop has nothing to
                    sell for this course, so a paid booking cannot be completed. Saying so beats
                    an empty box that looks finished.
                  */}
                  <input
                    type="number"
                    min={1}
                    className="btn btn-sm"
                    style={{ width: 92 }}
                    placeholder={c.bookingMode === 'free' ? 'not needed' : 'e.g. 1234'}
                    defaultValue={c.wooProductIds[0] ?? ''}
                    disabled={c.bookingMode === 'free'}
                    onBlur={(e) => {
                      const raw = e.target.value.trim()
                      const next = raw ? [Number(raw)] : []
                      if (next[0] !== c.wooProductIds[0]) {
                        courseMutation.mutate({ id: c.id, patch: { wooProductIds: next } as Partial<Course> })
                      }
                    }}
                  />
                  {c.bookingMode !== 'free' && c.wooProductIds.length === 0 && (
                    <div className="small" style={{ color: 'var(--danger, #b3382c)' }}>
                      Not on sale yet
                    </div>
                  )}
                </td>
                <td>
                  <label className="switch-label">
                    <input
                      type="checkbox"
                      checked={c.requiresManualConfirmation}
                      onChange={(e) =>
                        courseMutation.mutate({
                          id: c.id,
                          patch: { requiresManualConfirmation: e.target.checked } as Partial<Course>,
                        })
                      }
                    />
                    <span className="small muted">
                      {c.requiresManualConfirmation ? 'You approve each place' : 'Confirmed on payment'}
                    </span>
                  </label>
                </td>
                <td>
                  <select
                    className="btn btn-sm"
                    value={c.rescheduleCutoffHours}
                    onChange={(e) =>
                      courseMutation.mutate({
                        id: c.id,
                        patch: {
                          rescheduleCutoffHours: Number(e.target.value),
                          cancelCutoffHours: Number(e.target.value),
                        } as Partial<Course>,
                      })
                    }
                  >
                    <option value={0}>No restriction</option>
                    <option value={24}>24 hours</option>
                    <option value={48}>2 days</option>
                    <option value={72}>3 days</option>
                    <option value={168}>1 week</option>
                  </select>
                </td>
                <td>
                  <input
                    type="number"
                    min={1}
                    max={200}
                    className="btn btn-sm"
                    style={{ width: 74 }}
                    defaultValue={c.defaultCapacity}
                    onBlur={(e) => {
                      const value = Number(e.target.value)
                      if (value !== c.defaultCapacity) {
                        courseMutation.mutate({ id: c.id, patch: { defaultCapacity: value } as Partial<Course> })
                      }
                    }}
                  />
                </td>
                <td className="row-actions">
                  {/*
                    Archived, never deleted: courses are referenced by every class ever taught and
                    every package ever sold, and removing one would take the history with it.
                  */}
                  <button
                    type="button"
                    className={c.active ? 'link-btn link-danger' : 'link-btn'}
                    onClick={() =>
                      courseMutation.mutate({ id: c.id, patch: { active: !c.active } as Partial<Course> })
                    }
                  >
                    {c.active ? 'Archive' : 'Restore'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <NewCourseForm onMessage={setMessage} />

        <div className="banner banner-info" style={{ marginTop: 14, marginBottom: 0 }}>
          Changing the class size here only affects classes created from now on. To change one that
          already exists, open it on the calendar.
        </div>
      </div>

      <SetCoursesCard onMessage={setMessage} />

      <IntegrationsCard onMessage={setMessage} />

      <div className="card">
        <h2 className="card-title">Alerts on your phone</h2>
        <p className="card-sub">Get a notification the moment someone books.</p>
        <PushEnrolment onMessage={setMessage} />
      </div>

      <div className="card">
        <h2 className="card-title">Security</h2>
        <p className="card-sub">
          Two-factor sign-in is {totpEnabled ? 'on' : 'off'}.
          {!totpEnabled && ' Turning it on means a code from your phone is needed as well as your password.'}
        </p>
        <ChangePassword onMessage={setMessage} />
        <div style={{ marginTop: 18 }}>
          {!totpEnabled && <TotpSetup onMessage={setMessage} />}
        </div>
      </div>

      <BackupsCard onMessage={setMessage} />

      <AuditCard />

      <div className="card">
        <h2 className="card-title">Maintenance</h2>

        <div className="row" style={{ marginBottom: 14 }}>
          <button type="button" className="btn" onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending}>
            {generateMutation.isPending ? 'Working…' : 'Fill the calendar from my weekly timetable'}
          </button>
        </div>

        {driftQuery.data && driftQuery.data.drift.length > 0 ? (
          <>
            <div className="banner banner-warn">
              {driftQuery.data.drift.length} class(es) have a places-taken count that does not match their
              bookings. This should not happen — worth a look before correcting it.
            </div>
            <table className="table">
              <thead>
                <tr><th>Date</th><th>Class</th><th>Counter says</th><th>Bookings say</th></tr>
              </thead>
              <tbody>
                {driftQuery.data.drift.map((d) => (
                  <tr key={d.sessionId}>
                    <td className="small">{d.dateKey}</td>
                    <td>{d.title}</td>
                    <td>{d.storedSeatsTaken}</td>
                    <td>{d.actualSeatsTaken}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button type="button" className="btn btn-sm" style={{ marginTop: 12 }} onClick={() => repairMutation.mutate()}>
              Correct these counts
            </button>
          </>
        ) : (
          <div className="banner banner-ok" style={{ marginBottom: 0 }}>
            All place counts match their bookings.
          </div>
        )}
      </div>
    </>
  )
}

interface SeriesRow {
  seriesId: string
  name: string
  bookable: boolean
  placesLeft: number
  reason: string
  wooProductId: number | null
  active: boolean
  sessions: { id: string; title: string; startAt: string; seatsLeft: number; isFull: boolean }[]
}

/**
 * Set courses like the Autumn Ikebana Course, sold as one purchase covering several dates.
 *
 * The shop product id is the field that matters: until it is set, a course bought in the shop
 * arrives with no way to tell what it was for, and books nothing.
 */
function SetCoursesCard({ onMessage }: { onMessage: (m: { kind: 'ok' | 'danger'; text: string }) => void }) {
  const queryClient = useQueryClient()

  const { data } = useQuery({
    queryKey: ['admin-series'],
    queryFn: () => api.get<{ series: SeriesRow[] }>('/api/admin/settings/series'),
  })

  const linkMutation = useMutation({
    mutationFn: (input: { id: string; wooProductId: number | null }) =>
      api.patch(`/api/admin/settings/series/${input.id}`, { wooProductId: input.wooProductId }),
    onSuccess: () => {
      onMessage({ kind: 'ok', text: 'Saved.' })
      void queryClient.invalidateQueries({ queryKey: ['admin-series'] })
    },
    onError: (err) =>
      onMessage({ kind: 'danger', text: err instanceof ApiError ? err.message : 'Could not save.' }),
  })

  const rows = data?.series ?? []
  if (rows.length === 0) return null

  return (
    <div className="card">
      <h2 className="card-title">Set courses</h2>
      <p className="card-sub">
        Courses booked as a whole run rather than one date at a time. One purchase books every date.
      </p>

      {rows.map((row) => (
        <div key={row.seriesId} style={{ marginBottom: 18 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <strong>{row.name}</strong>
            {row.bookable ? (
              <span className="pill pill-ok">{row.placesLeft} place(s) available</span>
            ) : (
              <span className="pill pill-danger">Not bookable</span>
            )}
          </div>

          {!row.bookable && row.reason && <div className="banner banner-warn" style={{ marginTop: 8 }}>{row.reason}</div>}

          <table className="table" style={{ marginTop: 8 }}>
            <tbody>
              {row.sessions.map((s) => (
                <tr key={s.id}>
                  <td className="small">
                    {DateTime.fromISO(s.startAt).setZone(STUDIO_TZ).toFormat('ccc d LLL yyyy, h:mm a')}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <span className={`pill ${s.isFull ? 'pill-danger' : 'pill-muted'}`}>
                      {s.isFull ? 'Full' : `${s.seatsLeft} left`}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <label className="field" style={{ maxWidth: 320, marginTop: 10 }}>
            <span>Shop product ID</span>
            <input
              type="number"
              defaultValue={row.wooProductId ?? ''}
              placeholder="e.g. 1234"
              onBlur={(e) => {
                const value = e.target.value.trim() ? Number(e.target.value) : null
                if (value !== row.wooProductId) linkMutation.mutate({ id: row.seriesId, wooProductId: value })
              }}
            />
            <div className="field-hint">
              {row.wooProductId
                ? 'Buying this product in the shop books all the dates above.'
                : 'Until this is set, buying this course in the shop will not book anything. Find the ID in WooCommerce → Products.'}
            </div>
          </label>
        </div>
      ))}
    </div>
  )
}

interface AuditEntry {
  _id: string
  actor: string
  action: string
  entity: string
  reason: string
  createdAt: string
}

/** A plain-English record of who changed what — the counterweight to letting the studio override its own rules. */
function AuditCard() {
  const [open, setOpen] = useState(false)

  const { data } = useQuery({
    queryKey: ['audit'],
    queryFn: () => api.get<{ entries: AuditEntry[] }>('/api/admin/settings/audit?limit=60'),
    enabled: open,
  })

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h2 className="card-title">Recent changes</h2>
          <p className="card-sub" style={{ marginBottom: 0 }}>
            Every change to a class, a booking or a course package.
          </p>
        </div>
        <button type="button" className="btn btn-sm" onClick={() => setOpen(!open)}>
          {open ? 'Hide' : 'Show'}
        </button>
      </div>

      {open && (
        <table className="table" style={{ marginTop: 14 }}>
          <thead>
            <tr><th>When</th><th>What</th><th>Who</th></tr>
          </thead>
          <tbody>
            {(data?.entries ?? []).map((entry) => (
              <tr key={entry._id}>
                <td className="small muted" style={{ whiteSpace: 'nowrap' }}>
                  {DateTime.fromISO(entry.createdAt).setZone(STUDIO_TZ).toFormat('d LLL, h:mm a')}
                </td>
                <td>
                  {describeAction(entry.action)}
                  {entry.reason && <div className="muted small">{entry.reason}</div>}
                </td>
                <td className="small muted">{entry.actor.replace(/^(admin|student|woo):/, '')}</td>
              </tr>
            ))}
            {data?.entries.length === 0 && (
              <tr><td colSpan={3} className="empty">Nothing recorded yet.</td></tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  )
}

/** Turn an action key into something readable. Overrides are called out, since that is the point. */
function describeAction(action: string): string {
  const labels: Record<string, string> = {
    'booking.create': 'Booking added',
    'booking.create.override': 'Booking added over the class size',
    'booking.cancel': 'Booking cancelled',
    'booking.reschedule': 'Booking moved',
    'booking.reschedule.override': 'Booking moved past the notice period',
    'session.create': 'Class added',
    'session.update': 'Class changed',
    'session.cancel': 'Class cancelled',
    'session.restore': 'Class put back on',
    'session.delete': 'Class deleted',
    'closedDate.create': 'Days marked closed',
    'closedDate.delete': 'Closed days reopened',
    'package.grant': 'Course package created',
    'package.adjust': 'Course package changed',
    'course.rescheduleWindowChanged': 'Notice period changed',
    'series.book': 'Set course booked',
    'series.create': 'Set course created',
    'series.update': 'Set course changed',
    'scheduleRule.deactivate': 'Weekly slot stopped',
    'maintenance.repairSeatDrift': 'Place counts corrected',
  }
  return labels[action] ?? action
}

interface SecretStatus { configured: boolean; hint: string; source: 'studio' | 'environment' | 'none' }
interface Integrations {
  email: SecretStatus
  telegramToken: SecretStatus
  telegramChat: SecretStatus
  mailFrom: string
  replyTo: string | null
}

/**
 * Connected services.
 *
 * Keys can be changed here rather than requiring a redeploy, which matters because rotating one
 * is something the studio may need to do on a bad day without a developer. Only a masked hint is
 * ever shown — the screen answers "is the right key in there?" without becoming a way to read a
 * secret back out.
 */
function IntegrationsCard({ onMessage }: { onMessage: (m: { kind: 'ok' | 'danger'; text: string }) => void }) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<string | null>(null)
  const [value, setValue] = useState('')

  const { data } = useQuery({
    queryKey: ['integrations'],
    queryFn: () => api.get<Integrations>('/api/admin/settings/integrations'),
  })

  const save = useMutation({
    mutationFn: (input: { name: string; value: string }) =>
      api.put(`/api/admin/settings/integrations/${input.name}`, { value: input.value }),
    onSuccess: () => {
      setEditing(null)
      setValue('')
      onMessage({ kind: 'ok', text: 'Saved. New emails will use this key.' })
      void queryClient.invalidateQueries({ queryKey: ['integrations'] })
    },
    onError: (err) => onMessage({ kind: 'danger', text: err instanceof ApiError ? err.message : 'Could not save.' }),
  })

  const check = useMutation({
    mutationFn: () => api.post<{ ok: boolean; message: string; domains?: string[] }>('/api/admin/settings/integrations/resend/check'),
    onSuccess: (r) =>
      onMessage({
        kind: r.ok ? 'ok' : 'danger',
        text: r.domains?.length ? `${r.message} Domains: ${r.domains.join(', ')}` : r.message,
      }),
  })

  const rows: { name: string; label: string; hint: string; status?: SecretStatus }[] = [
    { name: 'resend', label: 'Resend API key', hint: 'Sends confirmations and reminders.', status: data?.email },
    { name: 'telegram-token', label: 'Telegram bot token', hint: 'Optional — booking alerts on your phone.', status: data?.telegramToken },
    { name: 'telegram-chat', label: 'Telegram chat ID', hint: 'From @userinfobot.', status: data?.telegramChat },
  ]

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h2 className="card-title">Connected services</h2>
          <p className="card-sub" style={{ marginBottom: 0 }}>
            Sending from <strong>{data?.mailFrom ?? '—'}</strong>
            {data?.replyTo && <> · replies to {data.replyTo}</>}
          </p>
        </div>
        <button type="button" className="btn btn-sm" disabled={check.isPending} onClick={() => check.mutate()}>
          {check.isPending ? 'Checking…' : 'Test email key'}
        </button>
      </div>

      <div className="field-row" style={{ marginTop: 14 }}>
        <MailField
          label="Send from"
          name="mail-from"
          value={data?.mailFrom ?? ''}
          hint="Resend will refuse this until your domain is verified. Use onboarding@resend.dev to test before then."
          onSaved={() => void queryClient.invalidateQueries({ queryKey: ['integrations'] })}
          onMessage={onMessage}
        />
        <MailField
          label="Replies go to"
          name="mail-reply-to"
          value={data?.replyTo ?? ''}
          hint="Where a student's reply lands."
          onSaved={() => void queryClient.invalidateQueries({ queryKey: ['integrations'] })}
          onMessage={onMessage}
        />
      </div>

      <table className="table" style={{ marginTop: 14 }}>
        <tbody>
          {rows.map((row) => (
            <tr key={row.name}>
              <td>
                <div className="row-title">{row.label}</div>
                <div className="row-sub">{row.hint}</div>

                {editing === row.name && (
                  <div className="row" style={{ marginTop: 10 }}>
                    <input
                      type="password"
                      autoFocus
                      className="btn"
                      style={{ minWidth: 300, fontFamily: 'ui-monospace, monospace' }}
                      placeholder="Paste the new key"
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                    />
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={!value.trim() || save.isPending}
                      onClick={() => save.mutate({ name: row.name, value: value.trim() })}
                    >
                      Save
                    </button>
                    <button type="button" className="btn btn-sm" onClick={() => { setEditing(null); setValue('') }}>
                      Cancel
                    </button>
                  </div>
                )}
              </td>
              <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                {row.status?.configured ? (
                  <>
                    <span className="mono faint" style={{ marginRight: 8 }}>{row.status.hint}</span>
                    <span className={row.status.source === 'studio' ? 'pill pill-ok' : 'pill pill-muted'}>
                      {row.status.source === 'studio' ? 'Set here' : 'From server'}
                    </span>
                  </>
                ) : (
                  <span className="pill pill-warn">Not set</span>
                )}
                {editing !== row.name && (
                  <button
                    type="button"
                    className="btn btn-sm"
                    style={{ marginLeft: 8 }}
                    onClick={() => { setEditing(row.name); setValue('') }}
                  >
                    Change
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="banner banner-info" style={{ marginTop: 14, marginBottom: 0 }}>
        Keys are stored encrypted and never shown again once saved — only the first and last few
        characters, so you can tell which key is in place.
      </div>
    </div>
  )
}

/** One editable mail address, saved on blur so there is no separate save button to miss. */
function MailField({
  label,
  name,
  value,
  hint,
  onSaved,
  onMessage,
}: {
  label: string
  name: string
  value: string
  hint: string
  onSaved: () => void
  onMessage: (m: { kind: 'ok' | 'danger'; text: string }) => void
}) {
  const save = useMutation({
    mutationFn: (next: string) => api.put(`/api/admin/settings/mail/${name}`, { value: next }),
    onSuccess: () => { onMessage({ kind: 'ok', text: 'Saved.' }); onSaved() },
    onError: (err) => onMessage({ kind: 'danger', text: err instanceof ApiError ? err.message : 'Could not save.' }),
  })

  return (
    <label className="field">
      <span>{label}</span>
      <input
        defaultValue={value}
        key={value}
        onBlur={(e) => { if (e.target.value !== value) save.mutate(e.target.value) }}
      />
      <div className="field-hint">{hint}</div>
    </label>
  )
}

interface BackupFile { file: string; bytes: number; createdAt: string }

/**
 * Nightly backups.
 *
 * MongoDB's free tier takes none, so the app takes its own onto this server's disk. Shown here
 * because a backup job that quietly stopped looks exactly like one that is working, right up
 * until the day it is needed.
 */
function BackupsCard({ onMessage }: { onMessage: (m: { kind: 'ok' | 'danger'; text: string }) => void }) {
  const queryClient = useQueryClient()

  const { data } = useQuery({
    queryKey: ['backups'],
    queryFn: () => api.get<{ backups: BackupFile[]; ageHours: number | null; keep: number }>('/api/admin/settings/backups'),
  })

  const run = useMutation({
    mutationFn: () => api.post<{ file: string; totalDocuments: number }>('/api/admin/settings/backups/run'),
    onSuccess: (r) => {
      onMessage({ kind: 'ok', text: `Backed up ${r.totalDocuments} records to ${r.file}.` })
      void queryClient.invalidateQueries({ queryKey: ['backups'] })
    },
    onError: (err) => onMessage({ kind: 'danger', text: err instanceof ApiError ? err.message : 'Backup failed.' }),
  })

  const backups = data?.backups ?? []
  const stale = data?.ageHours === null || (data?.ageHours ?? 0) > 48

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h2 className="card-title">Backups</h2>
          <p className="card-sub" style={{ marginBottom: 0 }}>
            Taken automatically every night, and kept for the last {data?.keep ?? 30} days.
          </p>
        </div>
        <button type="button" className="btn btn-sm" disabled={run.isPending} onClick={() => run.mutate()}>
          {run.isPending ? 'Backing up…' : 'Back up now'}
        </button>
      </div>

      {stale && (
        <div className="banner banner-danger" style={{ marginTop: 14 }}>
          {data?.ageHours === null
            ? 'No backup has been taken yet. Your bookings could not be recovered if the database were lost.'
            : 'The nightly backup has not run in over two days.'}
        </div>
      )}

      {backups.length > 0 && (
        <table className="table" style={{ marginTop: 14 }}>
          <tbody>
            {backups.slice(0, 8).map((b) => (
              <tr key={b.file}>
                <td>
                  <div className="row-title">
                    {DateTime.fromISO(b.createdAt).setZone(STUDIO_TZ).toFormat('ccc d LLL yyyy, h:mm a')}
                  </div>
                  <div className="row-sub">{(b.bytes / 1024).toFixed(0)} KB</div>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <a className="btn btn-sm" href={`/api/admin/settings/backups/${b.file}`} download>
                    Download
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function PushEnrolment({ onMessage }: { onMessage: (m: { kind: 'ok' | 'danger'; text: string }) => void }) {
  const [busy, setBusy] = useState(false)

  async function enable() {
    setBusy(true)
    try {
      const { publicKey } = await api.get<{ publicKey: string | null }>('/api/admin/settings/push/key')
      if (!publicKey) {
        onMessage({ kind: 'danger', text: 'Push alerts are not configured on the server yet.' })
        return
      }

      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        onMessage({ kind: 'danger', text: 'Your browser blocked notifications.' })
        return
      }

      const registration = await navigator.serviceWorker.register('/admin/sw.js')
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: publicKey,
      })

      await api.post('/api/admin/settings/push/subscribe', subscription.toJSON())
      onMessage({ kind: 'ok', text: 'Push alerts are on for this device.' })
    } catch (err) {
      onMessage({ kind: 'danger', text: err instanceof Error ? err.message : 'Could not turn on push alerts.' })
    } finally {
      setBusy(false)
    }
  }

  const supported = 'serviceWorker' in navigator && 'PushManager' in window

  if (!supported) {
    return <p className="muted small">This browser does not support push notifications.</p>
  }

  return (
    <button type="button" className="btn" onClick={enable} disabled={busy}>
      {busy ? 'Setting up…' : 'Turn on push alerts for this device'}
    </button>
  )
}

/** Change your own password. Signs every session out afterwards, including this one. */
function ChangePassword({ onMessage }: { onMessage: (m: { kind: 'ok' | 'danger'; text: string }) => void }) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' })

  const change = useMutation({
    mutationFn: () =>
      api.post<{ message: string }>('/api/auth/admin/password', {
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
      }),
    onSuccess: () => {
      onMessage({ kind: 'ok', text: 'Password changed. Signing you out…' })
      setTimeout(() => window.location.reload(), 1200)
    },
    onError: (err) =>
      onMessage({ kind: 'danger', text: err instanceof ApiError ? err.message : 'Could not change your password.' }),
  })

  const mismatch = form.confirm.length > 0 && form.newPassword !== form.confirm
  const canSubmit =
    form.currentPassword.length > 0 && form.newPassword.length >= 12 && form.newPassword === form.confirm

  if (!open) {
    return (
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        Change password
      </button>
    )
  }

  return (
    <div style={{ maxWidth: 360 }}>
      <PasswordField
        label="Current password"
        value={form.currentPassword}
        onChange={(v) => setForm({ ...form, currentPassword: v })}
        autoFocus
      />
      <PasswordField
        label="New password"
        value={form.newPassword}
        onChange={(v) => setForm({ ...form, newPassword: v })}
        autoComplete="new-password"
        minLength={12}
        hint="At least 12 characters."
      />
      <PasswordField
        label="Confirm new password"
        value={form.confirm}
        onChange={(v) => setForm({ ...form, confirm: v })}
        autoComplete="new-password"
        hint={mismatch ? 'These do not match.' : undefined}
      />

      <div className="row">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!canSubmit || change.isPending}
          onClick={() => change.mutate()}
        >
          {change.isPending ? 'Changing…' : 'Change password'}
        </button>
        <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
      </div>

      <div className="field-hint" style={{ marginTop: 10 }}>
        You will be signed out on every device, including this one.
      </div>
    </div>
  )
}

function TotpSetup({ onMessage }: { onMessage: (m: { kind: 'ok' | 'danger'; text: string }) => void }) {
  const [secret, setSecret] = useState<string | null>(null)
  const [code, setCode] = useState('')

  const setupMutation = useMutation({
    mutationFn: () => api.post<{ secret: string; otpauthUrl: string }>('/api/auth/admin/totp/setup'),
    onSuccess: (data) => setSecret(data.secret),
  })

  const confirmMutation = useMutation({
    mutationFn: () => api.post('/api/auth/admin/totp/confirm', { totp: code }),
    onSuccess: () => {
      onMessage({ kind: 'ok', text: 'Two-factor sign-in is now on.' })
      window.location.reload()
    },
    onError: (err) =>
      onMessage({ kind: 'danger', text: err instanceof ApiError ? err.message : 'That code was not accepted.' }),
  })

  if (!secret) {
    return (
      <button type="button" className="btn" onClick={() => setupMutation.mutate()} disabled={setupMutation.isPending}>
        Set up two-factor sign-in
      </button>
    )
  }

  return (
    <div className="stack">
      <p className="small">
        In your authenticator app, add an account by entering this key:
      </p>
      <div className="mono" style={{ padding: 10, background: 'var(--canvas)', borderRadius: 8, wordBreak: 'break-all' }}>
        {secret}
      </div>
      <div className="row">
        <input
          className="btn"
          style={{ width: 130 }}
          inputMode="numeric"
          maxLength={6}
          placeholder="000000"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
        />
        <button type="button" className="btn btn-primary" disabled={code.length !== 6 || confirmMutation.isPending} onClick={() => confirmMutation.mutate()}>
          Confirm
        </button>
      </div>
    </div>
  )
}

/**
 * Add a course.
 *
 * The two fields that decide whether a course can actually be sold — the shop product and
 * whether the studio approves each payment — are on the form rather than left to be discovered
 * afterwards. A course created without a product looks finished but silently cannot be booked,
 * which is the failure the Autumn Ikebana Course already hit.
 */
function NewCourseForm({
  onMessage,
}: {
  onMessage: (m: { kind: 'ok' | 'danger'; text: string }) => void
}) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({
    name: '',
    colour: '#7c6a9c',
    bookingMode: 'paid' as 'paid' | 'package' | 'free',
    rescheduleCutoffHours: 72,
    defaultDurationMins: 150,
    defaultCapacity: 8,
    wooProductId: '',
    requiresManualConfirmation: true,
  })

  const create = useMutation({
    mutationFn: () =>
      api.post('/api/admin/settings/courses', {
        name: form.name.trim(),
        // Derived rather than asked for: the slug is only ever used in URLs and the shortcode,
        // and asking the studio to invent one is asking them to get it wrong.
        slug: form.name
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, ''),
        colour: form.colour,
        bookingMode: form.bookingMode,
        rescheduleCutoffHours: form.rescheduleCutoffHours,
        cancelCutoffHours: form.rescheduleCutoffHours,
        defaultDurationMins: form.defaultDurationMins,
        defaultCapacity: form.defaultCapacity,
        wooProductIds: form.wooProductId.trim() ? [Number(form.wooProductId.trim())] : [],
        requiresManualConfirmation: form.bookingMode === 'free' ? false : form.requiresManualConfirmation,
      }),
    onSuccess: () => {
      onMessage({ kind: 'ok', text: `${form.name} added. Add classes for it on the calendar.` })
      setForm({ ...form, name: '', wooProductId: '' })
      setOpen(false)
      void queryClient.invalidateQueries({ queryKey: ['courses'] })
    },
    onError: (err) =>
      onMessage({
        kind: 'danger',
        text: err instanceof ApiError ? err.message : 'That course could not be added.',
      }),
  })

  if (!open) {
    return (
      <button type="button" className="btn btn-quiet" style={{ marginTop: 14 }} onClick={() => setOpen(true)}>
        + Add a course
      </button>
    )
  }

  return (
    <form
      className="inline-form"
      onSubmit={(e) => {
        e.preventDefault()
        create.mutate()
      }}
    >
      <label className="field">
        <span>Course name</span>
        <input
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="Preserved Flower"
          required
          autoFocus
        />
      </label>

      <label className="field" style={{ flex: '0 0 130px' }}>
        <span>Paid how?</span>
        <select
          value={form.bookingMode}
          onChange={(e) => setForm({ ...form, bookingMode: e.target.value as typeof form.bookingMode })}
        >
          <option value="paid">In the shop</option>
          <option value="package">Course package</option>
          <option value="free">Free</option>
        </select>
      </label>

      <label className="field" style={{ flex: '0 0 120px' }}>
        <span>Shop product ID</span>
        <input
          type="number"
          min={1}
          value={form.wooProductId}
          onChange={(e) => setForm({ ...form, wooProductId: e.target.value })}
          placeholder="e.g. 1234"
          disabled={form.bookingMode === 'free'}
        />
      </label>

      <label className="field" style={{ flex: '0 0 96px' }}>
        <span>Class size</span>
        <input
          type="number"
          min={1}
          max={200}
          value={form.defaultCapacity}
          onChange={(e) => setForm({ ...form, defaultCapacity: Number(e.target.value) })}
        />
      </label>

      <label className="field" style={{ flex: '0 0 116px' }}>
        <span>Notice to change</span>
        <select
          value={form.rescheduleCutoffHours}
          onChange={(e) => setForm({ ...form, rescheduleCutoffHours: Number(e.target.value) })}
        >
          <option value={0}>No restriction</option>
          <option value={24}>24 hours</option>
          <option value={48}>2 days</option>
          <option value={72}>3 days</option>
          <option value={168}>1 week</option>
        </select>
      </label>

      <label className="field" style={{ flex: '1 1 210px' }}>
        <span>Colour</span>
        <input
          type="color"
          value={form.colour}
          onChange={(e) => setForm({ ...form, colour: e.target.value })}
        />
      </label>

      {form.bookingMode !== 'free' && (
        <label className="switch-label" style={{ flex: '1 1 100%' }}>
          <input
            type="checkbox"
            checked={form.requiresManualConfirmation}
            onChange={(e) => setForm({ ...form, requiresManualConfirmation: e.target.checked })}
          />
          <span className="small">
            I check each payment myself before confirming the place
          </span>
        </label>
      )}

      <div className="row" style={{ flex: '1 1 100%' }}>
        <button type="submit" className="btn btn-primary" disabled={create.isPending || !form.name.trim()}>
          Add course
        </button>
        <button type="button" className="btn btn-quiet" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  )
}
