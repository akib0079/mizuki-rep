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
import { PaymentsPage } from './pages/PaymentsPage.js'
import { TeamPage } from './pages/TeamPage.js'
import { AcceptInvitePage } from './pages/AcceptInvitePage.js'
import { NotificationBell } from './components/NotificationBell.js'
import { CommandPalette } from './components/CommandPalette.js'
import { Icon, type IconName } from './components/Icon.js'

interface Me {
  admin: { id: string; name: string; email: string; role: string; totpEnabled: boolean }
}

/** Pinned entries sit above the rest, as on the agency panel the studio already uses. */
const PINNED: NavItem[] = [
  { to: '/calendar', label: 'Calendar', icon: 'calendar' },
  { to: '/students', label: 'Students', icon: 'students' },
]

const NAV: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
  { to: '/calendar', label: 'Calendar', icon: 'calendar' },
  { to: '/students', label: 'Students', icon: 'students' },
  { to: '/payments', label: 'Payments', icon: 'ticket' },
  { to: '/closed-dates', label: 'Closed dates', icon: 'closed' },
  { to: '/templates', label: 'Emails', icon: 'mail' },
  { to: '/team', label: 'Team', icon: 'users' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
]

interface NavItem {
  to: string
  label: string
  icon: IconName
}

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

  /*
   * Checked before the sign-in gate, not routed inside it: someone arriving on an invitation has
   * no session by definition, so the gate would send them to a login screen they cannot pass and
   * the link would look broken.
   */
  if (window.location.pathname.endsWith('/accept-invite')) {
    return <AcceptInvitePage onSignedIn={() => void refetch()} />
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
          <img className="brand-logo" src="/admin/mizuki-logo.png" alt="" width={32} height={32} />
          <div className="brand-text">
            <span className="brand-name">Mizuki Flora</span>
            <span className="brand-sub">Studio</span>
          </div>
        </div>

        <button type="button" className="side-search" onClick={() => setPaletteOpen(true)} title="Search (⌘K)">
          <Icon name="search" size={15} />
          <span className="nav-label">Search…</span>
          <kbd className="nav-label">⌘K</kbd>
        </button>

        <div className="side-heading">Pinned</div>
        {PINNED.map((item) => (
          // `title` is what makes the collapsed rail usable — an icon on its own is a guess.
          <NavLink key={`pin-${item.to}`} to={item.to} className={navClass} title={item.label}>
            <span className="nav-icon"><Icon name={item.icon} /></span>
            <span className="nav-label">{item.label}</span>
            <span className="pin nav-label"><Icon name="star" size={11} /></span>
          </NavLink>
        ))}

        <div className="side-heading">Studio</div>
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={navClass}
            title={item.label}
            end={item.to === '/dashboard'}
          >
            <span className="nav-icon"><Icon name={item.icon} /></span>
            <span className="nav-label">{item.label}</span>
          </NavLink>
        ))}

        <div className="sidebar-footer">
          <div className="avatar">{initials || 'M'}</div>
          <div className="user-meta">
            <div className="name">{data.admin.name}</div>
            <div className="email">{data.admin.email}</div>
            <button type="button"
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
          <button type="button"
            className="icon-btn"
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <Icon name="menu" />
          </button>
          <div className="spacer" />
          <QuickAdd />
          <NotificationBell />
          <button type="button"
            className="icon-btn"
            onClick={() => setPaletteOpen(true)}
            aria-label="Search"
            title="Search (⌘K)"
          >
            <Icon name="search" />
          </button>
        </header>

        <div className="content">
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/students" element={<StudentsPage />} />
            <Route path="/payments" element={<PaymentsPage />} />
            <Route path="/closed-dates" element={<ClosedDatesPage />} />
            <Route path="/templates" element={<TemplatesPage adminEmail={data.admin.email} />} />
            <Route path="/team" element={<TeamPage currentAdminId={data.admin.id} />} />
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

  // Escape closes, matching every other menu on the web.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  // Each of these opens the relevant form on arrival — landing on a list and leaving the
  // studio to hunt for a button is not "quick add".
  const items: { label: string; to: string; icon: IconName }[] = [
    { label: 'Add a class', to: '/calendar?new=1', icon: 'calendar' },
    { label: 'Add a student', to: '/students?new=1', icon: 'students' },
    { label: 'Close some days', to: '/closed-dates', icon: 'closed' },
  ]

  return (
    <div className="quickadd">
      <button type="button" className="btn btn-dark btn-sm" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu">
        <Icon name="plus" size={15} /> Quick add
      </button>
      {open && (
        <>
          <div className="menu-scrim" onClick={() => setOpen(false)} />
          <div className="menu" role="menu">
            {items.map((item) => (
              <button type="button"
                key={item.to}
                className="menu-item"
                role="menuitem"
                onClick={() => { setOpen(false); navigate(item.to) }}
              >
                <Icon name={item.icon} size={16} />
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
