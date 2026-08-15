import { existsSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { STUDIO_COUNTRY, countryList, flagFile } from '@mizuki/shared'

/**
 * Every country the booking form offers has a flag to show for it.
 *
 * The picker's list and the flag artwork come from two different places — our own dialling codes
 * on one side, an installed package on the other — so nothing but this stops them drifting apart.
 * A country in the list with no file behind it is a broken image on the form, and the kind of gap
 * that would only ever be found by a student from that country trying to book.
 */

const require = createRequire(import.meta.url)
const flagsDir = path.join(path.dirname(require.resolve('flag-icons/package.json')), 'flags', '4x3')

describe('the flat country flags', () => {
  it('are installed where the API expects to serve them from', () => {
    expect(existsSync(flagsDir)).toBe(true)
  })

  it('exist for every country the picker offers', () => {
    const missing = countryList()
      .map((c) => c.code)
      .filter((code) => !existsSync(path.join(flagsDir, flagFile(code))))

    expect(missing).toEqual([])
  })

  it('includes Singapore, which is the one shown by default', () => {
    expect(existsSync(path.join(flagsDir, flagFile(STUDIO_COUNTRY)))).toBe(true)
  })

  it('names files by the country code in lower case, which is what the URL carries', () => {
    expect(flagFile('SG')).toBe('sg.svg')
    expect(flagFile('my')).toBe('my.svg')
  })

  it('refuses to build a path out of anything that is not a country code', () => {
    // This value reaches a URL, so a traversal attempt must not survive it.
    expect(flagFile('../../etc/passwd')).toBe('etcpasswd.svg')
  })
})
