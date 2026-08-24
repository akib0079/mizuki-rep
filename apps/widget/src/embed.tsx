import { StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { configureApi } from './api.js'
import { BookingCalendar } from './BookingCalendar.js'
import { MyBookings } from './MyBookings.js'
import { MizukiApp } from './MizukiApp.js'
import { CoursePortal } from './CoursePortal.js'
import { StudentAccount } from './StudentAccount.js'
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
  view?: 'all' | 'calendar' | 'my-bookings' | 'course-portal' | 'account'
  course?: string
  /* Wording the studio has replaced on a page they laid out themselves. Blank means ours. */
  heading?: string
  intro?: string
}

const roots = new WeakMap<Element, Root>()

/**
 * The colours a page is allowed to change, and the reason they need carrying across by hand.
 *
 * widget.css declares these on `.mzk`, inside the shadow root. A custom property set on the host
 * — by the Elementor colour pickers, by a theme, by an inline style — reaches the host and then
 * stops, because a declaration on the element itself beats an inherited one. So the value looks
 * set from outside, is genuinely present on the host, and changes nothing.
 *
 * Copying it onto the container as an inline style puts it back in front: inline beats the
 * stylesheet's `.mzk` rule, and everything inside inherits from there. Read on every mount rather
 * than once, so changing a colour in the Elementor editor shows without reloading the page.
 */
const THEMEABLE = [
  '--mzk-accent',
  '--mzk-accent-dark',
  '--mzk-accent-light',
  '--mzk-brand',
  '--mzk-green',
  '--mzk-ink',
  '--mzk-soft',
  '--mzk-line',
  '--mzk-bg',
  '--mzk-canvas',
  '--mzk-danger',
  '--mzk-ok',
]

function applyHostColours(host: HTMLElement, container: HTMLElement): void {
  const computed = getComputedStyle(host)

  for (const token of THEMEABLE) {
    // Empty unless something outside actually set it — the widget's own default lives on .mzk
    // inside the shadow root, which the host cannot see.
    const value = computed.getPropertyValue(token).trim()
    if (value) {
      container.style.setProperty(token, value)
    } else {
      container.style.removeProperty(token)
    }
  }
}

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
  applyHostColours(element as HTMLElement, container)

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
        ) : config.view === 'account' ? (
          /* Just the account block: sign in, or the balance. Usually placed under a calendar. */
          <StudentAccount courseSlug={config.course} heading={config.heading} intro={config.intro} />
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

type View = NonNullable<MountConfig['view']>

/* Named once. The chain of ternaries this replaced had to be edited in step with the union above,
   and silently fell through to 'all' for anything it had not been told about. */
const VIEWS: View[] = ['all', 'calendar', 'my-bookings', 'course-portal', 'account']

/** Read config off the element, so one script serves every view without a second bundle. */
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
    view: VIEWS.includes(el.dataset.view as View) ? (el.dataset.view as View) : 'all',
    course: el.dataset.course || undefined,
    heading: el.dataset.heading || undefined,
    intro: el.dataset.intro || undefined,
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

/*
 * What a page builder can call, exposed as `window.MizukiBooking`.
 *
 * Through the exports, and only through the exports. This is built as an IIFE named
 * MizukiBooking, so Vite ends the bundle by assigning whatever is exported here to that global —
 * which silently overwrites anything the module assigned to it itself. An earlier version set
 * `window.MizukiBooking = { mount, refresh: autoMount }` on the line above this one, and the
 * wrapper replaced it with `{ mount }` a moment later. `refresh` worked in development, where
 * there is no wrapper, and did not exist in the file that shipped.
 */
export { mount, autoMount as refresh }
