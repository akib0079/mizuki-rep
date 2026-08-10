import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { api } from './api.js'
import { LoginPage } from './pages/LoginPage.js'
import { DashboardPage } from './pages/DashboardPage.js'
import { CalendarPage } from './pages/CalendarPage.js'
import { ClosedDatesPage } from './pages/ClosedDatesPage.js'
import { StudentsPage } from './pages/StudentsPage.js'
import { TemplatesPage } from './pages/TemplatesPage.js'
import { SettingsPage } from './pages/SettingsPage.js'
import { CommandPalette } from './components/CommandPalette.js'

interface Me {
  admin: { id: string; name: string; email: string; role: string; totpEnabled: boolean }
}

/** Pinned entries sit above the rest, as on the agency panel the studio already uses. */
const PINNED = [
  { to: '/calendar', label: 'Calendar', icon: '▦' },
  { to: '/students', label: 'Students', icon: '☺' },
]

const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: '◧' },
  { to: '/calendar', label: 'Calendar', icon: '▦' },
  { to: '/students', label: 'Students', icon: '☺' },
  { to: '/closed-dates', label: 'Closed dates', icon: '⊘' },
  { to: '/templates', label: 'Emails', icon: '✉' },
  { to: '/settings', label: 'Settings', icon: '⚙' },
]

export function App() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<Me>('/api/auth/admin/me'),
    retry: false,
  })

  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('mzk.sidebar') === 'collapsed')
  const [paletteOpen, setPaletteOpen] = useState(false)

  useEffect(() => {
    localStorage.setItem('mzk.sidebar', collapsed ? 'collapsed' : 'open')
  }, [collapsed])

  // ⌘K anywhere, the way the reference panel advertises in its search box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((open) => !open)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  if (isLoading) {
    return <div className="login-wrap"><p className="muted">Loading…</p></div>
  }

  if (isError || !data) {
    return <LoginPage onSignedIn={() => void refetch()} />
  }

  const initials = data.admin.name
    .split(' ')
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()

  return (
    <div className="shell">
      <nav className={collapsed ? 'sidebar collapsed' : 'sidebar'}>
        <div className="brand">
          <div className="brand-mark">M</div>
          <div className="brand-text">Mizuki Flora</div>
        </div>

        <button className="side-search" onClick={() => setPaletteOpen(true)}>
          <span>⌕</span>
          <span>Search…</span>
          <kbd>⌘K</kbd>
        </button>

        <div className="side-heading">Pinned</div>
        {PINNED.map((item) => (
          <NavLink key={`pin-${item.to}`} to={item.to} className={navClass}>
            <span className="nav-icon">{item.icon}</span>
            <span className="nav-label">{item.label}</span>
            <span className="pin">★</span>
          </NavLink>
        ))}

        <div className="side-heading">Studio</div>
        {NAV.map((item) => (
          <NavLink key={item.to} to={item.to} className={navClass} end={item.to === '/dashboard'}>
            <span className="nav-icon">{item.icon}</span>
            <span className="nav-label">{item.label}</span>
          </NavLink>
        ))}

        <div className="sidebar-footer">
          <div className="avatar">{initials || 'M'}</div>
          <div className="user-meta">
            <div className="name">{data.admin.name}</div>
            <div className="email">{data.admin.email}</div>
            <button
              className="signout"
              onClick={async () => {
                await api.post('/api/auth/logout')
                window.location.reload()
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      </nav>

      <div className="main">
        <header className="topbar">
          <button className="icon-btn" onClick={() => setCollapsed(!collapsed)} aria-label="Toggle sidebar">
            ☰
          </button>
          <div className="spacer" />
          <QuickAdd />
          <button className="icon-btn" onClick={() => setPaletteOpen(true)} aria-label="Search">⌕</button>
        </header>

        <div className="content">
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/students" element={<StudentsPage />} />
            <Route path="/closed-dates" element={<ClosedDatesPage />} />
            <Route path="/templates" element={<TemplatesPage />} />
            <Route path="/settings" element={<SettingsPage totpEnabled={data.admin.totpEnabled} />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </div>
      </div>

      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
    </div>
  )
}

function QuickAdd() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)

  return (
    <div style={{ position: 'relative' }}>
      <button className="btn btn-dark btn-sm" onClick={() => setOpen(!open)}>+ Quick add</button>
      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 30 }} onClick={() => setOpen(false)} />
          <div
            style={{
              position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 31,
              background: 'var(--surface)', border: '1px solid var(--line)',
              borderRadius: 'var(--radius-sm)', boxShadow: '0 8px 24px rgba(31,39,51,0.12)',
              minWidth: 190, padding: 5,
            }}
          >
            {[
              { label: 'Add a class', to: '/calendar' },
              { label: 'Add a student', to: '/students' },
              { label: 'Close some days', to: '/closed-dates' },
            ].map((item) => (
              <button
                key={item.to}
                className="nav-link"
                style={{ color: 'var(--ink)', margin: 0, width: '100%' }}
                onClick={() => { setOpen(false); navigate(item.to) }}
              >
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

const navClass = ({ isActive }: { isActive: boolean }) => (isActive ? 'nav-link active' : 'nav-link')
