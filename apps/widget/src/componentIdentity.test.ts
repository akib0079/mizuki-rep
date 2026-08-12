import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * No component may be defined inside another component's body.
 *
 * React decides whether to update a subtree or throw it away by comparing component identity.
 * A component created during render is a new function every time, so React replaces the whole
 * subtree on every render: fresh DOM nodes, and with them the loss of anything the browser was
 * holding — scroll position, selection, and focus.
 *
 * The symptom is not an error. It is a text box that appears to reject typing, because focus is
 * gone after the first character. That is how it was reported, and it took the sign-in form and
 * the profile form with it. Nothing in a type check or a normal render test catches it, so it
 * is caught here, in the source.
 */

const src = path.dirname(fileURLToPath(import.meta.url))

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.tsx$/.test(full) && !/\.test\.tsx$/.test(full) ? [full] : []
  })
}

describe('component identity', () => {
  it('defines no component inside another component', () => {
    const offenders: string[] = []

    for (const file of sourceFiles(src)) {
      const lines = readFileSync(file, 'utf8').split('\n')

      lines.forEach((line, i) => {
        // Indented, so inside some other function body; PascalCase, so used as a component;
        // assigned an arrow function or a choice between them.
        const declaration = /^\s+const ([A-Z]\w*)\s*=\s*(.*)$/.exec(line)
        if (!declaration) return

        // Look at this line and the next two — these are often wrapped across lines.
        const tail = [declaration[2], lines[i + 1] ?? '', lines[i + 2] ?? ''].join(' ')

        // An arrow function that returns JSX, which is what makes it a component rather than
        // a value. `useCallback`/`useMemo` results are stable and deliberately not flagged.
        const isComponent = /=>\s*(\(|<|\{[^}]*return\s*<)/.test(tail) && !/use(Callback|Memo)\(/.test(tail)

        if (isComponent) {
          offenders.push(`${path.relative(src, file)}:${i + 1} — ${declaration[1]}`)
        }
      })
    }

    expect(offenders).toEqual([])
  })
})
