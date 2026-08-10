import { Types, type ClientSession } from 'mongoose'
import { SEAT_OCCUPYING_STATUSES } from '@mizuki/shared'
import { BookingModel, SessionModel, type SessionDoc } from '../models/index.js'
import { NotFoundError, SessionFullError, AppError } from '../errors.js'
import { logger } from '../logger.js'

/**
 * The only code in the system allowed to move `Session.seatsTaken`.
 *
 * "A class can never be oversold" is the requirement the whole system is judged on, and it is
 * the one that a naive implementation gets wrong: read the session, see one place left, create
 * the booking. Two students clicking at the same moment both read "1 left" and both succeed.
 *
 * So the check and the increment are a single atomic document update with the capacity test in
 * its filter. Mongo applies it to one document at a time, so of two racing updates exactly one
 * matches and the other comes back `null`. There is no window to lose.
 */

export interface ReserveOptions {
  /** Let the studio seat someone in a full class anyway. Always recorded on the booking and in the audit log. */
  override?: boolean
  session?: ClientSession | null
}

/** Filter fragment: this session still has room for one more student. */
const hasRoom = {
  $expr: { $lt: [{ $add: ['$seatsTaken', '$heldBack'] }, '$capacity'] },
}

/**
 * Claim one place. Returns the updated session, or throws.
 *
 * Throwing rather than returning null is deliberate: every caller must handle "it filled up"
 * explicitly, and a forgotten null check would silently overbook.
 */
export async function reserveSeat(
  sessionId: Types.ObjectId | string,
  opts: ReserveOptions = {},
): Promise<SessionDoc> {
  const { override = false, session = null } = opts

  const filter = override
    ? { _id: sessionId, status: 'scheduled' as const }
    : { _id: sessionId, status: 'scheduled' as const, ...hasRoom }

  const updated = await SessionModel.findOneAndUpdate(
    filter,
    { $inc: { seatsTaken: 1 } },
    { new: true, session },
  )

  if (updated) return updated

  // The update matched nothing. Work out why, so the student gets a useful message
  // rather than a generic failure.
  const existing = await SessionModel.findById(sessionId).session(session)
  if (!existing) throw new NotFoundError('Class')
  if (existing.status === 'cancelled') {
    throw new AppError(409, 'session_cancelled', 'That class has been cancelled.')
  }
  throw new SessionFullError()
}

/**
 * Hand a place back. Guarded with `seatsTaken > 0` so a double-release — a cancel racing the
 * hold sweeper, say — can never drive the counter negative and quietly invent a free place.
 */
export async function releaseSeat(
  sessionId: Types.ObjectId | string,
  opts: { session?: ClientSession | null } = {},
): Promise<void> {
  const result = await SessionModel.findOneAndUpdate(
    { _id: sessionId, seatsTaken: { $gt: 0 } },
    { $inc: { seatsTaken: -1 } },
    { new: true, session: opts.session ?? null },
  )

  if (!result) {
    // Not fatal — the seat is already free, which is the state the caller wanted. Worth a
    // line in the log because repeated occurrences mean a counter is drifting.
    logger.warn({ sessionId: String(sessionId) }, 'releaseSeat found no seat to release')
  }
}

/**
 * Move one place between two classes as a unit, for a reschedule.
 *
 * The new place is claimed *before* the old one is released. Done the other way round, a
 * student moving into the last place of a popular class would briefly free their current
 * place — and if the target turned out to be full, they would be left with neither.
 */
export async function transferSeat(
  fromSessionId: Types.ObjectId | string,
  toSessionId: Types.ObjectId | string,
  opts: ReserveOptions = {},
): Promise<SessionDoc> {
  const target = await reserveSeat(toSessionId, opts)
  try {
    await releaseSeat(fromSessionId, { session: opts.session ?? null })
  } catch (err) {
    await releaseSeat(toSessionId, { session: opts.session ?? null })
    throw err
  }
  return target
}

export interface SeatDrift {
  sessionId: string
  dateKey: string
  title: string
  storedSeatsTaken: number
  actualSeatsTaken: number
}

/**
 * Recompute every future session's counter from the bookings that actually exist.
 *
 * The counter is denormalised, and denormalised numbers drift — a crashed process between the
 * increment and the booking insert, a hand-edit in Atlas. Run nightly: report the drift, and
 * only repair when asked, so an unexplained mismatch surfaces to a human instead of being
 * silently papered over.
 */
export async function findSeatDrift(from: Date = new Date()): Promise<SeatDrift[]> {
  const sessions = await SessionModel.find({ startAt: { $gte: from } })
    .select('_id dateKey title seatsTaken')
    .lean()

  if (sessions.length === 0) return []

  const counts = await BookingModel.aggregate<{ _id: Types.ObjectId; n: number }>([
    {
      $match: {
        sessionId: { $in: sessions.map((s) => s._id) },
        status: { $in: SEAT_OCCUPYING_STATUSES },
      },
    },
    { $group: { _id: '$sessionId', n: { $sum: 1 } } },
  ])

  const actual = new Map(counts.map((c) => [String(c._id), c.n]))

  return sessions
    .map((s) => ({
      sessionId: String(s._id),
      dateKey: s.dateKey,
      title: s.title ?? '',
      storedSeatsTaken: s.seatsTaken,
      actualSeatsTaken: actual.get(String(s._id)) ?? 0,
    }))
    .filter((s) => s.storedSeatsTaken !== s.actualSeatsTaken)
}

export async function repairSeatDrift(drift: SeatDrift[]): Promise<number> {
  if (drift.length === 0) return 0
  const ops = drift.map((d) => ({
    updateOne: { filter: { _id: new Types.ObjectId(d.sessionId) }, update: { $set: { seatsTaken: d.actualSeatsTaken } } },
  }))
  const result = await SessionModel.bulkWrite(ops)
  logger.warn({ repaired: result.modifiedCount, drift }, 'Repaired seat counter drift')
  return result.modifiedCount
}
