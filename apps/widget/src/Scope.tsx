import type { ReactNode } from 'react'

/**
 * The `.mzk` styling scope, or nothing when one is already present.
 *
 * This exists as a component taking a prop, rather than as a choice between two components,
 * because the choice is a trap. Written the obvious way —
 *
 *     const Wrap = embedded ? ({ children }) => <>{children}</> : ({ children }) => <div className="mzk">{children}</div>
 *
 * — `Wrap` is a brand new function on every render. React compares component identity to decide
 * whether to update or replace, sees a different type each time, and throws the entire subtree
 * away and rebuilds it. The DOM nodes are recreated, so anything the browser was holding on to
 * goes with them: an <input> loses focus after every single keystroke, which is indistinguishable
 * from a text box that will not accept typing. That is exactly how it was reported.
 *
 * One component, always the same identity, with the branch inside it, cannot do that.
 */
export function Scope({ embedded = false, children }: { embedded?: boolean; children: ReactNode }) {
  if (embedded) return <>{children}</>
  return <div className="mzk">{children}</div>
}
