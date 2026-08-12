import { Router } from 'express'
import { createHash, randomBytes } from 'node:crypto'
import rateLimit from 'express-rate-limit'
import argon2 from 'argon2'
import { authenticator } from 'otplib'
import { z } from 'zod'
import { emailSchema, requestMagicLinkSchema } from '@mizuki/shared'
import { AdminInviteModel, AdminUserModel, LoginTokenModel, StudentModel } from '../models/index.js'
import {
  ADMIN_SESSION_HOURS,
  COOKIE_NAMES,
  STUDENT_SESSION_DAYS,
  cookieOptions,
  generateMagicToken,
  hashToken,
  signAdminToken,
  signStudentToken,
} from '../auth/tokens.js'
import { queueAdminPasswordReset, queueMagicLink } from '../services/notificationService.js'
import { requireAdmin, requireStudent } from '../middleware/auth.js'
import { asyncRoute } from '../middleware/errorHandler.js'
import { AppError, AuthError } from '../errors.js'
import { summarisePackages } from '../services/packageService.js'
import { config, myBookingsUrl } from '../config.js'
import { logger } from '../logger.js'

export const authRouter: Router = Router()

/** Magic links are an email amplifier, so the request endpoint is rate limited per IP. */
const magicLinkLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'rate_limited', message: 'Too many sign-in requests. Please try again shortly.' } },
})

const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'rate_limited', message: 'Too many attempts. Please try again shortly.' } },
})

const MAGIC_LINK_TTL_MS = 30 * 60_000

/**
 * Request a sign-in link.
 *
 * Always answers the same way whether or not the address is known — otherwise this endpoint
 * becomes a way to test which of your customers study here.
 */
authRouter.post(
  '/magic-link',
  magicLinkLimiter,
  asyncRoute(async (req, res) => {
    const { email, redirectTo } = requestMagicLinkSchema.parse(req.body)

    const student = await StudentModel.findOne({ email })
    if (student) {
      const { token, tokenHash } = generateMagicToken()
      const record = await LoginTokenModel.create({
        studentId: student._id,
        tokenHash,
        expiresAt: new Date(Date.now() + MAGIC_LINK_TTL_MS),
        redirectTo: redirectTo ?? '',
        requestedIp: req.ip ?? '',
      })

      const url = `${config.PUBLIC_API_URL}/api/auth/magic-link/verify?token=${token}`
      await queueMagicLink(student, url, String(record._id))
    } else {
      logger.debug({ email }, 'Magic link requested for an unknown address')
    }

    res.json({ ok: true, message: 'If that email is registered, a sign-in link is on its way.' })
  }),
)

/** Consume a magic link and hand back a session cookie. */
authRouter.get(
  '/magic-link/verify',
  asyncRoute(async (req, res) => {
    const token = z.string().min(10).parse(req.query.token)

    const record = await LoginTokenModel.findOneAndUpdate(
      { tokenHash: hashToken(token), usedAt: null, expiresAt: { $gt: new Date() } },
      { $set: { usedAt: new Date() } },
      { new: true },
    )
    if (!record) {
      throw new AuthError('That sign-in link has expired or has already been used. Please request a new one.')
    }

    const student = await StudentModel.findById(record.studentId)
    if (!student) throw new AuthError()

    student.lastLoginAt = new Date()
    await student.save()

    const jwtToken = signStudentToken({ sub: String(student._id), email: student.email })
    res.cookie(COOKIE_NAMES.student, jwtToken, cookieOptions(STUDENT_SESSION_DAYS * 24 * 3600_000))

    const target = record.redirectTo || myBookingsUrl()
    res.redirect(safeRedirect(target))
  }),
)

/** Only ever bounce back into the studio's own site — never to a URL an attacker supplied. */
function safeRedirect(target: string): string {
  try {
    const url = new URL(target, config.PUBLIC_SITE_URL)
    const allowed = [new URL(config.PUBLIC_SITE_URL).origin, new URL(config.PUBLIC_API_URL).origin]
    if (!allowed.includes(url.origin)) return myBookingsUrl()
    return url.toString()
  } catch {
    return myBookingsUrl()
  }
}

authRouter.get(
  '/me',
  requireStudent,
  asyncRoute(async (req, res) => {
    const student = req.student!
    const packages = await summarisePackages(student._id)
    res.json({
      student: {
        id: String(student._id),
        name: student.name,
        email: student.email,
        phone: student.phone,
      },
      packages,
    })
  }),
)

authRouter.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAMES.student, { path: '/' })
  res.clearCookie(COOKIE_NAMES.admin, { path: '/' })
  res.json({ ok: true })
})

// --- Admin ------------------------------------------------------------------

const adminLoginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1),
  totp: z.string().length(6).optional(),
})

const LOCKOUT_THRESHOLD = 8
const LOCKOUT_MS = 15 * 60_000

authRouter.post(
  '/admin/login',
  loginLimiter,
  asyncRoute(async (req, res) => {
    const { email, password, totp } = adminLoginSchema.parse(req.body)

    const admin = await AdminUserModel.findOne({ email }).select('+passwordHash +totpSecret')
    // Same message for unknown user and wrong password — do not confirm which addresses exist.
    const genericFailure = new AuthError('Those details do not match. Please try again.')

    if (!admin || !admin.active) throw genericFailure
    if (admin.lockedUntil && admin.lockedUntil > new Date()) {
      throw new AppError(429, 'locked', 'Too many failed attempts. Please try again in a few minutes.')
    }

    const valid = await argon2.verify(admin.passwordHash, password)
    if (!valid) {
      admin.failedLoginCount += 1
      if (admin.failedLoginCount >= LOCKOUT_THRESHOLD) {
        admin.lockedUntil = new Date(Date.now() + LOCKOUT_MS)
        admin.failedLoginCount = 0
      }
      await admin.save()
      throw genericFailure
    }

    if (admin.totpEnabled) {
      if (!totp) throw new AppError(401, 'totp_required', 'Enter the 6-digit code from your authenticator app.')
      if (!admin.totpSecret || !authenticator.verify({ token: totp, secret: admin.totpSecret })) {
        throw new AuthError('That code was not accepted. Please try again.')
      }
    }

    admin.failedLoginCount = 0
    admin.lockedUntil = null
    admin.lastLoginAt = new Date()
    await admin.save()

    const token = signAdminToken({
      sub: String(admin._id),
      email: admin.email,
      role: admin.role,
      v: admin.tokenVersion,
    })
    res.cookie(COOKIE_NAMES.admin, token, cookieOptions(ADMIN_SESSION_HOURS * 3600_000))

    res.json({
      admin: { id: String(admin._id), name: admin.name, email: admin.email, role: admin.role, totpEnabled: admin.totpEnabled },
    })
  }),
)

/**
 * Forgot your password.
 *
 * A studio with one admin has nobody to reset it for them, so without this a forgotten password
 * means shell access to the server. It reuses the invite mechanism — a hashed, single-use,
 * expiring link — rather than inventing a second one.
 *
 * Always answers the same way whether or not the address has a login, so this cannot be used to
 * discover who works here. Rate limited for the same reason the magic-link endpoint is: it sends
 * mail on demand.
 */
authRouter.post(
  '/admin/forgot-password',
  magicLinkLimiter,
  asyncRoute(async (req, res) => {
    const { email } = z.object({ email: emailSchema }).parse(req.body)

    const admin = await AdminUserModel.findOne({ email, active: true })
    if (admin) {
      await AdminInviteModel.deleteMany({ adminUserId: admin._id, usedAt: null })

      const raw = randomBytes(32).toString('base64url')
      await AdminInviteModel.create({
        adminUserId: admin._id,
        tokenHash: createHash('sha256').update(raw).digest('hex'),
        expiresAt: new Date(Date.now() + ADMIN_RESET_TTL_HOURS * 3600_000),
        invitedBy: 'self-service',
      })

      await queueAdminPasswordReset(
        admin.email,
        admin.name,
        `${config.PUBLIC_API_URL}/admin/accept-invite?token=${raw}`,
        ADMIN_RESET_TTL_HOURS,
      )
    } else {
      logger.debug({ email }, 'Password reset requested for an unknown admin address')
    }

    res.json({
      ok: true,
      message: 'If that address has a studio login, a reset link is on its way.',
    })
  }),
)

const ADMIN_RESET_TTL_HOURS = 2

/**
 * A new admin setting their own password from an invite link.
 *
 * Public by necessity — the person using it has no session yet. The link is the credential, so
 * it is single-use, expires, and is matched by hash: a database dump gives an attacker nothing
 * to replay. Signing them straight in afterwards means the link is spent immediately rather
 * than sitting used-but-valid in whatever chat it was pasted into.
 */
authRouter.post(
  '/admin/accept-invite',
  asyncRoute(async (req, res) => {
    const { token, password } = z
      .object({
        token: z.string().min(10),
        password: z.string().min(12, 'Please choose at least 12 characters'),
      })
      .parse(req.body)

    const invite = await AdminInviteModel.findOne({
      tokenHash: createHash('sha256').update(token).digest('hex'),
      usedAt: null,
      expiresAt: { $gt: new Date() },
    })
    // Deliberately the same message whether the link is wrong, spent or stale: distinguishing
    // them tells someone probing which of their guesses was closest.
    if (!invite) {
      throw new AppError(400, 'invalid_invite', 'That invitation link is no longer valid. Ask for a new one.')
    }

    const admin = await AdminUserModel.findById(invite.adminUserId)
    if (!admin || !admin.active) {
      throw new AppError(400, 'invalid_invite', 'That invitation link is no longer valid. Ask for a new one.')
    }

    admin.passwordHash = await argon2.hash(password, { type: argon2.argon2id })
    admin.lastLoginAt = new Date()
    await admin.save()

    invite.usedAt = new Date()
    await invite.save()

    const token_ = signAdminToken({
      sub: String(admin._id),
      email: admin.email,
      role: admin.role,
      v: admin.tokenVersion,
    })
    res.cookie(COOKIE_NAMES.admin, token_, cookieOptions(ADMIN_SESSION_HOURS * 3600_000))

    res.json({
      admin: {
        id: String(admin._id),
        name: admin.name,
        email: admin.email,
        role: admin.role,
        totpEnabled: admin.totpEnabled,
      },
    })
  }),
)

authRouter.get(
  '/admin/me',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const admin = req.admin!
    res.json({
      admin: { id: String(admin._id), name: admin.name, email: admin.email, role: admin.role, totpEnabled: admin.totpEnabled },
    })
  }),
)

/**
 * Change your own password.
 *
 * Requires the current one, so someone who walks up to an unlocked laptop cannot lock the
 * studio out of their own system. Every other session is signed out afterwards: if the reason
 * for changing it is that the old one leaked, leaving those sessions alive defeats the point.
 */
authRouter.post(
  '/admin/password',
  loginLimiter,
  requireAdmin,
  asyncRoute(async (req, res) => {
    const { currentPassword, newPassword } = z
      .object({
        currentPassword: z.string().min(1, 'Enter your current password'),
        newPassword: z.string().min(12, 'Please choose at least 12 characters'),
      })
      .parse(req.body)

    const admin = await AdminUserModel.findById(req.admin!._id).select('+passwordHash')
    if (!admin) throw new AuthError()

    if (!(await argon2.verify(admin.passwordHash, currentPassword))) {
      throw new AuthError('That is not your current password.')
    }
    if (currentPassword === newPassword) {
      throw new AppError(422, 'unchanged', 'That is the password you already have.')
    }

    admin.passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id })
    // Invalidates every issued token, including this request's own cookie.
    admin.tokenVersion += 1
    await admin.save()

    res.clearCookie(COOKIE_NAMES.admin, { path: '/' })
    res.json({ ok: true, message: 'Password changed. Please sign in again.' })
  }),
)

/** Start 2FA enrolment: returns a secret to scan. Not enabled until a code is confirmed. */
authRouter.post(
  '/admin/totp/setup',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const admin = req.admin!
    const secret = authenticator.generateSecret()
    await AdminUserModel.updateOne({ _id: admin._id }, { $set: { totpSecret: secret, totpEnabled: false } })

    res.json({
      secret,
      otpauthUrl: authenticator.keyuri(admin.email, 'Mizuki Flora Booking', secret),
    })
  }),
)

authRouter.post(
  '/admin/totp/confirm',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const { totp } = z.object({ totp: z.string().length(6) }).parse(req.body)

    const admin = await AdminUserModel.findById(req.admin!._id).select('+totpSecret')
    if (!admin?.totpSecret) throw new AppError(400, 'no_totp_setup', 'Start two-factor setup first.')
    if (!authenticator.verify({ token: totp, secret: admin.totpSecret })) {
      throw new AuthError('That code was not accepted. Please try again.')
    }

    admin.totpEnabled = true
    await admin.save()
    res.json({ ok: true })
  }),
)
