/**
 * The small spinner that sits inside a button while it is working.
 *
 * Inherits `currentColor`, so it is legible on a primary button and on a plain one without
 * either needing to know about it. Hidden from screen readers: the button's own label already
 * changes to "Signing in…", and announcing a decoration on top of that is noise.
 */
export function Spinner({ size = 14 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} aria-hidden />
}

/**
 * A full-screen curtain for a transition that replaces everything — signing out, or the first
 * load of the console.
 *
 * Signing out used to reload the page outright, which blanks the screen to white and looks like
 * a crash for as long as the reload takes. Saying what is happening costs one frame.
 */
export function FullScreenLoader({ message }: { message: string }) {
  return (
    <div className="fullscreen-loader" role="status" aria-live="polite">
      <img src="/admin/mizuki-logo.png" alt="" width={44} height={44} />
      <Spinner size={18} />
      <p>{message}</p>
    </div>
  )
}
