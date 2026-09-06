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

/**
 * The studio's colours, in one place.
 *
 * Every email is assembled from the three helpers below, so changing a colour here changes all
 * fifteen messages at once rather than fifteen edits with one missed.
 */
export const BRAND = {
  /** Buttons, headings and the rule down the side of a class card. */
  primary: '#028097',
  /** Text on that colour. */
  onPrimary: '#ffffff',
  ink: '#22333b',
  muted: '#6b7c84',
  page: '#f4f8f9',
  card: '#ffffff',
  line: '#dbe6ea',
  logoUrl: 'https://mizuki.com.sg/wp-content/uploads/2024/05/mizuki_logo.png',
} as const

/**
 * Wraps body copy in the studio's colours. Kept inline — email clients strip <style> blocks.
 *
 * The logo is a linked image with the studio's name as its alt text, because most mail clients
 * hide images until the reader asks for them: what arrives by default is a wordmark in the right
 * colour, not a broken-image icon and a blank space where the sender should be.
 */
function layout(inner: string): string {
  return `<div style="margin:0;padding:24px 12px;background:${BRAND.page};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:${BRAND.card};border-radius:12px;overflow:hidden;border:1px solid ${BRAND.line};">
    <div style="padding:26px 28px 10px;border-top:4px solid ${BRAND.primary};">
      <a href="{{siteUrl}}" style="text-decoration:none;color:${BRAND.primary};font-size:18px;letter-spacing:0.14em;text-transform:uppercase;font-weight:600;">
        <img src="${BRAND.logoUrl}" alt="Mizuki Flora" width="150" style="display:block;width:150px;max-width:60%;height:auto;border:0;outline:none;text-decoration:none;" />
      </a>
    </div>
    <div style="padding:8px 28px 28px;color:${BRAND.ink};font-size:15px;line-height:1.65;">
${inner}
    </div>
    <div style="padding:16px 28px;background:${BRAND.page};border-top:1px solid ${BRAND.line};color:${BRAND.muted};font-size:12px;line-height:1.6;">
      Mizuki Flora · #2/F, 148 Jalan Besar, Singapore 208866<br />
      <a href="{{siteUrl}}" style="color:${BRAND.primary};">mizuki.com.sg</a>
    </div>
  </div>
</div>`
}

/**
 * The same shell, for the handful of emails assembled in code rather than from a template.
 *
 * A course package confirmation and a set-course confirmation are both sent straight from the
 * shop webhook, and both used to go out as bare paragraphs on a white page — the two messages a
 * student receives right after paying, and the two that looked least like the studio. They are
 * written in code because their content is a list built at send time, not because they deserved
 * to look different.
 */
export function wrapEmailHtml(inner: string, siteUrl: string): string {
  return renderString(layout(inner), { siteUrl })
}

const button = (label: string, url: string) =>
  `<p style="margin:24px 0;"><a href="${url}" style="display:inline-block;background:${BRAND.primary};color:${BRAND.onPrimary};text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;">${label}</a></p>`

/** The class card that appears in most student emails. */
const sessionCard = `<div style="margin:20px 0;padding:16px 18px;background:${BRAND.page};border-radius:8px;border-left:3px solid ${BRAND.primary};">
      <div style="font-weight:600;font-size:16px;color:${BRAND.ink};">{{sessionTitle}}</div>
      <div style="margin-top:6px;color:${BRAND.muted};">{{sessionDate}}<br />{{sessionTimeRange}} ({{sessionDuration}})</div>
    </div>`

const COMMON_VARS = ['studentName', 'siteUrl', 'studioPhone']
const SESSION_VARS = ['sessionTitle', 'courseName', 'sessionDate', 'sessionTimeRange', 'sessionDuration']

export const DEFAULT_TEMPLATES: Record<EmailTemplateKey, TemplateDefinition> = {
  magic_link: {
    label: 'Sign-in link',
    description: 'Sent when a student asks to sign in or needs to confirm a booking.',
    subject: 'Your Mizuki Flora sign-in link',
    bodyHtml: layout(`<p>Hello {{studentName}},</p>
      <p>Here is your sign-in link. It works once, and stays valid for {{expiryHours}} hours.</p>
      ${button('Sign in', '{{magicLinkUrl}}')}
      <p style="color:${BRAND.muted};font-size:13px;">If you did not ask for this, you can ignore this email — nothing will happen.</p>`),
    bodyText: `Hello {{studentName}},\n\nHere is your sign-in link (works once, valid for {{expiryHours}} hours):\n{{magicLinkUrl}}\n\nIf you did not ask for this, you can ignore this email.\n\nMizuki Flora`,
    variables: [...COMMON_VARS, 'magicLinkUrl', 'expiryHours'],
  },

  booking_confirmation: {
    label: 'Booking confirmation',
    description: 'Sent the moment a place is confirmed.',
    subject: 'Your place is confirmed — {{sessionTitle}}',
    bodyHtml: layout(`<p>Hello {{studentName}},</p>
      <p>Your place is confirmed. We look forward to seeing you.</p>
      ${sessionCard}
      <p>{{packageLine}}</p>
      <p style="color:${BRAND.muted};">You can change this booking until <strong>{{rescheduleDeadline}}</strong>.</p>
      ${button('View my bookings', '{{myBookingsUrl}}')}
      <p style="color:${BRAND.muted};font-size:13px;">A calendar invitation is attached to this email.</p>`),
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
      <p style="color:${BRAND.muted};">Need to change something? Reply to this email or call us on {{studioPhone}}.</p>`),
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
      <p style="color:${BRAND.muted};">Previously: {{previousSessionDate}}, {{previousSessionTimeRange}}</p>
      <p style="color:${BRAND.muted};">You can change this booking until <strong>{{rescheduleDeadline}}</strong>.</p>
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
      <p style="color:${BRAND.muted};text-decoration:line-through;">{{previousSessionDate}}, {{previousSessionTimeRange}}</p>
      ${sessionCard}
      <p>Your place has moved across automatically — there is nothing you need to do.</p>
      <p style="color:${BRAND.muted};">If the new time does not suit you, reply to this email or call {{studioPhone}} and we will find you another date.</p>`),
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
      <p style="color:${BRAND.muted};">If you would rather we arranged something for you, reply to this email or call {{studioPhone}}.</p>`),
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
      <p style="color:${BRAND.muted};">If you need more time, just ask — we are happy to extend it.</p>`),
    bodyText: `Hello {{studentName}},\n\nYour {{courseName}} course package expires on {{packageExpiryDate}} and you still have {{sessionsRemaining}} session(s) to use.\n\nBook a class: {{bookingUrl}}\n\nIf you need more time, just ask.\n\nMizuki Flora`,
    variables: [...COMMON_VARS, 'courseName', 'sessionsRemaining', 'packageExpiryDate', 'bookingUrl'],
  },

  booking_pending_confirmation: {
    label: 'Payment received — awaiting confirmation',
    description:
      'Sent instead of the confirmation when a course is set to be confirmed by the studio by hand. Reassures the student their payment arrived and their place is held.',
    subject: 'We have your booking — {{sessionTitle}}, {{sessionDate}}',
    bodyHtml: layout(`<p>Hello {{studentName}},</p>
      <p>Thank you — we have received your booking and your place is held for you.</p>
      ${sessionCard}
      <p>We check each payment by hand, so your confirmation will follow shortly. There is nothing else you need to do, and you do not need to book again.</p>
      <p style="color:${BRAND.muted};">If anything looks wrong, just reply to this email.</p>`),
    bodyText: `Hello {{studentName}},\n\nThank you — we have received your booking and your place is held for you.\n\n{{sessionTitle}}\n{{sessionDate}} · {{sessionTimeRange}}\n\nWe check each payment by hand, so your confirmation will follow shortly. There is nothing else you need to do, and you do not need to book again.\n\nIf anything looks wrong, just reply to this email.`,
    variables: [...COMMON_VARS],
  },

  booking_pending_payment: {
    label: 'Place reserved — payment to arrange',
    description:
      'Sent when someone books a course they have no package for. Their place is held; the studio still needs to arrange payment with them.',
    subject: 'Your place is reserved — {{sessionTitle}}, {{sessionDate}}',
    bodyHtml: layout(`<p>Hello {{studentName}},</p>
      <p>Thank you for booking. <strong>Your place is reserved and is being held for you.</strong></p>
      ${sessionCard}
      <p>It is not confirmed yet — we will be in touch shortly to arrange payment, and your place is confirmed as soon as that is settled. Nobody else can take it in the meantime.</p>
      <p style="color:${BRAND.muted};">If you would rather sort it out now, just reply to this email or call us on {{studioPhone}}.</p>`),
    bodyText: `Hello {{studentName}},\n\nThank you for booking. Your place is reserved and is being held for you.\n\n{{sessionTitle}}\n{{sessionDate}} · {{sessionTimeRange}}\n\nIt is not confirmed yet — we will be in touch shortly to arrange payment, and your place is confirmed as soon as that is settled. Nobody else can take it in the meantime.\n\nIf you would rather sort it out now, reply to this email or call {{studioPhone}}.`,
    variables: [...COMMON_VARS, ...SESSION_VARS],
  },

  admin_awaiting_confirmation: {
    label: 'Admin alert — payment to check',
    description: 'Sent when a student has paid for a course you confirm by hand.',
    subject: 'Check payment: {{studentName}} — {{sessionTitle}}, {{sessionDate}}',
    bodyHtml: layout(`<p><strong>{{studentName}}</strong> has paid and is waiting for you to confirm their place.</p>
      ${sessionCard}
      <p style="color:${BRAND.muted};">Email: {{studentEmail}}<br />Phone: {{studentPhone}}<br />Shop order: {{wooOrderId}}</p>
      <p style="color:${BRAND.muted};">Their place is held in the meantime, so nobody else can take it.</p>
      ${button('Check and confirm', '{{adminSessionUrl}}')}`),
    bodyText: `{{studentName}} has paid and is waiting for you to confirm their place.\n\n{{sessionTitle}}\n{{sessionDate}} · {{sessionTimeRange}}\n\nEmail: {{studentEmail}}\nPhone: {{studentPhone}}\nShop order: {{wooOrderId}}\n\nTheir place is held in the meantime, so nobody else can take it.\n\n{{adminSessionUrl}}`,
    variables: [
      ...SESSION_VARS,
      'studentName',
      'studentEmail',
      'studentPhone',
      'seatsLeft',
      'capacity',
      'wooOrderId',
      'adminSessionUrl',
    ],
  },

  admin_password_reset: {
    label: 'Admin password reset',
    description: 'Sent when someone with a studio login asks to reset their password.',
    subject: 'Reset your Mizuki Flora studio password',
    bodyHtml: layout(`<p>Hello {{studentName}},</p>
      <p>Someone asked to reset the password on your studio login. This link works once and expires in {{expiryHours}} hours.</p>
      ${button('Choose a new password', '{{resetUrl}}')}
      <p style="color:${BRAND.muted};font-size:13px;">If that was not you, you can ignore this email — your password has not changed.</p>`),
    bodyText: `Hello {{studentName}},\n\nSomeone asked to reset the password on your studio login. This link works once and expires in {{expiryHours}} hours:\n{{resetUrl}}\n\nIf that was not you, you can ignore this email — your password has not changed.\n\nMizuki Flora`,
    variables: ['studentName', 'resetUrl', 'expiryHours', 'siteUrl'],
  },

  admin_awaiting_payment: {
    label: 'Admin alert — payment to arrange',
    description: 'Sent when someone books a course they have no package for. Nothing has been paid yet.',
    subject: 'New request: {{studentName}} — {{sessionTitle}}, {{sessionDate}}',
    bodyHtml: layout(`<p><strong>{{studentName}}</strong> has asked for a place and needs payment arranging.</p>
      ${sessionCard}
      <p style="color:${BRAND.muted};">Email: {{studentEmail}}<br />Phone: {{studentPhone}}</p>
      <p style="color:${BRAND.muted};">They have no {{courseName}} package yet, so nothing has been paid. Their place is held in the meantime, so nobody else can take it.</p>
      ${button('Arrange payment and confirm', '{{adminSessionUrl}}')}`),
    bodyText: `{{studentName}} has asked for a place and needs payment arranging.\n\n{{sessionTitle}}\n{{sessionDate}} · {{sessionTimeRange}}\n\nEmail: {{studentEmail}}\nPhone: {{studentPhone}}\n\nThey have no {{courseName}} package yet, so nothing has been paid. Their place is held in the meantime.\n\n{{adminSessionUrl}}`,
    variables: [...SESSION_VARS, 'studentName', 'studentEmail', 'studentPhone', 'adminSessionUrl'],
  },

  admin_new_booking: {
    label: 'Admin alert — new booking',
    description: 'Sent to the studio the moment someone books.',
    subject: 'New booking: {{studentName}} — {{sessionTitle}}, {{sessionDate}}',
    bodyHtml: layout(`<p><strong>{{studentName}}</strong> has just booked.</p>
      ${sessionCard}
      <p style="color:${BRAND.muted};">Email: {{studentEmail}}<br />Phone: {{studentPhone}}<br />Booked via: {{bookingSource}}</p>
      <p style="color:${BRAND.muted};">Places now taken: <strong>{{seatsTaken}} of {{capacity}}</strong> ({{seatsLeft}} left).</p>
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
  /**
   * Wording to render instead of what is stored.
   *
   * Only the editor's preview passes this. Without it the preview rendered the *saved* template,
   * so the studio could rewrite an email, press Preview, and be shown the old copy — which reads
   * as the edit not having worked and invites them to save something they never actually saw.
   */
  draft?: { subject?: string; bodyHtml?: string; bodyText?: string },
): Promise<RenderedTemplate> {
  const override = await EmailTemplateModel.findOne({ key }).lean()
  const fallback = DEFAULT_TEMPLATES[key]

  const subject = draft?.subject ?? override?.subject ?? fallback.subject
  const bodyHtml = draft?.bodyHtml ?? override?.bodyHtml ?? fallback.bodyHtml
  const bodyText = draft?.bodyText || override?.bodyText || fallback.bodyText

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

/**
 * Wording nobody has touched, that can therefore be brought up to date.
 *
 * `seed` is a row written by the seeder; `reset` is one the studio explicitly put back to the
 * shipped version. Both mean "whatever you ship", so both may be replaced. Anything else is
 * somebody's own writing and is never overwritten.
 */
const UNTOUCHED = ['', 'seed', 'reset']

/**
 * Bring the shipped wording up to date on an install that has already been seeded.
 *
 * A stored row shadows the default in code, which is what lets the studio reword an email — and
 * also means a change to the design here reaches nobody who is already running the system. The
 * seeder only ever creates rows it finds missing, so on a live install a new colour or a logo
 * would sit in the source doing nothing at all, which is a change that looks made and is not.
 *
 * Only rows nobody has edited are replaced. Somebody's own wording is theirs, and losing it to a
 * deploy would be far worse than an email in last season's colours — those are listed by
 * `staleBranding` instead, so the console can offer to reset them.
 */
export async function refreshDefaultTemplates(): Promise<number> {
  let updated = 0

  for (const [key, def] of Object.entries(DEFAULT_TEMPLATES)) {
    const row = await EmailTemplateModel.findOne({ key })
    if (!row || !UNTOUCHED.includes(row.updatedBy ?? '')) continue
    if (row.subject === def.subject && row.bodyHtml === def.bodyHtml && row.bodyText === def.bodyText) {
      continue
    }

    row.subject = def.subject
    row.bodyHtml = def.bodyHtml
    row.bodyText = def.bodyText
    row.updatedBy = 'seed'
    await row.save()
    updated++
  }

  if (updated > 0) logger.info({ updated }, 'Refreshed unedited email templates to the shipped wording')
  return updated
}

/**
 * Is this stored wording still on the old look?
 *
 * True only for a template the studio has written themselves — the rest are refreshed on boot.
 * It is what lets the console say "your version of this one still uses the old colours" rather
 * than leaving somebody to notice that one email in fifteen looks different.
 */
export function usesCurrentBranding(bodyHtml: string): boolean {
  return bodyHtml.includes(BRAND.primary) || bodyHtml.includes(BRAND.logoUrl)
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
