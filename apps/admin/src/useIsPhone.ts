import { useEffect, useState } from 'react'

/**
 * Whether the console is being used on a phone-sized screen.
 *
 * Read once at mount and then kept current, because a tablet turned on its side crosses this
 * boundary and a calendar that decided its view at startup would be stuck in the wrong one.
 *
 * Matches the CSS breakpoint exactly. Two sources of truth for "is this a phone" is how a layout
 * ends up in a state neither the stylesheet nor the component expects.
 */
const PHONE = '(max-width: 820px)'

export function useIsPhone(): boolean {
  const [isPhone, setIsPhone] = useState(() => window.matchMedia(PHONE).matches)

  useEffect(() => {
    const query = window.matchMedia(PHONE)
    const onChange = (event: MediaQueryListEvent) => setIsPhone(event.matches)

    query.addEventListener('change', onChange)
    // Re-read on mount: the width can change between the initial state and the effect running.
    setIsPhone(query.matches)

    return () => query.removeEventListener('change', onChange)
  }, [])

  return isPhone
}
