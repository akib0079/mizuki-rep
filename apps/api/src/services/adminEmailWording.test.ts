import { beforeEach, describe, expect, it } from 'vitest'
import { studioInstant } from '@mizuki/shared'
import { OutboxModel, type CourseTypeDoc } from '../models/index.js'
import { createBooking } from './bookingService.js'
import { seedEmailTemplates } from './emailTemplates.js'
import { makeCourseType, makePackage, makeSession, makeStudent } from '../test/factories.js'

/**
 * Who an email is addressed to.
 *
 * The studio's alerts reused the student's own package sentence, so the booking notification told
 * the studio "You have 6 of 8 IFDA sessions remaining in your course package" — a fact about
 * somebody else's balance, written as though it were theirs. It is the kind of mistake that never
 * throws and never fails a test unless a test asks the question directly.
 */

let course: CourseTypeDoc

beforeEach(async () => {
  await seedEmailTemplates()
  course = await makeCourseType({ name: 'IFDA', slug: 'ifda-wording', bookingMode: 'package' })
})

async function bookWithAPackage() {
  const student = await makeStudent({ name: 'Aiko Tan', email: 'aiko@example.com' })
  const session = await makeSession({
    courseTypeId: course._id,
    capacity: 8,
    date: '2026-09-19',
  })
  await makePackage(student._id, course._id, { totalSessions: 8, usedSessions: 2 })

  await createBooking({
    sessionId: session._id,
    studentId: student._id,
    source: 'student_web',
    now: studioInstant('2026-09-01', '09:00'),
  })
}

/** Everything queued for an address that is not the student's. */
async function studioEmails() {
  return OutboxModel.find({ to: { $ne: 'aiko@example.com' } }).lean()
}

describe('the studio copy of a booking alert', () => {
  it('reports the package balance as theirs, not yours', async () => {
    await bookWithAPackage()

    const sent = await studioEmails()
    expect(sent.length).toBeGreaterThan(0)

    for (const message of sent) {
      const body = `${message.bodyHtml ?? ''} ${message.bodyText ?? ''}`
      expect(body).toContain('sessions left in their course package')
      expect(body).not.toContain('in your course package')
    }
  })

  it('still tells the student it is theirs', async () => {
    await bookWithAPackage()

    const toStudent = await OutboxModel.find({ to: 'aiko@example.com' }).lean()
    expect(toStudent.length).toBeGreaterThan(0)

    const body = toStudent.map((m) => `${m.bodyHtml ?? ''} ${m.bodyText ?? ''}`).join(' ')
    expect(body).toContain('in your course package')
  })

  it('leaves the line out entirely when there is no package', async () => {
    const student = await makeStudent({ name: 'Walk In', email: 'walkin@example.com' })
    const paid = await makeCourseType({ name: 'Bouquet', slug: 'bouquet-wording', bookingMode: 'paid' })
    const session = await makeSession({ courseTypeId: paid._id, capacity: 8, date: '2026-09-20' })

    await createBooking({
      sessionId: session._id,
      studentId: student._id,
      source: 'admin_manual',
      now: studioInstant('2026-09-01', '09:00'),
    })

    const sent = await OutboxModel.find({ to: { $ne: 'walkin@example.com' } }).lean()
    for (const message of sent) {
      const body = `${message.bodyHtml ?? ''} ${message.bodyText ?? ''}`
      expect(body).not.toContain('course package')
    }
  })
})
