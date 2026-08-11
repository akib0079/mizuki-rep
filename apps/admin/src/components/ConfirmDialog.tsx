import { useState, type ReactNode } from 'react'

/**
 * The confirmation used for anything students would notice.
 *
 * `notifyPrompt` is only passed when somebody is actually booked, so the studio is never asked
 * whether to email nobody — and when it is asked, the answer defaults to yes.
 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel = 'Confirm',
  danger = false,
  busy = false,
  notifyPrompt,
  notifyDefault = true,
  onConfirm,
  onCancel,
}: {
  title: string
  children: ReactNode
  confirmLabel?: string
  danger?: boolean
  busy?: boolean
  notifyPrompt?: string
  notifyDefault?: boolean
  onConfirm: (notify: boolean) => Promise<void>
  onCancel: () => void
}) {
  const [notify, setNotify] = useState(notifyDefault)
  const [error, setError] = useState<string | null>(null)

  return (
    <>
      <div className="drawer-backdrop" style={{ zIndex: 60 }} onClick={busy ? undefined : onCancel} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{
          position: 'fixed',
          zIndex: 70,
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 'min(440px, calc(100vw - 32px))',
          background: 'var(--surface)',
          borderRadius: 'var(--radius)',
          boxShadow: 'var(--shadow)',
          padding: 22,
        }}
      >
        <h2 style={{ margin: '0 0 10px', fontSize: 17 }}>{title}</h2>
        <div style={{ fontSize: 14 }}>{children}</div>

        {error && <div className="banner banner-danger" style={{ marginTop: 12 }}>{error}</div>}

        {notifyPrompt && (
          <label className="row" style={{ marginTop: 14, gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
            <span className="small">{notifyPrompt}</span>
          </label>
        )}

        <div className="row" style={{ marginTop: 20, justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>Keep as is</button>
          <button type="button"
            className={danger ? 'btn btn-danger' : 'btn btn-primary'}
            disabled={busy}
            onClick={async () => {
              setError(null)
              try {
                await onConfirm(notifyPrompt ? notify : false)
              } catch (err) {
                setError(err instanceof Error ? err.message : 'That did not work. Please try again.')
              }
            }}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </>
  )
}
