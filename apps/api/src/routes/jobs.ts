import { Router } from 'express'
import { runTick } from '../jobs/index.js'
import { asyncRoute } from '../middleware/errorHandler.js'
import { ForbiddenError } from '../errors.js'
import { safeEqual } from '../auth/tokens.js'
import { config } from '../config.js'
import { logger } from '../logger.js'

/**
 * The cron entry point. One hPanel job hits this every five minutes:
 *
 *   curl -fsS -X POST https://api.mizuki.com.sg/api/jobs/tick -H "X-Cron-Secret: <CRON_SECRET>"
 *
 * A signed endpoint rather than an in-process timer, because Hostinger's managed Node runtime
 * can restart an idle app — and a reminder that depends on the process having stayed awake is a
 * reminder that eventually does not arrive.
 */
export const jobsRouter: Router = Router()

/** Constant-time compare so the secret cannot be recovered a character at a time. */
function assertCronSecret(header: unknown): void {
  const provided = typeof header === 'string' ? header : ''
  if (!provided || !safeEqual(provided, config.CRON_SECRET)) {
    throw new ForbiddenError('Invalid cron secret.')
  }
}

/** Overlapping ticks are already safe, but skipping one avoids pointless duplicate work. */
let running = false

jobsRouter.post(
  '/tick',
  asyncRoute(async (req, res) => {
    assertCronSecret(req.headers['x-cron-secret'])

    if (running) {
      res.status(202).json({ skipped: true, reason: 'A tick is already running.' })
      return
    }

    running = true
    const startedAt = Date.now()
    try {
      const result = await runTick()
      logger.info({ ...result, ms: Date.now() - startedAt }, 'Cron tick complete')
      res.json({ ok: true, durationMs: Date.now() - startedAt, ...result })
    } finally {
      running = false
    }
  }),
)

/** Lets the studio confirm cron is wired up without waiting for something to happen. */
jobsRouter.get(
  '/health',
  asyncRoute(async (req, res) => {
    assertCronSecret(req.headers['x-cron-secret'])
    res.json({ ok: true, now: new Date().toISOString() })
  }),
)
