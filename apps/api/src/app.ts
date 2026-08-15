import path from 'node:path'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import express, { type Express } from 'express'
import helmet from 'helmet'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import mongoose from 'mongoose'
import { publicRouter } from './routes/public.js'
import { authRouter } from './routes/auth.js'
import { bookingRouter } from './routes/bookings.js'
import { adminSessionsRouter } from './routes/admin/sessions.js'
import { adminStudentsRouter } from './routes/admin/students.js'
import { adminClosedDatesRouter } from './routes/admin/closedDates.js'
import { adminSettingsRouter } from './routes/admin/settings.js'
import { adminNotificationsRouter } from './routes/admin/notifications.js'
import { adminAdminsRouter } from './routes/admin/admins.js'
import { jobsRouter } from './routes/jobs.js'
import { wooRouter } from './routes/woo.js'
import { requireAdmin } from './middleware/auth.js'
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js'
import { config } from './config.js'
import { schedulerStatus } from './scheduler.js'
import { logger } from './logger.js'

export function createApp(): Express {
  const app = express()

  // Hostinger terminates TLS in front of the Node app, so trust its forwarded headers —
  // otherwise every request looks like it came from the proxy and rate limiting is useless.
  app.set('trust proxy', 1)

  app.use(
    helmet({
      // The booking widget is embedded in the WordPress site on another origin.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: config.isProduction ? undefined : false,
    }),
  )

  /*
   * The API's own origin is always allowed, because it serves the studio console: a browser
   * posting from /admin sends Origin: https://api.mizuki.com.sg, and requiring the operator to
   * remember that in CORS_ORIGINS is a trap — miss it and sign-in fails with an error that says
   * nothing about the cause.
   */
  const allowedOrigins = new Set(config.corsOrigins)
  try {
    allowedOrigins.add(new URL(config.PUBLIC_API_URL).origin)
  } catch {
    // PUBLIC_API_URL is validated as a URL at boot, so this cannot realistically happen.
  }

  app.use(
    cors({
      origin(origin, callback) {
        // Same-origin navigations and server-to-server calls arrive without an Origin header.
        if (!origin) return callback(null, true)
        if (config.corsOrigins.length === 0 || allowedOrigins.has(origin)) {
          return callback(null, true)
        }
        // Refuse without throwing: cors() turns a thrown error into an opaque 500, which hides
        // a configuration mistake behind "something went wrong on our side". The request still
        // fails, but the browser reports it as the CORS problem it actually is.
        logger.warn({ origin, allowed: [...allowedOrigins] }, 'Rejected a cross-origin request')
        callback(null, false)
      },
      // The student session cookie has to ride along from the WordPress site.
      credentials: true,
    }),
  )

  app.use(
    express.json({
      limit: '1mb',
      // Keep the exact bytes so the WooCommerce signature can be verified against what was
      // actually sent. Re-serialising the parsed object would produce different bytes and
      // every legitimate callback would fail.
      verify: (req, _res, buf) => {
        ;(req as { rawBody?: Buffer }).rawBody = buf
      },
    }),
  )
  app.use(cookieParser())

  app.get('/health', (_req, res) => {
    const dbUp = mongoose.connection.readyState === 1
    const scheduler = schedulerStatus()

    // A scheduler that has quietly stopped looks identical to one that is working, so its
    // staleness is reported here rather than left to be noticed when a reminder does not arrive.
    const scheduledWorkStale =
      scheduler.enabled && scheduler.minutesSinceLastRun !== null && scheduler.minutesSinceLastRun > 30

    res.status(dbUp ? 200 : 503).json({
      ok: dbUp,
      db: dbUp ? 'connected' : 'disconnected',
      scheduler: {
        enabled: scheduler.enabled,
        lastRunAt: scheduler.lastRunAt,
        minutesSinceLastRun: scheduler.minutesSinceLastRun,
        stale: scheduledWorkStale,
        ...(scheduler.lastError ? { lastError: scheduler.lastError } : {}),
      },
      now: new Date().toISOString(),
    })
  })

  app.use('/api/public', publicRouter)
  app.use('/api/auth', authRouter)
  app.use('/api/bookings', bookingRouter)
  app.use('/api/jobs', jobsRouter)
  app.use('/api/woo', wooRouter)

  app.use('/api/admin/sessions', requireAdmin, adminSessionsRouter)
  app.use('/api/admin/students', requireAdmin, adminStudentsRouter)
  app.use('/api/admin/closed-dates', requireAdmin, adminClosedDatesRouter)
  app.use('/api/admin/settings', requireAdmin, adminSettingsRouter)
  app.use('/api/admin/notifications', requireAdmin, adminNotificationsRouter)
  app.use('/api/admin/admins', requireAdmin, adminAdminsRouter)

  mountFlags(app)
  mountAdminConsole(app)

  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}

/**
 * Serve the flat country flags at /flags/sg.svg.
 *
 * Flags appear in two places — the country picker on the booking form, and beside a foreign phone
 * number in the console — and both need the same picture. Serving them from here rather than
 * bundling them means the widget stays one small file: at most one flag is ever on screen, so the
 * browser fetches one 1KB SVG instead of the student downloading all two hundred.
 *
 * The artwork comes straight from the installed package rather than a copy in this repository, so
 * there is nothing to keep in step by hand. Anything that fails to load falls back to the country
 * code in the interface, which is why a missing folder here is a warning and not a failure.
 */
function mountFlags(app: Express): void {
  let dir: string
  try {
    const require = createRequire(import.meta.url)
    dir = path.join(path.dirname(require.resolve('flag-icons/package.json')), 'flags', '4x3')
  } catch {
    logger.warn('Country flags are not installed — the picker will show country codes instead')
    return
  }

  if (!existsSync(dir)) {
    logger.warn({ dir }, 'Country flags are not installed — the picker will show country codes instead')
    return
  }

  app.use(
    '/flags',
    express.static(dir, {
      index: false,
      // A country's flag is the same picture tomorrow, and the filename is the country code, so
      // there is no version to bust — a year in the browser cache costs one request per student.
      maxAge: '365d',
      immutable: true,
    }),
  )
}

/**
 * Serve the studio console at /admin from the same process as the API.
 *
 * One origin for both means the admin session cookie is same-site, which avoids the
 * third-party-cookie restrictions that would otherwise make signing in fragile — and it means
 * the studio has one address to remember rather than two.
 *
 * Skipped when the build output is absent: in development the console runs on its own Vite
 * server with hot reload, and a missing folder there is normal rather than a misconfiguration.
 */
function mountAdminConsole(app: Express): void {
  const distDir = config.ADMIN_DIST_DIR
    ? path.resolve(config.ADMIN_DIST_DIR)
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../admin/dist')

  if (!existsSync(path.join(distDir, 'index.html'))) {
    logger.warn({ distDir }, 'Admin console build not found — /admin will not be served')
    return
  }

  // Hashed asset filenames can be cached hard; index.html and the service worker must not be,
  // or a deploy leaves the studio on the previous version until they clear their browser.
  app.use(
    '/admin',
    express.static(distDir, {
      index: false,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('index.html') || filePath.endsWith('sw.js')) {
          res.setHeader('Cache-Control', 'no-cache')
        } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
        }
      },
    }),
  )

  // The console is a single-page app: /admin/calendar is a client-side route, not a file, so
  // anything that is not a real asset has to return the shell for the router to take over.
  app.get(/^\/admin(\/.*)?$/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache')
    res.sendFile(path.join(distDir, 'index.html'))
  })

  logger.info({ distDir }, 'Serving the studio console at /admin')
}
