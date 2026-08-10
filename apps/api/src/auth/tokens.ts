import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'
import { config } from '../config.js'

/**
 * Two separate audiences share one signing secret but can never be swapped for one another:
 * a student session must not open the admin console, so the audience claim is checked on verify.
 */

const STUDENT_AUDIENCE = 'mizuki:student'
const ADMIN_AUDIENCE = 'mizuki:admin'

/** Long enough that students rarely re-authenticate — the studio's audience is small and repeat. */
export const STUDENT_SESSION_DAYS = 90
export const ADMIN_SESSION_HOURS = 12

export interface StudentClaims {
  sub: string
  email: string
}

export interface AdminClaims {
  sub: string
  email: string
  role: string
  /** Bumped on the user record to invalidate every issued token at once. */
  v: number
}

export function signStudentToken(claims: StudentClaims): string {
  return jwt.sign(claims, config.JWT_SECRET, {
    audience: STUDENT_AUDIENCE,
    expiresIn: `${STUDENT_SESSION_DAYS}d`,
  })
}

export function verifyStudentToken(token: string): StudentClaims {
  return jwt.verify(token, config.JWT_SECRET, { audience: STUDENT_AUDIENCE }) as StudentClaims
}

export function signAdminToken(claims: AdminClaims): string {
  return jwt.sign(claims, config.JWT_SECRET, {
    audience: ADMIN_AUDIENCE,
    expiresIn: `${ADMIN_SESSION_HOURS}h`,
  })
}

export function verifyAdminToken(token: string): AdminClaims {
  return jwt.verify(token, config.JWT_SECRET, { audience: ADMIN_AUDIENCE }) as AdminClaims
}

/**
 * Magic-link tokens are random, single-use and stored only as a hash — a database dump
 * must not be replayable into a student's account.
 */
export function generateMagicToken(): { token: string; tokenHash: string } {
  const token = crypto.randomBytes(32).toString('base64url')
  return { token, tokenHash: hashToken(token) }
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

/** Opaque handle a student's browser carries through WooCommerce checkout and back. */
export function generateHoldToken(): string {
  return crypto.randomBytes(24).toString('base64url')
}

/** Constant-time compare, for signatures and secrets where an early exit leaks length. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return crypto.timingSafeEqual(bufA, bufB)
}

export const COOKIE_NAMES = {
  student: 'mizuki_student',
  admin: 'mizuki_admin',
} as const

export function cookieOptions(maxAgeMs: number) {
  return {
    httpOnly: true,
    secure: config.isProduction,
    // The widget is embedded in WordPress on a different host from the API, so the student
    // cookie has to survive a cross-site request. `none` requires `secure`, hence production only.
    sameSite: config.isProduction ? ('none' as const) : ('lax' as const),
    maxAge: maxAgeMs,
    path: '/',
  }
}
