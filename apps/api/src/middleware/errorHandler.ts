import type { NextFunction, Request, Response } from 'express'
import { ZodError } from 'zod'
import { AppError } from '../errors.js'
import { isDuplicateKeyError } from '../services/transaction.js'
import { logger } from '../logger.js'
import { config } from '../config.js'

/** Wraps an async route so a rejected promise reaches the error handler instead of hanging. */
export function asyncRoute<T extends Request>(
  fn: (req: T, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req as T, res, next).catch(next)
  }
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: { code: 'not_found', message: 'That endpoint does not exist.' } })
}

/**
 * One JSON shape for every failure: `{ error: { code, message, details? } }`.
 *
 * Only `AppError` messages reach the caller. Anything unexpected becomes a generic message,
 * because a raw Mongo or driver error can carry connection strings and field values.
 */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'validation_error',
        message: 'Please check the highlighted fields.',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    })
    return
  }

  if (err instanceof AppError) {
    // 4xx is the caller's problem and is expected traffic; 5xx is ours.
    const level = err.status >= 500 ? 'error' : 'debug'
    logger[level]({ err, path: req.path, code: err.code }, 'Request failed')
    res.status(err.status).json({
      error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) },
    })
    return
  }

  if (isDuplicateKeyError(err)) {
    res.status(409).json({
      error: { code: 'duplicate', message: 'That already exists.' },
    })
    return
  }

  logger.error({ err, path: req.path, method: req.method }, 'Unhandled error')
  res.status(500).json({
    error: {
      code: 'internal_error',
      message: 'Something went wrong on our side. Please try again.',
      ...(config.isProduction ? {} : { details: String(err) }),
    },
  })
}
