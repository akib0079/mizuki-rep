import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ACTIVE_BOOKING_STATUSES, ROSTER_STATUSES, SEAT_OCCUPYING_STATUSES } from '@mizuki/shared'

/**
 * A structural guard, not a behavioural one.
 *
 * Booking statuses used to be grouped by writing the array out at each call site — seventeen of
 * them. The danger is specific: a capacity query that omits a live status undercounts the room
 * and lets the class oversell, and it does that silently, because the query still returns rows
 * and every test that does not happen to use that status still passes.
 *
 * So the rule is that statuses may only be grouped through the shared constants, and this test
 * enforces it by reading the source. It fails on the literal, before anyone has to notice the
 * oversold class.
 */

const apiSrc = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    // Test files legitimately assert on individual statuses.
    return full.endsWith('.ts') && !full.endsWith('.test.ts') ? [full] : []
  })
}

describe('booking status grouping', () => {
  it('never groups statuses with a literal array', () => {
    // Two or more quoted statuses inside brackets — the shape of a hand-written group.
    const grouped =
      /\[\s*'(?:hold|awaiting_confirmation|confirmed|attended|no_show|cancelled)'\s*,\s*'(?:hold|awaiting_confirmation|confirmed|attended|no_show|cancelled)'/

    const offenders = sourceFiles(apiSrc)
      .filter((file) => {
        // The model declares the enum itself; that is the one place the full list belongs.
        if (file.endsWith(path.join('models', 'Booking.ts'))) return false

        const source = readFileSync(file, 'utf8')
          // `z.enum([...])` spells out which values a request may send. That is an input
          // contract, not a grouping of statuses that mean the same thing, and narrowing it
          // to the shared sets would let callers pass statuses the endpoint cannot handle.
          .replace(/z\.enum\(\[[^\]]*\]\)/g, '')

        return grouped.test(source)
      })
      .map((file) => path.relative(apiSrc, file))

    expect(offenders).toEqual([])
  })

  it('keeps the sets nested, so a live status is always a seat and always on the roster', () => {
    for (const status of ACTIVE_BOOKING_STATUSES) {
      expect(SEAT_OCCUPYING_STATUSES).toContain(status)
      expect(ROSTER_STATUSES).toContain(status)
    }
    for (const status of SEAT_OCCUPYING_STATUSES) {
      expect(ROSTER_STATUSES).toContain(status)
    }
  })

  it('treats a paid-but-unverified place as occupied', () => {
    // The whole point of the state: the student has paid, so the place must not go back on sale
    // while the studio checks the money arrived.
    expect(ACTIVE_BOOKING_STATUSES).toContain('awaiting_confirmation')
  })

  it('never counts a cancelled booking as holding a place', () => {
    expect(ROSTER_STATUSES).not.toContain('cancelled')
  })
})
