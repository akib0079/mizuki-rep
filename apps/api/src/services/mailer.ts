import { Resend } from 'resend'
import { createEvent, type EventAttributes } from 'ics'
import webpush from 'web-push'
import { DateTime } from 'luxon'
import { STUDIO_TZ } from '@mizuki/shared'
import { OutboxModel, PushSubscriptionModel, SessionModel, type OutboxDoc } from '../models/index.js'
import { config, myBookingsUrl } from '../config.js'
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
      // A permanent rejection is settled on the first attempt: four more identical failures
      // would only delay the studio seeing why, and the why is the actionable part.
      const exhausted = err instanceof PermanentDeliveryError || message.attempts >= MAX_ATTEMPTS

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

/**
 * Send what is waiting, now, without making the caller wait for it.
 *
 * The queue used to be drained only by the five-minute scheduler tick, which is fine for a
 * reminder and wrong for everything a person is sitting looking at. A student asks for a sign-in
 * link and watches an empty inbox for up to five minutes: long past the point where anyone
 * concludes it is broken, asks for another, and gives up. The studio reported exactly that, and
 * the same delay sat in front of the confirmation sent when a place is approved.
 *
 * Deliberately not awaited by callers. Booking a class must not fail, or get slower, because
 * Resend is having a bad second — that is what the queue and its retries are for. This only
 * changes when the first attempt happens.
 *
 * Coalesced behind a short timer, so a booking that queues five messages drains once rather than
 * five times, and `pending` catches anything queued while a drain is already running.
 */
let drainTimer: NodeJS.Timeout | null = null
let draining = false
let queuedWhileDraining = false

export function kickOutbox(): void {
  /*
   * Tests drive the queue explicitly and assert on what is still pending; a background drain
   * would empty it underneath them — and with no API key every message would be parked as
   * undeliverable rather than left alone.
   */
  if (config.isTest) return

  if (draining) {
    queuedWhileDraining = true
    return
  }
  if (drainTimer) return

  drainTimer = setTimeout(() => {
    drainTimer = null
    draining = true

    void drainOutbox()
      .catch((err) => logger.error({ err }, 'Immediate send failed — the next scheduled run will retry'))
      .finally(() => {
        draining = false
        if (queuedWhileDraining) {
          queuedWhileDraining = false
          kickOutbox()
        }
      })
  }, 800)

  // Never hold the process open for this; a redeploy mid-drain is retried by the next tick.
  drainTimer.unref()
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

  if (error) {
    if (isPermanentRejection(error.message)) throw new PermanentDeliveryError(explain(error.message))
    throw new Error(`Resend rejected the message: ${error.message}`)
  }
  return true
}

/**
 * A rejection no amount of retrying will fix.
 *
 * The one that matters today is the sandbox sender: until a domain is verified, Resend accepts
 * mail only to the account owner and rejects every other address outright. Retrying that five
 * times over twenty-five minutes achieves nothing except burying the reason under a generic
 * "failed" — and the reason is the whole point, because it is fixable in ten minutes of DNS.
 */
export class PermanentDeliveryError extends Error {}

function isPermanentRejection(message: string): boolean {
  const text = message.toLowerCase()
  return (
    text.includes('you can only send testing emails') ||
    text.includes('domain is not verified') ||
    text.includes('invalid `to` field') ||
    text.includes('invalid `from` field')
  )
}

/** Say what to do about it, not just what happened. */
function explain(message: string): string {
  const text = message.toLowerCase()

  if (text.includes('you can only send testing emails')) {
    return (
      'Not delivered: the "Send from" address is still Resend\'s shared test address, which only ' +
      'ever reaches the Resend account owner — so nobody else gets anything, students or studio. ' +
      'Set it to an address at a domain verified in Resend. ' +
      `(Resend said: ${message})`
    )
  }

  if (text.includes('domain is not verified')) {
    return (
      'Not delivered: the "Send from" address uses a domain that is not verified in Resend. ' +
      'Either verify that domain at resend.com/domains, or send from one that already is. ' +
      `(Resend said: ${message})`
    )
  }

  return `Not delivered, and retrying will not help: ${message}`
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

  /*
   * Written as UTC, which is the only zone that means the same thing on every machine.
   *
   * This used to build the time array in the studio's zone and hand it over as `local`, which
   * tells the library to read those numbers in *the server's* timezone and convert. The server is
   * not in Singapore — so a 10am class was written into the file as 10am wherever the host
   * happened to be, and landed in the student's calendar hours out. It was wrong by two hours on
   * this machine and would be wrong by eight on a UTC host, in every confirmation email already
   * sent with an invitation attached.
   *
   * A real instant in UTC is also the right thing for a calendar to hold: a student in Singapore
   * sees 10am, and one reading it from abroad sees the hour that is actually the same moment.
   */
  const start = DateTime.fromJSDate(session.startAt).toUTC()
  const end = DateTime.fromJSDate(session.endAt).toUTC()

  const event: EventAttributes = {
    title: session.title || session.courseTypeId.name,
    start: [start.year, start.month, start.day, start.hour, start.minute],
    end: [end.year, end.month, end.day, end.hour, end.minute],
    startInputType: 'utc',
    endInputType: 'utc',
    startOutputType: 'utc',
    endOutputType: 'utc',
    location: 'Mizuki Flora, #2/F, 148 Jalan Besar, Singapore 208866',
    // The booking page that exists, rather than the one this predates.
    url: myBookingsUrl(),
    organizer: { name: 'Mizuki Flora', email: config.STUDIO_EMAIL },
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
export interface EmailHealth {
  ok: boolean
  message: string
  /** What to change, in the studio's words, when something is wrong. */
  fix?: string
  from: string
  verifiedDomains: string[]
  recentFailures: { type: string; to: string; error: string; at: Date }[]
}

/**
 * Can this system actually deliver email right now?
 *
 * The old version answered "is the API key accepted", which is a much smaller question and the
 * reason a total outage looked healthy: the key was fine, the sender was not, and every message
 * was rejected at the door. A key that works is not the same as mail that arrives.
 *
 * The sender is the part that catches people out. Resend will only send from a domain verified
 * on that account, and its shared test address only ever reaches the account owner — so a studio
 * that sets a real key and leaves the test sender in place gets silence, for everybody.
 */
export async function checkEmailKey(): Promise<EmailHealth> {
  const from = (await getPlain(PLAIN_KEYS.mailFrom, config.MAIL_FROM)) ?? config.MAIL_FROM
  const recentFailures = await recentDeliveryFailures()
  // Failures since the last successful send. Anything older was fixed by whatever made mail
  // start working again, and reporting it forever makes a healthy system look broken.
  const stillFailing = await failedMessageCount()
  const historical = recentFailures.length - stillFailing

  const resend = await resendClient()
  if (!resend) {
    return {
      ok: false,
      message: 'No API key is set, so nothing can be sent.',
      fix: 'Add your Resend API key below.',
      from,
      verifiedDomains: [],
      recentFailures,
    }
  }

  try {
    const { data, error } = await resend.domains.list()
    if (error) {
      return {
        ok: false,
        message: `Resend rejected the key: ${error.message}`,
        fix: 'Check the API key below, or create a new one at resend.com/api-keys.',
        from,
        verifiedDomains: [],
        recentFailures,
      }
    }

    const all = data?.data ?? []
    const verified = all.filter((d) => d.status === 'verified').map((d) => d.name)
    const senderDomain = from.match(/@([^\s>]+)/)?.[1]?.toLowerCase() ?? ''

    if (!verified.length) {
      return {
        ok: false,
        message: 'No domain is verified in Resend, so mail can only reach your own address.',
        fix: all.length
          ? `${all[0]!.name} is added but not verified — finish its DNS records at resend.com/domains.`
          : 'Add and verify a domain at resend.com/domains.',
        from,
        verifiedDomains: [],
        recentFailures,
      }
    }

    if (!verified.some((d) => senderDomain === d || senderDomain.endsWith(`.${d}`))) {
      return {
        ok: false,
        message: `Nothing is being delivered: mail is sent from ${senderDomain || 'an unset address'}, which is not verified in Resend.`,
        fix: `Change "Send from" to an address at ${verified.join(' or ')} — for example bookings@${verified[0]}.`,
        from,
        verifiedDomains: verified,
        recentFailures,
      }
    }

    if (stillFailing > 0) {
      return {
        ok: false,
        message: `Sending from ${senderDomain} is set up correctly, but ${stillFailing} message(s) have failed since the last one went out.`,
        fix: 'See what failed below — this is happening now, not left over from an earlier problem.',
        from,
        verifiedDomains: verified,
        recentFailures,
      }
    }

    if (recentFailures.length > 0) {
      return {
        // Not a problem: these failed under a configuration that has since been corrected, and a
        // permanent rejection never retries, so they stay on the record until cleared.
        ok: true,
        message: `Ready. Sending from ${senderDomain}, which is verified.`,
        fix: `${recentFailures.length} older message(s) failed before this was set up correctly. Nothing has failed since — you can clear them.`,
        from,
        verifiedDomains: verified,
        recentFailures,
      }
    }

    return {
      ok: true,
      message: `Ready. Sending from ${senderDomain}, which is verified.`,
      from,
      verifiedDomains: verified,
      recentFailures,
    }
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : 'Could not reach Resend.',
      from,
      verifiedDomains: [],
      recentFailures,
    }
  }
}

/** The last few things that did not arrive, and why — the studio's only window into this. */
export async function recentDeliveryFailures(limit = 5) {
  const rows = await OutboxModel.find(FAILED_DELIVERY)
    .sort({ updatedAt: -1 })
    .limit(limit)
    .lean()

  return rows.map((m) => ({
    type: m.type,
    to: m.to,
    error: m.lastError,
    at: m.updatedAt as Date,
  }))
}

/**
 * What counts as a delivery failure worth telling anyone about.
 *
 * Email only. A web push with nobody subscribed and a Telegram message with no bot configured
 * both park as failed, but neither is broken — they are features the studio has not switched on,
 * and listing them as failures next to a real bounce buries the one that matters.
 */
const FAILED_DELIVERY = { status: 'failed', channel: 'email' } as const

/**
 * Failures that are still happening, as opposed to ones already fixed.
 *
 * A permanent rejection never retries, so a message that failed under a broken configuration
 * stays failed forever — and counting it keeps a corrected system looking broken indefinitely.
 * What matters is whether anything has failed *since* the last message went out successfully:
 * if mail has flowed since, the problem is behind us and the rows are history.
 */
export async function failedMessageCount(): Promise<number> {
  const lastSent = await OutboxModel.findOne({ status: 'sent' }).sort({ sentAt: -1 }).select('sentAt').lean()

  return OutboxModel.countDocuments({
    ...FAILED_DELIVERY,
    ...(lastSent?.sentAt ? { updatedAt: { $gt: lastSent.sentAt } } : {}),
  })
}

/** Everything that ever failed, including what has since been fixed. */
export async function totalFailedCount(): Promise<number> {
  return OutboxModel.countDocuments(FAILED_DELIVERY)
}

/**
 * Forget the failures.
 *
 * They cannot be resent — a permanent rejection is permanent, and the booking they belonged to
 * has long since been dealt with by other means. This only clears the record, so the console
 * stops reporting a problem that has been fixed.
 */
export async function clearFailedMessages(): Promise<number> {
  const result = await OutboxModel.deleteMany(FAILED_DELIVERY)
  return result.deletedCount ?? 0
}

export interface TelegramHealth {
  ok: boolean
  message: string
  fix?: string
  botUsername: string
  hasToken: boolean
  hasChat: boolean
  /** Conversations the bot can see. Empty until somebody has pressed Start. */
  chats: { id: string; label: string }[]
}

/**
 * Can the studio actually be messaged on Telegram?
 *
 * The half-configured state is the one that catches people, and it is invisible: a bot token on
 * its own looks like setup is done, and nothing arrives. Telegram will not let a bot message
 * anyone who has not opened a conversation with it first, so until somebody presses Start there
 * is no chat to send to and no way to discover its id.
 *
 * The old instruction was "get your id from @userinfobot", which is a different number obtained
 * a different way, and still fails silently if Start was never pressed. Asking Telegram what
 * conversations the bot can see answers both questions at once.
 */
interface TelegramReply {
  ok?: boolean
  description?: string
  result?: {
    username?: string
    message?: { chat?: TelegramChat }
    channel_post?: { chat?: TelegramChat }
  } & Array<{ message?: { chat?: TelegramChat }; channel_post?: { chat?: TelegramChat } }>
}

interface TelegramChat {
  id?: number | string
  type?: string
  title?: string
  first_name?: string
  last_name?: string
  username?: string
}

export async function checkTelegram(): Promise<TelegramHealth> {
  const [token, chatId] = await Promise.all([
    getSecret(SECRET_KEYS.telegramBotToken, config.TELEGRAM_BOT_TOKEN),
    getSecret(SECRET_KEYS.telegramChatId, config.TELEGRAM_CHAT_ID),
  ])

  const base = { hasToken: Boolean(token), hasChat: Boolean(chatId), botUsername: '', chats: [] }

  if (!token) {
    return {
      ...base,
      ok: false,
      message: 'No bot token, so phone alerts are off.',
      fix: 'Create a bot with @BotFather in Telegram and paste its token below. This is optional — email still works without it.',
    }
  }

  try {
    const me = (await fetch(`https://api.telegram.org/bot${token}/getMe`).then((r) => r.json())) as TelegramReply
    if (!me?.ok) {
      return {
        ...base,
        ok: false,
        message: `Telegram rejected the token: ${me?.description ?? 'unknown error'}`,
        fix: 'Check the token, or ask @BotFather for a new one.',
      }
    }

    const botUsername = me.result?.username ?? ''

    const updates = (await fetch(`https://api.telegram.org/bot${token}/getUpdates`).then((r) => r.json())) as TelegramReply
    const chats = new Map<string, string>()

    for (const update of Array.isArray(updates?.result) ? updates.result : []) {
      const chat = update?.message?.chat ?? update?.channel_post?.chat
      if (!chat?.id) continue

      const label =
        chat.title ||
        [chat.first_name, chat.last_name].filter(Boolean).join(' ') ||
        chat.username ||
        'Chat'
      chats.set(String(chat.id), `${label} (${chat.type ?? 'chat'})`)
    }

    const list = [...chats].map(([id, label]) => ({ id, label }))

    if (!chatId) {
      return {
        ...base,
        ok: false,
        botUsername,
        chats: list,
        message: list.length
          ? 'The bot is set up but no chat is chosen, so nothing is being sent.'
          : `The bot @${botUsername} is ready, but nobody has spoken to it yet.`,
        fix: list.length
          ? 'Pick the chat below.'
          : `Open Telegram, find @${botUsername}, press Start, then press "Find my chat" here.`,
      }
    }

    return {
      ...base,
      ok: true,
      botUsername,
      chats: list,
      message: `Ready. Alerts go to @${botUsername}.`,
    }
  } catch (err) {
    return {
      ...base,
      ok: false,
      message: err instanceof Error ? err.message : 'Could not reach Telegram.',
    }
  }
}

/** Send a message right now, to prove the setup works rather than waiting for a booking. */
export async function sendTelegramTest(): Promise<{ ok: boolean; message: string }> {
  const [token, chatId] = await Promise.all([
    getSecret(SECRET_KEYS.telegramBotToken, config.TELEGRAM_BOT_TOKEN),
    getSecret(SECRET_KEYS.telegramChatId, config.TELEGRAM_CHAT_ID),
  ])
  if (!token || !chatId) return { ok: false, message: 'Set the bot token and chat first.' }

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: '✅ Mizuki Flora — phone alerts are working. New bookings will arrive here.',
    }),
  })

  const body = (await response.json().catch(() => null)) as TelegramReply | null
  return response.ok
    ? { ok: true, message: 'Sent. Check Telegram.' }
    : { ok: false, message: body?.description ?? 'Telegram refused the message.' }
}
