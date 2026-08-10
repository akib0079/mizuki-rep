import { z } from 'zod'
import { isDateKey } from './time.js'

/** Shared request contracts. The API validates with these; the clients build payloads against them. */

export const dateKeySchema = z.string().refine(isDateKey, 'Expected a YYYY-MM-DD date')
export const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected a HH:mm time')
export const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Expected an id')

export const emailSchema = z.string().trim().toLowerCase().email('Please enter a valid email address')

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
  phone: z.string().trim().max(40).default(''),
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
  phone: z.string().trim().max(40).default(''),
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
  'reminder_2day',
  'reschedule_confirmed',
  'booking_cancelled',
  'session_moved',
  'session_cancelled',
  'package_low',
  'package_expiring',
  'admin_new_booking',
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
