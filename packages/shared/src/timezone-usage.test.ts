import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * A structural guard, not a behavioural one.
 *
 * Every class time is stored as a UTC instant. Formatting one with Luxon's default zone renders
 * it in whatever timezone the *viewer* happens to be in — so a student in Bangkok, or the studio
 * owner on a trip, sees a 10am class advertised as 8am and books the wrong slot. It fails
 * silently and only for people who are not in Singapore, which is precisely the kind of bug that
 * reaches production.
 *
 * It already happened once: the reschedule picker offered every class two hours early. This test
 * exists so it cannot happen again quietly. If it fails, wrap the value in `toStudio()` from this
 * package rather than deleting the assertion.
 */

const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '../../..')
const SCANNED = ['apps/widget/src', 'apps/admin/src']

/**
 * A `DateTime.fromISO(...)` is safe when the zone is pinned either way round:
 *   DateTime.fromISO(x, { zone: STUDIO_TZ })   — option form
 *   DateTime.fromISO(x).setZone(STUDIO_TZ)     — chained form
 * Anything else inherits the viewer's zone.
 */
const FROM_ISO = /DateTime\.fromISO\(/g

function isZoned(line: string, matchIndex: number): boolean {
  const rest = line.slice(matchIndex)
  return /\{\s*zone\s*:/.test(rest) || /\)\s*\.setZone\(/.test(rest)
}

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry)
      if (statSync(full).isDirectory()) walk(full)
      else if (/\.tsx?$/.test(entry) && !entry.endsWith('.test.ts')) out.push(full)
    }
  }
  walk(dir)
  return out
}

describe('class times always render in the studio timezone', () => {
  it('never formats an instant in the viewer’s local zone', () => {
    const offenders: string[] = []

    for (const scanned of SCANNED) {
      for (const file of sourceFiles(join(REPO_ROOT, scanned))) {
        const source = readFileSync(file, 'utf8')

        source.split('\n').forEach((line, index) => {
          for (const match of line.matchAll(FROM_ISO)) {
            if (isZoned(line, match.index ?? 0)) continue
            offenders.push(`${relative(REPO_ROOT, file)}:${index + 1}  ${line.trim()}`)
          }
        })
      }
    }

    expect(
      offenders,
      `Found date formatting that would show the wrong time to anyone outside Singapore.\n` +
        `Use toStudio(value) from @mizuki/shared, or pass { zone: STUDIO_TZ }.\n\n` +
        offenders.join('\n'),
    ).toEqual([])
  })

  it('scans a meaningful number of files, so a silent glob failure cannot hide a regression', () => {
    const count = SCANNED.reduce((n, dir) => n + sourceFiles(join(REPO_ROOT, dir)).length, 0)
    expect(count).toBeGreaterThan(10)
  })
})
