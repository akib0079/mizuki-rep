import crypto from 'node:crypto'
import { Router } from 'express'
import { z } from 'zod'
import { formatSessionDateTime, seatsLeft } from '@mizuki/shared'
import { BookingModel, CourseTypeModel, PackageModel, SessionModel, StudentModel } from '../models/index.js'
import { confirmHold, createBooking, cancelBooking } from '../services/bookingService.js'
import { grantSessions } from '../services/packageService.js'
import { bookSeries, findSeriesByProduct } from '../services/seriesService.js'
import { queueMessage } from '../services/notificationService.js'
import { safeEqual } from '../auth/tokens.js'
import { asyncRoute } from '../middleware/errorHandler.js'
import { ForbiddenError } from '../errors.js'
import { SessionFullError } from '../errors.js'
import { config } from '../config.js'
import { logger } from '../logger.js'

/**
 * What WooCommerce reports back after a paid workshop goes through checkout.
 *
 * "Paid workshops go through your existing shop as they do now. Places are held during checkout
 * and released automatically if payment isn't completed." This endpoint closes that loop: the
 * hold becomes a confirmed place when the money lands.
 *
 * The WordPress plugin signs each call with a shared secret. Without that, anyone who guessed
 * the URL could confirm themselves into a full class for free.
 */
export const wooRouter: Router = Router()

/**
 * `sessionId` is optional because not every line is a class. A course package is an ordinary
 * shop product with no date attached; the plugin sends every line and this end decides which
 * ones mean something.
 */
const lineSchema = z.object({
  sessionId: z.string().default(''),
  holdToken: z.string().default(''),
  productId: z.number().int().nonnegative().optional(),
  quantity: z.number().int().positive().default(1),
})

const orderPayloadSchema = z.object({
  event: z.enum(['paid', 'cancelled', 'refunded']),
  orderId: z.number().int().positive(),
  status: z.string(),
  customer: z.object({
    email: z.string().email(),
    name: z.string().default(''),
    phone: z.string().default(''),
    wooId: z.number().int().nonnegative().default(0),
  }),
  lines: z.array(lineSchema).min(1),
  timestamp: z.number().int().optional(),
})

/**
 * The signature covers the exact bytes WordPress sent, so it has to be checked against the raw
 * body — re-serialising the parsed JSON would produce different bytes and never match.
 */
wooRouter.post(
  '/order',
  asyncRoute(async (req, res) => {
    if (!config.WOO_WEBHOOK_SECRET) {
      throw new ForbiddenError('Shop integration is not configured.')
    }

    const provided = req.headers['x-mizuki-signature']
    const raw = (req as { rawBody?: Buffer }).rawBody
    if (typeof provided !== 'string' || !raw) {
      throw new ForbiddenError('Missing signature.')
    }

    const expected = crypto.createHmac('sha256', config.WOO_WEBHOOK_SECRET).update(raw).digest('hex')
    if (!safeEqual(provided, expected)) {
      logger.warn({ orderId: req.body?.orderId }, 'Rejected a shop callback with a bad signature')
      throw new ForbiddenError('Invalid signature.')
    }

    const payload = orderPayloadSchema.parse(req.body)

    if (payload.event === 'paid') {
      const result = await confirmPaidOrder(payload)
      res.json(result)
      return
    }

    const released = await releaseOrder(payload)
    res.json({ ok: true, released })
  }),
)

type OrderPayload = z.infer<typeof orderPayloadSchema>

async function confirmPaidOrder(payload: OrderPayload) {
  const confirmed: string[] = []
  const granted: string[] = []
  const problems: { sessionId: string; reason: string }[] = []

  for (const line of payload.lines) {
    try {
      /*
       * A set course such as the Autumn Ikebana Course: one purchase books every date in it.
       * Checked before the single-class path, because the order line carries the course
       * product rather than any one session.
       */
      const series = line.productId ? await findSeriesByProduct(line.productId) : null
      if (series) {
        const alreadyBooked = await BookingModel.findOne({
          wooOrderId: payload.orderId,
          sessionId: { $in: series.sessionIds },
          status: { $in: ['confirmed', 'attended'] },
        })
        if (alreadyBooked) {
          confirmed.push(String(alreadyBooked._id))
          continue
        }

        const student = await findOrCreateStudent(payload)
        const booked = await bookSeries({
          seriesId: series._id,
          studentId: student._id,
          source: 'woo_order',
          wooOrderId: payload.orderId,
          actor: `woo:order:${payload.orderId}`,
        })
        confirmed.push(...booked.bookings.map((b) => String(b._id)))
        continue
      }

      /*
       * A course package: the student bought a block of IFDA or Preserved Flower sessions
       * rather than one class. Grant the credits and move on — there is no seat to reserve.
       */
      const packageCourse = line.productId ? await findPackageCourse(line.productId) : null
      if (packageCourse) {
        const pkg = await grantPackageFromOrder(payload, line, packageCourse)
        if (pkg) granted.push(String(pkg._id))
        continue
      }

      // Not a class and not a package — a vase, a bouquet, anything else in the shop.
      if (!line.sessionId) continue

      // The happy path: the hold this student was given is still alive, so just confirm it.
      const held = line.holdToken
        ? await BookingModel.findOne({ holdToken: line.holdToken, status: 'hold' })
        : null

      if (held) {
        await confirmHold(held._id, payload.orderId)
        confirmed.push(String(held._id))
        continue
      }

      // Already confirmed — a repeated callback, which WooCommerce does send. Not an error.
      const existing = line.holdToken
        ? await BookingModel.findOne({ holdToken: line.holdToken, status: 'confirmed' })
        : null
      if (existing) {
        confirmed.push(String(existing._id))
        continue
      }

      /*
       * No live hold. Either it expired while the student was paying, or the order was placed
       * without going through the calendar. Try to seat them anyway — but through the normal
       * booking path, so the capacity guard still applies. Payment does not buy an extra chair.
       */
      const student = await findOrCreateStudent(payload)
      const result = await createBooking({
        sessionId: line.sessionId,
        studentId: student._id,
        source: 'woo_order',
        usePackage: false,
        wooOrderId: payload.orderId,
        actor: `woo:order:${payload.orderId}`,
      })
      confirmed.push(String(result.booking._id))
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      problems.push({ sessionId: line.sessionId, reason })

      if (err instanceof SessionFullError) {
        // The worst case for a customer: they paid and there is no place. Never overbook to
        // paper over it — raise it loudly so the studio can refund or offer another date.
        await alertPaidButFull(payload, line.sessionId)
      } else {
        logger.error({ err, orderId: payload.orderId, sessionId: line.sessionId }, 'Could not confirm a paid place')
      }
    }
  }

  return { ok: problems.length === 0, confirmed, granted, problems }
}

/** A product that sells a block of course sessions rather than a place in one class. */
async function findPackageCourse(productId: number) {
  return CourseTypeModel.findOne({
    wooProductIds: productId,
    bookingMode: 'package',
    packageGrantSessions: { $gt: 0 },
  })
}

/**
 * Turn a paid package purchase into course credits.
 *
 * Idempotent on (order, course): WooCommerce sends `processing` and then `completed` for the
 * same order, and a studio marking an order complete by hand fires it again. Granting twice
 * would hand the student a second set of sessions they never paid for.
 */
async function grantPackageFromOrder(
  payload: OrderPayload,
  line: z.infer<typeof lineSchema>,
  course: NonNullable<Awaited<ReturnType<typeof findPackageCourse>>>,
) {
  const existing = await PackageModel.findOne({ sourceOrderId: payload.orderId, courseTypeId: course._id })
  if (existing) {
    logger.debug({ orderId: payload.orderId, course: course.name }, 'Package already granted for this order')
    return existing
  }

  const student = await findOrCreateStudent(payload)

  // Buying two blocks gets two blocks' worth of sessions.
  const sessions = course.packageGrantSessions * line.quantity
  const expiresAt =
    course.packageValidityDays > 0
      ? new Date(Date.now() + course.packageValidityDays * 24 * 3600_000)
      : null

  const pkg = await grantSessions({
    studentId: student._id,
    courseTypeId: course._id,
    totalSessions: sessions,
    expiresAt,
    note: `Purchased in order #${payload.orderId}`,
    by: `woo:order:${payload.orderId}`,
    sourceOrderId: payload.orderId,
  })

  logger.info(
    { orderId: payload.orderId, student: student.email, course: course.name, sessions },
    'Granted a course package from a shop order',
  )

  await notifyPackageGranted(student, course, pkg)
  return pkg
}

/** Tell the student their sessions are ready, and the studio that a package sold. */
async function notifyPackageGranted(
  student: Awaited<ReturnType<typeof findOrCreateStudent>>,
  course: NonNullable<Awaited<ReturnType<typeof findPackageCourse>>>,
  pkg: { _id: unknown; totalSessions: number; expiresAt?: Date | null },
) {
  const expiryLine = pkg.expiresAt
    ? ` They are valid until ${formatSessionDateTime(pkg.expiresAt).split(',')[0]}.`
    : ''

  await queueMessage('package_granted', {
    dedupeKey: `package_granted:${pkg._id}`,
    to: student.email,
    subject: `Your ${course.name} course is ready to book`,
    bodyText: `Hello ${student.name},\n\nThank you — your ${course.name} course package is ready. You have ${pkg.totalSessions} sessions to use.${expiryLine}\n\nBook your dates: ${config.PUBLIC_SITE_URL}/book\n\nMizuki Flora`,
    bodyHtml: `<p>Hello ${student.name},</p><p>Thank you — your <strong>${course.name}</strong> course package is ready. You have <strong>${pkg.totalSessions}</strong> sessions to use.${expiryLine}</p><p><a href="${config.PUBLIC_SITE_URL}/book">Book your dates</a></p><p>Mizuki Flora</p>`,
  })

  if (config.ADMIN_ALERT_EMAIL) {
    await queueMessage('admin_package_sold', {
      dedupeKey: `admin_package_sold:${pkg._id}`,
      to: config.ADMIN_ALERT_EMAIL,
      subject: `Course package sold: ${student.name} — ${course.name}`,
      bodyText: `${student.name} (${student.email}) bought a ${course.name} package of ${pkg.totalSessions} sessions.`,
      bodyHtml: `<p><strong>${student.name}</strong> (${student.email}) bought a ${course.name} package of ${pkg.totalSessions} sessions.</p>`,
    })
  }
}

async function releaseOrder(payload: OrderPayload): Promise<number> {
  const bookings = await BookingModel.find({
    wooOrderId: payload.orderId,
    status: { $in: ['hold', 'confirmed'] },
  })

  let released = 0
  for (const booking of bookings) {
    await cancelBooking({
      bookingId: booking._id,
      reason: payload.event === 'refunded' ? 'Order refunded' : 'Order cancelled',
      by: `woo:order:${payload.orderId}`,
      enforceCutoff: false,
    })
    released++
  }

  return released
}

async function findOrCreateStudent(payload: OrderPayload) {
  const email = payload.customer.email.toLowerCase()
  const existing = await StudentModel.findOne({ email })
  if (existing) {
    if (!existing.phone && payload.customer.phone) {
      existing.phone = payload.customer.phone
      await existing.save()
    }
    return existing
  }

  return StudentModel.create({
    name: payload.customer.name || email,
    email,
    phone: payload.customer.phone,
    wooCustomerId: payload.customer.wooId || null,
  })
}

/** A high-priority alert: money taken, no place available. Needs a human, fast. */
async function alertPaidButFull(payload: OrderPayload, sessionId: string): Promise<void> {
  const session = await SessionModel.findById(sessionId)
  const course = session ? await CourseTypeModel.findById(session.courseTypeId) : null

  const description = session
    ? `${session.title || course?.name || 'Class'} on ${session.dateKey} (${seatsLeft(session)} places left)`
    : `class ${sessionId}`

  const line = `⚠️ PAID BUT NO PLACE\n\nOrder #${payload.orderId} from ${payload.customer.email} paid for ${description}, but it filled up before payment completed.\n\nNobody has been overbooked. Please refund the order or offer another date.`

  logger.error({ orderId: payload.orderId, sessionId }, 'Payment received for a class that is now full')

  /*
   * Recorded unconditionally, unlike every other alert.
   *
   * This is the one case where someone has paid and has no place, and it needs a human within
   * the hour. Gating it on ADMIN_ALERT_EMAIL being configured would mean the most urgent message
   * in the system is the one most likely to vanish — so the Outbox row is always written, and
   * delivery is what depends on configuration. An undelivered row still surfaces in the console.
   */
  await queueMessage('admin_paid_but_full', {
    dedupeKey: `admin_paid_but_full:${payload.orderId}:${sessionId}`,
    to: config.ADMIN_ALERT_EMAIL ?? '',
    subject: `Action needed: order #${payload.orderId} paid for a full class`,
    bodyText: line,
    bodyHtml: `<p style="font-weight:600;color:#b3382c">Payment received for a class with no places left.</p><p>${line.replace(/\n/g, '<br />')}</p>`,
    payload: { urgent: true, orderId: payload.orderId, sessionId },
  })

  if (config.TELEGRAM_BOT_TOKEN && config.TELEGRAM_CHAT_ID) {
    await queueMessage('admin_paid_but_full', {
      dedupeKey: `admin_paid_but_full:telegram:${payload.orderId}:${sessionId}`,
      channel: 'telegram',
      bodyText: line,
    })
  }
}
