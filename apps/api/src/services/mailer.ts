import { Resend } from 'resend'
import { createEvent, type EventAttributes } from 'ics'
import webpush from 'web-push'
import { DateTime } from 'luxon'
import { STUDIO_TZ } from '@mizuki/shared'
import { OutboxModel, PushSubscriptionModel, SessionModel, type OutboxDoc } from '../models/index.js'
import { config } from '../config.js'
import { PLAIN_KEYS, SECRET_KEYS, getPlain, getSecret } from './secretStore.js'
import { logger } from '../logger.js'

/**
 * Drains the Outbox.
 *
 * Deliberately not Hostinger's SMTP: shared-host mail is rate-limited and lands in spam, and a
 * class reminder that silently does not arrive is worse than no reminder feature at all. Resend
 * with SPF/DKIM on mizuki.com.sg is the sending path; Telegram and web push are for the studio's
 * own instant alerts.
 */

/**
 * Built per send rather than once at boot, because the studio can change the key from the
 * console. A client captured at startup would keep using the old key until the next deploy —
 * which is precisely when someone has just pasted a new one and is watching to see it work.
 * The key itself is cached for a minute in the secret store, so this is not a database read
 * per message.
 */
let cachedClient: { key: string; client: Resend } | null = null

async function resendClient(): Promise<Resend | null> {
  const key = await getSecret(SECRET_KEYS.resendApiKey, config.RESEND_API_KEY)
  if (!key) return null

  if (!cachedClient || cachedClient.key !== key) {
    cachedClient = { key, client: new Resend(key) }
  }
  return cachedClient.client
}

if (config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(config.VAPID_SUBJECT, config.VAPID_PUBLIC_KEY, config.VAPID_PRIVATE_KEY)
}

const MAX_ATTEMPTS = 5
/** Back off 1, 4, 9, 16 minutes — a transient provider blip resolves without hammering it. */
const backoffMs = (attempts: number) => attempts * attempts * 60_000

export interface DrainResult {
  sent: number
  failed: number
  skipped: number
}

/**
 * Claim and send whatever is due.
 *
 * Claiming is a conditional update from `pending` to `sending`, so two overlapping cron runs
 * cannot both pick up the same message and send it twice.
 */
export async function drainOutbox(limit = 25): Promise<DrainResult> {
  const result: DrainResult = { sent: 0, failed: 0, skipped: 0 }
  const now = new Date()

  for (let i = 0; i < limit; i++) {
    const message = await OutboxModel.findOneAndUpdate(
      { status: 'pending', availableAt: { $lte: now } },
      { $set: { status: 'sending' }, $inc: { attempts: 1 } },
      { new: true, sort: { availableAt: 1 } },
    )
    if (!message) break

    try {
      const delivered = await deliver(message)
      if (delivered) {
        message.status = 'sent'
        message.sentAt = new Date()
        result.sent++
      } else {
        // No transport configured for this channel — park it rather than retrying forever.
        message.status = 'failed'
        message.lastError = 'No transport configured for this channel'
        result.skipped++
      }
      await message.save()
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      const exhausted = message.attempts >= MAX_ATTEMPTS

      message.status = exhausted ? 'failed' : 'pending'
      message.lastError = reason
      message.availableAt = new Date(Date.now() + backoffMs(message.attempts))
      await message.save()

      result.failed++
      logger.error(
        { err, type: message.type, dedupeKey: message.dedupeKey, attempts: message.attempts, exhausted },
        'Failed to deliver message',
      )
    }
  }

  return result
}

async function deliver(message: OutboxDoc): Promise<boolean> {
  switch (message.channel) {
    case 'email':
      return sendEmail(message)
    case 'telegram':
      return sendTelegram(message)
    case 'webpush':
      return sendWebPush(message)
    default:
      return false
  }
}

async function sendEmail(message: OutboxDoc): Promise<boolean> {
  const resend = await resendClient()
  if (!resend) {
    logger.warn({ type: message.type }, 'No Resend API key configured — email not sent')
    return false
  }
  if (!message.to) throw new Error('Email message has no recipient')

  const attachments = []
  const payload = message.payload as { attachIcs?: boolean } | undefined
  if (payload?.attachIcs && message.relatedSessionId) {
    const ics = await buildIcs(String(message.relatedSessionId))
    if (ics) attachments.push({ filename: 'mizuki-class.ics', content: Buffer.from(ics).toString('base64') })
  }

  const [from, replyTo] = await Promise.all([
    getPlain(PLAIN_KEYS.mailFrom, config.MAIL_FROM),
    getPlain(PLAIN_KEYS.mailReplyTo, config.MAIL_REPLY_TO),
  ])

  const { error } = await resend.emails.send({
    from: from ?? config.MAIL_FROM,
    to: message.to,
    subject: message.subject,
    html: message.bodyHtml,
    text: message.bodyText || undefined,
    ...(replyTo ? { replyTo } : {}),
    ...(attachments.length ? { attachments } : {}),
  })

  if (error) throw new Error(`Resend rejected the message: ${error.message}`)
  return true
}

async function sendTelegram(message: OutboxDoc): Promise<boolean> {
  const [token, chatId] = await Promise.all([
    getSecret(SECRET_KEYS.telegramBotToken, config.TELEGRAM_BOT_TOKEN),
    getSecret(SECRET_KEYS.telegramChatId, config.TELEGRAM_CHAT_ID),
  ])
  if (!token || !chatId) return false

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: message.bodyText,
      disable_web_page_preview: true,
    }),
  })

  if (!response.ok) {
    throw new Error(`Telegram returned ${response.status}: ${await response.text()}`)
  }
  return true
}

async function sendWebPush(message: OutboxDoc): Promise<boolean> {
  if (!config.VAPID_PUBLIC_KEY || !config.VAPID_PRIVATE_KEY) return false

  const subscriptions = await PushSubscriptionModel.find()
  if (subscriptions.length === 0) return false

  const body = JSON.stringify({
    title: message.subject || 'Mizuki Flora',
    body: message.bodyText,
    ...(message.payload as Record<string, unknown>),
  })

  let anyDelivered = false
  for (const sub of subscriptions) {
    // A subscription without its key pair cannot be encrypted to; drop it rather than throw.
    if (!sub.keys?.p256dh || !sub.keys?.auth) {
      await PushSubscriptionModel.deleteOne({ _id: sub._id })
      continue
    }
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } },
        body,
      )
      sub.lastSuccessAt = new Date()
      sub.failureCount = 0
      await sub.save()
      anyDelivered = true
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode
      // 404/410 mean the browser dropped the subscription — remove it rather than retrying forever.
      if (status === 404 || status === 410) {
        await PushSubscriptionModel.deleteOne({ _id: sub._id })
      } else {
        sub.failureCount += 1
        await sub.save()
      }
    }
  }

  return anyDelivered
}

/**
 * A calendar invitation for the class, so a student can add it to their phone in one tap.
 * Times are emitted in the studio's zone with an explicit TZID rather than as floating times,
 * so a student travelling abroad still sees the class at its Singapore hour.
 */
export async function buildIcs(sessionId: string): Promise<string | null> {
  const session = await SessionModel.findById(sessionId)
    .populate<{ courseTypeId: { name: string } }>('courseTypeId', 'name')
    .lean()
  if (!session) return null

  const start = DateTime.fromJSDate(session.startAt).setZone(STUDIO_TZ)
  const end = DateTime.fromJSDate(session.endAt).setZone(STUDIO_TZ)

  const event: EventAttributes = {
    title: session.title || session.courseTypeId.name,
    start: [start.year, start.month, start.day, start.hour, start.minute],
    end: [end.year, end.month, end.day, end.hour, end.minute],
    startInputType: 'local',
    endInputType: 'local',
    location: 'Mizuki Flora, #2/F, 148 Jalan Besar, Singapore 208866',
    url: `${config.PUBLIC_SITE_URL}/my-bookings`,
    organizer: { name: 'Mizuki Flora', email: 'mizukisg148@gmail.com' },
    productId: 'mizuki-booking',
  }

  const { error, value } = createEvent(event)
  if (error || !value) {
    logger.error({ err: error, sessionId }, 'Failed to build calendar invitation')
    return null
  }
  return value
}

/** Used by the admin template editor's "send test to me" button. */
export async function sendDirectEmail(to: string, subject: string, html: string, text: string): Promise<void> {
  const resend = await resendClient()
  if (!resend) throw new Error('Email is not set up yet — add a Resend API key under Settings.')

  const [from, replyTo] = await Promise.all([
    getPlain(PLAIN_KEYS.mailFrom, config.MAIL_FROM),
    getPlain(PLAIN_KEYS.mailReplyTo, config.MAIL_REPLY_TO),
  ])

  const { error } = await resend.emails.send({
    from: from ?? config.MAIL_FROM,
    to,
    subject,
    html,
    text,
    ...(replyTo ? { replyTo } : {}),
  })
  if (error) throw new Error(error.message)
}

/**
 * Ask Resend whether a key works, without sending anything.
 *
 * Listing domains is a read-only call, so the studio can check a key they have just pasted
 * without spending quota or emailing a real person to find out.
 */
export async function checkEmailKey(): Promise<{ ok: boolean; message: string; domains?: string[] }> {
  const resend = await resendClient()
  if (!resend) return { ok: false, message: 'No API key is set.' }

  try {
    const { data, error } = await resend.domains.list()
    if (error) return { ok: false, message: error.message }

    const domains = (data?.data ?? []).map((d) => `${d.name} (${d.status})`)
    return {
      ok: true,
      message: domains.length ? 'Key accepted.' : 'Key accepted, but no domain has been added in Resend yet.',
      domains,
    }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Could not reach Resend.' }
  }
}
