import { Router } from 'express'
import { calendarQuerySchema } from '@mizuki/shared'
import { buildPublicCalendar, findAlternatives, getPublicSession } from '../services/calendarService.js'
import { CourseSeriesModel, CourseTypeModel } from '../models/index.js'
import { getSeriesAvailability } from '../services/seriesService.js'
import { asyncRoute } from '../middleware/errorHandler.js'
import { NotFoundError } from '../errors.js'
import { config } from '../config.js'

/**
 * Everything a visitor can see without signing in. No roster, no student details — just what
 * is running, when, how long it is and how many places are left.
 */
export const publicRouter: Router = Router()

publicRouter.get(
  '/courses',
  asyncRoute(async (_req, res) => {
    const courses = await CourseTypeModel.find({ active: true }).sort({ sortOrder: 1 }).lean()
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
        description: c.description,
        rescheduleCutoffHours: c.rescheduleCutoffHours,

        // The "Learn more" panel.
        suitableFor: c.suitableFor,
        whatYouLearn: c.whatYouLearn,
        whatToBring: c.whatToBring,
        whatIsProvided: c.whatIsProvided,
        priceNote: c.priceNote,
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
