import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api, type StudentSummary } from '../api.js'

/**
 * ⌘K search, matching the shortcut the sidebar advertises.
 *
 * Searches students by name, email or phone — the lookup the studio actually does mid-conversation
 * ("how many sessions has she got left?") — alongside the pages themselves.
 */
const PAGES = [
  { label: 'Dashboard', to: '/dashboard', hint: 'Overview' },
  { label: 'Calendar', to: '/calendar', hint: 'Classes and bookings' },
  { label: 'Students', to: '/students', hint: 'People and course packages' },
  { label: 'Closed dates', to: '/closed-dates', hint: "Days you're away" },
  { label: 'Emails', to: '/templates', hint: 'Message wording' },
  { label: 'Notifications', to: '/notifications', hint: 'Everything you have been told' },
  { label: 'Settings', to: '/settings', hint: 'Courses, alerts, security' },
]

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)

  const students = useQuery({
    queryKey: ['palette-students', query],
    queryFn: () => api.get<{ students: StudentSummary[] }>(`/api/admin/students?search=${encodeURIComponent(query)}&limit=6`),
    enabled: query.trim().length >= 2,
  })

  const pageHits = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return PAGES
    return PAGES.filter((p) => p.label.toLowerCase().includes(q) || p.hint.toLowerCase().includes(q))
  }, [query])

  const studentHits = students.data?.students ?? []
  const results = useMemo(
    () => [
      ...pageHits.map((p) => ({ kind: 'page' as const, label: p.label, hint: p.hint, to: p.to })),
      ...studentHits.map((s) => ({
        kind: 'student' as const,
        label: s.name,
        hint: `${s.email}${s.sessionsRemaining > 0 ? ` · ${s.sessionsRemaining} sessions left` : ''}`,
        to: '/students',
      })),
    ],
    [pageHits, studentHits],
  )

  // Keep the highlight inside the list as results change under it.
  useEffect(() => setCursor(0), [query])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return onClose()
      if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, results.length - 1)) }
      if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)) }
      if (e.key === 'Enter') {
        const hit = results[cursor]
        if (hit) { navigate(hit.to); onClose() }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [results, cursor, navigate, onClose])

  return (
    <>
      <div className="drawer-backdrop" style={{ zIndex: 80 }} onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        style={{
          position: 'fixed', zIndex: 81, top: '15vh', left: '50%', transform: 'translateX(-50%)',
          width: 'min(540px, calc(100vw - 32px))', background: 'var(--surface)',
          borderRadius: 'var(--radius)', boxShadow: '0 20px 60px rgba(31,39,51,0.22)', overflow: 'hidden',
        }}
      >
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search students and pages…"
          style={{
            width: '100%', padding: '15px 18px', border: 'none',
            borderBottom: '1px solid var(--line)', fontSize: 15, outline: 'none',
          }}
        />

        <div style={{ maxHeight: 340, overflowY: 'auto', padding: 6 }}>
          {results.length === 0 ? (
            <div className="empty">No matches.</div>
          ) : (
            results.map((hit, i) => (
              <button
                key={`${hit.kind}-${hit.label}-${i}`}
                className="nav-link"
                style={{
                  color: 'var(--ink)', width: '100%', margin: 0,
                  background: i === cursor ? 'var(--canvas)' : 'transparent',
                }}
                onMouseEnter={() => setCursor(i)}
                onClick={() => { navigate(hit.to); onClose() }}
              >
                <span className="nav-icon">{hit.kind === 'student' ? '☺' : '›'}</span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontWeight: 600 }}>{hit.label}</span>
                  <span className="small faint" style={{ display: 'block' }}>{hit.hint}</span>
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </>
  )
}
