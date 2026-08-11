import { Router } from 'express'
import { z } from 'zod'
import {
  courseTypeInputSchema,
  emailTemplateInputSchema,
  emailTemplateKeySchema,
  scheduleRuleInputSchema,
  sendTestEmailSchema,
} from '@mizuki/shared'
import {
  AuditLogModel,
  CourseSeriesModel,
  CourseTypeModel,
  EmailTemplateModel,
  PushSubscriptionModel,
  ScheduleRuleModel,
} from '../../models/index.js'
import { getSeriesAvailability } from '../../services/seriesService.js'
import { buildDashboard } from '../../services/dashboardService.js'
import { hoursSinceLastBackup, listBackups, readBackup, runBackup } from '../../services/backupService.js'
import { DEFAULT_TEMPLATES, renderTemplate, resetTemplate } from '../../services/emailTemplates.js'
import { checkEmailKey, sendDirectEmail } from '../../services/mailer.js'
import {
  PLAIN_KEYS,
  SECRET_KEYS,
  clearSecret,
  describeSecret,
  getPlain,
  setPlain,
  setSecret,
} from '../../services/secretStore.js'
import { materializeSessions } from '../../services/scheduleService.js'
import { findSeatDrift, repairSeatDrift } from '../../services/seatService.js'
import { recordAudit } from '../../services/auditService.js'
import { actorOf } from '../../middleware/auth.js'
import { asyncRoute } from '../../middleware/errorHandler.js'
import { NotFoundError } from '../../errors.js'
import { config } from '../../config.js'

/** Courses, recurring timetable rules, message wording, and the maintenance levers. */
export const adminSettingsRouter: Router = Router()

// --- Dashboard --------------------------------------------------------------

/** Everything the landing page shows, in one call. */
adminSettingsRouter.get(
  '/dashboard',
  asyncRoute(async (_req, res) => {
    res.json(await buildDashboard())
  }),
)

// --- Courses ----------------------------------------------------------------

adminSettingsRouter.get(
  '/courses',
  asyncRoute(async (_req, res) => {
    const courses = await CourseTypeModel.find().sort({ sortOrder: 1 }).lean()
    res.json({ courses: courses.map((c) => ({ ...c, id: String(c._id) })) })
  }),
)

adminSettingsRouter.post(
  '/courses',
  asyncRoute(async (req, res) => {
    const input = courseTypeInputSchema.parse(req.body)
    const course = await CourseTypeModel.create(input)
    res.status(201).json({ course: { id: String(course._id), name: course.name } })
  }),
)

/**
 * Editing a course changes policy for every class of that course, including ones already booked —
 * so the reschedule window is audited when it moves.
 */
adminSettingsRouter.patch(
  '/courses/:id',
  asyncRoute(async (req, res) => {
    const input = courseTypeInputSchema.partial().parse(req.body)

    const before = await CourseTypeModel.findById(req.params.id).lean()
    if (!before) throw new NotFoundError('Course')

    const course = await CourseTypeModel.findByIdAndUpdate(req.params.id, { $set: input }, { new: true })

    if (input.rescheduleCutoffHours !== undefined && input.rescheduleCutoffHours !== before.rescheduleCutoffHours) {
      await recordAudit({
        actor: actorOf(req),
        action: 'course.rescheduleWindowChanged',
        entity: 'CourseType',
        entityId: course!._id,
        before: { rescheduleCutoffHours: before.rescheduleCutoffHours },
        after: { rescheduleCutoffHours: input.rescheduleCutoffHours },
      })
    }

    res.json({ course: { id: String(course!._id), name: course!.name } })
  }),
)

// --- Recurring timetable rules ----------------------------------------------

adminSettingsRouter.get(
  '/schedule-rules',
  asyncRoute(async (_req, res) => {
    const rules = await ScheduleRuleModel.find().sort({ startTime: 1 }).lean()
    res.json({ rules: rules.map((r) => ({ ...r, id: String(r._id) })) })
  }),
)

adminSettingsRouter.post(
  '/schedule-rules',
  asyncRoute(async (req, res) => {
    const input = scheduleRuleInputSchema.parse(req.body)
    const rule = await ScheduleRuleModel.create(input)

    // Fill the calendar straight away, so a new weekly slot shows up without waiting for cron.
    const generated = await materializeSessions()

    res.status(201).json({ rule: { id: String(rule._id) }, sessionsGenerated: generated.created })
  }),
)

adminSettingsRouter.patch(
  '/schedule-rules/:id',
  asyncRoute(async (req, res) => {
    // `.innerType()` reaches past the cross-field refinement, which cannot be made partial.
    const input = scheduleRuleInputSchema.innerType().partial().parse(req.body)
    const rule = await ScheduleRuleModel.findByIdAndUpdate(req.params.id, { $set: input }, { new: true })
    if (!rule) throw new NotFoundError('Schedule rule')
    res.json({ rule: { id: String(rule._id) } })
  }),
)

/**
 * Stopping a rule stops future generation only. Classes it already produced stay exactly as they
 * are, because students are booked into them — removing a template must never delete a booking.
 */
adminSettingsRouter.delete(
  '/schedule-rules/:id',
  asyncRoute(async (req, res) => {
    const rule = await ScheduleRuleModel.findByIdAndUpdate(req.params.id, { $set: { active: false } }, { new: true })
    if (!rule) throw new NotFoundError('Schedule rule')

    await recordAudit({
      actor: actorOf(req),
      action: 'scheduleRule.deactivate',
      entity: 'ScheduleRule',
      entityId: rule._id,
    })

    res.json({ ok: true, note: 'Future classes will no longer be generated. Existing classes are unchanged.' })
  }),
)

/** Force a generation pass — the admin console's "fill the calendar" button. */
adminSettingsRouter.post(
  '/schedule-rules/generate',
  asyncRoute(async (req, res) => {
    const { from, to } = z.object({ from: z.string().optional(), to: z.string().optional() }).parse(req.body)
    const result = await materializeSessions({ from, to })
    res.json(result)
  }),
)

// --- Set courses (the Autumn Ikebana Course and anything like it) ------------

adminSettingsRouter.get(
  '/series',
  asyncRoute(async (_req, res) => {
    const all = await CourseSeriesModel.find().sort({ createdAt: -1 }).lean()
    const detailed = await Promise.all(
      all.map(async (s) => ({
        ...(await getSeriesAvailability(s._id)),
        wooProductId: s.wooProductId,
        active: s.active,
        description: s.description,
      })),
    )
    res.json({ series: detailed })
  }),
)

const seriesInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  courseTypeId: z.string().regex(/^[0-9a-fA-F]{24}$/),
  sessionIds: z.array(z.string().regex(/^[0-9a-fA-F]{24}$/)).min(1),
  wooProductId: z.number().int().positive().nullable().default(null),
  description: z.string().max(2000).default(''),
  active: z.boolean().default(true),
})

adminSettingsRouter.post(
  '/series',
  asyncRoute(async (req, res) => {
    const input = seriesInputSchema.parse(req.body)
    const series = await CourseSeriesModel.create(input)

    await recordAudit({
      actor: actorOf(req),
      action: 'series.create',
      entity: 'CourseSeries',
      entityId: series._id,
      after: { name: input.name, sessions: input.sessionIds.length },
    })

    res.status(201).json({ series: { id: String(series._id), name: series.name } })
  }),
)

/**
 * Mostly used to attach the shop product. Until that is set, buying the course in the shop
 * cannot book anything — the order arrives with no way to tell what it was for.
 */
adminSettingsRouter.patch(
  '/series/:id',
  asyncRoute(async (req, res) => {
    const input = seriesInputSchema.partial().parse(req.body)
    const series = await CourseSeriesModel.findByIdAndUpdate(req.params.id, { $set: input }, { new: true })
    if (!series) throw new NotFoundError('Course')

    await recordAudit({
      actor: actorOf(req),
      action: 'series.update',
      entity: 'CourseSeries',
      entityId: series._id,
      after: input,
    })

    res.json({ series: { id: String(series._id), name: series.name, wooProductId: series.wooProductId } })
  }),
)

// --- Email templates --------------------------------------------------------

adminSettingsRouter.get(
  '/templates',
  asyncRoute(async (_req, res) => {
    const overrides = await EmailTemplateModel.find().lean()
    const byKey = new Map(overrides.map((t) => [t.key, t]))

    res.json({
      templates: Object.entries(DEFAULT_TEMPLATES).map(([key, def]) => {
        const override = byKey.get(key)
        return {
          key,
          label: def.label,
          description: def.description,
          variables: def.variables,
          subject: override?.subject ?? def.subject,
          bodyHtml: override?.bodyHtml ?? def.bodyHtml,
          bodyText: override?.bodyText ?? def.bodyText,
          isCustomised: Boolean(override) && override!.updatedBy !== 'seed',
        }
      }),
    })
  }),
)

adminSettingsRouter.put(
  '/templates/:key',
  asyncRoute(async (req, res) => {
    const key = emailTemplateKeySchema.parse(req.params.key)
    const input = emailTemplateInputSchema.parse(req.body)

    await EmailTemplateModel.findOneAndUpdate(
      { key },
      { $set: { ...input, updatedBy: actorOf(req) } },
      { upsert: true },
    )

    res.json({ ok: true })
  }),
)

adminSettingsRouter.post(
  '/templates/:key/reset',
  asyncRoute(async (req, res) => {
    const key = emailTemplateKeySchema.parse(req.params.key)
    await resetTemplate(key)
    res.json({ ok: true })
  }),
)

/** Preview with realistic sample values, so the studio sees what a student would receive. */
adminSettingsRouter.post(
  '/templates/:key/preview',
  asyncRoute(async (req, res) => {
    const key = emailTemplateKeySchema.parse(req.params.key)
    // The editor sends what is on screen; an empty body still previews what is stored.
    const draft = z
      .object({
        subject: z.string().max(200).optional(),
        bodyHtml: z.string().max(50_000).optional(),
        bodyText: z.string().max(20_000).optional(),
      })
      .parse(req.body ?? {})

    const rendered = await renderTemplate(key, SAMPLE_VARS, draft)
    res.json(rendered)
  }),
)

adminSettingsRouter.post(
  '/templates/:key/test',
  asyncRoute(async (req, res) => {
    const key = emailTemplateKeySchema.parse(req.params.key)
    const { to } = sendTestEmailSchema.parse(req.body)

    const rendered = await renderTemplate(key, SAMPLE_VARS)
    await sendDirectEmail(to, `[Test] ${rendered.subject}`, rendered.html, rendered.text)

    res.json({ ok: true, sentTo: to })
  }),
)

const SAMPLE_VARS: Record<string, string | number> = {
  studentName: 'Aiko Tan',
  studentEmail: 'aiko@example.com',
  studentPhone: '+65 9123 4567',
  courseName: 'Ikebana',
  sessionTitle: 'Ikebana Workshop — Morning',
  sessionDate: 'Sat 22 Aug 2026',
  sessionTimeRange: '10:00 AM – 12:30 PM',
  sessionDuration: '2h 30m',
  rescheduleDeadline: 'Wed 19 Aug 2026, 10:00 AM',
  previousSessionDate: 'Sun 16 Aug 2026',
  previousSessionTimeRange: '2:30 PM – 5:00 PM',
  packageLine: 'You have 6 of 8 IFDA sessions remaining in your course package.',
  cancelReasonLine: 'Reason: the studio is closed for outside work.',
  sessionsRemaining: 1,
  packageExpiryDate: 'Sat 14 Nov 2026',
  bookingSource: 'website',
  seatsTaken: 5,
  seatsLeft: 3,
  capacity: 8,
  todayDate: 'Saturday 22 August 2026',
  sessionCount: 3,
  studentCount: 11,
  sessionListHtml: '<ul><li><strong>10:00 AM</strong> — Ikebana Workshop: 5/8 booked</li></ul>',
  sessionListText: '• 10:00 AM — Ikebana Workshop: 5/8 booked',
  magicLinkUrl: `${config.PUBLIC_API_URL}/api/auth/magic-link/verify?token=sample`,
  myBookingsUrl: `${config.PUBLIC_SITE_URL}/my-bookings`,
  bookingUrl: `${config.PUBLIC_SITE_URL}/book`,
  adminSessionUrl: `${config.PUBLIC_API_URL}/admin/calendar`,
  adminCalendarUrl: `${config.PUBLIC_API_URL}/admin/calendar`,
  siteUrl: config.PUBLIC_SITE_URL,
  studioPhone: '+65 8821 9386',
}

// --- Web push enrolment -----------------------------------------------------

adminSettingsRouter.get('/push/key', (_req, res) => {
  res.json({ publicKey: config.VAPID_PUBLIC_KEY ?? null })
})

adminSettingsRouter.post(
  '/push/subscribe',
  asyncRoute(async (req, res) => {
    const subscription = z
      .object({
        endpoint: z.string().url(),
        keys: z.object({ p256dh: z.string(), auth: z.string() }),
      })
      .parse(req.body)

    await PushSubscriptionModel.findOneAndUpdate(
      { endpoint: subscription.endpoint },
      {
        $set: {
          adminUserId: req.admin!._id,
          keys: subscription.keys,
          userAgent: req.headers['user-agent'] ?? '',
          failureCount: 0,
        },
      },
      { upsert: true },
    )

    res.status(201).json({ ok: true })
  }),
)

// --- Connected services -----------------------------------------------------

/**
 * The keys the studio can change themselves.
 *
 * Only ever reports whether each is set and a masked hint — never the value. The screen exists
 * to answer "is the right key in there?", not to become a way of reading secrets back out.
 */
adminSettingsRouter.get(
  '/integrations',
  asyncRoute(async (_req, res) => {
    const [email, telegramToken, telegramChat] = await Promise.all([
      describeSecret(SECRET_KEYS.resendApiKey, config.RESEND_API_KEY),
      describeSecret(SECRET_KEYS.telegramBotToken, config.TELEGRAM_BOT_TOKEN),
      describeSecret(SECRET_KEYS.telegramChatId, config.TELEGRAM_CHAT_ID),
    ])
    const [mailFrom, replyTo] = await Promise.all([
      getPlain(PLAIN_KEYS.mailFrom, config.MAIL_FROM),
      getPlain(PLAIN_KEYS.mailReplyTo, config.MAIL_REPLY_TO),
    ])
    res.json({ email, telegramToken, telegramChat, mailFrom, replyTo })
  }),
)

const secretInputSchema = z.object({ value: z.string().trim().min(1, 'Paste the key') })

const PLAIN_SETTINGS: Record<string, (typeof PLAIN_KEYS)[keyof typeof PLAIN_KEYS]> = {
  'mail-from': PLAIN_KEYS.mailFrom,
  'mail-reply-to': PLAIN_KEYS.mailReplyTo,
}

/**
 * The sending address.
 *
 * Editable because it has to change at a predictable moment: Resend refuses to send from a
 * domain until its DNS is verified, so testing before that means sending from their sandbox
 * address and switching afterwards. That should not need a redeploy.
 */
adminSettingsRouter.put(
  '/mail/:name',
  asyncRoute(async (req, res) => {
    const key = PLAIN_SETTINGS[req.params.name!]
    if (!key) throw new NotFoundError('Setting')

    const { value } = z.object({ value: z.string().trim().max(200) }).parse(req.body)
    await setPlain(key, value, actorOf(req))

    await recordAudit({ actor: actorOf(req), action: 'mail.update', entity: 'Setting', reason: `${req.params.name} = ${value}` })
    res.json({ ok: true, value })
  }),
)

const EDITABLE_SECRETS: Record<string, (typeof SECRET_KEYS)[keyof typeof SECRET_KEYS]> = {
  resend: SECRET_KEYS.resendApiKey,
  'telegram-token': SECRET_KEYS.telegramBotToken,
  'telegram-chat': SECRET_KEYS.telegramChatId,
}

adminSettingsRouter.put(
  '/integrations/:name',
  asyncRoute(async (req, res) => {
    const key = EDITABLE_SECRETS[req.params.name!]
    if (!key) throw new NotFoundError('Setting')

    const { value } = secretInputSchema.parse(req.body)
    await setSecret(key, value, actorOf(req))

    // The value is never logged or audited — only that it changed, and by whom.
    await recordAudit({ actor: actorOf(req), action: 'integration.update', entity: 'Setting', reason: req.params.name })

    res.json({ ok: true, status: await describeSecret(key) })
  }),
)

/** Revert to whatever the server was deployed with. */
adminSettingsRouter.delete(
  '/integrations/:name',
  asyncRoute(async (req, res) => {
    const key = EDITABLE_SECRETS[req.params.name!]
    if (!key) throw new NotFoundError('Setting')

    await clearSecret(key, actorOf(req))
    await recordAudit({ actor: actorOf(req), action: 'integration.clear', entity: 'Setting', reason: req.params.name })

    res.json({ ok: true })
  }),
)

/** Check a key works without sending anything or spending quota. */
adminSettingsRouter.post(
  '/integrations/resend/check',
  asyncRoute(async (_req, res) => {
    res.json(await checkEmailKey())
  }),
)

// --- Backups ----------------------------------------------------------------

adminSettingsRouter.get(
  '/backups',
  asyncRoute(async (_req, res) => {
    const [backups, ageHours] = await Promise.all([listBackups(), hoursSinceLastBackup()])
    res.json({ backups, ageHours, keep: config.BACKUP_KEEP })
  }),
)

adminSettingsRouter.post(
  '/backups/run',
  asyncRoute(async (req, res) => {
    const result = await runBackup()
    await recordAudit({ actor: actorOf(req), action: 'maintenance.backup', entity: 'Database', after: result })
    res.json(result)
  }),
)

/**
 * Download a backup.
 *
 * These contain student names, emails and phone numbers, so this sits behind the admin session
 * like everything else here, and the filename is validated rather than trusted — it arrives
 * from a URL and would otherwise be a path traversal.
 */
adminSettingsRouter.get(
  '/backups/:file',
  asyncRoute(async (req, res) => {
    try {
      const data = await readBackup(req.params.file!)
      res.setHeader('Content-Type', 'application/gzip')
      res.setHeader('Content-Disposition', `attachment; filename="${req.params.file}"`)
      res.send(data)
    } catch {
      throw new NotFoundError('Backup')
    }
  }),
)

// --- Maintenance ------------------------------------------------------------

adminSettingsRouter.get(
  '/audit',
  asyncRoute(async (req, res) => {
    const { limit } = z.object({ limit: z.coerce.number().min(1).max(200).default(100) }).parse(req.query)
    const entries = await AuditLogModel.find().sort({ createdAt: -1 }).limit(limit).lean()
    res.json({ entries })
  }),
)

/** Surface counter drift; repairing is a separate, deliberate click. */
adminSettingsRouter.get(
  '/seat-drift',
  asyncRoute(async (_req, res) => {
    res.json({ drift: await findSeatDrift() })
  }),
)

adminSettingsRouter.post(
  '/seat-drift/repair',
  asyncRoute(async (req, res) => {
    const drift = await findSeatDrift()
    const repaired = await repairSeatDrift(drift)

    await recordAudit({
      actor: actorOf(req),
      action: 'maintenance.repairSeatDrift',
      entity: 'Session',
      after: { repaired, drift },
    })

    res.json({ repaired, drift })
  }),
)
