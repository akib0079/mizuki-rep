import { useEffect, useMemo, useState } from 'react'
import { DateTime } from 'luxon'
import { STUDIO_TZ } from '@mizuki/shared'

/**
 * The small month beside the calendar, for moving around without losing your place.
 *
 * The grid is for reading a month; this is for choosing one. Paging the big grid to reach
 * October means three clicks and three reloads, and after each one the studio has to work out
 * where they have landed. Here a whole month is one glance and one click.
 *
 * Days that have classes carry a dot, so the shape of a month — which weekends are working, where
 * the gaps are — is legible before anything is loaded.
 */

export function MiniMonth({
  month,
  selected,
  busyDates,
  closedDates,
  onPick,
}: {
  /** Any day inside the month to draw. */
  month: DateTime
  /** The day the big calendar is currently showing. */
  selected: DateTime
  /** yyyy-MM-dd for every day that has at least one class. */
  busyDates: Set<string>
  closedDates: Set<string>
  onPick: (date: DateTime) => void
}) {
  const today = DateTime.now().setZone(STUDIO_TZ).startOf('day')

  /*
   * The arrows page this panel on its own; only choosing a day moves the calendar beside it.
   *
   * Tying them together meant looking ahead to October cost you your place in August, and
   * arriving on the 1st of a month you were only glancing at. Browsing and going are different
   * intentions and get different controls.
   *
   * The panel snaps back whenever the calendar itself moves, so the two cannot drift apart. Keyed
   * on the month rather than the date object: a new DateTime is built on every redraw, and
   * depending on the object would resync — and undo the paging — on any render at all.
   */
  const [viewMonth, setViewMonth] = useState(month)
  const monthKey = month.toFormat('yyyy-MM')
  useEffect(() => setViewMonth(month), [monthKey]) // eslint-disable-line react-hooks/exhaustive-deps

  /*
   * Six rows always, whatever the month.
   *
   * A month that needs five rows next to one that needs six makes the panel jump as you page
   * through, and the calendar below it move with it. A fixed six is what every paper calendar
   * does, and it costs one row of grey numbers.
   */
  const days = useMemo(() => {
    const first = viewMonth.startOf('month').startOf('week') // Luxon weeks start Monday
    return Array.from({ length: 42 }, (_, i) => first.plus({ days: i }))
  }, [viewMonth])

  return (
    <div className="mini">
      <div className="mini-head">
        <div className="mini-title">{viewMonth.toFormat('LLLL yyyy')}</div>
        <div className="mini-nav">
          <button
            type="button"
            className="icon-btn"
            aria-label="Previous month"
            onClick={() => setViewMonth(viewMonth.minus({ months: 1 }))}
          >
            ‹
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Next month"
            onClick={() => setViewMonth(viewMonth.plus({ months: 1 }))}
          >
            ›
          </button>
        </div>
      </div>

      <div className="mini-grid" role="grid">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          // The initials repeat, so they are decorative — the buttons below carry the real date.
          <div className="mini-dow" key={i} aria-hidden>
            {d}
          </div>
        ))}

        {days.map((day) => {
          const key = day.toFormat('yyyy-MM-dd')
          const outside = day.month !== viewMonth.month
          const classes = [
            'mini-day',
            outside ? 'is-outside' : '',
            day.hasSame(today, 'day') ? 'is-today' : '',
            day.hasSame(selected, 'day') ? 'is-selected' : '',
            closedDates.has(key) ? 'is-closed' : '',
          ]
            .filter(Boolean)
            .join(' ')

          return (
            <button
              type="button"
              key={key}
              className={classes}
              onClick={() => onPick(day)}
              aria-label={day.toFormat('cccc d LLLL yyyy')}
              aria-current={day.hasSame(today, 'day') ? 'date' : undefined}
            >
              {day.day}
              {busyDates.has(key) && !outside && <span className="mini-dot" aria-hidden />}
            </button>
          )
        })}
      </div>
    </div>
  )
}
