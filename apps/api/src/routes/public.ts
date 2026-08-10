import { Router } from 'express'
import { calendarQuerySchema } from '@mizuki/shared'
import { buildPublicCalendar, findAlternatives, getPublicSession } from '../services/calendarService.js'
import { CourseTypeModel } from '../models/index.js'
import { asyncRoute } from '../middleware/errorHandler.js'
import { NotFoundError } from '../errors.js'

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
      courses: courses.map((c) => ({
        id: String(c._id),
        name: c.name,
        slug: c.slug,
        colour: c.colour,
        bookingMode: c.bookingMode,
        description: c.description,
        rescheduleCutoffHours: c.rescheduleCutoffHours,
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
