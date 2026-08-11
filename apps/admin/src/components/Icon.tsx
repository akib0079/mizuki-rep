import type { SVGProps } from 'react'

/**
 * A small stroked icon set, drawn inline.
 *
 * Replaces the unicode glyphs this console started with. Those rendered at whatever weight and
 * baseline each font happened to supply, so the collapsed sidebar — where the icon is the only
 * label — came out as a column of mismatched symbols. These share a grid, a stroke width and a
 * baseline, and inherit `currentColor` so hover and active states just work.
 */

export type IconName =
  | 'dashboard'
  | 'calendar'
  | 'students'
  | 'closed'
  | 'mail'
  | 'settings'
  | 'search'
  | 'menu'
  | 'plus'
  | 'star'
  | 'chevron'
  | 'clock'
  | 'users'
  | 'trend'
  | 'alert'
  | 'check'
  | 'phone'
  | 'note'
  | 'ticket'
  | 'close'
  | 'bell'

const PATHS: Record<IconName, JSX.Element> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  students: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20c0-3.1 2.7-5 6-5s6 1.9 6 5" />
      <path d="M16 5.2a3 3 0 0 1 0 5.6M18 15c2.2.5 3.7 2 3.7 4.4" />
    </>
  ),
  closed: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M5.6 5.6l12.8 12.8" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3.5 7l8.5 6 8.5-6" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.9-3.9" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  plus: <path d="M12 5v14M5 12h14" />,
  star: <path d="M12 3.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8-5.3-2.8-5.3 2.8 1-5.8-4.2-4.1 5.9-.9z" />,
  chevron: <path d="M6 9l6 6 6-6" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5.2l3.2 1.9" />
    </>
  ),
  trend: <path d="M3 17l6-6 4 4 8-8M21 7v5m0-5h-5" />,
  alert: (
    <>
      <path d="M12 3.5L2.5 20h19z" />
      <path d="M12 9.5v4.5M12 17.2v.1" />
    </>
  ),
  check: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.4l2.7 2.6L16 9.6" />
    </>
  ),
  phone: <path d="M6.5 3.5h3l1.5 4-2 1.4a12 12 0 0 0 6.1 6.1l1.4-2 4 1.5v3a2 2 0 0 1-2.2 2A17 17 0 0 1 4.5 5.7a2 2 0 0 1 2-2.2z" />,
  note: (
    <>
      <path d="M5 3.5h9l5 5V20a1.5 1.5 0 0 1-1.5 1.5h-12A1.5 1.5 0 0 1 4 20V5A1.5 1.5 0 0 1 5.5 3.5z" />
      <path d="M13.5 3.5V9H19M8 13h8M8 17h5" />
    </>
  ),
  ticket: (
    <>
      <path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h15A1.5 1.5 0 0 1 21 8.5v2a2 2 0 0 0 0 3.9v2A1.5 1.5 0 0 1 19.5 18h-15A1.5 1.5 0 0 1 3 16.5v-2a2 2 0 0 0 0-3.9z" />
      <path d="M14 7v11" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6L6 18" />,
  bell: (
    <>
      <path d="M18 8a6 6 0 1 0-12 0c0 4.5-1.5 6-2 6.5h16c-.5-.5-2-2-2-6.5z" />
      <path d="M10 18.5a2 2 0 0 0 4 0" />
    </>
  ),
}

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName
  size?: number
}

export function Icon({ name, size = 18, ...rest }: IconProps) {
  const filled = name === 'star'
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={filled ? 0 : 1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      // Decorative: the surrounding control carries the accessible name.
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {PATHS[name]}
    </svg>
  )
}
