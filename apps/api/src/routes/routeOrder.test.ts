import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * No route may be hidden behind a wildcard one.
 *
 * Express matches in declaration order, so `GET /:id` declared above `GET /duplicates` swallows
 * it: the request arrives as a student whose id is the word "duplicates", Mongoose throws casting
 * that to an ObjectId, and the caller gets a 500 that looks like a database fault rather than a
 * routing mistake. That is exactly what happened to the duplicate-accounts panel, and nothing
 * caught it — the handler was correct, fully tested in isolation, and simply never called.
 *
 * A structural test rather than a request-level one, because the failure is invisible per-route:
 * you only see it by looking at two declarations together, in the order they were written.
 */

const ROUTES_DIR = dirname(fileURLToPath(import.meta.url))

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return path.endsWith('.ts') && !path.endsWith('.test.ts') ? [path] : []
  })
}

interface Declared {
  router: string
  method: string
  path: string
}

/** Route declarations in the order they appear, which is the order Express will try them. */
function declarations(source: string): Declared[] {
  const pattern = /(\w+Router)\.(get|post|patch|put|delete)\(\s*\n?\s*'([^']+)'/g
  const out: Declared[] = []
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source))) {
    out.push({ router: match[1]!, method: match[2]!, path: match[3]! })
  }
  return out
}

function shadowed(routes: Declared[]): string[] {
  const problems: string[] = []

  for (let i = 0; i < routes.length; i++) {
    const earlier = routes[i]!
    const earlierSegments = earlier.path.split('/').filter(Boolean)
    if (!earlierSegments.some((s) => s.startsWith(':'))) continue

    for (let j = i + 1; j < routes.length; j++) {
      const later = routes[j]!
      if (later.router !== earlier.router || later.method !== earlier.method) continue

      const laterSegments = later.path.split('/').filter(Boolean)
      if (laterSegments.length !== earlierSegments.length) continue

      // A wildcard segment matches anything; a literal one has to match exactly.
      const catchesIt = earlierSegments.every((s, k) => s.startsWith(':') || s === laterSegments[k])
      const laterIsAllLiteral = laterSegments.every((s) => !s.startsWith(':'))

      if (catchesIt && laterIsAllLiteral) {
        problems.push(
          `${later.method.toUpperCase()} ${later.path} can never be reached — ` +
            `${earlier.method.toUpperCase()} ${earlier.path} is declared above it and matches first. ` +
            `Move the literal route above the wildcard one.`,
        )
      }
    }
  }

  return problems
}

describe('route declaration order', () => {
  it('never hides a literal route behind a wildcard', () => {
    const problems = sourceFiles(ROUTES_DIR).flatMap((file) => {
      const relative = file.slice(ROUTES_DIR.length + 1)
      return shadowed(declarations(readFileSync(file, 'utf8'))).map((p) => `${relative}: ${p}`)
    })

    expect(problems).toEqual([])
  })

  it('recognises the shape that broke the duplicates panel', () => {
    // The exact ordering that shipped, so the check itself is known to work.
    const broken: Declared[] = [
      { router: 'adminStudentsRouter', method: 'get', path: '/:id' },
      { router: 'adminStudentsRouter', method: 'get', path: '/duplicates' },
    ]
    expect(shadowed(broken)).toHaveLength(1)
    expect(shadowed(broken)[0]).toContain('/duplicates')

    // And the corrected ordering is accepted.
    expect(shadowed([broken[1]!, broken[0]!])).toEqual([])
  })

  it('leaves alone the cases that are genuinely fine', () => {
    expect(
      shadowed([
        // Different methods never collide.
        { router: 'r', method: 'get', path: '/:id' },
        { router: 'r', method: 'post', path: '/merge' },
        // Different depths never collide.
        { router: 'r', method: 'get', path: '/:id' },
        { router: 'r', method: 'get', path: '/packages/:id/ledger' },
        // Different routers never collide.
        { router: 'a', method: 'get', path: '/:id' },
        { router: 'b', method: 'get', path: '/summary' },
      ]),
    ).toEqual([])
  })
})
