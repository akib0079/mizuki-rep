import { StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { configureApi } from './api.js'
import { BookingCalendar } from './BookingCalendar.js'
import { MyBookings } from './MyBookings.js'
import './widget.css'

/**
 * Entry point for the WordPress embed.
 *
 * The plugin drops a `<div data-mizuki-booking>` on the page and loads this script; everything
 * below is about mounting into whatever the theme gives us without needing the theme's help.
 * Mounts are tracked so a second call — a page builder re-rendering, say — reuses the existing
 * React root rather than leaking a new one on every pass.
 */

interface MountConfig {
  apiBase: string
  view?: 'calendar' | 'my-bookings'
  course?: string
}

const roots = new WeakMap<Element, Root>()

function mount(element: Element, config: MountConfig): void {
  configureApi(config.apiBase)

  const existing = roots.get(element)
  const root = existing ?? createRoot(element)
  if (!existing) roots.set(element, root)

  root.render(
    <StrictMode>
      {config.view === 'my-bookings' ? <MyBookings /> : <BookingCalendar courseSlug={config.course} />}
    </StrictMode>,
  )
}

/** Read config off the element, so one script serves both views without a second bundle. */
function mountFromElement(element: Element): void {
  const el = element as HTMLElement
  const apiBase = el.dataset.apiBase ?? window.MIZUKI_API_BASE ?? ''

  if (!apiBase) {
    // Fail loudly in the console rather than rendering an empty box the studio cannot diagnose.
    console.error('[mizuki-booking] No API base URL configured. Set data-api-base on the embed element.')
    return
  }

  mount(element, {
    apiBase,
    view: el.dataset.view === 'my-bookings' ? 'my-bookings' : 'calendar',
    course: el.dataset.course || undefined,
  })
}

function autoMount(): void {
  document.querySelectorAll('[data-mizuki-booking]').forEach(mountFromElement)
}

// The plugin enqueues this with `defer`, but a page builder may inject it after
// DOMContentLoaded has already fired — handle both cases.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', autoMount)
} else {
  autoMount()
}

declare global {
  interface Window {
    MIZUKI_API_BASE?: string
    MizukiBooking?: { mount: (element: Element, config: MountConfig) => void; refresh: () => void }
  }
}

// Exposed so a theme or page builder can mount into an element it created later.
window.MizukiBooking = { mount, refresh: autoMount }

export { mount }
