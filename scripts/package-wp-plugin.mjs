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
import { cp, mkdir, rm, access, readFile, readdir } from 'node:fs/promises'
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

  // assets/ is build output only, and is emptied above. The booking widget's own stylesheet is
  // compiled into the bundle and injected into its shadow root, so there is no widget.css to
  // ship; the IFDA page's stylesheet is hand-written source and lives in css/ for that reason.
  for (const file of ['widget.js']) {
    const source = path.join(widgetDist, file)
    if (!(await exists(source))) {
      console.error(`Missing build output: ${file}`)
      process.exit(1)
    }
    await cp(source, path.join(assetsDir, file))
  }

  await assertWidgetSurface(path.join(assetsDir, 'widget.js'))
  await assertEverythingReferencedShips()
  await assertPluginLoads()

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

/**
 * Every file the plugin enqueues has to actually be in the plugin.
 *
 * This is here because it already went wrong once. `assets/` is emptied and rebuilt from the
 * widget build on every package, so a stylesheet written by hand and left in there was deleted
 * by the next build — and nothing complained. The plugin installed, activated, rendered, and
 * served an unstyled page, because a missing stylesheet is a 404 in the network panel and
 * nothing at all in PHP.
 *
 * So the rule is read off the source rather than kept in a list here: whatever the plugin
 * registers, this checks is on disk.
 */
async function assertEverythingReferencedShips() {
  const php = await readFile(path.join(pluginDir, 'mizuki-booking-bridge.php'), 'utf8')

  // wp_register_style( 'handle', $base . 'css/ifda.css', ... ) and the script equivalent.
  const referenced = [...php.matchAll(/wp_register_(?:style|script)\(\s*'[^']+',\s*\$base \. '([^']+)'/g)]
    .map((match) => match[1])

  if (!referenced.length) {
    console.error('No registered assets found in the plugin file. Has the registration moved?')
    process.exit(1)
  }

  const missing = []
  for (const file of referenced) {
    if (!(await exists(path.join(pluginDir, file)))) missing.push(file)
  }

  if (missing.length) {
    console.error(
      `The plugin registers ${missing.join(', ')} but ${missing.length > 1 ? 'they are' : 'it is'} not in the plugin.\n` +
        'Note that assets/ is emptied on every package — anything hand-written belongs in css/ or js/.',
    )
    process.exit(1)
  }
}

/**
 * Does the PHP parse, and does the plugin survive being loaded?
 *
 * A plugin that fatals does not fail gracefully: WordPress serves a white page on every URL of
 * the site, wp-admin included, and the only way back in is a file manager. That happened once
 * here. `wp-plugin/tests/load-plugin.php` stubs enough of WordPress and Elementor to run the
 * plugin's own code, and the states it covers are the ones that have actually bitten.
 *
 * Skipped with a warning where PHP is absent — a build machine without it should still be able
 * to produce a zip, and this check runs wherever anybody has PHP, which is everybody working on
 * a WordPress plugin.
 */
async function assertPluginLoads() {
  if (!(await hasPhp())) {
    console.warn('PHP is not installed here, so the plugin was packaged without being loaded once.')
    return
  }

  const phpFiles = await collectPhp(pluginDir)
  for (const file of phpFiles) {
    try {
      await run('php', ['-l', file])
    } catch (error) {
      console.error(`${path.relative(root, file)} does not parse:\n${error.stdout || error.message}`)
      process.exit(1)
    }
  }

  try {
    await run('php', [path.join(root, 'wp-plugin/tests/load-plugin.php')])
  } catch (error) {
    console.error('The plugin does not survive being loaded:\n' + (error.stdout || error.message))
    process.exit(1)
  }

  /* The stylesheets have to beat the theme, and not beat themselves. Both have gone wrong. */
  try {
    await run('php', [path.join(root, 'wp-plugin/tests/page-css.php')])
  } catch (error) {
    console.error('A page stylesheet is not sound:\n' + (error.stdout || error.message))
    process.exit(1)
  }

  await checkScripts(pluginDir)
}

/**
 * Every function a plugin script calls must be one it defines.
 *
 * `node --check` parses; it does not resolve names. An edit that moved a block took
 * prefersReducedMotion out with it, and the file still parsed perfectly — the slider would have
 * thrown a ReferenceError on the first press, in the browser, on the studio's site. Nothing else
 * here executes this code, so it is checked by reading it.
 */
async function checkScripts(pluginDir) {
  const jsDir = path.join(pluginDir, 'js')
  let files = []
  try {
    files = (await readdir(jsDir)).filter((name) => name.endsWith('.js'))
  } catch (error) {
    // A plugin with no js/ is fine; anything else here is this check being broken, and a
    // check that fails silently is worse than no check.
    if ('ENOENT' === error.code) {
      return
    }
    throw error
  }

  const known = new Set([
    'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'function', 'else',
    'parseInt', 'parseFloat', 'String', 'Number', 'Boolean', 'Array', 'Object', 'Math', 'JSON',
    'setTimeout', 'clearTimeout', 'requestAnimationFrame', 'matchMedia', 'Event', 'Set', 'Map',
  ])

  let broken = false

  for (const name of files) {
    const source = await readFile(path.join(jsDir, name), 'utf8')

    const defined = new Set(
      [...source.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1])
    )
    for (const match of source.matchAll(/(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*function/g)) {
      defined.add(match[1])
    }

    /*
     * Bare calls only. Anything after a dot is a method on something else, and anything after a
     * colon or a quote is inside a string — `button:not([disabled])` in a selector is not a call
     * to a function named `not`, which is what the first version of this check decided it was.
     */
    const withoutStrings = source.replace(/'[^'\n]*'|"[^"\n]*"/g, "''")

    const called = new Set(
      [...withoutStrings.matchAll(/(?<![.:\w$])([a-z][A-Za-z0-9_$]{2,})\s*\(/g)].map((m) => m[1])
    )

    const missing = [...called].filter((fn) => !defined.has(fn) && !known.has(fn))

    if (missing.length) {
      broken = true
      console.error(`js/${name} calls functions it does not define: ${missing.join(', ')}`)
    }
  }

  if (broken) {
    process.exit(1)
  }
}

async function hasPhp() {
  try {
    await run('php', ['-v'])
    return true
  } catch {
    return false
  }
}

async function collectPhp(dir) {
  const found = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) found.push(...(await collectPhp(full)))
    else if (entry.name.endsWith('.php')) found.push(full)
  }
  return found
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
