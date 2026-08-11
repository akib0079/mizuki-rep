import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, api, type EmailTemplate } from '../api.js'

/**
 * "You can reword them however you like."
 *
 * Every variable is one click away, the preview shows what a student actually receives, and
 * reset restores the wording the system shipped with — so experimenting is safe.
 */
export function TemplatesPage() {
  const queryClient = useQueryClient()
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [draft, setDraft] = useState({ subject: '', bodyHtml: '', bodyText: '' })
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null)
  const [message, setMessage] = useState<{ kind: 'ok' | 'danger'; text: string } | null>(null)

  const { data } = useQuery({
    queryKey: ['templates'],
    queryFn: () => api.get<{ templates: EmailTemplate[] }>('/api/admin/settings/templates'),
  })

  const templates = data?.templates ?? []
  const active = templates.find((t) => t.key === activeKey) ?? templates[0]

  // Load the selected template into the editor whenever the selection changes.
  useEffect(() => {
    if (!active) return
    setDraft({ subject: active.subject, bodyHtml: active.bodyHtml, bodyText: active.bodyText })
    setPreview(null)
    setMessage(null)
  }, [active?.key])

  const saveMutation = useMutation({
    mutationFn: () => api.put(`/api/admin/settings/templates/${active!.key}`, draft),
    onSuccess: () => {
      setMessage({ kind: 'ok', text: 'Saved. New emails will use this wording.' })
      void queryClient.invalidateQueries({ queryKey: ['templates'] })
    },
    onError: (err) => setMessage({ kind: 'danger', text: err instanceof ApiError ? err.message : 'Could not save.' }),
  })

  const resetMutation = useMutation({
    mutationFn: () => api.post(`/api/admin/settings/templates/${active!.key}/reset`),
    onSuccess: () => {
      setMessage({ kind: 'ok', text: 'Restored the original wording.' })
      void queryClient.invalidateQueries({ queryKey: ['templates'] })
    },
  })

  const previewMutation = useMutation({
    mutationFn: () => api.post<{ subject: string; html: string }>(`/api/admin/settings/templates/${active!.key}/preview`),
    onSuccess: setPreview,
  })

  const testMutation = useMutation({
    mutationFn: (to: string) => api.post(`/api/admin/settings/templates/${active!.key}/test`, { to }),
    onSuccess: () => setMessage({ kind: 'ok', text: 'Test email sent.' }),
    onError: (err) =>
      setMessage({ kind: 'danger', text: err instanceof ApiError ? err.message : 'Could not send the test.' }),
  })

  /** Insert a variable at the cursor, so the studio never has to type the braces. */
  function insertVariable(variable: string) {
    const field = document.getElementById('template-body') as HTMLTextAreaElement | null
    const token = `{{${variable}}}`
    if (!field) {
      setDraft((d) => ({ ...d, bodyHtml: d.bodyHtml + token }))
      return
    }
    const { selectionStart: start, selectionEnd: end, value } = field
    setDraft((d) => ({ ...d, bodyHtml: value.slice(0, start) + token + value.slice(end) }))
    requestAnimationFrame(() => {
      field.focus()
      field.setSelectionRange(start + token.length, start + token.length)
    })
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Emails</h1>
          <p>The wording students see. Changes take effect on the next email sent.</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px, 250px) 1fr', gap: 16, alignItems: 'start' }}>
        <div className="card" style={{ padding: 10 }}>
          {templates.map((t) => (
            <button type="button"
              key={t.key}
              className={t.key === active?.key ? 'nav-link active' : 'nav-link'}
              style={{ width: '100%', textAlign: 'left', border: 'none', cursor: 'pointer', background: t.key === active?.key ? undefined : 'transparent' }}
              onClick={() => setActiveKey(t.key)}
            >
              {t.label}
              {t.isCustomised && <span className="pill pill-muted" style={{ marginLeft: 6 }}>edited</span>}
            </button>
          ))}
        </div>

        <div>
          {active && (
            <div className="card">
              <h2 className="card-title">{active.label}</h2>
              <p className="card-sub">{active.description}</p>

              {message && <div className={`banner banner-${message.kind}`}>{message.text}</div>}

              <label className="field">
                <span>Subject</span>
                <input value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
              </label>

              <div className="field">
                <span style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 5, color: 'var(--ink-soft)' }}>
                  Insert a detail
                </span>
                <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                  {active.variables.map((v) => (
                    <button type="button" key={v} className="btn btn-sm" onClick={() => insertVariable(v)} title={`Insert {{${v}}}`}>
                      {v}
                    </button>
                  ))}
                </div>
              </div>

              <label className="field">
                <span>Email body (HTML)</span>
                <textarea
                  id="template-body"
                  rows={16}
                  className="mono"
                  value={draft.bodyHtml}
                  onChange={(e) => setDraft({ ...draft, bodyHtml: e.target.value })}
                />
              </label>

              <label className="field">
                <span>Plain-text version</span>
                <textarea
                  rows={6}
                  className="mono"
                  value={draft.bodyText}
                  onChange={(e) => setDraft({ ...draft, bodyText: e.target.value })}
                />
                <div className="field-hint">Shown by email apps that do not display HTML.</div>
              </label>

              <div className="row" style={{ flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-primary" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                  {saveMutation.isPending ? 'Saving…' : 'Save'}
                </button>
                <button type="button" className="btn" onClick={() => previewMutation.mutate()}>Preview</button>
                <button type="button"
                  className="btn"
                  onClick={() => {
                    const to = prompt('Send a test to which address?')
                    if (to) testMutation.mutate(to)
                  }}
                >
                  Send test
                </button>
                <div className="spacer" />
                <button type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    if (confirm('Restore the original wording for this email?')) resetMutation.mutate()
                  }}
                >
                  Reset to original
                </button>
              </div>
            </div>
          )}

          {preview && (
            <div className="card">
              <h2 className="card-title">Preview</h2>
              <p className="card-sub">Subject: {preview.subject}</p>
              <iframe
                title="Email preview"
                // Sandboxed with no allow-scripts: the preview renders studio-authored HTML,
                // and it should never be able to run anything inside the console.
                sandbox=""
                srcDoc={preview.html}
                style={{ width: '100%', height: 460, border: '1px solid var(--line)', borderRadius: 8, background: '#fff' }}
              />
            </div>
          )}
        </div>
      </div>
    </>
  )
}
