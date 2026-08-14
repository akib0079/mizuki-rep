import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import {
  cancelBookingSchema,
  evaluateReschedule,
  rescheduleBookingSchema,
  startBookingSchema,
  startBookingSignedInSchema,
  studentSelfUpdateSchema,
} from '@mizuki/shared'
import { buildIcs } from '../services/mailer.js'
import {
  BookingModel,
  CourseTypeModel,
  SessionModel,
  StudentModel,
  type CourseTypeDoc,
} from '../models/index.js'
import {
  HOLD_TTL_MS,
  cancelBooking,
  createBooking,
  listStudentBookings,
  rescheduleBooking,
} from '../services/bookingService.js'
import { findUsablePackage, summarisePackages } from '../services/packageService.js'
import { queueMagicLink } from '../services/notificationService.js'
import { toPublicSession } from '../services/calendarService.js'
import { optionalStudent, requireStudent } from '../middleware/auth.js'
import { asyncRoute } from '../middleware/errorHandler.js'
import { AppError, ForbiddenError, NotFoundError } from '../errors.js'
import { LoginTokenModel } from '../models/index.js'
import { generateHoldToken, generateMagicToken } from '../auth/tokens.js'
import { z } from 'zod'
import { findExistingStudent } from '../services/studentMatch.js'
import { config } from '../config.js'

/**
 * What a student can do with their own bookings.
 *
 * The booking entry point is email-first rather than sign-in-first: a visitor should not have to
 * make an account to find out whether they can book. Where a course credit is about to be spent,
 * a magic link is required first — otherwise knowing someone's address would be enough to burn
 * through the sessions they paid for.
 */
export const bookingRouter: Router = Router()

/**
 * Find an account by phone, comparing digits only.
 *
 * "+65 9123 4567" and "6591234567" are the same number to everyone except a string comparison,
 * and matching literally would miss exactly the duplicate this is meant to catch.
 */


/** a•••a@gmail.com — enough to recognise your own address, not enough to learn someone else's. */
function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@')
  if (local.length <= 2) return `${local[0] ?? ''}•••@${domain}`
  return `${local[0]}•••${local[local.length - 1]}@${domain}`
}

const bookingLimiter = rateLimit({
  windowMs: 10 * 60_000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'rate_limited', message: 'Too many attempts. Please try again shortly.' } },
})

/**
 * Step one of booking: identify the student and decide the route.
 *
 * Returns one of three outcomes — booked outright (free class, already signed in), a magic link
 * sent (course credit needs verifying), or a checkout handoff (paid workshop).
 */
bookingRouter.post(
  '/start',
  bookingLimiter,
  optionalStudent,
  asyncRoute(async (req, res) => {
    /*
     * Who is booking is decided by the session, never by the form.
     *
     * A signed-in student's identity fields are not even read: accepting them let the same person
     * arrive on the register under a different name each time, and let anyone who knew an address
     * book against that account and spend its course credits. Signed in, the account is the
     * answer and the form only says what is different about this booking.
     */
    const signedIn = req.student ?? null

    const input = signedIn
      ? { ...startBookingSignedInSchema.parse(req.body), marketingOptIn: undefined }
      : startBookingSchema.parse(req.body)

    const session = await SessionModel.findById(input.sessionId)
    if (!session) throw new NotFoundError('Class')

    const courseType = await CourseTypeModel.findById(session.courseTypeId)
    if (!courseType) throw new NotFoundError('Course')

    let student = signedIn

    if (!student) {
      const visitor = input as z.infer<typeof startBookingSchema>
      const match = await findExistingStudent(visitor)

      /*
       * Already ours, and we are sure of it.
       *
       * Booking anyway would attach this to their record on nothing more than knowing an address
       * or a number — no proof of the inbox, their course credits spent by a stranger, and a name
       * on the register that may not be theirs. Proving the inbox is what the sign-in link is for.
       */
      if (match?.certain) {
        res.json({
          outcome: 'sign_in_required',
          reason: match.kind,
          certain: true,
          email: match.kind === 'email_known' ? match.student.email : maskEmail(match.student.email),
          message:
            match.kind === 'email_known'
              ? 'This email has booked with us before. Sign in and your place will be added to your ' +
                'existing bookings, with your course package if you have one.'
              : `This phone number is already registered to ${maskEmail(match.student.email)}. Sign in ` +
                'with that address to keep your bookings and course package together.',
        })
        return
      }

      /*
       * Nearly ours. Not certain, so not refused outright.
       *
       * This is what actually creates duplicates: gmal for gmail, a missing letter, the same name
       * typed twice. Every field differs, so nothing exact catches it, and the studio ends up with
       * one person spread across three accounts and three separate course balances.
       *
       * Two people can genuinely share a name, though, so this asks rather than decides — and the
       * answer comes back as `confirmedNewAccount`, which only ever gets past a near miss.
       */
      if (match && !visitor.confirmedNewAccount) {
        res.json({
          outcome: 'possible_duplicate',
          reason: match.kind,
          certain: false,
          email: maskEmail(match.student.email),
          name: match.student.name,
          message:
            match.kind === 'email_similar'
              ? `We already have an account at ${maskEmail(match.student.email)}, which looks very ` +
                'like the address you typed. If that is you, sign in — otherwise your bookings and ' +
                'course package will end up split across two accounts.'
              : `We already have a student called ${match.student.name}. If that is you, sign in so ` +
                'this booking joins your others.',
        })
        return
      }

      student = await StudentModel.create({
        name: visitor.name,
        email: visitor.email,
        phone: visitor.phone,
        phoneCountry: visitor.phoneCountry,
        marketingOptIn: visitor.marketingOptIn,
      })
    }

    const isSignedIn = Boolean(signedIn)

    if (courseType.bookingMode === 'package') {
      const pkg = await findUsablePackage(student._id, courseType._id)

      /*
       * No course package yet.
       *
       * This used to be a dead end: a 422 telling the student to "get in touch", with no booking
       * made, no place held and nobody at the studio told it had happened. Someone ready to hand
       * over money was turned away by a sentence, and the studio never learned they existed.
       *
       * So take the booking. The place is held, the student is told their place is reserved while
       * payment is arranged, and the studio gets it as something to action — the same queue as a
       * paid place awaiting a payment check, because it is the same job: confirm the money, then
       * confirm the place. Nothing is spent, since there is no package to spend from; the studio
       * grants one when they take payment.
       */
      if (!pkg) {
        const result = await createBooking({
          sessionId: session._id,
          studentId: student._id,
          status: 'awaiting_confirmation',
          source: 'student_web',
          usePackage: false,
          actor: `student:${student.email}`,
          studentNotes: input.notes,
      attendeeName: input.attendeeName,
        })

        res.status(201).json({
          outcome: 'awaiting_confirmation',
          booking: serialiseBooking(result.booking, result.session, result.courseType),
          message:
            `Thank you — your place on ${courseType.name} is reserved. ` +
            `We will be in touch shortly to arrange payment and confirm it.`,
        })
        return
      }

      // Spending someone's course credits needs proof of the inbox, not just knowledge of it.
      if (!isSignedIn) {
        const { token, tokenHash } = generateMagicToken()
        const record = await LoginTokenModel.create({
          studentId: student._id,
          tokenHash,
          expiresAt: new Date(Date.now() + 30 * 60_000),
          redirectTo: `${config.PUBLIC_SITE_URL}/book?confirm=${session._id}`,
          requestedIp: req.ip ?? '',
        })
        await queueMagicLink(student, `${config.PUBLIC_API_URL}/api/auth/magic-link/verify?token=${token}`, String(record._id))

        res.json({
          outcome: 'verify_email',
          message: `We have emailed ${student.email} a link to confirm this booking.`,
        })
        return
      }

      const result = await createBooking({
        sessionId: session._id,
        studentId: student._id,
        source: 'student_web',
        actor: `student:${student.email}`,
        studentNotes: input.notes,
      attendeeName: input.attendeeName,
      })

      res.status(201).json({
        outcome: 'booked',
        booking: serialiseBooking(result.booking, result.session, result.courseType),
        packageRemaining: result.pkg ? result.pkg.totalSessions - result.pkg.usedSessions : null,
      })
      return
    }

    if (courseType.bookingMode === 'free') {
      const result = await createBooking({
        sessionId: session._id,
        studentId: student._id,
        source: 'student_web',
        usePackage: false,
        actor: `student:${student.email}`,
        studentNotes: input.notes,
      attendeeName: input.attendeeName,
      })
      res.status(201).json({
        outcome: 'booked',
        booking: serialiseBooking(result.booking, result.session, result.courseType),
      })
      return
    }

    /*
     * Paid workshops are paid for in the existing shop, so the student leaves this system for
     * a few minutes. Their place is reserved before they go — otherwise the last seat stays on
     * sale throughout checkout and two people can pay for it.
     *
     * The hold occupies a place exactly like a confirmed booking, and expires on its own if
     * payment never lands, which is what makes it safe to hand out optimistically.
     */
    const holdToken = generateHoldToken()
    const holdExpiresAt = new Date(Date.now() + HOLD_TTL_MS)

    const hold = await createBooking({
      sessionId: session._id,
      studentId: student._id,
      status: 'hold',
      source: 'student_web',
      usePackage: false,
      holdToken,
      holdExpiresAt,
      actor: `student:${student.email}`,
      studentNotes: input.notes,
      attendeeName: input.attendeeName,
      // Nothing is confirmed yet — telling them now would be a lie, and telling the studio
      // now would mean an alert for every abandoned cart.
      notify: false,
    })

    const productId = courseType.wooProductIds[0]
    const checkoutUrl = productId
      ? `${config.PUBLIC_SITE_URL}/?add-to-cart=${productId}&mizuki_session=${session._id}&mizuki_hold=${holdToken}`
      : `${config.PUBLIC_SITE_URL}/shop`

    res.json({
      outcome: 'checkout_required',
      message: 'This workshop is paid for through our shop.',
      bookingId: String(hold.booking._id),
      studentId: String(student._id),
      sessionId: String(session._id),
      holdToken,
      holdExpiresAt: holdExpiresAt.toISOString(),
      holdMinutes: config.HOLD_TTL_MINUTES,
      checkoutUrl,
      wooProductIds: courseType.wooProductIds,
      shopUrl: `${config.PUBLIC_SITE_URL}/shop`,
    })
  }),
)

/**
 * Give up a held place deliberately — the student closed the booking box rather than paying.
 *
 * Without this the seat sits unavailable until the sweeper catches it, which on a class with
 * two places left is the difference between someone else booking now or giving up.
 */
bookingRouter.post(
  '/release-hold',
  asyncRoute(async (req, res) => {
    const { holdToken } = z.object({ holdToken: z.string().min(10) }).parse(req.body)

    // Matched on the token alone: the visitor may not be signed in, and the token is the
    // unguessable secret that proves this hold is theirs to give up.
    const booking = await BookingModel.findOne({ holdToken, status: 'hold' })
    if (!booking) {
      // Already paid, already expired, or never existed — all fine, and none of the caller's business.
      res.json({ ok: true })
      return
    }

    await cancelBooking({
      bookingId: booking._id,
      reason: 'Checkout abandoned',
      by: 'student',
      enforceCutoff: false,
      notify: false,
    })

    res.json({ ok: true })
  }),
)

/** The "My bookings" list, with a live reschedule deadline on each row. */
bookingRouter.get(
  '/mine',
  requireStudent,
  asyncRoute(async (req, res) => {
    const student = req.student!
    const rows = await listStudentBookings(student._id, { includePast: req.query.includePast === 'true' })

    const courseIds = [...new Set(rows.map((r) => String(r.session.courseTypeId)))]
    const courses = await CourseTypeModel.find({ _id: { $in: courseIds } }).lean()
    const courseById = new Map(courses.map((c) => [String(c._id), c]))
    const now = new Date()

    const bookings = rows.map((row) => {
      const course = courseById.get(String(row.session.courseTypeId))
      const verdict = course
        ? evaluateReschedule(
            {
              booking: { status: row.booking.status },
              session: { startAt: row.session.startAt, status: row.session.status },
              courseType: { rescheduleCutoffHours: course.rescheduleCutoffHours, name: course.name },
            },
            now,
          )
        : null

      return {
        id: String(row.booking._id),
        status: row.booking.status,
        session: course
          ? toPublicSession(row.session, course)
          : { id: String(row.session._id), startAt: row.session.startAt.toISOString() },
        canReschedule: verdict?.allowed ?? false,
        rescheduleDeadline: verdict?.deadline?.toISOString() ?? null,
        rescheduleBlockedReason: verdict?.allowed ? null : (verdict?.message ?? null),
      }
    })

    res.json({ bookings, packages: await summarisePackages(student._id) })
  }),
)

/**
 * A student's own record.
 *
 * Their email is deliberately not editable here: it is the identity their sign-in links and
 * every confirmation depend on, so changing it is a conversation with the studio rather than a
 * form field they can get wrong and lock themselves out with.
 */
bookingRouter.patch(
  '/me',
  requireStudent,
  asyncRoute(async (req, res) => {
    const input = studentSelfUpdateSchema.parse(req.body)

    const student = await StudentModel.findByIdAndUpdate(
      req.student!._id,
      { $set: { name: input.name, phone: input.phone, marketingOptIn: input.marketingOptIn } },
      { new: true },
    )
    if (!student) throw new NotFoundError('Student')

    res.json({
      student: {
        id: String(student._id),
        name: student.name,
        email: student.email,
        phone: student.phone,
        marketingOptIn: student.marketingOptIn,
      },
    })
  }),
)

/** Classes a student has already had, so their own history is theirs to look at. */
bookingRouter.get(
  '/history',
  requireStudent,
  asyncRoute(async (req, res) => {
    const rows = await listStudentBookings(req.student!._id, { includePast: true })
    const now = new Date()

    const courses = await CourseTypeModel.find().lean()
    const courseById = new Map(courses.map((c) => [String(c._id), c]))

    const past = rows
      .filter((row) => row.session.startAt < now)
      .sort((a, b) => b.session.startAt.getTime() - a.session.startAt.getTime())

    res.json({
      classes: past.map((row) => {
        const course = courseById.get(String(row.session.courseTypeId))
        return {
          id: String(row.booking._id),
          status: row.booking.status,
          title: row.session.title || course?.name || 'Class',
          courseName: course?.name ?? '',
          colour: course?.colour ?? '#94a3b8',
          startAt: row.session.startAt.toISOString(),
          endAt: row.session.endAt.toISOString(),
          durationMins: Math.round((row.session.endAt.getTime() - row.session.startAt.getTime()) / 60_000),
        }
      }),
      totals: {
        attended: past.filter((r) => r.booking.status === 'attended').length,
        total: past.length,
      },
    })
  }),
)

/**
 * A calendar invitation for one booking, so a student can add a class to their phone at any
 * time rather than only from the confirmation email they may have deleted.
 */
bookingRouter.get(
  '/:id/calendar.ics',
  requireStudent,
  asyncRoute(async (req, res) => {
    await assertOwnBooking(req.student!._id, req.params.id!)

    const booking = await BookingModel.findById(req.params.id).select('sessionId').lean()
    const ics = booking ? await buildIcs(String(booking.sessionId)) : null
    if (!ics) throw new NotFoundError('Calendar invitation')

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8')
    res.setHeader('Content-Disposition', 'attachment; filename="mizuki-class.ics"')
    res.send(ics)
  }),
)

bookingRouter.post(
  '/reschedule',
  bookingLimiter,
  requireStudent,
  asyncRoute(async (req, res) => {
    const input = rescheduleBookingSchema.parse(req.body)
    await assertOwnBooking(req.student!._id, input.bookingId)

    const result = await rescheduleBooking({
      bookingId: input.bookingId,
      toSessionId: input.toSessionId,
      by: `student:${req.student!.email}`,
      // Students are held to their course's notice period; the studio can override in the console.
      enforceCutoff: true,
    })

    res.json({ booking: serialiseBooking(result.booking, result.session, result.courseType) })
  }),
)

bookingRouter.post(
  '/cancel',
  bookingLimiter,
  requireStudent,
  asyncRoute(async (req, res) => {
    const input = cancelBookingSchema.parse(req.body)
    await assertOwnBooking(req.student!._id, input.bookingId)

    await cancelBooking({
      bookingId: input.bookingId,
      reason: input.reason,
      by: `student:${req.student!.email}`,
      enforceCutoff: true,
    })

    res.json({ ok: true })
  }),
)

async function assertOwnBooking(studentId: unknown, bookingId: string): Promise<void> {
  const booking = await BookingModel.findById(bookingId).select('studentId')
  if (!booking) throw new NotFoundError('Booking')
  if (String(booking.studentId) !== String(studentId)) {
    // Deliberately the same shape as a missing booking — do not confirm that someone
    // else's booking id is real.
    throw new ForbiddenError('That booking does not belong to this account.')
  }
}

function serialiseBooking(
  booking: { _id: unknown; status: string },
  session: Parameters<typeof toPublicSession>[0],
  courseType: CourseTypeDoc,
) {
  return {
    id: String(booking._id),
    status: booking.status,
    session: toPublicSession(session, courseType),
  }
}
