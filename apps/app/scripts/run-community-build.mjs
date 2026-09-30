import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const require = createRequire(import.meta.url)
const vitePackageJson = require.resolve('vite/package.json')
const vitePackage = require(vitePackageJson)
const viteBin = join(dirname(vitePackageJson), vitePackage.bin.vite)

function cleanBuildEnvironment(baseEnv = process.env) {
  const env = {}
  for (const [key, value] of Object.entries(baseEnv)) {
    if (key.startsWith('=') || typeof value !== 'string') continue
    if (key.startsWith('VITE_SUPABASE_')) continue
    env[key] = value
  }
  env.VITE_CONDUI_EDITION = 'community'
  env.VITE_CLOUD_ACCOUNTS_ENABLED = '0'
  env.VITE_ACCOUNT_ENTRY_ENABLED = '0'
  env.VITE_EDITOR_CLOUD_SYNC = '0'
  env.EDITOR_CLOUD_SYNC = '0'
  env.VITE_ENABLE_ELECTRICAL_VISION_SCAN = '0'
  env.VITE_ENABLE_FLOORPLAN_SCAN = '0'
  env.VITE_ENABLE_PROJECT_DOCUMENTS ??= '1'
  env.VITE_ENABLE_CABLE_ROUTES ??= '1'
  return env
}

const env = cleanBuildEnvironment()

function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: appRoot, env, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

rmSync(join(appRoot, '.community-module-audit.local.json'), { force: true })
run([viteBin, 'build', '--mode', 'community', '--config', 'vite.config.ts'])
run(['./scripts/write-version-json.mjs'])
