import type { EmailTemplateKey } from '@mizuki/shared'
import { EmailTemplateModel } from '../models/index.js'
import { logger } from '../logger.js'

/**
 * Default wording for every message the system sends.
 *
 * These ship in code so a fresh install works, but the admin console writes overrides into
 * `EmailTemplate`, which shadow them — that is how the studio rewords "we look forward to
 * seeing you" without a deploy. Deleting the override restores the default below.
 */

export interface TemplateDefinition {
  /** Shown in the admin template editor. */
  label: string
  description: string
  subject: string
  bodyHtml: string
  bodyText: string
  /** Offered as a click-to-insert palette in the editor. */
  variables: string[]
}

/** Wraps body copy in the studio's colours. Kept inline — email clients strip <style> blocks. */
function layout(inner: string): string {
  return `<div style="margin:0;padding:24px 12px;background:#faf7f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #ece5e0;">
    <div style="padding:24px 28px 8px;">
      <div style="font-size:18px;letter-spacing:0.14em;text-transform:uppercase;color:#6b5b73;font-weight:600;">Mizuki Flora</div>
    </div>
    <div style="padding:8px 28px 28px;color:#3a3336;font-size:15px;line-height:1.65;">
${inner}
    </div>
    <div style="padding:16px 28px;background:#faf7f5;border-top:1px solid #ece5e0;color:#8b7f86;font-size:12px;line-height:1.6;">
      Mizuki Flora · #2/F, 148 Jalan Besar, Singapore 208866<br />
      <a href="{{siteUrl}}" style="color:#8b7f86;">mizuki.com.sg</a>
    </div>
  </div>
</div>`
}

const button = (label: string, url: string) =>
  `<p style="margin:24px 0;"><a href="${url}" style="display:inline-block;background:#6b5b73;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;">${label}</a></p>`

/** The class card that appears in most student emails. */
const sessionCard = `<div style="margin:20px 0;padding:16px 18px;background:#faf7f5;border-radius:8px;border-left:3px solid #6b5b73;">
      <div style="font-weight:600;font-size:16px;color:#3a3336;">{{sessionTitle}}</div>
      <div style="margin-top:6px;color:#5c5257;">{{sessionDate}}<br />{{sessionTimeRange}} ({{sessionDuration}})</div>
    </div>`

const COMMON_VARS = ['studentName', 'siteUrl', 'studioPhone']
const SESSION_VARS = ['sessionTitle', 'courseName', 'sessionDate', 'sessionTimeRange', 'sessionDuration']

export const DEFAULT_TEMPLATES: Record<EmailTemplateKey, TemplateDefinition> = {
  magic_link: {
    label: 'Sign-in link',
    description: 'Sent when a student asks to sign in or needs to confirm a booking.',
    subject: 'Your Mizuki Flora sign-in link',
    bodyHtml: layout(`<p>Hello {{studentName}},</p>
      <p>Here is your sign-in link. It works once and expires in 30 minutes.</p>
      ${button('Sign in', '{{magicLinkUrl}}')}
      <p style="color:#8b7f86;font-size:13px;">If you did not ask for this, you can ignore this email — nothing will happen.</p>`),
    bodyText: `Hello {{studentName}},\n\nHere is your sign-in link (works once, expires in 30 minutes):\n{{magicLinkUrl}}\n\nIf you did not ask for this, you can ignore this email.\n\nMizuki Flora`,
    variables: [...COMMON_VARS, 'magicLinkUrl'],
  },

  booking_confirmation: {
    label: 'Booking confirmation',
    description: 'Sent the moment a place is confirmed.',
    subject: 'Your place is confirmed — {{sessionTitle}}',
    bodyHtml: layout(`<p>Hello {{studentName}},</p>
      <p>Your place is confirmed. We look forward to seeing you.</p>
      ${sessionCard}
      <p>{{packageLine}}</p>
      <p style="color:#5c5257;">You can change this booking until <strong>{{rescheduleDeadline}}</strong>.</p>
      ${button('View my bookings', '{{myBookingsUrl}}')}
      <p style="color:#8b7f86;font-size:13px;">A calendar invitation is attached to this email.</p>`),
    bodyText: `Hello {{studentName}},\n\nYour place is confirmed.\n\n{{sessionTitle}}\n{{sessionDate}}\n{{sessionTimeRange}} ({{sessionDuration}})\n\n{{packageLine}}\n\nYou can change this booking until {{rescheduleDeadline}}.\n{{myBookingsUrl}}\n\nMizuki Flora`,
    variables: [...COMMON_VARS, ...SESSION_VARS, 'rescheduleDeadline', 'packageLine', 'myBookingsUrl'],
  },

  reminder_2day: {
    label: 'Class reminder (2 days before)',
    description: 'Sent automatically two days before the class.',
    subject: 'See you in 2 days — {{sessionTitle}}',
    bodyHtml: layout(`<p>Hello {{studentName}},</p>
      <p>A reminder that your class is in two days.</p>
      ${sessionCard}
      <p>We are at <strong>#2/F, 148 Jalan Besar, Singapore 208866</strong>. Everything you need is provided — just bring yourself.</p>
      <p style="color:#5c5257;">Need to change something? Reply to this email or call us on {{studioPhone}}.</p>`),
    bodyText: `Hello {{studentName}},\n\nA reminder that your class is in two days.\n\n{{sessionTitle}}\n{{sessionDate}}\n{{sessionTimeRange}} ({{sessionDuration}})\n\nWe are at #2/F, 148 Jalan Besar, Singapore 208866.\n\nNeed to change something? Reply to this email or call {{studioPhone}}.\n\nMizuki Flora`,
    variables: [...COMMON_VARS, ...SESSION_VARS, 'myBookingsUrl'],
  },

  reschedule_confirmed: {
    label: 'Reschedule confirmation',
    description: 'Sent when a student moves to a different class.',
    subject: 'Your class has been moved — {{sessionTitle}}',
    bodyHtml: layout(`<p>Hello {{studentName}},</p>
      <p>Your booking has been moved. Your new class is:</p>
      ${sessionCard}
      <p style="color:#8b7f86;">Previously: {{previousSessionDate}}, {{previousSessionTimeRange}}</p>
      <p style="color:#5c5257;">You can change this booking until <strong>{{rescheduleDeadline}}</strong>.</p>
      ${button('View my bookings', '{{myBookingsUrl}}')}`),
    bodyText: `Hello {{studentName}},\n\nYour booking has been moved.\n\nNew class:\n{{sessionTitle}}\n{{sessionDate}}\n{{sessionTimeRange}} ({{sessionDuration}})\n\nPreviously: {{previousSessionDate}}, {{previousSessionTimeRange}}\n\nYou can change this booking until {{rescheduleDeadline}}.\n\nMizuki Flora`,
    variables: [...COMMON_VARS, ...SESSION_VARS, 'previousSessionDate', 'previousSessionTimeRange', 'rescheduleDeadline', 'myBookingsUrl'],
  },

  booking_cancelled: {
    label: 'Booking cancelled',
    description: 'Sent when a student cancels, or the studio cancels on their behalf.',
    subject: 'Your booking has been cancelled — {{sessionTitle}}',
    bodyHtml: layout(`<p>Hello {{studentName}},</p>
      <p>Your booking for the class below has been cancelled.</p>
      ${sessionCard}
      <p>{{packageLine}}</p>
      ${button('Book another class', '{{bookingUrl}}')}`),
    bodyText: `Hello {{studentName}},\n\nYour booking has been cancelled.\n\n{{sessionTitle}}\n{{sessionDate}}\n{{sessionTimeRange}}\n\n{{packageLine}}\n\nBook another class: {{bookingUrl}}\n\nMizuki Flora`,
    variables: [...COMMON_VARS, ...SESSION_VARS, 'packageLine', 'bookingUrl'],
  },

  session_moved: {
    label: 'Class time changed',
    description: 'Sent to everyone booked when the studio moves a class.',
    subject: 'Your class time has changed — {{sessionTitle}}',
    bodyHtml: layout(`<p>Hello {{studentName}},</p>
      <p>We have had to move a class you are booked into. Our apologies for the change.</p>
      <p style="color:#8b7f86;text-decoration:line-through;">{{previousSessionDate}}, {{previousSessionTimeRange}}</p>
      ${sessionCard}
      <p>Your place has moved across automatically — there is nothing you need to do.</p>
      <p style="color:#5c5257;">If the new time does not suit you, reply to this email or call {{studioPhone}} and we will find you another date.</p>`),
    bodyText: `Hello {{studentName}},\n\nWe have had to move a class you are booked into.\n\nWas: {{previousSessionDate}}, {{previousSessionTimeRange}}\nNow: {{sessionDate}}, {{sessionTimeRange}}\n\nYour place has moved across automatically.\n\nIf the new time does not suit, reply to this email or call {{studioPhone}}.\n\nMizuki Flora`,
    variables: [...COMMON_VARS, ...SESSION_VARS, 'previousSessionDate', 'previousSessionTimeRange'],
  },

  session_cancelled: {
    label: 'Class cancelled by the studio',
    description: 'Sent to everyone booked when the studio cancels a class.',
    subject: 'Class cancelled — {{sessionTitle}}',
    bodyHtml: layout(`<p>Hello {{studentName}},</p>
      <p>We are sorry — we have had to cancel the class below.</p>
      ${sessionCard}
      <p>{{cancelReasonLine}}</p>
      <p>{{packageLine}}</p>
      ${button('Choose another date', '{{bookingUrl}}')}
      <p style="color:#5c5257;">If you would rather we arranged something for you, reply to this email or call {{studioPhone}}.</p>`),
    bodyText: `Hello {{studentName}},\n\nWe are sorry — we have had to cancel this class.\n\n{{sessionTitle}}\n{{sessionDate}}\n{{sessionTimeRange}}\n\n{{cancelReasonLine}}\n\n{{packageLine}}\n\nChoose another date: {{bookingUrl}}\n\nMizuki Flora`,
    variables: [...COMMON_VARS, ...SESSION_VARS, 'cancelReasonLine', 'packageLine', 'bookingUrl'],
  },

  package_low: {
    label: 'Course package running low',
    description: 'Sent once when a student has one session left.',
    subject: 'You have {{sessionsRemaining}} session left in your {{courseName}} course',
    bodyHtml: layout(`<p>Hello {{studentName}},</p>
      <p>You have <strong>{{sessionsRemaining}}</strong> session remaining in your {{courseName}} course package.</p>
      <p>Do let us know if you would like to add more — reply to this email or call {{studioPhone}}.</p>
      ${button('Book your next class', '{{bookingUrl}}')}`),
    bodyText: `Hello {{studentName}},\n\nYou have {{sessionsRemaining}} session remaining in your {{courseName}} course package.\n\nLet us know if you would like to add more — reply to this email or call {{studioPhone}}.\n\nMizuki Flora`,
    variables: [...COMMON_VARS, 'courseName', 'sessionsRemaining', 'bookingUrl'],
  },

  package_expiring: {
    label: 'Course package expiring',
    description: 'Sent two weeks before a package expires with sessions unused.',
    subject: 'Your {{courseName}} course expires on {{packageExpiryDate}}',
    bodyHtml: layout(`<p>Hello {{studentName}},</p>
      <p>Your {{courseName}} course package expires on <strong>{{packageExpiryDate}}</strong>, and you still have <strong>{{sessionsRemaining}}</strong> session(s) to use.</p>
      ${button('Book a class', '{{bookingUrl}}')}
      <p style="color:#5c5257;">If you need more time, just ask — we are happy to extend it.</p>`),
    bodyText: `Hello {{studentName}},\n\nYour {{courseName}} course package expires on {{packageExpiryDate}} and you still have {{sessionsRemaining}} session(s) to use.\n\nBook a class: {{bookingUrl}}\n\nIf you need more time, just ask.\n\nMizuki Flora`,
    variables: [...COMMON_VARS, 'courseName', 'sessionsRemaining', 'packageExpiryDate', 'bookingUrl'],
  },

  admin_new_booking: {
    label: 'Admin alert — new booking',
    description: 'Sent to the studio the moment someone books.',
    subject: 'New booking: {{studentName}} — {{sessionTitle}}, {{sessionDate}}',
    bodyHtml: layout(`<p><strong>{{studentName}}</strong> has just booked.</p>
      ${sessionCard}
      <p style="color:#5c5257;">Email: {{studentEmail}}<br />Phone: {{studentPhone}}<br />Booked via: {{bookingSource}}</p>
      <p style="color:#5c5257;">Places now taken: <strong>{{seatsTaken}} of {{capacity}}</strong> ({{seatsLeft}} left).</p>
      <p>{{packageLine}}</p>
      ${button('Open the class', '{{adminSessionUrl}}')}`),
    bodyText: `{{studentName}} has just booked.\n\n{{sessionTitle}}\n{{sessionDate}} · {{sessionTimeRange}}\n\nEmail: {{studentEmail}}\nPhone: {{studentPhone}}\nVia: {{bookingSource}}\n\nPlaces taken: {{seatsTaken}} of {{capacity}} ({{seatsLeft}} left).\n{{packageLine}}\n\n{{adminSessionUrl}}`,
    variables: [
      ...SESSION_VARS,
      'studentName',
      'studentEmail',
      'studentPhone',
      'bookingSource',
      'seatsTaken',
      'seatsLeft',
      'capacity',
      'packageLine',
      'adminSessionUrl',
    ],
  },

  admin_daily_digest: {
    label: 'Admin daily digest',
    description: "Sent each morning with the day's classes and numbers.",
    subject: 'Today at Mizuki: {{sessionCount}} classes, {{studentCount}} students',
    bodyHtml: layout(`<p>Good morning. Here is today, {{todayDate}}:</p>
      {{sessionListHtml}}
      ${button('Open the calendar', '{{adminCalendarUrl}}')}`),
    bodyText: `Good morning. Here is today, {{todayDate}}:\n\n{{sessionListText}}\n\n{{adminCalendarUrl}}`,
    variables: ['todayDate', 'sessionCount', 'studentCount', 'sessionListHtml', 'sessionListText', 'adminCalendarUrl'],
  },
}

/**
 * Fill `{{placeholders}}`.
 *
 * An unknown placeholder renders as an empty string rather than being left on the page —
 * a student should never receive an email with a literal `{{packageLine}}` in it because
 * the studio pasted a variable that does not apply to that message.
 */
export function renderString(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, name: string) => {
    const value = vars[name]
    return value === undefined || value === null ? '' : String(value)
  })
}

export interface RenderedTemplate {
  subject: string
  html: string
  text: string
}

/** Resolve a template — admin override if one exists, otherwise the shipped default — and fill it. */
export async function renderTemplate(
  key: EmailTemplateKey,
  vars: Record<string, string | number>,
): Promise<RenderedTemplate> {
  const override = await EmailTemplateModel.findOne({ key }).lean()
  const fallback = DEFAULT_TEMPLATES[key]

  const subject = override?.subject ?? fallback.subject
  const bodyHtml = override?.bodyHtml ?? fallback.bodyHtml
  const bodyText = override?.bodyText || fallback.bodyText

  return {
    subject: renderString(subject, vars),
    html: renderString(bodyHtml, vars),
    text: renderString(bodyText, vars),
  }
}

/** Write the defaults into the database so the admin editor opens on real, editable copy. */
export async function seedEmailTemplates(): Promise<number> {
  let created = 0

  for (const [key, def] of Object.entries(DEFAULT_TEMPLATES)) {
    const existing = await EmailTemplateModel.exists({ key })
    if (existing) continue

    await EmailTemplateModel.create({
      key,
      subject: def.subject,
      bodyHtml: def.bodyHtml,
      bodyText: def.bodyText,
      updatedBy: 'seed',
    })
    created++
  }

  logger.info({ created }, 'Email templates seeded')
  return created
}

/** Restore one template to its shipped wording. */
export async function resetTemplate(key: EmailTemplateKey): Promise<void> {
  const def = DEFAULT_TEMPLATES[key]
  await EmailTemplateModel.findOneAndUpdate(
    { key },
    { $set: { subject: def.subject, bodyHtml: def.bodyHtml, bodyText: def.bodyText, updatedBy: 'reset' } },
    { upsert: true },
  )
}
