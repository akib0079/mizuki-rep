import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api.js'
import { Icon } from './Icon.js'

/**
 * What needs looking at, in the console rather than in an inbox.
 *
 * The studio told us things get missed in email, and a place that has been paid for but not yet
 * approved is the worst thing to miss — the student has been charged and is waiting. So the
 * count is not read from the notification rows: it is counted from the bookings themselves, and
 * an item that needs action stays visible even after someone has glanced at the list.
 */

interface NotificationRow {
  id: string
  type: string
  title: string
  body: string
  severity: 'info' | 'action'
  url: string
  bookingId: string | null
  read: boolean
  resolvedAt: string | null
  createdAt: string
}

interface FeedResponse {
  notifications: NotificationRow[]
  unreadCount: number
  awaitingConfirmation: number
}

export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<FeedResponse>('/api/admin/notifications?limit=25'),
    // The console is left open all day on the studio's laptop, so it has to notice new
    // bookings without someone thinking to reload.
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  })

  /** Both lists read the same rows, so either changing them has to refresh the other. */
  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['notifications'] })
    void queryClient.invalidateQueries({ queryKey: ['notifications-page'] })
    // The sidebar's count reads the same rows.
    void queryClient.invalidateQueries({ queryKey: ['notification-summary'] })
  }

  const markAllRead = useMutation({
    mutationFn: () => api.post('/api/admin/notifications/read-all'),
    onSuccess: refresh,
  })

  const markRead = useMutation({
    mutationFn: (ids: string[]) => api.post('/api/admin/notifications/read', { ids }),
    onSuccess: refresh,
  })

  // Click outside and Escape both close it — a panel you cannot dismiss is a panel in the way.
  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: MouseEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const items = data?.notifications ?? []
  const awaiting = data?.awaitingConfirmation ?? 0
  const unread = data?.unreadCount ?? 0

  /*
   * The badge shows whichever is more pressing. An unread count that disappears the moment
   * someone opens the panel would hide payments still waiting to be approved, so those win.
   */
  const badge = awaiting > 0 ? awaiting : unread
  const needsAction = awaiting > 0

  function openItem(item: NotificationRow) {
    if (!item.read) markRead.mutate([item.id])
    setOpen(false)
    if (item.url) navigate(item.url)
  }

  return (
    <div className="notif" ref={panelRef}>
      <button
        type="button"
        className={needsAction ? 'icon-btn notif-btn notif-action' : 'icon-btn notif-btn'}
        onClick={() => setOpen((v) => !v)}
        aria-label={
          badge > 0
            ? `Notifications — ${needsAction ? `${awaiting} waiting for you` : `${unread} unread`}`
            : 'Notifications'
        }
        aria-expanded={open}
        title="Notifications"
      >
        <Icon name="bell" />
        {badge > 0 && <span className="notif-badge">{badge > 99 ? '99+' : badge}</span>}
      </button>

      {open && (
        <div className="notif-panel" role="dialog" aria-label="Notifications">
          <div className="notif-head">
            <strong>Notifications</strong>
            {unread > 0 && (
              <button
                type="button"
                className="link-btn"
                onClick={() => markAllRead.mutate()}
                disabled={markAllRead.isPending}
              >
                Mark all read
              </button>
            )}
          </div>

          {awaiting > 0 && (
            <button
              type="button"
              className="notif-strip"
              onClick={() => {
                setOpen(false)
                navigate('/payments')
              }}
            >
              <Icon name="alert" size={15} />
              <span>
                <strong>
                  {awaiting} {awaiting === 1 ? 'payment' : 'payments'} to check
                </strong>
                <span className="notif-strip-sub">
                  {awaiting === 1 ? 'Someone has' : 'People have'} paid and{' '}
                  {awaiting === 1 ? 'is' : 'are'} waiting for their place
                </span>
              </span>
            </button>
          )}

          <div className="notif-list">
            {items.length === 0 ? (
              <p className="notif-empty">Nothing new. Bookings will show up here.</p>
            ) : (
              items.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={[
                    'notif-item',
                    item.read ? '' : 'notif-unread',
                    item.severity === 'action' && !item.resolvedAt ? 'notif-item-action' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => openItem(item)}
                >
                  <span className="notif-item-title">{item.title}</span>
                  {item.body && <span className="notif-item-body">{item.body}</span>}
                  <span className="notif-item-when">{relativeTime(item.createdAt)}</span>
                </button>
              ))
            )}
          </div>

          {/* The panel is a glance at the newest few; anything older lives on its own page. */}
          <button
            type="button"
            className="notif-all"
            onClick={() => {
              setOpen(false)
              navigate('/notifications')
            }}
          >
            See all notifications
          </button>
        </div>
      )}
    </div>
  )
}

/** "4 minutes ago" reads faster than a timestamp when you are scanning a list. */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  const mins = Math.round((Date.now() - then) / 60_000)

  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`

  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`

  const days = Math.round(hours / 24)
  if (days < 7) return `${days} ${days === 1 ? 'day' : 'days'} ago`

  return new Date(iso).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })
}
