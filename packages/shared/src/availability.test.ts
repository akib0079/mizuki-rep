import { describe, expect, it } from 'vitest'
import { sessionAvailability } from './rules.js'
import { STUDIO_COUNTRY, dialCode, flagEmoji, formatInternational } from './countries.js'

/**
 * The two rules a student sees the result of but never the working of.
 *
 * Availability, because "full" and "not available" are the same seat count and different facts —
 * one sends someone looking for another date, the other should send them to the phone. And the
 * dialling code, because a number saved without one is a number the studio cannot ring.
 */

const session = (over: Partial<{ capacity: number; heldBack: number; seatsTaken: number; status: string }> = {}) => ({
  capacity: 8,
  heldBack: 0,
  seatsTaken: 0,
  ...over,
})

describe('what a student is told about a class', () => {
  it('is available while places remain', () => {
    expect(sessionAvailability(session())).toBe('available')
    expect(sessionAvailability(session({ seatsTaken: 7 }))).toBe('available')
  })

  it('is full when every place in the room is taken by a person', () => {
    expect(sessionAvailability(session({ seatsTaken: 8 }))).toBe('full')
  })

  it('is not available — not full — when the studio is holding the rest back', () => {
    /*
     * The distinction the three states exist for. Eight places, one student, seven withheld for
     * chat bookings: the seat count says nothing is bookable, but the room is nearly empty, and
     * a student told "full" would give up on a class they could have had by ringing.
     */
    expect(sessionAvailability(session({ seatsTaken: 1, heldBack: 7 }))).toBe('unavailable')
  })

  it('is not available when the class has been cancelled', () => {
    expect(sessionAvailability(session({ status: 'cancelled' }))).toBe('unavailable')
    // Even with the room empty.
    expect(sessionAvailability(session({ seatsTaken: 0, status: 'cancelled' }))).toBe('unavailable')
  })

  it('counts an over-booked class as full rather than as anything stranger', () => {
    // Reachable when the studio lowers the capacity of a class people are already in.
    expect(sessionAvailability(session({ capacity: 6, seatsTaken: 8 }))).toBe('full')
  })
})

describe('a number from outside Singapore', () => {
  it('knows the dialling code for the countries the studio actually sees', () => {
    expect(dialCode('SG')).toBe('65')
    expect(dialCode('MY')).toBe('60')
    expect(dialCode('ID')).toBe('62')
    expect(dialCode('GB')).toBe('44')
    expect(dialCode('AU')).toBe('61')
  })

  it('is case-insensitive, because a form is', () => {
    expect(dialCode('my')).toBe('60')
  })

  it('says so rather than guessing when it does not know', () => {
    expect(dialCode('ZZ')).toBeNull()
  })

  it('writes the number the way the studio would dial it', () => {
    expect(formatInternational('MY', '123456789')).toBe('+60 123456789')
  })

  it('drops a leading zero, which is a local-dialling habit', () => {
    expect(formatInternational('GB', '07700900123')).toBe('+44 7700900123')
  })

  it('leaves a number alone that already carries its own code', () => {
    expect(formatInternational('MY', '+60 12 345 6789')).toBe('+60 12 345 6789')
  })

  it('leaves a number alone when the country is unknown, rather than inventing a code', () => {
    expect(formatInternational('', '9123 4567')).toBe('9123 4567')
    expect(formatInternational(null, '9123 4567')).toBe('9123 4567')
  })

  it('builds a flag from the country code itself', () => {
    // Two regional indicators — 🇸🇬 — so there is no image to load inside a shadow root.
    expect(flagEmoji('SG')).toBe('\u{1F1F8}\u{1F1EC}')
    expect(flagEmoji(STUDIO_COUNTRY)).toBe('\u{1F1F8}\u{1F1EC}')
    expect([...flagEmoji('MY')]).toHaveLength(2)
  })
})
