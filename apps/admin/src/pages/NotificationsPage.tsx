import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { DateTime } from 'luxon'
import { STUDIO_TZ } from '@mizuki/shared'
import { ApiError, api } from '../api.js'
import { Icon, type IconName } from '../components/Icon.js'
import { SkeletonBlock, SkeletonLine } from '../components/Skeleton.js'

/**
 * Everything that has happened, in one place you can actually work through.
 *
 * The bell is a glance — the newest twenty-five, one click each. That is the wrong shape for
 * "what did I miss over the weekend": there was no way to see past the end of the panel, no way
 * to put something back that you opened by accident, and no way to put anything away. So the
 * list stayed at everything-ever, which made the bell steadily less worth opening.
 *
 * Read and cleared are both per-admin. One person working through their list never changes what
 * anyone else sees, which is the property that lets somebody clear things without first working
 * out whether Hana has dealt with them.
 */

interface NotificationRow {
  id: string
  type: string
  title: string
  body: string
  severity: 'info' | 'action'
  url: string
  bookingId: string | null
  studentId: string | null
  read: boolean
  cleared: boolean
  resolvedAt: string | null
  createdAt: string
}

interface FeedResponse {
  notifications: NotificationRow[]
  hasMore: boolean
  counts: { all: number; unread: number; action: number; cleared: number }
  unreadCount: number
  awaitingConfirmation: number
}

type View = 'all' | 'unread' | 'action' | 'cleared'

const VIEWS: { key: View; label: string; countKey: keyof FeedResponse['counts'] }[] = [
  { key: 'all', label: 'All', countKey: 'all' },
  { key: 'unread', label: 'Unread', countKey: 'unread' },
  { key: 'action', label: 'Needs you', countKey: 'action' },
  { key: 'cleared', label: 'Cleared', countKey: 'cleared' },
]

/** What each kind of notification is, in the studio's words rather than the database's. */
const KINDS: Record<string, { label: string; icon: IconName }> = {
  new_booking: { label: 'New booking', icon: 'calendar' },
  awaiting_confirmation: { label: 'Payment to check', icon: 'alert' },
  booking_cancelled: { label: 'Cancellation', icon: 'close' },
  booking_rescheduled: { label: 'Moved', icon: 'clock' },
  paid_but_full: { label: 'Paid, no place', icon: 'alert' },
  session_over_capacity: { label: 'Over capacity', icon: 'alert' },
}

const PAGE_SIZE = 30

export function NotificationsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [view, setView] = useState<View>('all')
  const [kind, setKind] = useState('')
  const [shown, setShown] = useState(PAGE_SIZE)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const query = new URLSearchParams({ view, limit: String(shown) })
  if (kind) query.set('type', kind)

  const { data, isPending } = useQuery({
    queryKey: ['notifications-page', view, kind, shown],
    queryFn: () => api.get<FeedResponse>(`/api/admin/notifications?${query}`),
    refetchInterval: 60_000,
  })

  /** The bell reads the same rows, so it has to be told whenever this page changes them. */
  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['notifications-page'] })
    void queryClient.invalidateQueries({ queryKey: ['notifications'] })
    void queryClient.invalidateQueries({ queryKey: ['notification-summary'] })
  }

  const act = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) =>
      api.post<{ cleared?: number; restored?: number }>(`/api/admin/notifications/${path}`, body),
    onSuccess: (result, variables) => {
      setSelected(new Set())
      setError(null)
      setMessage(describe(variables.path, result))
      refresh()
    },
    onError: (err) => {
      setMessage(null)
      setError(err instanceof ApiError ? err.message : 'That did not work.')
    },
  })

  const items = data?.notifications ?? []
  const counts = data?.counts ?? { all: 0, unread: 0, action: 0, cleared: 0 }
  const awaiting = data?.awaitingConfirmation ?? 0

  const ids = items.map((n) => n.id)
  const chosen = ids.filter((id) => selected.has(id))
  const allChosen = ids.length > 0 && chosen.length === ids.length

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function openItem(item: NotificationRow) {
    if (!item.read) act.mutate({ path: 'read', body: { ids: [item.id] } })
    if (item.url) navigate(item.url)
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Notifications</h1>
          <p className="muted">Everything the studio has been told about. Clearing tidies your own list only.</p>
        </div>
        {counts.unread > 0 && (
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => act.mutate({ path: 'read-all' })}
            disabled={act.isPending}
          >
            <Icon name="check" size={14} /> Mark all read
          </button>
        )}
      </header>

      {message && (
        <div className="note note-ok" role="status">
          {message}
          <button type="button" className="link-btn" onClick={() => setMessage(null)}>
            Dismiss
          </button>
        </div>
      )}
      {error && (
        <div className="note note-error" role="alert">
          {error}
        </div>
      )}

      {/* Counted from the bookings, not these rows — clearing an alert never hides the work. */}
      {awaiting > 0 && (
        <button type="button" className="notif-strip notif-strip-page" onClick={() => navigate('/payments')}>
          <Icon name="alert" size={16} />
          <span>
            <strong>
              {awaiting} {awaiting === 1 ? 'payment' : 'payments'} to check
            </strong>
            <span className="notif-strip-sub">
              {awaiting === 1 ? 'Someone has' : 'People have'} paid and{' '}
              {awaiting === 1 ? 'is' : 'are'} waiting for their place. This stays until it is done.
            </span>
          </span>
          <Icon name="chevron" size={16} />
        </button>
      )}

      <div className="tabs tabs-standalone" role="tablist">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            type="button"
            role="tab"
            aria-selected={view === v.key}
            className={view === v.key ? 'tab active' : 'tab'}
            onClick={() => {
              setView(v.key)
              setShown(PAGE_SIZE)
              setSelected(new Set())
            }}
          >
            {v.label}
            {counts[v.countKey] > 0 && <span className="tab-count">{counts[v.countKey]}</span>}
          </button>
        ))}
      </div>

      <div className="card">
        <div className="notif-toolbar">
          <label className="notif-check-all">
            <input
              type="checkbox"
              checked={allChosen}
              // Some but not all: neither ticked nor empty is the honest state.
              ref={(el) => {
                if (el) el.indeterminate = chosen.length > 0 && !allChosen
              }}
              onChange={() => setSelected(allChosen ? new Set() : new Set(ids))}
              disabled={ids.length === 0}
            />
            <span>{chosen.length > 0 ? `${chosen.length} selected` : 'Select all'}</span>
          </label>

          <label className="notif-kind">
            <span className="visually-hidden">Show only</span>
            <select
              value={kind}
              onChange={(e) => {
                setKind(e.target.value)
                setShown(PAGE_SIZE)
                setSelected(new Set())
              }}
            >
              <option value="">Every kind</option>
              {Object.entries(KINDS).map(([value, k]) => (
                <option key={value} value={value}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>

          <div className="spacer" />

          {chosen.length > 0 ? (
            <div className="row" style={{ gap: 8 }}>
              {view === 'cleared' ? (
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={act.isPending}
                  onClick={() => act.mutate({ path: 'restore', body: { ids: chosen } })}
                >
                  Put back
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={act.isPending}
                    onClick={() => act.mutate({ path: 'read', body: { ids: chosen } })}
                  >
                    Mark read
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={act.isPending}
                    onClick={() => act.mutate({ path: 'unread', body: { ids: chosen } })}
                  >
                    Mark unread
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={act.isPending}
                    onClick={() => act.mutate({ path: 'clear', body: { ids: chosen } })}
                  >
                    Clear
                  </button>
                </>
              )}
            </div>
          ) : (
            view !== 'cleared' &&
            counts.all > 0 && (
              <button
                type="button"
                className="btn btn-sm"
                disabled={act.isPending}
                onClick={() => {
                  /*
                   * Says what it will leave behind, not just what it will remove. "Clear all"
                   * that silently swept away two paid places waiting on approval would be the
                   * one press nobody could undo without noticing it first.
                   */
                  const staying = counts.action
                  const note = staying
                    ? `\n\n${staying} still waiting on you will be kept.`
                    : ''
                  if (confirm(`Clear your notifications?${note}\n\nNobody else's list changes, and you can put them back from the Cleared tab.`)) {
                    act.mutate({ path: 'clear-all' })
                  }
                }}
              >
                Clear all
              </button>
            )
          )}
        </div>

        {isPending ? (
          <SkeletonBlock label="Loading notifications">
            <SkeletonLine w="60%" />
            <SkeletonLine w="80%" />
            <SkeletonLine w="45%" />
          </SkeletonBlock>
        ) : items.length === 0 ? (
          <div className="empty">{emptyLine(view, Boolean(kind))}</div>
        ) : (
          <ol className="notif-rows">
            {groupByDay(items).map(([day, rows]) => (
              <li key={day}>
                <div className="notif-day">{day}</div>
                <ol className="notif-rows">
                  {rows.map((item) => (
                    <NotificationItem
                      key={item.id}
                      item={item}
                      selected={selected.has(item.id)}
                      busy={act.isPending}
                      onToggle={() => toggle(item.id)}
                      onOpen={() => openItem(item)}
                      onRead={(read) =>
                        act.mutate({ path: read ? 'read' : 'unread', body: { ids: [item.id] } })
                      }
                      onClear={() =>
                        act.mutate({
                          path: item.cleared ? 'restore' : 'clear',
                          body: { ids: [item.id] },
                        })
                      }
                    />
                  ))}
                </ol>
              </li>
            ))}
          </ol>
        )}

        {data?.hasMore && (
          <div className="row" style={{ justifyContent: 'center', marginTop: 14 }}>
            <button type="button" className="btn btn-quiet" onClick={() => setShown((n) => n + PAGE_SIZE)}>
              Show older
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function NotificationItem({
  item,
  selected,
  busy,
  onToggle,
  onOpen,
  onRead,
  onClear,
}: {
  item: NotificationRow
  selected: boolean
  busy: boolean
  onToggle: () => void
  onOpen: () => void
  onRead: (read: boolean) => void
  onClear: () => void
}) {
  const kind = KINDS[item.type] ?? { label: 'Notification', icon: 'bell' as IconName }
  const needsAction = item.severity === 'action' && !item.resolvedAt

  return (
    <li
      className={[
        'notif-row',
        item.read ? '' : 'is-unread',
        needsAction ? 'is-action' : '',
        selected ? 'is-selected' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <input
        type="checkbox"
        className="notif-row-check"
        checked={selected}
        onChange={onToggle}
        aria-label={`Select "${item.title}"`}
      />

      <span className={needsAction ? 'notif-row-icon is-action' : 'notif-row-icon'} aria-hidden="true">
        <Icon name={kind.icon} size={15} />
      </span>

      {/*
        The whole body is the target rather than a small "open" link: on a list you are scanning,
        the row is what you are pointing at anyway.
      */}
      <button type="button" className="notif-row-main" onClick={onOpen}>
        <span className="notif-row-top">
          <span className="notif-row-kind">{kind.label}</span>
          {!item.read && <span className="notif-dot" aria-label="Unread" />}
          {needsAction && <span className="pill pill-warn">Needs you</span>}
          {item.resolvedAt && <span className="pill pill-ok">Done</span>}
        </span>
        <span className="notif-row-title">{item.title}</span>
        {item.body && <span className="notif-row-body">{item.body}</span>}
      </button>

      <span className="notif-row-side">
        <time className="notif-row-when" dateTime={item.createdAt} title={fullTime(item.createdAt)}>
          {shortTime(item.createdAt)}
        </time>
        <span className="notif-row-actions">
          {!item.cleared && (
            <button type="button" className="link-btn" disabled={busy} onClick={() => onRead(!item.read)}>
              {item.read ? 'Mark unread' : 'Mark read'}
            </button>
          )}
          <button type="button" className="link-btn" disabled={busy} onClick={onClear}>
            {item.cleared ? 'Put back' : 'Clear'}
          </button>
        </span>
      </span>
    </li>
  )
}

/** Days as headings, so a week of bookings reads as a week rather than one long column. */
function groupByDay(items: NotificationRow[]): [string, NotificationRow[]][] {
  const today = DateTime.now().setZone(STUDIO_TZ).startOf('day')
  const groups = new Map<string, NotificationRow[]>()

  for (const item of items) {
    const at = DateTime.fromISO(item.createdAt).setZone(STUDIO_TZ).startOf('day')
    const days = today.diff(at, 'days').days

    const label =
      days < 1 ? 'Today' : days < 2 ? 'Yesterday' : at.toFormat('cccc d LLLL yyyy')

    groups.set(label, [...(groups.get(label) ?? []), item])
  }

  return [...groups]
}

function shortTime(iso: string): string {
  const at = DateTime.fromISO(iso).setZone(STUDIO_TZ)
  return at.hasSame(DateTime.now().setZone(STUDIO_TZ), 'day')
    ? at.toFormat('h:mm a')
    : at.toFormat('d LLL')
}

function fullTime(iso: string): string {
  return DateTime.fromISO(iso).setZone(STUDIO_TZ).toFormat('cccc d LLLL yyyy, h:mm a')
}

function emptyLine(view: View, filtered: boolean): string {
  if (filtered) return 'Nothing of that kind here.'
  if (view === 'unread') return 'Nothing unread. You are up to date.'
  if (view === 'action') return 'Nothing is waiting on you.'
  if (view === 'cleared') return 'You have not cleared anything yet.'
  return 'Nothing yet. Bookings, cancellations and payments to check will appear here.'
}

/** Say what happened, in a number — a toast that only says "Done" proves nothing. */
function describe(path: string, result: { cleared?: number; restored?: number }): string {
  if (path === 'clear' || path === 'clear-all') {
    return `Cleared ${result.cleared ?? 0}. You can put them back from the Cleared tab.`
  }
  if (path === 'restore') return `Put ${result.restored ?? 0} back on your list.`
  if (path === 'read-all') return 'All marked as read.'
  if (path === 'unread') return 'Put back as unread.'
  return 'Marked as read.'
}
