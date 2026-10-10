import { describe, expect, it } from 'vitest'
import { workshopPolicy } from '@mizuki/shared'
import { SettingModel } from '../models/index.js'
import { makeCourseType, makeSession } from '../test/factories.js'
import { buildIcs } from './mailer.js'
import { renderTemplate } from './emailTemplates.js'
import { getStudioContact, saveStudioContact } from './studioContactService.js'

describe('editable studio contact and class venue', () => {
  it('uses saved contact details in emails and the per class venue in invitations', async () => {
    const contact = {
      name: 'Mizuki Flora', address: '148 Jalan Besar, Singapore',
      phone: '+65 8000 1234', email: 'hello@example.com',
    }
    await saveStudioContact(contact, 'test')
    expect(await getStudioContact()).toEqual(contact)
    expect(await SettingModel.countDocuments({ key: { $regex: '^studio\\.' } })).toBe(4)

    const course = await makeCourseType()
    const session = await makeSession({ courseTypeId: course._id, venueAddress: 'Seasonal Hall, Singapore' })
    const reminder = await renderTemplate('reminder_2day', {
      studentName: 'Aiko', sessionTitle: 'Workshop', sessionDate: 'Saturday',
      sessionTimeRange: '10:00 AM', sessionDuration: '2h', partySizeLine: '',
      workshopPolicyLine: workshopPolicy(contact.phone), venueAddress: session.venueAddress,
    })
    expect(reminder.text).toContain('Seasonal Hall, Singapore')
    expect(reminder.text).toContain(contact.phone)
    expect(reminder.html).toContain(contact.address)

    const ics = await buildIcs(String(session._id))
    expect(ics).toContain('Seasonal Hall')
    expect(ics).toContain('hello@example.com')
  })
})
