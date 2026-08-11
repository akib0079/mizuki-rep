import { runTick } from './jobs/index.js'
import { config } from './config.js'
import { logger } from './logger.js'

/**
 * The app schedules its own work.
 *
 * Originally this relied on an external cron hitting /api/jobs/tick, on the reasoning that a
 * managed host might suspend an idle process. In practice that turned out to be the wrong
 * trade: setting up external cron is a manual step that is easy to get wrong, easy to point at
 * the wrong machine, and silent when it fails — and a studio whose reminders quietly stopped
 * would have no way of knowing.
 *
 * An in-process timer needs no setup and starts with the app. The HTTP endpoint stays, so an
 * external cron can still be added as a second line of defence: every job is idempotent and a
 * run in progress is skipped, so both firing at once is harmless.
 */

let timer: NodeJS.Timeout | null = null
let running = false
let lastRunAt: Date | null = null
let lastError: string | null = null
let consecutiveFailures = 0

export function startScheduler(): void {
  if (!config.SCHEDULER_ENABLED) {
    logger.warn('Internal scheduler is disabled — reminders and backups need an external cron hitting /api/jobs/tick')
    return
  }

  const intervalMs = config.SCHEDULER_INTERVAL_MINUTES * 60_000

  // A short delay so the first run does not compete with startup: connecting, index sync and
  // whatever traffic arrives the moment the port opens.
  setTimeout(() => void tick(), 20_000)

  timer = setInterval(() => void tick(), intervalMs)
  // Do not hold the process open purely for the timer during shutdown.
  timer.unref()

  logger.info(
    { everyMinutes: config.SCHEDULER_INTERVAL_MINUTES },
    'Internal scheduler started — reminders, holds, calendar and backups run automatically',
  )
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer)
  timer = null
}

async function tick(): Promise<void> {
  // Overlap is already safe — every job is idempotent — but a second concurrent pass is pure
  // waste, and on a shared host that waste is someone else's latency.
  if (running) {
    logger.debug('Scheduled run skipped — the previous one is still going')
    return
  }

  running = true
  const startedAt = Date.now()

  try {
    const result = await runTick()
    lastRunAt = new Date()
    lastError = null
    consecutiveFailures = 0

    // Only worth a line in the log when something actually happened. A studio reading these
    // should see events, not a heartbeat every five minutes.
    const didSomething =
      result.holdsExpired > 0 ||
      result.remindersQueued > 0 ||
      result.sessionsGenerated > 0 ||
      result.backedUp ||
      result.mail.sent > 0 ||
      result.mail.failed > 0

    if (didSomething) {
      logger.info({ ...result, ms: Date.now() - startedAt }, 'Scheduled run')
    } else {
      logger.debug({ ms: Date.now() - startedAt }, 'Scheduled run — nothing to do')
    }
  } catch (err) {
    consecutiveFailures++
    lastError = err instanceof Error ? err.message : String(err)
    logger.error({ err, consecutiveFailures }, 'Scheduled run failed')
  } finally {
    running = false
  }
}

export interface SchedulerStatus {
  enabled: boolean
  everyMinutes: number
  running: boolean
  lastRunAt: string | null
  minutesSinceLastRun: number | null
  lastError: string | null
  consecutiveFailures: number
}

/** Surfaced in the console, so a scheduler that has quietly stopped is visible rather than assumed. */
export function schedulerStatus(now: Date = new Date()): SchedulerStatus {
  return {
    enabled: config.SCHEDULER_ENABLED,
    everyMinutes: config.SCHEDULER_INTERVAL_MINUTES,
    running,
    lastRunAt: lastRunAt ? lastRunAt.toISOString() : null,
    minutesSinceLastRun: lastRunAt ? Math.round((now.getTime() - lastRunAt.getTime()) / 60_000) : null,
    lastError,
    consecutiveFailures,
  }
}
