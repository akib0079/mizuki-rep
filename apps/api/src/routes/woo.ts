import crypto from 'node:crypto'
import { Router } from 'express'
import { z } from 'zod'
import { seatsLeft } from '@mizuki/shared'
import { BookingModel, CourseTypeModel, SessionModel, StudentModel } from '../models/index.js'
import { confirmHold, createBooking, cancelBooking } from '../services/bookingService.js'
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

const lineSchema = z.object({
  sessionId: z.string(),
  holdToken: z.string().optional().default(''),
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
  const problems: { sessionId: string; reason: string }[] = []

  for (const line of payload.lines) {
    try {
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

  return { ok: problems.length === 0, confirmed, problems }
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
