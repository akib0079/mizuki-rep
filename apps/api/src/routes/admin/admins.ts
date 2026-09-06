import { Router } from 'express'
import { randomBytes, createHash } from 'node:crypto'
import { z } from 'zod'
import argon2 from 'argon2'
import { AdminInviteModel, AdminUserModel } from '../../models/index.js'
import {
  getExtraRecipients,
  notificationRecipients,
  setExtraRecipients,
} from '../../services/adminNotificationService.js'
import { recordAudit } from '../../services/auditService.js'
import { actorOf } from '../../middleware/auth.js'
import { asyncRoute } from '../../middleware/errorHandler.js'
import { config } from '../../config.js'
import { AppError, NotFoundError } from '../../errors.js'

/**
 * Who can run the studio, and who hears about bookings.
 *
 * Everyone here has the same rights — the studio asked for that explicitly, and a permission
 * model nobody wants is a permission model that gets worked around. What is guarded instead is
 * lockout: the last active admin cannot be removed, and nobody can deactivate themselves.
 */
export const adminAdminsRouter: Router = Router()

const INVITE_TTL_HOURS = 72

const hashToken = (raw: string) => createHash('sha256').update(raw).digest('hex')

adminAdminsRouter.get(
  '/',
  asyncRoute(async (_req, res) => {
    const [admins, extra, recipients] = await Promise.all([
      AdminUserModel.find().sort({ createdAt: 1 }).lean(),
      getExtraRecipients(),
      notificationRecipients(),
    ])

    const pending = await AdminInviteModel.find({
      adminUserId: { $in: admins.map((a) => a._id) },
      usedAt: null,
      expiresAt: { $gt: new Date() },
    }).lean()
    const pendingFor = new Set(pending.map((i) => String(i.adminUserId)))

    res.json({
      admins: admins.map((a) => ({
        id: String(a._id),
        name: a.name,
        email: a.email,
        active: a.active,
        totpEnabled: a.totpEnabled,
        lastLoginAt: a.lastLoginAt,
        // Someone invited who has never signed in still has an unused invite outstanding.
        invitePending: pendingFor.has(String(a._id)) && !a.lastLoginAt,
        createdAt: a.createdAt,
      })),
      extraRecipients: extra,
      /** Exactly who a booking alert goes to right now — admins plus extras, de-duplicated. */
      effectiveRecipients: recipients,
    })
  }),
)

/**
 * Add someone — either by handing them a link, or by setting their password here and now.
 *
 * The link is the better of the two and stays the default: nobody but its owner ever knows the
 * password, so the audit log means what it says. But it assumes the two people can pass a link
 * between them, and the studio's case is often the opposite one — sitting beside the person,
 * setting up their access in front of them. Refusing that turns into a shared login, which is
 * worse than either.
 *
 * The link comes back in the response rather than only by email because email cannot be relied
 * on to reach them: on the sandbox sender it will not, and the invite would be a dead end with
 * no way to recover it.
 */
adminAdminsRouter.post(
  '/',
  asyncRoute(async (req, res) => {
    const input = z
      .object({
        name: z.string().trim().min(1).max(80),
        email: z.string().trim().toLowerCase().email(),
        /**
         * Set this and they can sign in immediately; leave it out and they get an invitation.
         *
         * Same length the account holder is held to when they choose their own, because a
         * password someone else picks for you is the one most likely to be short and guessable —
         * and this one is typed by a person who will not be the one living with it.
         */
        password: z.string().min(12, 'Please choose a password of at least 12 characters').optional(),
      })
      .parse(req.body)

    const existing = await AdminUserModel.findOne({ email: input.email })
    if (existing) {
      throw new AppError(409, 'already_exists', 'Someone with that email address is already an admin.')
    }

    /*
     * Without a password chosen here: a random one nobody is told, so the account cannot be
     * signed into until the invite is used. The field is required, and leaving it empty or
     * predictable would be the difference between an unusable account and an open one.
     */
    const admin = await AdminUserModel.create({
      name: input.name,
      email: input.email,
      passwordHash: await argon2.hash(input.password ?? randomBytes(32).toString('hex'), {
        type: argon2.argon2id,
      }),
      role: 'owner',
      active: true,
    })

    if (input.password) {
      await recordAudit({
        action: 'admin.create',
        entity: 'AdminUser',
        entityId: admin._id,
        actor: actorOf(req),
        // Recorded because it is the one route where somebody else knows the password.
        reason: `Added ${input.name} <${input.email}> as an admin with a password set by hand`,
      })

      res.status(201).json({
        admin: { id: String(admin._id), name: admin.name, email: admin.email, active: true },
        passwordSet: true,
        signInUrl: `${config.PUBLIC_API_URL}/admin`,
      })
      return
    }

    const raw = randomBytes(32).toString('base64url')
    await AdminInviteModel.create({
      adminUserId: admin._id,
      tokenHash: hashToken(raw),
      expiresAt: new Date(Date.now() + INVITE_TTL_HOURS * 3600_000),
      invitedBy: actorOf(req),
    })

    await recordAudit({
      action: 'admin.invite',
      entity: 'AdminUser',
      entityId: admin._id,
      actor: actorOf(req),
      reason: `Invited ${input.name} <${input.email}> as an admin`,
    })

    res.status(201).json({
      admin: { id: String(admin._id), name: admin.name, email: admin.email, active: true },
      inviteUrl: `${config.PUBLIC_API_URL}/admin/accept-invite?token=${raw}`,
      expiresInHours: INVITE_TTL_HOURS,
    })
  }),
)

/**
 * Set another admin's password directly.
 *
 * The reset link above is still the right answer whenever the two people are not in the same
 * room, and it stays the button the console offers first. This is for the case the studio
 * actually hit: a person who cannot receive the link — email that does not reach them, a shared
 * device, someone standing right there — where the alternative is not a more secure flow, it is
 * two people using one login.
 *
 * Every existing session for that account ends, exactly as a reset link does. If the reason is
 * that the old password leaked, leaving those sessions alive defeats the point.
 */
adminAdminsRouter.post(
  '/:id/set-password',
  asyncRoute(async (req, res) => {
    const { password } = z
      .object({
        password: z.string().min(12, 'Please choose a password of at least 12 characters'),
      })
      .parse(req.body)

    const admin = await AdminUserModel.findById(req.params.id)
    if (!admin) throw new NotFoundError('Admin')

    admin.passwordHash = await argon2.hash(password, { type: argon2.argon2id })
    admin.tokenVersion += 1
    admin.failedLoginCount = 0
    admin.lockedUntil = null
    await admin.save()

    // Any outstanding invitation or reset link stops working — there is a password now.
    await AdminInviteModel.deleteMany({ adminUserId: admin._id, usedAt: null })

    await recordAudit({
      action: 'admin.set_password',
      entity: 'AdminUser',
      entityId: admin._id,
      actor: actorOf(req),
      reason: `Set a password by hand for ${admin.email} and signed out their sessions`,
    })

    res.json({ ok: true, email: admin.email })
  }),
)

/**
 * Reset another admin's password.
 *
 * Issues the same kind of single-use link as an invitation rather than setting a password on
 * their behalf. One admin knowing another's password is the thing worth avoiding here — it
 * makes the audit log a guess about who actually did something.
 *
 * Every existing session for that account ends immediately. If the reason for the reset is that
 * the password leaked, leaving those sessions alive defeats the point of resetting it.
 */
adminAdminsRouter.post(
  '/:id/reset-password',
  asyncRoute(async (req, res) => {
    const admin = await AdminUserModel.findById(req.params.id)
    if (!admin) throw new NotFoundError('Admin')

    admin.tokenVersion += 1
    admin.failedLoginCount = 0
    admin.lockedUntil = null
    await admin.save()

    await AdminInviteModel.deleteMany({ adminUserId: admin._id, usedAt: null })

    const raw = randomBytes(32).toString('base64url')
    await AdminInviteModel.create({
      adminUserId: admin._id,
      tokenHash: hashToken(raw),
      expiresAt: new Date(Date.now() + INVITE_TTL_HOURS * 3600_000),
      invitedBy: actorOf(req),
    })

    await recordAudit({
      action: 'admin.reset_password',
      entity: 'AdminUser',
      entityId: admin._id,
      actor: actorOf(req),
      reason: `Issued a password reset link for ${admin.email} and signed out their sessions`,
    })

    res.json({
      resetUrl: `${config.PUBLIC_API_URL}/admin/accept-invite?token=${raw}`,
      expiresInHours: INVITE_TTL_HOURS,
    })
  }),
)

/** Fresh link for someone who lost theirs or let it expire. */
adminAdminsRouter.post(
  '/:id/reinvite',
  asyncRoute(async (req, res) => {
    const admin = await AdminUserModel.findById(req.params.id)
    if (!admin) throw new NotFoundError('Admin')

    // Anything outstanding stops working the moment a new link is issued.
    await AdminInviteModel.deleteMany({ adminUserId: admin._id, usedAt: null })

    const raw = randomBytes(32).toString('base64url')
    await AdminInviteModel.create({
      adminUserId: admin._id,
      tokenHash: hashToken(raw),
      expiresAt: new Date(Date.now() + INVITE_TTL_HOURS * 3600_000),
      invitedBy: actorOf(req),
    })

    res.json({
      inviteUrl: `${config.PUBLIC_API_URL}/admin/accept-invite?token=${raw}`,
      expiresInHours: INVITE_TTL_HOURS,
    })
  }),
)

adminAdminsRouter.patch(
  '/:id',
  asyncRoute(async (req, res) => {
    const input = z
      .object({
        name: z.string().trim().min(1).max(80).optional(),
        active: z.boolean().optional(),
      })
      .parse(req.body)

    const admin = await AdminUserModel.findById(req.params.id)
    if (!admin) throw new NotFoundError('Admin')

    if (input.active === false) {
      if (String(admin._id) === String(req.admin!._id)) {
        throw new AppError(
          400,
          'cannot_deactivate_self',
          'You cannot remove your own access. Ask another admin to do it.',
        )
      }

      /*
       * A backstop, not the main guard. The check above is what actually keeps the studio out of
       * a locked console: requireAdmin rejects a deactivated admin, so whoever is making this
       * request is active, and removing anyone other than themselves always leaves at least one.
       * This fires only if that stops being true — an admin deactivated mid-session, say — and
       * costs one count to keep the invariant stated rather than assumed.
       */
      const activeCount = await AdminUserModel.countDocuments({ active: true })
      if (activeCount <= 1) {
        throw new AppError(
          400,
          'last_admin',
          'This is the only active admin. Add another before removing this one.',
        )
      }
    }

    if (input.name !== undefined) admin.name = input.name
    if (input.active !== undefined) {
      admin.active = input.active
      // Ends every session this person has open, rather than waiting for their token to lapse.
      if (!input.active) admin.tokenVersion += 1
    }
    await admin.save()

    await recordAudit({
      action: 'admin.update',
      entity: 'AdminUser',
      entityId: admin._id,
      actor: actorOf(req),
      reason:
        input.active === false
          ? `Removed access for ${admin.email}`
          : `Updated ${admin.email}`,
    })

    res.json({ admin: { id: String(admin._id), name: admin.name, active: admin.active } })
  }),
)

/** Extra addresses that should get booking alerts without having a console login. */
adminAdminsRouter.put(
  '/recipients',
  asyncRoute(async (req, res) => {
    const { emails } = z
      .object({ emails: z.array(z.string().trim().toLowerCase().email()).max(20) })
      .parse(req.body)

    const saved = await setExtraRecipients(emails)

    await recordAudit({
      action: 'settings.recipients',
      entity: 'Setting',
      actor: actorOf(req),
      reason: `Booking alerts now also go to: ${saved.join(', ') || 'nobody extra'}`,
    })

    res.json({ extraRecipients: saved, effectiveRecipients: await notificationRecipients() })
  }),
)
