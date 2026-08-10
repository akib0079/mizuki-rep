import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, api, type Course } from '../api.js'

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
              <th>Notice to change</th>
              <th>Default class size</th>
            </tr>
          </thead>
          <tbody>
            {(coursesQuery.data?.courses ?? []).map((c) => (
              <tr key={c.id}>
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
              </tr>
            ))}
          </tbody>
        </table>

        <div className="banner banner-info" style={{ marginTop: 14, marginBottom: 0 }}>
          Changing the class size here only affects classes created from now on. To change one that
          already exists, open it on the calendar.
        </div>
      </div>

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
        {!totpEnabled && <TotpSetup onMessage={setMessage} />}
      </div>

      <div className="card">
        <h2 className="card-title">Maintenance</h2>

        <div className="row" style={{ marginBottom: 14 }}>
          <button className="btn" onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending}>
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
            <button className="btn btn-sm" style={{ marginTop: 12 }} onClick={() => repairMutation.mutate()}>
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
    <button className="btn" onClick={enable} disabled={busy}>
      {busy ? 'Setting up…' : 'Turn on push alerts for this device'}
    </button>
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
      <button className="btn" onClick={() => setupMutation.mutate()} disabled={setupMutation.isPending}>
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
        <button className="btn btn-primary" disabled={code.length !== 6 || confirmMutation.isPending} onClick={() => confirmMutation.mutate()}>
          Confirm
        </button>
      </div>
    </div>
  )
}
