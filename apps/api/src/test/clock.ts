import { vi } from 'vitest'
import { studioInstant } from '@mizuki/shared'

/**
 * Run one step with the clock held still at a moment the seeded timetable is still ahead of.
 *
 * The seed is the studio's real 2026 calendar — fixed dates, because that is what it is. A test
 * that calls a service passes its own `now` and is unaffected by that. A test that goes through
 * an HTTP route cannot: the route reads the real clock, and the public calendar hides anything
 * already past. So those tests quietly stopped being about what they say they are about and
 * became tests of today's date, and on 24 August 2026 six of them began failing on a codebase
 * nobody had touched.
 *
 * Two deliberate narrownesses, both learned the hard way:
 *
 * Only Date is faked. Faking timers as well leaves mongoose and supertest waiting on setTimeout
 * calls that never fire.
 *
 * And only for the length of one call, rather than the whole file. Held across a file's worth of
 * database work, a frozen Date outlives the driver's heartbeat interval — real timers still fire,
 * the reply is timed against a clock that has not moved, and the topology is marked unreachable.
 * The symptom is a health check reporting the database disconnected while every query around it
 * works perfectly.
 */
export async function atSeedTime<T>(
  run: () => Promise<T>,
  dateKey = '2026-08-11',
  time = '09:00',
): Promise<T> {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(studioInstant(dateKey, time))
  try {
    return await run()
  } finally {
    vi.useRealTimers()
  }
}
