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
import { jobsRouter } from './routes/jobs.js'
import { wooRouter } from './routes/woo.js'
import { requireAdmin } from './middleware/auth.js'
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js'
import { config } from './config.js'

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

  app.use(
    cors({
      origin(origin, callback) {
        // Same-origin and server-to-server calls arrive without an Origin header.
        if (!origin) return callback(null, true)
        if (config.corsOrigins.length === 0 || config.corsOrigins.includes(origin)) {
          return callback(null, true)
        }
        callback(new Error(`Origin ${origin} is not allowed`))
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
    res.status(dbUp ? 200 : 503).json({
      ok: dbUp,
      db: dbUp ? 'connected' : 'disconnected',
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

  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}
