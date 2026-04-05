import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const target = process.argv[2] ?? 'all'
const validTargets = new Set(['all', 'chromium', 'firefox'])

if (!validTargets.has(target)) {
  console.error(`Invalid target \"${target}\". Use one of: all, chromium, firefox.`)
  process.exit(1)
}

const rootDir = process.cwd()
const distDir = resolve(rootDir, 'dist')
const outRootDir = resolve(rootDir, 'dist-browsers')

if (!existsSync(distDir)) {
  console.error('Missing dist folder. Run the core build first.')
  process.exit(1)
}

mkdirSync(outRootDir, { recursive: true })

function copyDistTo(targetDirName) {
  const targetDir = resolve(outRootDir, targetDirName)
  rmSync(targetDir, { recursive: true, force: true })
  cpSync(distDir, targetDir, { recursive: true })
  return targetDir
}

function patchFirefoxManifest(firefoxDir) {
  const manifestPath = resolve(firefoxDir, 'manifest.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))

  if (Array.isArray(manifest.web_accessible_resources)) {
    manifest.web_accessible_resources = manifest.web_accessible_resources.map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return entry
      }

      const { use_dynamic_url: _ignored, ...safeEntry } = entry
      return safeEntry
    })
  }

  const serviceWorkerPath =
    typeof manifest.background?.service_worker === 'string'
      ? manifest.background.service_worker
      : null

  if (serviceWorkerPath) {
    const serviceWorkerLoaderPath = resolve(firefoxDir, serviceWorkerPath)
    let targetModulePath = null

    if (existsSync(serviceWorkerLoaderPath)) {
      const serviceWorkerLoaderCode = readFileSync(serviceWorkerLoaderPath, 'utf-8')
      const match = serviceWorkerLoaderCode.match(/import\s+['\"](.+?)['\"]/)
      targetModulePath = match?.[1] ?? null
    }

    const firefoxBackgroundLoader = 'firefox-background-loader.js'
    const importPath = targetModulePath ?? `./${serviceWorkerPath}`

    writeFileSync(
      resolve(firefoxDir, firefoxBackgroundLoader),
      [
        "(async () => {",
        `  await import(${JSON.stringify(importPath)});`,
        '})();',
        '',
      ].join('\n'),
      'utf-8',
    )

    manifest.background = {
      scripts: [firefoxBackgroundLoader],
    }
  }

  manifest.browser_specific_settings = {
    gecko: {
      id: 'gaze@favodev.local',
      strict_min_version: '121.0',
    },
  }

  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8')
}

if (target === 'all' || target === 'chromium') {
  const chromiumDir = copyDistTo('chromium')
  console.log(`Chromium package ready: ${chromiumDir}`)
}

if (target === 'all' || target === 'firefox') {
  const firefoxDir = copyDistTo('firefox')
  patchFirefoxManifest(firefoxDir)
  console.log(`Firefox package ready: ${firefoxDir}`)
}
