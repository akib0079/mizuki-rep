import { Router } from 'express'
import { buildProgramme, listProgrammes } from '../../services/programmeService.js'
import { asyncRoute } from '../../middleware/errorHandler.js'

/** Courses run as programmes, each with its own section of the console. */
export const adminProgrammesRouter: Router = Router()

/**
 * The programmes themselves, for the console's navigation.
 *
 * Declared above `/:id` so the word "list" could never be read as a course id — see
 * routeOrder.test.ts for what that mistake costs.
 */
adminProgrammesRouter.get(
  '/',
  asyncRoute(async (_req, res) => {
    res.json({ programmes: await listProgrammes() })
  }),
)

/** Everything one programme's page shows, in one call. */
adminProgrammesRouter.get(
  '/:id',
  asyncRoute(async (req, res) => {
    res.json(await buildProgramme(req.params.id!))
  }),
)
