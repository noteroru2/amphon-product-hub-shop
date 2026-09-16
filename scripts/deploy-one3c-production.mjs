import { readFile, writeFile, rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'

const workerDir = path.resolve('workers/one-bridge')
const sourceConfigPath = path.join(workerDir, 'wrangler.jsonc')
const tempConfigPath = path.join(workerDir, '.wrangler.one3c.production.json')

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', shell: false })
    child.on('error', reject)
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}`)))
  })
}

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
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

await run(npx, ['wrangler', 'deploy', '--config', tempConfigPath, '--dry-run'])

try {
  await writeFile(tempConfigPath, `${JSON.stringify(production, null, 2)}\n`, { flag: 'wx' })
  await run(npx, ['wrangler', 'deploy', '--config', tempConfigPath, '--keep-vars', '--yes'])
  console.log('AMPHON ONE-3C: production bridge deployed with ONE2B=true, ONE2D=true, ONE3=true; source config remains fail-closed')
} finally {
  await rm(tempConfigPath, { force: true })
}
