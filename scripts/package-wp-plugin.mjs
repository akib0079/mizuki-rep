#!/usr/bin/env node
/**
 * Assembles the WordPress plugin into a zip the studio can upload through wp-admin.
 *
 * The built widget lives in apps/widget/dist and the PHP lives in wp-plugin/, so this copies
 * the former into the latter's assets folder and zips the result.
 *
 * `assets/` is generated and is emptied on every run — nothing hand-written may live there. The
 * plugin's own source is in `includes/` and `js/`, which this leaves alone and the zip picks up.
 *
 * `npm run build` now ends by running this, and it has to stay that way. The plugin's copy of
 * widget.js is a build artefact and is not in git, so nothing about the repository being current
 * says anything about the zip sitting next to it. A build that refreshed dist but left the zip
 * alone produced exactly that: a plugin uploaded to the live site carrying a bundle from before
 * the work it was supposed to deliver, with the API correctly updated underneath it — which
 * looks, from the outside, like a feature that simply does not work.
 */
import { cp, mkdir, rm, access, readFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const run = promisify(execFile)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const widgetDist = path.join(root, 'apps/widget/dist')
const pluginDir = path.join(root, 'wp-plugin/mizuki-booking-bridge')
const assetsDir = path.join(pluginDir, 'assets')
const outputZip = path.join(root, 'wp-plugin/mizuki-booking-bridge.zip')

async function exists(target) {
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}

async function main() {
  if (!(await exists(widgetDist))) {
    console.error('The widget has not been built yet. Run: npm run build -w @mizuki/widget')
    process.exit(1)
  }

  await rm(assetsDir, { recursive: true, force: true })
  await mkdir(assetsDir, { recursive: true })

  // Just the one file: the stylesheet is compiled into the bundle and injected into the widget's
  // shadow root, so there is no separate widget.css to ship.
  for (const file of ['widget.js']) {
    const source = path.join(widgetDist, file)
    if (!(await exists(source))) {
      console.error(`Missing build output: ${file}`)
      process.exit(1)
    }
    await cp(source, path.join(assetsDir, file))
  }

  await assertWidgetSurface(path.join(assetsDir, 'widget.js'))

  await rm(outputZip, { force: true })
  // `zip` ships with macOS and every Linux host the studio might build on.
  await run('zip', ['-r', '-q', outputZip, 'mizuki-booking-bridge'], { cwd: path.join(root, 'wp-plugin') })

  console.log('Built wp-plugin/mizuki-booking-bridge.zip')
  console.log('Upload it in WordPress under Plugins → Add New → Upload Plugin.')
}

/**
 * The two things the plugin calls on the bundle, checked in the file that actually ships.
 *
 * `refresh` went missing for a whole release without anyone noticing, because it existed in
 * development and not in the build: this is an IIFE named MizukiBooking, so Vite ends the file by
 * assigning the module's *exports* to that global — quietly replacing the object the module had
 * assigned to it a moment earlier. Anything not exported simply was not there. Nothing failed;
 * the buttons on the page just did nothing.
 */
async function assertWidgetSurface(builtFile) {
  const source = await readFile(builtFile, 'utf8')

  const missing = ['mount', 'refresh'].filter(
    (name) => !new RegExp(`[.{,]${name}\\s*[=:]`).test(source),
  )

  if (missing.length > 0) {
    console.error(
      `The built widget does not expose ${missing.join(' or ')} on window.MizukiBooking.\n` +
        'Everything the plugin calls has to be exported from apps/widget/src/embed.tsx — the IIFE\n' +
        'wrapper overwrites the global with the exports, so an internal function is not enough.',
    )
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
