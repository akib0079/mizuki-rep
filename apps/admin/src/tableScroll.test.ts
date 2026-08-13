import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Every table has to sit in something that can scroll.
 *
 * A table is the one element that genuinely cannot reflow — its columns need the width they
 * need. Left bare in a card, it does not overflow *itself*; it makes the whole page wider than
 * the phone, and the studio gets a console they have to pan sideways to read. The mobile
 * stylesheet only knows how to scroll `.table-wrap` and `.card-pad-0`, so a table outside one of
 * those is the page's problem rather than its own.
 *
 * Settings and Team shipped with seven bare tables between them: the Settings page laid out
 * 839px wide inside a 390px screen. Nothing failed, nothing logged, and an automated width check
 * missed it too — mobile emulation quietly zooms out to fit rather than reporting an overflow,
 * so both numbers grow together and the page looks like it fits.
 *
 * A source lint rather than a rendering test, because this is about markup that is either there
 * or is not, and a lint runs in milliseconds with no browser.
 */

const src = path.dirname(fileURLToPath(import.meta.url))

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.tsx$/.test(full) ? [full] : []
  })
}

/** Containers the mobile stylesheet gives `overflow-x: auto`. */
const SCROLLABLE = /table-wrap|card-pad-0/

describe('tables', () => {
  it('are always inside a container that can scroll', () => {
    const bare: string[] = []

    for (const file of sourceFiles(src)) {
      const lines = readFileSync(file, 'utf8').split('\n')

      lines.forEach((line, i) => {
        if (!/<table\b/.test(line)) return

        /*
         * Look back a few lines rather than only at the one above: a wrapper is sometimes split
         * across lines by the formatter, and a conditional can sit between the two.
         */
        const before = lines.slice(Math.max(0, i - 4), i).join(' ')
        if (SCROLLABLE.test(before)) return

        bare.push(`${path.relative(src, file)}:${i + 1} — <table> is not inside .table-wrap`)
      })
    }

    expect(bare).toEqual([])
  })
})
