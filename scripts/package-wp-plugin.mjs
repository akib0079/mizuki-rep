#!/usr/bin/env node
/**
 * Assembles the WordPress plugin into a zip the studio can upload through wp-admin.
 *
 * The built widget lives in apps/widget/dist and the PHP lives in wp-plugin/, so this copies
 * the former into the latter's assets folder and zips the result. Run after `npm run build`.
 */
import { cp, mkdir, rm, access } from 'node:fs/promises'
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

  await rm(outputZip, { force: true })
  // `zip` ships with macOS and every Linux host the studio might build on.
  await run('zip', ['-r', '-q', outputZip, 'mizuki-booking-bridge'], { cwd: path.join(root, 'wp-plugin') })

  console.log('Built wp-plugin/mizuki-booking-bridge.zip')
  console.log('Upload it in WordPress under Plugins → Add New → Upload Plugin.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
