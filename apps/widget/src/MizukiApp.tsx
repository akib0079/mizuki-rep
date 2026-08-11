import { useEffect, useState } from 'react'
import { BookingCalendar } from './BookingCalendar.js'
import { MyBookings } from './MyBookings.js'

/**
 * Booking and "my bookings" on one page, behind two tabs.
 *
 * They were separate shortcodes on separate pages, which meant a student who had just booked had
 * to go and find another page to see what they had booked, and the studio had to create and
 * maintain two pages to install one feature. One mount, two tabs, one thing to link to.
 *
 * The tab lives in the URL rather than only in memory, so the sign-in link a student receives by
 * email can land them straight on their bookings, and so a reload does not silently move them.
 */

export type WidgetTab = 'book' | 'bookings'

const TABS: { id: WidgetTab; label: string }[] = [
  { id: 'book', label: 'Book a class' },
  { id: 'bookings', label: 'My bookings' },
]

function tabFromUrl(): WidgetTab {
  const params = new URLSearchParams(window.location.search)
  const wanted = params.get('tab') ?? window.location.hash.replace('#', '')
  return wanted === 'bookings' || wanted === 'my-bookings' ? 'bookings' : 'book'
}

export function MizukiApp({ courseSlug }: { courseSlug?: string }) {
  const [tab, setTab] = useState<WidgetTab>(tabFromUrl)

  // Back and forward should move between tabs, since the tab is in the address.
  useEffect(() => {
    const onPop = () => setTab(tabFromUrl())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  function go(next: WidgetTab) {
    setTab(next)

    // replaceState rather than pushState: the tabs are two views of one page, and filling
    // the back button with them would make leaving the page take several presses.
    const url = new URL(window.location.href)
    if (next === 'book') url.searchParams.delete('tab')
    else url.searchParams.set('tab', 'bookings')
    window.history.replaceState({}, '', url)
  }

  return (
    <div className="mzk">
      <div className="mzk-switch" role="tablist" aria-label="Booking">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? 'mzk-switch-btn mzk-switch-on' : 'mzk-switch-btn'}
            onClick={() => go(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/*
        Both are kept mounted and one is hidden, rather than unmounted. Switching back to the
        calendar should not refetch three months of classes and lose the day the student had
        open — the tabs are a view control, not navigation.
      */}
      <div hidden={tab !== 'book'}>
        <BookingCalendar courseSlug={courseSlug} embedded onSeeBookings={() => go('bookings')} />
      </div>
      <div hidden={tab !== 'bookings'}>
        <MyBookings embedded />
      </div>
    </div>
  )
}
