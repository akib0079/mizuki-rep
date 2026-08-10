import type { RuleCode } from '@mizuki/shared'

/** An error the student or admin is meant to read. Anything else becomes a generic 500. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export class NotFoundError extends AppError {
  constructor(what = 'Resource') {
    super(404, 'not_found', `${what} not found.`)
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(400, 'validation_error', message, details)
  }
}

export class AuthError extends AppError {
  constructor(message = 'Please sign in to continue.') {
    super(401, 'unauthenticated', message)
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to do that.') {
    super(403, 'forbidden', message)
  }
}

/**
 * The class filled up. 409 rather than 400 because nothing was wrong with the request —
 * it lost a race, and retrying with a different session is the sensible next step.
 */
export class SessionFullError extends AppError {
  constructor(message = 'Sorry — that class just filled up. Please choose another time.') {
    super(409, 'session_full', message)
  }
}

export class ConflictError extends AppError {
  constructor(code: string, message: string) {
    super(409, code, message)
  }
}

/**
 * Turns a shared rule refusal into the HTTP response, keeping the student-facing wording.
 *
 * A full class is raised as `SessionFullError` whichever layer noticed it — the cheap pre-check
 * or the atomic reservation that is the real authority. Callers catch one type for one condition;
 * they should not have to know which layer got there first.
 */
export function ruleError(code: RuleCode, message: string): AppError {
  if (code === 'session_full') return new SessionFullError(message)
  return new AppError(422, code, message)
}
