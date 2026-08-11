import { Component, type ReactNode } from 'react'

/**
 * Keeps one broken panel from taking the whole widget down.
 *
 * Booking and "my bookings" used to be separate shortcodes, so they were separate React roots and
 * a crash in one could not touch the other. Putting them behind tabs put them in one tree, where
 * an unhandled error unmounts everything — a student loading the page to book a class would get a
 * blank space, with the calendar itself perfectly fine underneath. That is the worst way for this
 * to fail, and it is invisible: no error on the page, nothing in the studio's inbox.
 *
 * So each panel gets its own boundary. A failure stays inside its tab, says so plainly, and the
 * other tab carries on working.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode; label: string },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error) {
    // The student cannot act on a stack trace, but whoever they report it to can.
    console.error(`[mizuki-booking] The ${this.props.label} panel failed to render.`, error)
  }

  render() {
    if (!this.state.failed) return this.props.children

    /*
     * The .mzk wrapper is deliberate even when this boundary sits inside one already: the outermost
     * boundary catches failures from the component that would have provided that scope, and an
     * error message that inherits the theme's styling instead of ours is the one piece of UI that
     * must never look broken. Nesting it is harmless.
     */
    return (
      <div className="mzk">
        <div className="mzk-note mzk-note-error">
          <strong>This part of the page did not load.</strong>
          <p className="mzk-small" style={{ margin: '6px 0 0' }}>
            Please refresh the page. If it keeps happening, let us know and we will book you in
            directly.
          </p>
        </div>
      </div>
    )
  }
}
