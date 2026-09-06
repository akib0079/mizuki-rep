import { describe, expect, it } from 'vitest'
import { DateTime } from 'luxon'
import { STUDIO_TZ, evaluateCancel, evaluateReschedule, studioInstant } from '@mizuki/shared'
import { buildIcs } from './mailer.js'
import { renderTemplate } from './emailTemplates.js'
import { config } from '../config.js'
import { makeCourseType, makeSession } from '../test/factories.js'

/**
 * What a student sees and receives between booking and being confirmed.
 *
 * All of this was reported at once by the studio testing the flow as a student: a place that had
 * just been reserved reading as dead, a calendar invitation at the wrong hour, and sign-in links
 * that expired before anyone got to them.
 */

describe('a place that is reserved but not yet confirmed', () => {
  const ctx = (status: string) => ({
    booking: { status: status as 'awaiting_confirmation' },
    session: { startAt: studioInstant('2027-03-06', '10:00'), status: 'scheduled' as const },
    courseType: { rescheduleCutoffHours: 24, cancelCutoffHours: 24, name: 'IFDA' },
  })

  const now = studioInstant('2027-03-01', '09:00')

  it('is never described to the student as no longer active', () => {
    /*
     * What they used to be told, on their own bookings page, minutes after an email saying their
     * place was held. The reschedule check's deny message was rendered as the booking's status.
     */
    const verdict = evaluateReschedule(ctx('awaiting_confirmation'), now)
    expect(verdict.message).not.toContain('no longer active')
    expect(verdict.message).toContain('reserved')
    expect(verdict.code).toBe('awaiting_confirmation')
  })

  it('says the same thing when they try to cancel', () => {
    const verdict = evaluateCancel(ctx('awaiting_confirmation'), now)
    expect(verdict.message).not.toContain('no longer active')
    expect(verdict.code).toBe('awaiting_confirmation')
  })

  it('still calls a genuinely dead booking dead', () => {
    expect(evaluateReschedule(ctx('cancelled'), now).message).toContain('no longer active')
  })

  it('lets a confirmed place be changed as before', () => {
    expect(evaluateReschedule(ctx('confirmed'), now).allowed).toBe(true)
  })
})

describe('the calendar invitation', () => {
  it('puts the class at the hour it actually runs, whatever zone the server is in', async () => {
    const course = await makeCourseType({ name: 'IFDA' })
    // 10:00 in Singapore is 02:00 UTC.
    const session = await makeSession({
      courseTypeId: course._id,
      date: '2027-03-06',
      time: '10:00',
      durationMins: 180,
      title: 'IFDA Morning',
    })

    const ics = await buildIcs(String(session._id))

    /*
     * The times used to be built in the studio's zone and handed over as "local", which the
     * library reads in the *server's* zone — so a 10am class was written as 10am wherever the
     * host happened to be. Two hours out on a laptop here, eight on a UTC host, in every
     * confirmation email that carried an invitation.
     */
    expect(ics).toContain('DTSTART:20270306T020000Z')
    expect(ics).toContain('DTEND:20270306T050000Z')

    // And it is the real instant, not a floating time that drifts with the reader.
    const startAt = DateTime.fromISO('2027-03-06T10:00', { zone: STUDIO_TZ }).toUTC()
    expect(ics).toContain(`DTSTART:${startAt.toFormat("yyyyMMdd'T'HHmmss'Z'")}`)
  })

  it('links to the booking page that exists', async () => {
    const course = await makeCourseType()
    const session = await makeSession({ courseTypeId: course._id, date: '2027-03-06' })

    const ics = await buildIcs(String(session._id))

    // `/my-bookings` was a separate page before the widget was consolidated into one with tabs.
    expect(ics).not.toContain('/my-bookings')
    expect(ics).toContain('tab=bookings')
  })
})

describe('the sign-in link', () => {
  it('lasts long enough to be read after work', () => {
    // Thirty minutes assumed the link is opened the moment it lands.
    expect(config.MAGIC_LINK_TTL_HOURS).toBeGreaterThanOrEqual(6)
  })

  it('tells the student the lifetime it actually has, rather than a number of its own', async () => {
    const rendered = await renderTemplate('magic_link', {
      studentName: 'Aiko Tan',
      magicLinkUrl: 'https://example.com/x',
      expiryHours: config.MAGIC_LINK_TTL_HOURS,
      siteUrl: 'https://mizuki.com.sg',
    })

    expect(rendered.html).not.toContain('30 minutes')
    expect(rendered.text).not.toContain('30 minutes')
    expect(rendered.html).toContain(`${config.MAGIC_LINK_TTL_HOURS} hours`)
    expect(rendered.text).toContain(`${config.MAGIC_LINK_TTL_HOURS} hours`)
  })
})
