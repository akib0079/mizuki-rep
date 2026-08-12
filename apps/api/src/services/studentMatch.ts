import { StudentModel, type StudentDoc } from '../models/index.js'

/**
 * Is this person already on file?
 *
 * Exact matching is not enough, and the studio's own data shows why. Three accounts turned out
 * to be one person:
 *
 *   ayeshaakter6100@gmal.com     (domain typed wrong)
 *   ayeshaakter6100@gmail.com    (the real one)
 *   ayeshaaker6100@gmail.com     (a letter missing)
 *
 * Every field differed — address, phone and name — so nothing exact could have caught any of
 * them. What they have in common is that they are *nearly* the same, which is what a person
 * spots instantly and a string comparison never will.
 *
 * So this looks for near misses as well, and the caller treats the two differently: an exact
 * match is certain and blocks, a near match is a suspicion and asks.
 */

export type MatchKind = 'email_known' | 'phone_known' | 'email_similar' | 'name_known'

export interface StudentMatch {
  kind: MatchKind
  student: StudentDoc
  /** True when we are certain. Near misses are not, and must leave the person a way through. */
  certain: boolean
}

/** Digits only — "+65 9123 4567" and "91234567" are one number to everybody but a comparison. */
export const phoneDigitsOf = (phone: string): string => phone.replace(/\D/g, '')

/**
 * Names, reduced to what is actually being compared.
 *
 * Case, punctuation and doubled spaces all vary between one booking and the next without meaning
 * anything: "ayesha  akter", "Ayesha Akter" and "AYESHA AKTER" are one person typing.
 */
export const normaliseName = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/**
 * How many single-character edits separate two strings.
 *
 * Bounded, and it gives up as soon as the answer is certainly above the limit — the alternative
 * is scoring every student on file against every booking, which gets slower exactly as the
 * studio gets busier.
 */
export function editDistance(a: string, b: string, limit = 2): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > limit) return limit + 1

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)

  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    let rowBest = i

    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      const value = Math.min(current[j - 1]! + 1, previous[j]! + 1, previous[j - 1]! + cost)
      current.push(value)
      rowBest = Math.min(rowBest, value)
    }

    // Nothing later can bring the distance back down, so stop.
    if (rowBest > limit) return limit + 1
    previous = current
  }

  return previous[b.length]!
}

/**
 * Two addresses that are probably the same person.
 *
 * Compared in two halves. A domain typo — gmal for gmail — leaves the local part untouched and
 * is the single most common way one person becomes two accounts; a slip in the local part leaves
 * the domain untouched. Comparing the whole address at once would let a genuinely different
 * person at the same provider look like a near miss.
 */
export function emailsLookAlike(a: string, b: string): boolean {
  if (a === b) return false

  const [localA = '', domainA = ''] = a.toLowerCase().split('@')
  const [localB = '', domainB = ''] = b.toLowerCase().split('@')

  // Same person, mistyped domain.
  if (localA === localB && domainA !== domainB) return editDistance(domainA, domainB, 2) <= 2

  // Same mailbox, mistyped name. Short local parts are excluded: at four characters or fewer,
  // two edits is most of the address and "anna" would match "anne".
  if (domainA === domainB && localA.length > 4 && localB.length > 4) {
    return editDistance(localA, localB, 2) <= 2
  }

  return false
}

/**
 * The account this person probably already has.
 *
 * Ordered by confidence: an exact address, then an exact number, then the near misses. The first
 * hit wins, so the message they see is the most specific one available.
 */
export async function findExistingStudent(input: {
  email: string
  phone: string
  name: string
}): Promise<StudentMatch | null> {
  const email = input.email.trim().toLowerCase()
  const digits = phoneDigitsOf(input.phone)
  const name = normaliseName(input.name)

  const byEmail = await StudentModel.findOne({ email })
  if (byEmail) return { kind: 'email_known', student: byEmail, certain: true }

  if (digits.length >= 8) {
    // The last eight digits, so a country code on one booking and not the next still matches.
    const byPhone = await StudentModel.findOne({ phoneDigits: { $regex: `${digits.slice(-8)}$` } })
    if (byPhone) return { kind: 'phone_known', student: byPhone, certain: true }
  }

  /*
   * Near misses need candidates to compare against, and there is no index for "nearly equal".
   *
   * Narrowed three ways, because a typo lands in exactly one half of an address at a time.
   * Narrowing by domain alone looked obvious and was wrong: a mistyped domain — gmal for gmail —
   * puts the account in a *different* domain, so the query excluded the very case it existed to
   * catch. Same mailbox at another domain, and the same name, are the other two.
   */
  const [local = '', domain = ''] = email.split('@')
  const candidates = await StudentModel.find({
    $or: [
      { email: { $regex: `@${escapeRegex(domain)}$` } },
      { email: { $regex: `^${escapeRegex(local)}@` } },
      ...(name ? [{ nameNormalised: name }] : []),
    ],
  }).limit(200)

  for (const candidate of candidates) {
    if (emailsLookAlike(email, candidate.email)) {
      return { kind: 'email_similar', student: candidate, certain: false }
    }
  }

  for (const candidate of candidates) {
    if (name && normaliseName(candidate.name) === name) {
      return { kind: 'name_known', student: candidate, certain: false }
    }
  }

  return null
}

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
