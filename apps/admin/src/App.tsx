import { useQuery } from '@tanstack/react-query'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { api } from './api.js'
import { LoginPage } from './pages/LoginPage.js'
import { CalendarPage } from './pages/CalendarPage.js'
import { ClosedDatesPage } from './pages/ClosedDatesPage.js'
import { StudentsPage } from './pages/StudentsPage.js'
import { TemplatesPage } from './pages/TemplatesPage.js'
import { SettingsPage } from './pages/SettingsPage.js'

interface Me {
  admin: { id: string; name: string; email: string; role: string; totpEnabled: boolean }
}

export function App() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<Me>('/api/auth/admin/me'),
    retry: false,
  })

  if (isLoading) {
    return <div className="login-wrap"><p className="muted">Loading…</p></div>
  }

  if (isError || !data) {
    return <LoginPage onSignedIn={() => void refetch()} />
  }

  return (
    <div className="shell">
      <nav className="sidebar">
        <div className="brand">Mizuki Studio</div>
        <NavLink to="/calendar" className={navClass}>Calendar</NavLink>
        <NavLink to="/students" className={navClass}>Students</NavLink>
        <NavLink to="/closed-dates" className={navClass}>Closed dates</NavLink>
        <NavLink to="/templates" className={navClass}>Emails</NavLink>
        <NavLink to="/settings" className={navClass}>Settings</NavLink>
        <div className="sidebar-footer">
          <div>{data.admin.name}</div>
          <button
            className="btn btn-sm btn-ghost"
            style={{ paddingLeft: 0 }}
            onClick={async () => {
              await api.post('/api/auth/logout')
              window.location.reload()
            }}
          >
            Sign out
          </button>
        </div>
      </nav>

      <main className="main">
        <Routes>
          <Route path="/" element={<Navigate to="/calendar" replace />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/students" element={<StudentsPage />} />
          <Route path="/closed-dates" element={<ClosedDatesPage />} />
          <Route path="/templates" element={<TemplatesPage />} />
          <Route path="/settings" element={<SettingsPage totpEnabled={data.admin.totpEnabled} />} />
          <Route path="*" element={<Navigate to="/calendar" replace />} />
        </Routes>
      </main>
    </div>
  )
}

const navClass = ({ isActive }: { isActive: boolean }) => (isActive ? 'nav-link active' : 'nav-link')
