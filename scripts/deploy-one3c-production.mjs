import { readFile, writeFile, rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'

const workerDir = path.resolve('workers/one-bridge')
const sourceConfigPath = path.join(workerDir, 'wrangler.jsonc')
const tempConfigPath = path.join(workerDir, '.wrangler.one3c.production.json')
const isWindows = process.platform === 'win32'

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      // Node 22 on Windows can reject direct spawning of npm.cmd/npx.cmd with EINVAL.
      // The commands and arguments here are repository-owned constants, so using the
      // platform command shell on Windows is intentional and bounded.
      shell: isWindows,
    })
    child.on('error', reject)
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}`)))
  })
}

const npx = 'npx'
const npm = 'npm'

const sourceRaw = await readFile(sourceConfigPath, 'utf8')
const source = JSON.parse(sourceRaw)

if (source?.name !== 'amphon-one-bridge') throw new Error('Unexpected Worker name')
if (source?.main !== 'src/one2b-entry.ts') throw new Error('Unexpected Worker entry point')
if (String(source?.vars?.ONE3_STOCK_CONSUMER_ENABLED) !== 'false') {
  throw new Error('Source ONE3_STOCK_CONSUMER_ENABLED must remain fail-closed')
}

const production = structuredClone(source)
production.vars = {
  ...(production.vars || {}),
  ONE2B_SHELL_CONSUMER_ENABLED: 'true',
  ONE2D_RECONCILIATION_ENABLED: 'true',
  ONE3_STOCK_CONSUMER_ENABLED: 'true',
}

if (process.argv.includes('--runner-smoke')) {
  await run(npm, ['--version'])
  await run(npx, ['--version'])
  await rm(tempConfigPath, { force: true })
  await writeFile(tempConfigPath, `${JSON.stringify(production, null, 2)}\n`, { flag: 'wx' })
  try {
    // Validate the same Wrangler command/config shape used by production deploy,
    // without authentication or upload side effects.
    await run(npx, ['wrangler', 'deploy', '--config', tempConfigPath, '--keep-vars', '--dry-run'])
    console.log(`AMPHON ONE-3C RUNNER: PASS — platform=${process.platform}, wrangler deploy dry-run accepted`)
  } finally {
    await rm(tempConfigPath, { force: true })
  }
  process.exit(0)
}

await run(npm, ['run', 'verify:one3c'])
await rm(tempConfigPath, { force: true })
await writeFile(tempConfigPath, `${JSON.stringify(production, null, 2)}\n`, { flag: 'wx' })

try {
  await run(npx, ['wrangler', 'deploy', '--config', tempConfigPath, '--keep-vars', '--dry-run'])
  // Wrangler v4 deploy has no --yes flag. Deploy is non-interactive when auth/config
  // are already available, and --keep-vars preserves remote dashboard variables.
  await run(npx, ['wrangler', 'deploy', '--config', tempConfigPath, '--keep-vars'])
  console.log('AMPHON ONE-3C: production bridge deployed with ONE2B=true, ONE2D=true, ONE3=true; source config remains fail-closed')
} finally {
  await rm(tempConfigPath, { force: true })
}
