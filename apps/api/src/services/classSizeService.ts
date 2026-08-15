import { Types } from 'mongoose'
import { CourseTypeModel, ScheduleRuleModel, SessionModel } from '../models/index.js'
import { recordAudit } from '../services/auditService.js'
import { NotFoundError } from '../errors.js'
import { logger } from '../logger.js'

/**
 * Setting a course's class size, everywhere it is written down.
 *
 * "How many students fit in this class?" reads like one number, but the system stores it in three
 * places, and until this module existed the settings page only wrote to the first:
 *
 *   1. `CourseType.defaultCapacity` — the number a newly added one-off class starts with.
 *   2. `ScheduleRule.capacity`      — the number the generator stamps on every class it creates
 *                                     from the recurring timetable, weeks ahead of time.
 *   3. `Session.capacity`           — the number on the classes already on the calendar, which
 *                                     is the only one a student ever books against.
 *
 * So the studio could type 12 into the settings page, watch it save, and still have a calendar
 * made entirely of classes for 8 — and the nightly generator would keep producing more of them.
 * That is the worst kind of setting: one that reports success and changes nothing.
 *
 * Hence one operation that writes all three. Two things it deliberately refuses to do:
 *
 *   - It never touches a class whose capacity was set by hand. `overriddenFields` is the studio
 *     saying "this Saturday is different"; a course-wide default must not silently undo that.
 *   - It never shrinks a class below the students already in it. "A class can never be oversold"
 *     is the requirement the whole system is judged on, and quietly seating 6 students in a room
 *     for 4 would break it from the admin side, where nothing is watching.
 *
 * Past classes are left alone in every case. They are a record of what happened, not a plan.
 */

/** One upcoming class that cannot take the new size, and why. */
export interface BlockedSession {
  id: string
  dateKey: string
  title: string
  /** Students already booked, plus places the studio withheld — the real floor for capacity. */
  occupied: number
}

export interface ClassSizePlan {
  courseId: string
  courseName: string
  capacity: number
  /** Upcoming classes that would move to the new size. */
  willChange: number
  /** Upcoming classes already at the new size. */
  alreadyCorrect: number
  /** Upcoming classes whose size was set by hand, and so are left alone. */
  keptCustom: number
  /** Recurring timetable rules that would move to the new size. */
  rulesChanged: number
  /** Upcoming classes that cannot shrink that far, because students are already in them. */
  blocked: BlockedSession[]
}

/** Upcoming, still-scheduled classes of one course. Past classes are history and stay untouched. */
function upcomingFilter(courseId: Types.ObjectId, now: Date) {
  return { courseTypeId: courseId, status: 'scheduled' as const, startAt: { $gte: now } }
}

/**
 * Work out what setting this size would do, without doing it.
 *
 * The settings page shows this before asking the studio to confirm, because "12 classes will
 * change and 2 cannot" is a decision, and the studio should get to make it knowing the numbers.
 */
export async function planClassSize(
  courseIdInput: Types.ObjectId | string,
  capacity: number,
  now: Date = new Date(),
): Promise<ClassSizePlan> {
  const courseId = new Types.ObjectId(String(courseIdInput))
  const course = await CourseTypeModel.findById(courseId).lean()
  if (!course) throw new NotFoundError('Course')

  const sessions = await SessionModel.find(upcomingFilter(courseId, now))
    .select('capacity seatsTaken heldBack dateKey title overriddenFields')
    .sort({ startAt: 1 })
    .lean()

  let willChange = 0
  let alreadyCorrect = 0
  let keptCustom = 0
  const blocked: BlockedSession[] = []

  for (const s of sessions) {
    if (s.capacity === capacity) {
      alreadyCorrect++
      continue
    }
    if ((s.overriddenFields ?? []).includes('capacity')) {
      keptCustom++
      continue
    }
    const occupied = s.seatsTaken + s.heldBack
    if (capacity < occupied) {
      blocked.push({
        id: String(s._id),
        dateKey: s.dateKey,
        title: s.title || course.name,
        occupied,
      })
      continue
    }
    willChange++
  }

  const rulesChanged = await ScheduleRuleModel.countDocuments({
    courseTypeId: courseId,
    capacity: { $ne: capacity },
  })

  return {
    courseId: String(courseId),
    courseName: course.name,
    capacity,
    willChange,
    alreadyCorrect,
    keptCustom,
    rulesChanged,
    blocked,
  }
}

export interface ClassSizeResult extends ClassSizePlan {
  /** Classes actually written. Matches `willChange` unless something changed underneath us. */
  changed: number
}

/**
 * Set the class size for a course: the default, the timetable rules, and the calendar ahead.
 *
 * Returns the same shape as the plan, so the settings page can report what happened in the same
 * words it used to ask. Blocked classes are reported, never forced — the studio can lower those
 * by hand once it has moved the students, which is a decision only a person can make.
 */
export async function applyClassSize(
  courseIdInput: Types.ObjectId | string,
  capacity: number,
  actor: string,
  now: Date = new Date(),
): Promise<ClassSizeResult> {
  const plan = await planClassSize(courseIdInput, capacity, now)
  const courseId = new Types.ObjectId(String(courseIdInput))

  const previousDefault = (await CourseTypeModel.findById(courseId).select('defaultCapacity').lean())
    ?.defaultCapacity

  await CourseTypeModel.updateOne({ _id: courseId }, { $set: { defaultCapacity: capacity } })
  await ScheduleRuleModel.updateMany({ courseTypeId: courseId }, { $set: { capacity } })

  // Excludes hand-edited classes, and classes with more students in them than the new size
  // allows. Both are re-tested here rather than trusted from the plan, so a booking taken
  // between the preview and the confirmation cannot slip a class past the check.
  const blockedIds = plan.blocked.map((b) => new Types.ObjectId(b.id))
  const result = await SessionModel.updateMany(
    {
      ...upcomingFilter(courseId, now),
      capacity: { $ne: capacity },
      overriddenFields: { $ne: 'capacity' },
      _id: { $nin: blockedIds },
      $expr: { $lte: [{ $add: ['$seatsTaken', '$heldBack'] }, capacity] },
    },
    { $set: { capacity } },
  )

  await recordAudit({
    actor,
    action: 'course.classSizeSet',
    entity: 'CourseType',
    entityId: courseId,
    before: { defaultCapacity: previousDefault },
    after: {
      defaultCapacity: capacity,
      sessionsChanged: result.modifiedCount,
      rulesChanged: plan.rulesChanged,
      keptCustom: plan.keptCustom,
      blocked: plan.blocked.length,
    },
  })

  logger.info(
    {
      courseId: String(courseId),
      capacity,
      sessionsChanged: result.modifiedCount,
      rulesChanged: plan.rulesChanged,
      keptCustom: plan.keptCustom,
      blocked: plan.blocked.length,
    },
    'Class size set',
  )

  return { ...plan, changed: result.modifiedCount }
}
