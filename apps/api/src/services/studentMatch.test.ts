import { beforeEach, describe, expect, it } from 'vitest'
import { StudentModel } from '../models/index.js'
import { editDistance, emailsLookAlike, findExistingStudent, normaliseName } from './studentMatch.js'

/**
 * The three accounts that were really one person.
 *
 * Taken from the studio's own student list, where the same student appeared three times:
 *
 *   ayeshaakter6100@gmal.com    Akib Zawayed   019 0418 7508
 *   ayeshaakter6100@gmail.com   Ayesha Akter   0130187508
 *   ayeshaaker6100@gmail.com    Ayesha         08689699
 *
 * Every field differs, so exact matching on email, phone or name would have caught none of them.
 * These tests exist because that is the case that actually happens.
 */

const REAL = 'ayeshaakter6100@gmail.com'
const DOMAIN_TYPO = 'ayeshaakter6100@gmal.com'
const LOCAL_TYPO = 'ayeshaaker6100@gmail.com'

beforeEach(async () => {
  await StudentModel.create({
    name: 'Ayesha Akter',
    email: REAL,
    phone: '0130187508',
  })
})

describe('spotting the same person again', () => {
  it('catches the exact address, and is certain about it', async () => {
    const match = await findExistingStudent({ email: REAL, phone: '0999888777', name: 'Someone' })

    expect(match?.kind).toBe('email_known')
    expect(match?.certain).toBe(true)
  })

  it('catches the exact number however it was written', async () => {
    const match = await findExistingStudent({
      email: 'brand.new@example.com',
      phone: '+65 0130 187508',
      name: 'Someone',
    })

    expect(match?.kind).toBe('phone_known')
    expect(match?.certain).toBe(true)
  })

  it('catches a mistyped domain — the real gmal.com case', async () => {
    const match = await findExistingStudent({
      email: DOMAIN_TYPO,
      phone: '019 0418 7508',
      name: 'Akib Zawayed',
    })

    expect(match?.kind).toBe('email_similar')
    // A suspicion, not a fact: they must be able to say "no, this is me for the first time".
    expect(match?.certain).toBe(false)
  })

  it('catches a missing letter in the address — the real ayeshaaker case', async () => {
    const match = await findExistingStudent({
      email: LOCAL_TYPO,
      phone: '08689699',
      name: 'Ayesha',
    })

    expect(match?.kind).toBe('email_similar')
    expect(match?.certain).toBe(false)
  })

  it('catches the same name at a different address', async () => {
    const match = await findExistingStudent({
      email: 'ayesha.akter@outlook.com',
      phone: '0777666555',
      name: 'ayesha  AKTER',
    })

    expect(match?.kind).toBe('name_known')
    expect(match?.certain).toBe(false)
  })

  it('leaves a genuinely different person alone', async () => {
    const match = await findExistingStudent({
      email: 'hana.tan@gmail.com',
      phone: '0912345678',
      name: 'Hana Tan',
    })

    expect(match).toBeNull()
  })

  it('does not confuse two different people at the same provider', async () => {
    // Same domain, unrelated mailbox. Comparing whole addresses would score these as close.
    const match = await findExistingStudent({
      email: 'benjamin2100@gmail.com',
      phone: '0911111111',
      name: 'Benjamin Lim',
    })

    expect(match).toBeNull()
  })
})

describe('the comparisons themselves', () => {
  it('measures edits, and gives up once the answer is past the limit', () => {
    expect(editDistance('gmail.com', 'gmal.com')).toBe(1)
    expect(editDistance('ayeshaakter6100', 'ayeshaaker6100')).toBe(1)
    expect(editDistance('completely', 'different', 2)).toBeGreaterThan(2)
  })

  it('will not call two short mailboxes alike', () => {
    // "anna" and "anne" are one edit apart and are not the same person.
    expect(emailsLookAlike('anna@gmail.com', 'anne@gmail.com')).toBe(false)
  })

  it('does not report an address as looking like itself', () => {
    expect(emailsLookAlike(REAL, REAL)).toBe(false)
  })

  it('reduces a name to what is actually being compared', () => {
    expect(normaliseName('Ayesha  AKTER')).toBe('ayesha akter')
    expect(normaliseName("O'Brien-Smith")).toBe('o brien smith')
  })
})
