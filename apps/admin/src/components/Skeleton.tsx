/**
 * Wireframe placeholders, shaped like the thing that is coming.
 *
 * A centred "Loading…" tells you the page is not ready and nothing else. A skeleton in the shape
 * of the real content says how much is coming and where it will be, so the page assembles rather
 * than appears — and nothing jumps when the data lands, because the space was already the right
 * size.
 *
 * All of these accept no state. They are geometry.
 */

/** One grey bar. `w` accepts any CSS width so a row of them can look like real text. */
export function SkeletonLine({ w = '100%', h = 13 }: { w?: string | number; h?: number }) {
  return <span className="sk-line" style={{ width: w, height: h }} aria-hidden />
}

export function SkeletonCircle({ size = 32 }: { size?: number }) {
  return <span className="sk-circle" style={{ width: size, height: size }} aria-hidden />
}

/**
 * The wrapper that makes a skeleton legible to a screen reader.
 *
 * Without this the bars are announced as nothing at all and the page reads as empty. `aria-busy`
 * with a label says "this is loading" once, instead of describing the geometry.
 */
export function SkeletonBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="sk" role="status" aria-busy="true" aria-label={label}>
      {children}
    </div>
  )
}

/** Placeholder for the dashboard's four figures. */
export function SkeletonStats({ count = 4 }: { count?: number }) {
  return (
    <SkeletonBlock label="Loading your studio summary">
      <div className="stat-row">
        {Array.from({ length: count }, (_, i) => (
          <div className="card stat-card" key={i}>
            <SkeletonLine w="55%" h={11} />
            <SkeletonLine w="38%" h={26} />
            <SkeletonLine w="70%" h={10} />
          </div>
        ))}
      </div>
    </SkeletonBlock>
  )
}

/** Placeholder for a table, matched to the column count so nothing shifts on arrival. */
export function SkeletonTable({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  // Uneven widths, because a grid of identical bars reads as a pattern rather than as text.
  const widths = ['62%', '78%', '45%', '55%', '70%', '38%']

  return (
    <SkeletonBlock label="Loading">
      <table className="table sk-table">
        <tbody>
          {Array.from({ length: rows }, (_, r) => (
            <tr key={r}>
              {Array.from({ length: cols }, (_, c) => (
                <td key={c}>
                  <SkeletonLine w={widths[(r + c) % widths.length]} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </SkeletonBlock>
  )
}

/** Placeholder for a stack of cards — payments, notifications, bookings. */
export function SkeletonCards({ count = 3 }: { count?: number }) {
  return (
    <SkeletonBlock label="Loading">
      <div className="stack">
        {Array.from({ length: count }, (_, i) => (
          <div className="card sk-row" key={i}>
            <div className="sk-row-main">
              <SkeletonLine w="34%" h={15} />
              <SkeletonLine w="58%" h={11} />
              <SkeletonLine w="44%" h={11} />
            </div>
            <SkeletonLine w={110} h={34} />
          </div>
        ))}
      </div>
    </SkeletonBlock>
  )
}

/** Placeholder for the month grid, so the calendar does not appear from nothing. */
export function SkeletonCalendar() {
  return (
    <SkeletonBlock label="Loading the calendar">
      <div className="card">
        <div className="sk-cal-head">
          <SkeletonLine w={150} h={20} />
          <SkeletonLine w={80} h={30} />
        </div>
        <div className="sk-cal-grid">
          {Array.from({ length: 35 }, (_, i) => (
            <span className="sk-cal-cell" key={i} aria-hidden />
          ))}
        </div>
      </div>
    </SkeletonBlock>
  )
}
