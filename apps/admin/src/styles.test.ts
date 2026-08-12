import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Every class the console uses must actually be styled.
 *
 * A className with no matching rule fails silently: the element renders as a browser default,
 * which looks like a half-finished page rather than an error. Nine of them shipped across the
 * Payments, Team and invite screens before this test existed — a "Forgot your password?" link
 * rendering as a grey system button was the first anyone noticed.
 *
 * Deliberately a lint over the source rather than a rendering test. It cannot tell whether a
 * rule looks right, only whether one exists at all, which is the failure that hides.
 */

const src = path.dirname(fileURLToPath(import.meta.url))

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.tsx$/.test(full) ? [full] : []
  })
}

/** Class names that live in the stylesheet, including those only used as modifiers. */
function definedClasses(): Set<string> {
  const css = readFileSync(path.join(src, 'styles.css'), 'utf8')
  return new Set([...css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]!))
}

/**
 * Class names written as plain string literals in className.
 *
 * Only the literal forms — anything assembled at runtime is beyond a static check, and guessing
 * at template strings would produce false failures that teach people to ignore this test.
 */
function usedClasses(): Map<string, string[]> {
  const used = new Map<string, string[]>()

  for (const file of sourceFiles(src)) {
    const source = readFileSync(file, 'utf8')

    for (const match of source.matchAll(/className=(?:"([^"]+)"|\{'([^']+)'\}|\{`([^`${}]+)`\})/g)) {
      const value = match[1] ?? match[2] ?? match[3] ?? ''
      for (const cls of value.split(/\s+/).filter(Boolean)) {
        used.set(cls, [...(used.get(cls) ?? []), path.relative(src, file)])
      }
    }

    // The ternary form: className={cond ? 'a b' : 'c'}
    for (const match of source.matchAll(/className=\{[^}]*?\?\s*'([^']+)'\s*:\s*'([^']+)'/g)) {
      for (const value of [match[1], match[2]]) {
        for (const cls of (value ?? '').split(/\s+/).filter(Boolean)) {
          used.set(cls, [...(used.get(cls) ?? []), path.relative(src, file)])
        }
      }
    }
  }

  return used
}

describe('stylesheet coverage', () => {
  it('has a rule for every class the console renders', () => {
    const defined = definedClasses()

    const missing = [...usedClasses().entries()]
      .filter(([cls]) => !defined.has(cls))
      .map(([cls, files]) => `${cls} (${[...new Set(files)].join(', ')})`)
      .sort()

    expect(missing).toEqual([])
  })
})
