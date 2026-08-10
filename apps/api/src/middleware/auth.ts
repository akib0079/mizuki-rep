import type { NextFunction, Request, Response } from 'express'
import { AdminUserModel, StudentModel, type AdminUserDoc, type StudentDoc } from '../models/index.js'
import { AuthError, ForbiddenError } from '../errors.js'
import { COOKIE_NAMES, verifyAdminToken, verifyStudentToken } from '../auth/tokens.js'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      student?: StudentDoc
      admin?: AdminUserDoc
    }
  }
}

function readToken(req: Request, cookieName: string): string | null {
  const cookie = req.cookies?.[cookieName]
  if (cookie) return cookie
  const header = req.headers.authorization
  if (header?.startsWith('Bearer ')) return header.slice(7)
  return null
}

/** Attach the student if signed in, but let anonymous visitors through — the calendar is public. */
export async function optionalStudent(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = readToken(req, COOKIE_NAMES.student)
  if (!token) return next()

  try {
    const claims = verifyStudentToken(token)
    const student = await StudentModel.findById(claims.sub)
    if (student) req.student = student
  } catch {
    // An expired or tampered cookie is treated as simply not being signed in.
  }
  next()
}

export async function requireStudent(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = readToken(req, COOKIE_NAMES.student)
  if (!token) return next(new AuthError())

  try {
    const claims = verifyStudentToken(token)
    const student = await StudentModel.findById(claims.sub)
    if (!student) return next(new AuthError())
    req.student = student
    next()
  } catch {
    next(new AuthError('Your sign-in link has expired. Please request a new one.'))
  }
}

export async function requireAdmin(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = readToken(req, COOKIE_NAMES.admin)
  if (!token) return next(new AuthError())

  try {
    const claims = verifyAdminToken(token)
    const admin = await AdminUserModel.findById(claims.sub)
    if (!admin || !admin.active) return next(new AuthError())
    // A bumped token version revokes every session issued before it.
    if (admin.tokenVersion !== claims.v) return next(new AuthError('Your session has ended. Please sign in again.'))
    req.admin = admin
    next()
  } catch {
    next(new AuthError('Your session has expired. Please sign in again.'))
  }
}

export function requireOwner(req: Request, _res: Response, next: NextFunction): void {
  if (req.admin?.role !== 'owner') return next(new ForbiddenError('Only the studio owner can do that.'))
  next()
}

/** Identifies the person behind a change, for the audit log. */
export function actorOf(req: Request): string {
  if (req.admin) return `admin:${req.admin.email}`
  if (req.student) return `student:${req.student.email}`
  return 'anonymous'
}
