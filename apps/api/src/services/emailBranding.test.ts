import { describe, expect, it } from 'vitest'
import {
  BRAND,
  DEFAULT_TEMPLATES,
  refreshDefaultTemplates,
  renderTemplate,
  usesCurrentBranding,
} from './emailTemplates.js'
import { EmailTemplateModel } from '../models/index.js'

/**
 * The studio's look, and the reason changing it in code is not enough.
 *
 * Stored rows shadow the defaults — that is what lets the studio reword an email without a
 * deploy — so a new colour in the source reaches nobody who is already running the system. The
 * refresh closes that gap for wording nobody has touched, and must not touch anything else.
 */

const KEYS = Object.keys(DEFAULT_TEMPLATES) as (keyof typeof DEFAULT_TEMPLATES)[]

describe('the studio look', () => {
  it('puts the logo and the studio colour in every email that has a layout', () => {
    for (const key of KEYS) {
      const html = DEFAULT_TEMPLATES[key].bodyHtml
      expect(html, `${key} is missing the logo`).toContain(BRAND.logoUrl)
      expect(html, `${key} is missing the studio colour`).toContain(BRAND.primary)
    }
  })

  it('leaves no trace of the old palette', () => {
    const retired = ['#6b5b73', '#faf7f5', '#8b7f86', '#5c5257', '#3a3336', '#ece5e0']
    for (const key of KEYS) {
      for (const colour of retired) {
        expect(DEFAULT_TEMPLATES[key].bodyHtml, `${key} still uses ${colour}`).not.toContain(colour)
      }
    }
  })

  it('names the studio in the logo’s alt text, for the clients that hide images', () => {
    expect(DEFAULT_TEMPLATES.booking_confirmation.bodyHtml).toContain('alt="Mizuki Flora"')
  })

  it('survives rendering — a real email carries the colour and the logo', async () => {
    const rendered = await renderTemplate('booking_confirmation', {
      studentName: 'Aiko Tan',
      sessionTitle: 'Ikebana Workshop',
      siteUrl: 'https://mizuki.com.sg',
    })
    expect(rendered.html).toContain(BRAND.primary)
    expect(rendered.html).toContain(BRAND.logoUrl)
    expect(rendered.html).toContain('Aiko Tan')
  })
})

describe('bringing an already-seeded install up to date', () => {
  it('replaces wording nobody has edited', async () => {
    await EmailTemplateModel.create({
      key: 'booking_confirmation',
      subject: 'Old subject',
      bodyHtml: '<p style="color:#6b5b73">Old body</p>',
      bodyText: 'Old body',
      updatedBy: 'seed',
    })

    expect(await refreshDefaultTemplates()).toBe(1)

    const row = await EmailTemplateModel.findOne({ key: 'booking_confirmation' }).lean()
    expect(row!.bodyHtml).toContain(BRAND.primary)
    expect(row!.bodyHtml).toContain(BRAND.logoUrl)
  })

  it('never overwrites what the studio wrote themselves', async () => {
    await EmailTemplateModel.create({
      key: 'booking_confirmation',
      subject: 'See you soon!',
      bodyHtml: '<p>Our own words</p>',
      bodyText: 'Our own words',
      updatedBy: 'mizukisg148@gmail.com',
    })

    expect(await refreshDefaultTemplates()).toBe(0)

    const row = await EmailTemplateModel.findOne({ key: 'booking_confirmation' }).lean()
    expect(row!.bodyHtml).toBe('<p>Our own words</p>')
    expect(row!.subject).toBe('See you soon!')
  })

  it('also refreshes one the studio reset to the shipped version', async () => {
    await EmailTemplateModel.create({
      key: 'magic_link',
      subject: 'Old',
      bodyHtml: '<p>Old</p>',
      bodyText: 'Old',
      updatedBy: 'reset',
    })

    expect(await refreshDefaultTemplates()).toBe(1)
  })

  it('does nothing the second time', async () => {
    await EmailTemplateModel.create({
      key: 'magic_link',
      subject: 'Old',
      bodyHtml: '<p>Old</p>',
      bodyText: 'Old',
      updatedBy: 'seed',
    })

    expect(await refreshDefaultTemplates()).toBe(1)
    expect(await refreshDefaultTemplates()).toBe(0)
  })

  it('flags a hand-edited email still on the old look, so the console can offer to reset it', () => {
    expect(usesCurrentBranding('<p style="color:#6b5b73">Our own words</p>')).toBe(false)
    expect(usesCurrentBranding(DEFAULT_TEMPLATES.booking_confirmation.bodyHtml)).toBe(true)
  })
})
