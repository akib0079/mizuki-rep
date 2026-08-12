import { z } from 'zod'
import { isDateKey } from './time.js'

/** Shared request contracts. The API validates with these; the clients build payloads against them. */

export const dateKeySchema = z.string().refine(isDateKey, 'Expected a YYYY-MM-DD date')
export const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected a HH:mm time')
export const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Expected an id')

export const emailSchema = z.string().trim().toLowerCase().email('Please enter a valid email address')

/**
 * A contact number the studio can actually ring.
 *
 * Deliberately permissive about shape — students are not all Singaporean, and rejecting a
 * legitimate foreign number is a worse failure than accepting an oddly punctuated one. What it
 * does insist on is enough digits to be a real number, so "n/a" and "-" cannot get through.
 */
export const phoneSchema = z
  .string()
  .trim()
  .min(1, 'Please enter a phone number')
  .refine((value) => value.replace(/\D/g, '').length >= 8, 'That does not look like a complete phone number')
  .refine((value) => /^[+\d][\d\s()+-]*$/.test(value), 'Please use only digits, spaces and + ( ) -')

/** For records the studio may hold without a number — imported or created from a shop order. */
export const optionalPhoneSchema = z.union([z.literal(''), phoneSchema]).default('')

export const bookingModeSchema = z.enum(['package', 'paid', 'free'])
export const sessionStatusSchema = z.enum(['scheduled', 'cancelled'])

export const sessionBreakSchema = z.object({
  start: timeSchema,
  end: timeSchema,
  label: z.string().max(60).default('Break'),
})

export const recurrenceSchema = z.object({
  freq: z.enum(['WEEKLY', 'NONE']),
  byWeekday: z.array(z.number().int().min(1).max(7)).default([]),
  interval: z.number().int().min(1).max(12).default(1),
})

// --- Public / student ------------------------------------------------------

export const calendarQuerySchema = z.object({
  from: dateKeySchema.optional(),
  to: dateKeySchema.optional(),
  courseTypeId: objectIdSchema.optional(),
})

export const startBookingSchema = z.object({
  sessionId: objectIdSchema,
  email: emailSchema,
  name: z.string().trim().min(1, 'Please enter your name').max(120),
  phone: phoneSchema,
  notes: z.string().trim().max(500).default(''),
  marketingOptIn: z.boolean().default(false),
})

export const requestMagicLinkSchema = z.object({
  email: emailSchema,
  redirectTo: z.string().max(300).optional(),
})

export const rescheduleBookingSchema = z.object({
  bookingId: objectIdSchema,
  toSessionId: objectIdSchema,
})

export const cancelBookingSchema = z.object({
  bookingId: objectIdSchema,
  reason: z.string().trim().max(300).default(''),
})

// --- Admin: course types ---------------------------------------------------

export const courseTypeInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  slug: z.string().trim().regex(/^[a-z0-9-]+$/, 'Lowercase letters, numbers and dashes only').max(80),
  colour: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Expected a hex colour'),
  bookingMode: bookingModeSchema,
  rescheduleCutoffHours: z.number().int().min(0).max(720),
  cancelCutoffHours: z.number().int().min(0).max(720),
  defaultDurationMins: z.number().int().min(15).max(600),
  defaultCapacity: z.number().int().min(1).max(200),
  wooProductIds: z.array(z.number().int().positive()).default([]),
  requiresManualConfirmation: z.boolean().default(false),
  packageGrantSessions: z.number().int().min(0).max(200).default(0),
  packageValidityDays: z.number().int().min(0).max(3650).default(365),
  description: z.string().trim().max(2000).default(''),
  sortOrder: z.number().int().min(0).max(999).default(0),
  active: z.boolean().default(true),
})

// --- Admin: schedule rules -------------------------------------------------

export const scheduleRuleInputSchema = z
  .object({
    courseTypeId: objectIdSchema,
    title: z.string().trim().min(1).max(120),
    recurrence: recurrenceSchema,
    startTime: timeSchema,
    durationMins: z.number().int().min(15).max(600),
    capacity: z.number().int().min(1).max(200),
    breaks: z.array(sessionBreakSchema).default([]),
    effectiveFrom: dateKeySchema,
    effectiveTo: dateKeySchema.nullable().default(null),
    active: z.boolean().default(true),
  })
  .refine((r) => r.recurrence.freq !== 'WEEKLY' || r.recurrence.byWeekday.length > 0, {
    message: 'Pick at least one weekday for a weekly rule',
    path: ['recurrence', 'byWeekday'],
  })

// --- Admin: sessions -------------------------------------------------------

export const sessionCreateSchema = z.object({
  courseTypeId: objectIdSchema,
  date: dateKeySchema,
  startTime: timeSchema,
  durationMins: z.number().int().min(15).max(600),
  capacity: z.number().int().min(1).max(200),
  title: z.string().trim().max(120).default(''),
  notes: z.string().trim().max(1000).default(''),
  breaks: z.array(sessionBreakSchema).default([]),
})

export const sessionUpdateSchema = z.object({
  date: dateKeySchema.optional(),
  startTime: timeSchema.optional(),
  durationMins: z.number().int().min(15).max(600).optional(),
  capacity: z.number().int().min(1).max(200).optional(),
  heldBack: z.number().int().min(0).max(200).optional(),
  title: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(1000).optional(),
  breaks: z.array(sessionBreakSchema).optional(),
  /** Email the students already booked about the change. Defaults to true when the time moves. */
  notifyStudents: z.boolean().optional(),
})

export const sessionCancelSchema = z.object({
  reason: z.string().trim().max(300).default(''),
  notifyStudents: z.boolean().default(true),
})

/** The admin "minus button": withhold or release places without touching capacity. */
export const adjustHeldBackSchema = z.object({
  delta: z.number().int().min(-50).max(50),
})

// --- Admin: closed dates & away periods ------------------------------------

export const closedDateInputSchema = z
  .object({
    startDate: dateKeySchema,
    endDate: dateKeySchema,
    reason: z.string().trim().max(200).default(''),
  })
  .refine((d) => d.endDate >= d.startDate, {
    message: 'End date must not be before the start date',
    path: ['endDate'],
  })

export const awayPeriodActionSchema = z.enum(['cancel_and_notify', 'hide_empty_only'])

export const applyAwayPeriodSchema = closedDateInputSchema.innerType().extend({
  action: awayPeriodActionSchema,
})

// --- Admin: students, packages, bookings ------------------------------------

export const studentInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: emailSchema,
  phone: phoneSchema,
  notes: z.string().trim().max(2000).default(''),
  marketingOptIn: z.boolean().default(false),
})

export const adminAddBookingSchema = z.object({
  sessionId: objectIdSchema,
  studentId: objectIdSchema.optional(),
  student: studentInputSchema.optional(),
  /** Let the studio seat a student even when the class is technically full. Always audited. */
  overrideCapacity: z.boolean().default(false),
  usePackage: z.boolean().default(true),
})

export const packageGrantSchema = z.object({
  studentId: objectIdSchema,
  courseTypeId: objectIdSchema,
  totalSessions: z.number().int().min(1).max(200),
  expiresAt: z.string().datetime().nullable().default(null),
  note: z.string().trim().max(300).default(''),
})

export const packageAdjustSchema = z.object({
  addSessions: z.number().int().min(-100).max(100).default(0),
  extendToDate: z.string().datetime().nullable().default(null),
  note: z.string().trim().max(300).default(''),
})

// --- Admin: email templates -------------------------------------------------

export const emailTemplateKeySchema = z.enum([
  'magic_link',
  'booking_confirmation',
  /*
   * Sent when a course is set to be confirmed by the studio by hand. The student has paid and
   * needs to hear something back immediately — silence after taking someone's money reads as a
   * failed transaction, and they book again or email to ask. This says the place is held and the
   * confirmation is coming, so `booking_confirmation` still means what it says.
   */
  'booking_pending_confirmation',
  /*
   * The other half of the same queue: a student who asked for a place on a course they have no
   * package for. Nothing has been paid, so telling them their payment is being checked — which
   * the confirmation-pending wording does — is simply untrue, and invites them to wait for a
   * confirmation that will not come until somebody asks them for money.
   */
  'booking_pending_payment',
  'reminder_2day',
  'reschedule_confirmed',
  'booking_cancelled',
  'session_moved',
  'session_cancelled',
  'package_low',
  'package_expiring',
  'admin_password_reset',
  'admin_new_booking',
  /** A paid place is waiting for the studio to check the money arrived. */
  'admin_awaiting_confirmation',
  /** The same queue, but nobody has paid — the studio has to ask for the money first. */
  'admin_awaiting_payment',
  'admin_daily_digest',
])

export const emailTemplateInputSchema = z.object({
  subject: z.string().trim().min(1).max(200),
  bodyHtml: z.string().min(1).max(50_000),
  bodyText: z.string().max(20_000).default(''),
})

export const sendTestEmailSchema = z.object({
  to: emailSchema,
})

export type StartBookingInput = z.infer<typeof startBookingSchema>
export type SessionCreateInput = z.infer<typeof sessionCreateSchema>
export type SessionUpdateInput = z.infer<typeof sessionUpdateSchema>
export type ScheduleRuleInput = z.infer<typeof scheduleRuleInputSchema>
export type CourseTypeInput = z.infer<typeof courseTypeInputSchema>
export type ClosedDateInput = z.infer<typeof closedDateInputSchema>
export type AdminAddBookingInput = z.infer<typeof adminAddBookingSchema>
export type PackageGrantInput = z.infer<typeof packageGrantSchema>
export type EmailTemplateKey = z.infer<typeof emailTemplateKeySchema>

/**
 * What a student can edit on their own page.
 *
 * Their email is not here on purpose: it is the identity their sign-in links and every
 * confirmation depend on, so changing it is a request to the studio rather than a form field.
 */
export const studentSelfUpdateSchema = z.object({
  name: z.string().trim().min(1, 'Please enter your name').max(120),
  phone: phoneSchema,
  marketingOptIn: z.boolean(),
})

export type StudentSelfUpdateInput = z.infer<typeof studentSelfUpdateSchema>
