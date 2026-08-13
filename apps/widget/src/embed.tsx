import { StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { configureApi } from './api.js'
import { BookingCalendar } from './BookingCalendar.js'
import { MyBookings } from './MyBookings.js'
import { MizukiApp } from './MizukiApp.js'
import { CoursePortal } from './CoursePortal.js'
import { ErrorBoundary } from './ErrorBoundary.js'
// Imported as text rather than as a stylesheet: it is injected into the shadow root below,
// where the page's CSS cannot reach it and it cannot reach the page.
import css from './widget.css?inline'

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
  view?: 'all' | 'calendar' | 'my-bookings' | 'course-portal'
  course?: string
}

const roots = new WeakMap<Element, Root>()

/**
 * Put the widget inside a shadow root, and render into that.
 *
 * This site runs Astra plus Elementor plus a dozen other plugins, all of which style bare
 * element selectors — `button`, `input`, `h3` — site-wide and with !important. Scoping our own
 * CSS under `.mzk` stops us leaking outward but does nothing about them leaking in, and answering
 * !important with !important is a fight that has to be re-won every time the studio installs or
 * updates a plugin. It was already lost once: every day cell rendered as a solid green block.
 *
 * A shadow root ends the argument. Page rules simply do not match elements inside one, so there
 * is nothing to out-specify and nothing to keep up with. What still crosses the boundary is
 * inherited text properties, and widget.css pins those explicitly on `.mzk`.
 */
function containerFor(element: Element): HTMLElement {
  const host = element as HTMLElement

  const prepared = host.shadowRoot?.querySelector<HTMLElement>('[data-mizuki-root]')
  if (prepared) return prepared

  let shadow = host.shadowRoot
  if (!shadow) {
    try {
      shadow = host.attachShadow({ mode: 'open' })
    } catch {
      // Some other script got there first with mode:'closed', or this is a browser old enough
      // not to support it. Fall back to rendering in the page and hope the !important wins.
      shadow = null
    }
  }

  const container = document.createElement('div')
  container.setAttribute('data-mizuki-root', '')

  if (!shadow) {
    injectPageStyle()
    host.appendChild(container)
    return container
  }

  const style = document.createElement('style')
  style.textContent = css
  shadow.append(style, container)
  return container
}

/** Only for the no-shadow-root fallback: the stylesheet has to go somewhere. */
function injectPageStyle(): void {
  if (document.getElementById('mizuki-booking-css')) return

  const style = document.createElement('style')
  style.id = 'mizuki-booking-css'
  style.textContent = css
  document.head.appendChild(style)
}

function mount(element: Element, config: MountConfig): void {
  configureApi(config.apiBase)

  const container = containerFor(element)

  const existing = roots.get(container)
  const root = existing ?? createRoot(container)
  if (!existing) roots.set(container, root)

  root.render(
    <StrictMode>
      <ErrorBoundary label="booking widget">
        {config.view === 'course-portal' ? (
          /*
           * A page for students who have already paid: balance and dates first, calendar behind
           * one button. Needs a course to be about, so it falls back to the ordinary page rather
           * than rendering a portal for nothing in particular.
           */
          config.course ? <CoursePortal courseSlug={config.course} /> : <MizukiApp />
        ) : config.view === 'my-bookings' ? (
          <MyBookings />
        ) : config.view === 'calendar' ? (
          <BookingCalendar courseSlug={config.course} />
        ) : (
          // Default: booking and "my bookings" together, so one page and one link does everything.
          <MizukiApp courseSlug={config.course} />
        )}
      </ErrorBoundary>
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
    view:
      el.dataset.view === 'my-bookings'
        ? 'my-bookings'
        : el.dataset.view === 'calendar'
          ? 'calendar'
          : el.dataset.view === 'course-portal'
            ? 'course-portal'
            : 'all',
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
