import { describe, expect, it } from 'vitest'
import { SessionModel } from '../models/index.js'
import { makeSession } from '../test/factories.js'
import { findSeatDrift, releaseSeat, repairSeatDrift, reserveSeat, transferSeat } from './seatService.js'
import { SessionFullError } from '../errors.js'

describe('reserveSeat', () => {
  it('claims a place and reports the new count', async () => {
    const session = await makeSession({ capacity: 3 })
    const updated = await reserveSeat(session._id)
    expect(updated.seatsTaken).toBe(1)
  })

  it('refuses once the class is full', async () => {
    const session = await makeSession({ capacity: 2 })
    await reserveSeat(session._id)
    await reserveSeat(session._id)
    await expect(reserveSeat(session._id)).rejects.toBeInstanceOf(SessionFullError)
  })

  it('counts places held back for chat bookings as unavailable', async () => {
    // 6 seats, 4 withheld for students who book over chat — only 2 are on public sale.
    const session = await makeSession({ capacity: 6, heldBack: 4 })
    await reserveSeat(session._id)
    await reserveSeat(session._id)
    await expect(reserveSeat(session._id)).rejects.toBeInstanceOf(SessionFullError)

    const fresh = await SessionModel.findById(session._id)
    expect(fresh!.seatsTaken).toBe(2)
  })

  it('refuses a cancelled class with its own message', async () => {
    const session = await makeSession({ capacity: 5, status: 'cancelled' })
    await expect(reserveSeat(session._id)).rejects.toMatchObject({ code: 'session_cancelled' })
  })

  it('lets the studio override a full class deliberately', async () => {
    const session = await makeSession({ capacity: 1 })
    await reserveSeat(session._id)
    await expect(reserveSeat(session._id)).rejects.toBeInstanceOf(SessionFullError)

    const overridden = await reserveSeat(session._id, { override: true })
    expect(overridden.seatsTaken).toBe(2)
  })

  /**
   * The requirement the client cares about most: "it can never be exceeded".
   *
   * Twenty students hit the same five-seat class at the same instant. If the check and the
   * increment were separate reads and writes, several would each see a free place and all
   * succeed. They must not.
   */
  it('sells exactly the available places under a stampede', async () => {
    const capacity = 5
    const attempts = 20
    const session = await makeSession({ capacity })

    const results = await Promise.allSettled(
      Array.from({ length: attempts }, () => reserveSeat(session._id)),
    )

    const granted = results.filter((r) => r.status === 'fulfilled')
    const refused = results.filter((r) => r.status === 'rejected')

    expect(granted).toHaveLength(capacity)
    expect(refused).toHaveLength(attempts - capacity)
    expect(refused.every((r) => (r as PromiseRejectedResult).reason instanceof SessionFullError)).toBe(true)

    const fresh = await SessionModel.findById(session._id)
    expect(fresh!.seatsTaken).toBe(capacity)
  })

  it('respects held-back places under the same stampede', async () => {
    // 10 in the room, 7 withheld — the public may take exactly 3, however hard they press.
    const session = await makeSession({ capacity: 10, heldBack: 7 })

    const results = await Promise.allSettled(Array.from({ length: 25 }, () => reserveSeat(session._id)))

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3)
    const fresh = await SessionModel.findById(session._id)
    expect(fresh!.seatsTaken).toBe(3)
  })
})

describe('releaseSeat', () => {
  it('hands a place back', async () => {
    const session = await makeSession({ capacity: 2 })
    await reserveSeat(session._id)
    await releaseSeat(session._id)

    const fresh = await SessionModel.findById(session._id)
    expect(fresh!.seatsTaken).toBe(0)
  })

  it('never drives the counter negative when released twice', async () => {
    // A student cancelling at the same moment the hold sweeper expires their booking.
    const session = await makeSession({ capacity: 2 })
    await reserveSeat(session._id)

    await Promise.all([releaseSeat(session._id), releaseSeat(session._id)])

    const fresh = await SessionModel.findById(session._id)
    expect(fresh!.seatsTaken).toBe(0)
  })

  it('frees the place for the next student', async () => {
    const session = await makeSession({ capacity: 1 })
    await reserveSeat(session._id)
    await expect(reserveSeat(session._id)).rejects.toBeInstanceOf(SessionFullError)

    await releaseSeat(session._id)
    await expect(reserveSeat(session._id)).resolves.toMatchObject({ seatsTaken: 1 })
  })
})

describe('transferSeat', () => {
  it('moves a student between classes', async () => {
    const from = await makeSession({ capacity: 4, date: '2026-09-12' })
    const to = await makeSession({ capacity: 4, date: '2026-09-13' })
    await reserveSeat(from._id)

    await transferSeat(from._id, to._id)

    expect((await SessionModel.findById(from._id))!.seatsTaken).toBe(0)
    expect((await SessionModel.findById(to._id))!.seatsTaken).toBe(1)
  })

  it('leaves the original booking untouched when the target is full', async () => {
    const from = await makeSession({ capacity: 4, date: '2026-09-12' })
    const to = await makeSession({ capacity: 1, date: '2026-09-13' })
    await reserveSeat(from._id)
    await reserveSeat(to._id)

    await expect(transferSeat(from._id, to._id)).rejects.toBeInstanceOf(SessionFullError)

    // The student must still have their original place — not neither.
    expect((await SessionModel.findById(from._id))!.seatsTaken).toBe(1)
    expect((await SessionModel.findById(to._id))!.seatsTaken).toBe(1)
  })
})

describe('drift detection', () => {
  it('spots a counter that disagrees with the bookings, and repairs on request', async () => {
    const session = await makeSession({ capacity: 8, date: '2027-01-10' })
    await SessionModel.updateOne({ _id: session._id }, { $set: { seatsTaken: 3 } })

    const drift = await findSeatDrift(new Date('2026-01-01'))
    expect(drift).toHaveLength(1)
    expect(drift[0]).toMatchObject({ storedSeatsTaken: 3, actualSeatsTaken: 0 })

    await repairSeatDrift(drift)
    expect((await SessionModel.findById(session._id))!.seatsTaken).toBe(0)
    expect(await findSeatDrift(new Date('2026-01-01'))).toHaveLength(0)
  })
})
