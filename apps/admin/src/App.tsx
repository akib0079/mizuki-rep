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
import { CoursesPage } from './pages/CoursesPage.js'
import { ProgrammePage } from './pages/ProgrammePage.js'
import { TeamPage } from './pages/TeamPage.js'
import { AcceptInvitePage } from './pages/AcceptInvitePage.js'
import { NotificationBell } from './components/NotificationBell.js'
import { FullScreenLoader } from './components/Spinner.js'
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
  { to: '/courses', label: 'Courses', icon: 'note' },
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

  /*
   * Which courses have their own section. Driven by a setting rather than a constant, so moving
   * a course in or out of its own page is something the studio can do from the settings page.
   * Only fetched once signed in — before that there is nothing to navigate.
   */
  const { data: programmeData } = useQuery({
    queryKey: ['programmes'],
    queryFn: () => api.get<{ programmes: { id: string; name: string; colour: string }[] }>('/api/admin/programmes'),
    enabled: Boolean(data),
  })
  const programmes = programmeData?.programmes ?? []

  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('mzk.sidebar') === 'collapsed')
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  /*
   * Separate from `collapsed`, which is the desktop rail's width preference. On a phone the rail
   * is off-canvas entirely and this is whether it is showing — two different questions that were
   * one state, which is why the same button had to mean two things.
   */
  const [navOpen, setNavOpen] = useState(false)

  useEffect(() => {
    localStorage.setItem('mzk.sidebar', collapsed ? 'collapsed' : 'open')
  }, [collapsed])

  /*
   * Any request answering 401 means the cookie is gone or expired. Re-checking `me` is what
   * decides it: that call will 401 too, and the shell falls through to the sign-in screen
   * rather than every page inventing its own way of being broken.
   */
  useEffect(() => {
    const onEnded = () => void refetch()
    window.addEventListener('mizuki:session-ended', onEnded)
    return () => window.removeEventListener('mizuki:session-ended', onEnded)
  }, [refetch])

  // Escape closes the drawer, like every other overlay in here.
  useEffect(() => {
    if (!navOpen) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setNavOpen(false)
    document.addEventListener('keydown', onKey)
    // The page behind a full-height drawer must not scroll under it.
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [navOpen])

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

  // The very first thing the console shows. A blank page with the word "Loading" is the least
  // reassuring possible first impression of a system that holds the studio's bookings.
  if (isLoading) {
    return <FullScreenLoader message="Opening your studio…" />
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

  if (signingOut) return <FullScreenLoader message="Signing you out…" />

  return (
    <div className="shell">
      {/* Only ever visible on a phone; on desktop the rail is always in the layout. */}
      {navOpen && <div className="nav-backdrop" onClick={() => setNavOpen(false)} aria-hidden />}

      <nav
        className={[collapsed ? 'sidebar collapsed' : 'sidebar', navOpen ? 'nav-open' : '']
          .filter(Boolean)
          .join(' ')}
        onClick={(e) => {
          // Any link tap closes the drawer — otherwise it covers the page you just asked for.
          if ((e.target as HTMLElement).closest('a')) setNavOpen(false)
        }}
      >
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

        <div className="side-heading side-heading-pinned">Pinned</div>
        {PINNED.map((item) => (
          // `title` is what makes the collapsed rail usable — an icon on its own is a guess.
          <NavLink
            key={`pin-${item.to}`}
            to={item.to}
            className={(state) => `${navClass(state)} nav-pinned`}
            title={item.label}
          >
            <span className="nav-icon"><Icon name={item.icon} /></span>
            <span className="nav-label">{item.label}</span>
            <span className="pin nav-label"><Icon name="star" size={11} /></span>
          </NavLink>
        ))}

        {/*
          Courses run as programmes get their own heading rather than a row among the rest.
          IFDA is a different kind of thing from "Calendar" or "Emails" — it is a place the
          studio goes to work on one course — and a heading is what says so at a glance.
        */}
        {programmes.length > 0 && (
          <>
            <div className="side-heading">Courses</div>
            {programmes.map((p) => (
              <NavLink key={p.id} to={`/programme/${p.id}`} className={navClass} title={p.name}>
                <span className="nav-icon"><Icon name="programme" /></span>
                <span className="nav-label">{p.name}</span>
              </NavLink>
            ))}
          </>
        )}

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
              disabled={signingOut}
              onClick={async () => {
                // Curtain first, then the request. A reload blanks the screen to white for as
                // long as it takes, which reads as a crash rather than as signing out.
                setSigningOut(true)
                try {
                  await api.post('/api/auth/logout')
                } finally {
                  window.location.reload()
                }
              }}
            >
              {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        </div>
      </nav>

      <div className="main">
        <header className="topbar">
          <button type="button"
            className="icon-btn"
            onClick={() => {
              // One button, two meanings, decided by whether the rail is on screen at all.
              if (window.matchMedia('(max-width: 820px)').matches) setNavOpen((v) => !v)
              else setCollapsed(!collapsed)
            }}
            aria-label="Menu"
            aria-expanded={navOpen}
            title="Menu"
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
            <Route path="/courses" element={<CoursesPage />} />
            <Route path="/programme/:id" element={<ProgrammePage />} />
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
