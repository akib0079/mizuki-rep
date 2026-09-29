import { Router } from 'express'
import { calendarQuerySchema } from '@mizuki/shared'
import { buildPublicCalendar, findAlternatives, getPublicSession } from '../services/calendarService.js'
import { BookingModel, CourseSeriesModel, CourseTypeModel, SessionModel } from '../models/index.js'
import { getSeriesAvailability } from '../services/seriesService.js'
import { asyncRoute } from '../middleware/errorHandler.js'
import { NotFoundError } from '../errors.js'
import { config } from '../config.js'
import { refreshWooProductSnapshots } from '../services/wooProductService.js'

/**
 * Everything a visitor can see without signing in. No roster, no student details — just what
 * is running, when, how long it is and how many places are left.
 */
export const publicRouter: Router = Router()

publicRouter.get(
  '/courses',
  asyncRoute(async (_req, res) => {
    const courses = await CourseTypeModel.find({ active: true }).sort({ sortOrder: 1 }).lean()
    await refreshWooProductSnapshots(courses)
    res.json({
      /*
       * Returned alongside the courses rather than from an endpoint of its own: the booking page
       * needs both together, and one request is one fewer thing to fail on a slow phone.
       */
      studio: {
        phone: config.STUDIO_PHONE,
        email: config.MAIL_REPLY_TO || config.STUDIO_EMAIL,
      },
      /*
       * Named one by one rather than spread, because this is the one endpoint anybody on the
       * internet can read. A course row also carries the shop product ids and the studio's
       * package rules, and a spread would publish them the moment either was added.
       */
      courses: courses.map((c) => ({
        id: String(c._id),
        name: c.name,
        slug: c.slug,
        colour: c.colour,
        bookingMode: c.bookingMode,
        checkoutFlow: c.checkoutFlow,
        description: c.description,
        rescheduleCutoffHours: c.rescheduleCutoffHours,

        // The "Learn more" panel.
        suitableFor: c.suitableFor,
        whatYouLearn: c.whatYouLearn,
        whatToBring: c.whatToBring,
        whatIsProvided: c.whatIsProvided,
        priceNote: c.priceNote,
        priceText: c.wooPriceText,
        productName: c.wooProductName,
        productUrl: c.wooProductUrl,
        imageUrl: c.imageUrl,
      })),
    })
  }),
)

/** The three-month calendar the widget renders. */
publicRouter.get(
  '/calendar',
  asyncRoute(async (req, res) => {
    const query = calendarQuerySchema.parse(req.query)
    const calendar = await buildPublicCalendar(query)
    res.json(calendar)
  }),
)

publicRouter.get(
  '/sessions/:id',
  asyncRoute(async (req, res) => {
    const session = await getPublicSession(req.params.id!)
    if (!session) throw new NotFoundError('Class')
    res.json({ session })
  }),
)

/**
 * WooCommerce checks this immediately before placing a calendar product in the cart.
 * The random hold token is a short lived capability; no student details are returned.
 */
publicRouter.get(
  '/holds/:token/checkout',
  asyncRoute(async (req, res) => {
    const { token } = req.params
    const sessionId = String(req.query.sessionId ?? '')
    const productId = Number(req.query.productId)
    const quantity = Number(req.query.quantity)
    if (!/^[A-Za-z0-9_-]{32}$/.test(token ?? '') || !/^[a-f0-9]{24}$/i.test(sessionId) ||
        !Number.isSafeInteger(productId) || productId <= 0 ||
        !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 10) {
      res.json({ valid: false })
      return
    }
    const hold = await BookingModel.findOne({
      holdToken: token,
      sessionId,
      status: 'hold',
      holdExpiresAt: { $gt: new Date() },
      partySize: quantity,
    }).select('sessionId').lean()
    if (!hold) {
      res.json({ valid: false })
      return
    }
    const session = await SessionModel.findById(sessionId).select('courseTypeId').lean()
    const course = session ? await CourseTypeModel.findById(session.courseTypeId).select('bookingMode wooProductIds').lean() : null
    res.json({ valid: course?.bookingMode === 'paid' && course.wooProductIds.includes(productId) })
  }),
)

/**
 * Set courses sold as one purchase, like the Autumn Ikebana Course. Shown separately from the
 * day-by-day calendar because you book the whole run, not a date.
 */
publicRouter.get(
  '/series',
  asyncRoute(async (_req, res) => {
    const all = await CourseSeriesModel.find({ active: true }).lean()
    const availability = await Promise.all(all.map((s) => getSeriesAvailability(s._id)))
    res.json({ series: availability })
  }),
)

publicRouter.get(
  '/series/:id',
  asyncRoute(async (req, res) => {
    res.json({ series: await getSeriesAvailability(req.params.id!) })
  }),
)

/** Other dates for the same course — offered when a class is full or a student is moving. */
publicRouter.get(
  '/sessions/:id/alternatives',
  asyncRoute(async (req, res) => {
    const session = await getPublicSession(req.params.id!)
    if (!session) throw new NotFoundError('Class')

    const alternatives = await findAlternatives(session.courseTypeId, {
      excludeSessionId: req.params.id!,
      limit: 20,
    })
    res.json({ alternatives })
  }),
)
