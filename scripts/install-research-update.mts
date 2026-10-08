import { execFileSync, spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { build } from 'esbuild'
import { assertDatasetRoot, marketFamily } from '../src/research-data/family.js'
import { activateResearchSchedule, prepareUpdateConfig } from '../src/research-data/installation.js'
import { launchAgentPlist } from '../src/research-data/schedule.js'

const { values } = parseArgs({
  options: {
    root: { type: 'string' },
    from: { type: 'string' },
    market: { type: 'string', default: 'btc:15m' },
    activate: { type: 'boolean', default: false },
  },
})
if (!values.root || !values.from)
  throw new Error(
    'Usage: npm run research:schedule -- --root ABSOLUTE_PATH --from YYYY-MM-DD [--activate]',
  )
if (process.platform !== 'darwin')
  throw new Error(
    'This installer supports macOS launchd. Other systems can schedule research:update with their native scheduler.',
  )
if (Number(process.versions.node.split('.')[0]) !== 20)
  throw new Error('Run the installer with Node 20; its absolute executable is pinned in the job')
if (Intl.DateTimeFormat().resolvedOptions().timeZone !== 'Europe/Belgrade')
  throw new Error(
    'Set this Mac system timezone to Europe/Belgrade before installing the 03:00 schedule',
  )
const family = marketFamily(values.market)
const root = path.resolve(values.root)
await assertDatasetRoot(root)
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
execFileSync('git', ['diff', '--quiet'], { cwd: project })
execFileSync('git', ['diff', '--cached', '--quiet'], { cwd: project })
const revision = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: project,
  encoding: 'utf8',
}).trim()
const releases = path.join(root, 'runtime')
await mkdir(releases, { recursive: true })
// A preparation of the same commit must never overwrite a running release.
const runtime = await mkdtemp(path.join(releases, `${revision}-`))
const configFile = path.join(root, 'update-config.json')
const candidateConfig = await prepareUpdateConfig(runtime, {
  root,
  from: values.from,
  market: family.id,
})
const duck = JSON.parse(
  await readFile(path.join(project, 'node_modules', '@duckdb', 'node-api', 'package.json'), 'utf8'),
) as { version: string }
await writeFile(
  path.join(runtime, 'package.json'),
  JSON.stringify(
    { private: true, type: 'module', dependencies: { '@duckdb/node-api': duck.version } },
    null,
    2,
  ) + '\n',
)
execFileSync(
  path.join(path.dirname(process.execPath), 'npm'),
  ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'],
  { cwd: runtime, stdio: 'inherit' },
)
const bundle = path.join(runtime, 'research-data.mjs')
await build({
  entryPoints: [path.join(project, 'src/cli/research-data.ts')],
  outfile: bundle,
  bundle: true,
  packages: 'external',
  platform: 'node',
  format: 'esm',
  target: 'node20',
})
const logDirectory = path.join(root, 'logs', 'nightly')
await mkdir(logDirectory, { recursive: true })
const log = path.join(logDirectory, 'latest.log')
const output = path.join(logDirectory, 'latest.json')
const runner = path.join(runtime, 'nightly.mjs')
await writeFile(
  runner,
  `import { writeFileSync } from 'node:fs'\nimport { main } from ${JSON.stringify(pathToFileURL(bundle).href)}\nwriteFileSync(${JSON.stringify(log)}, '')\nwriteFileSync(${JSON.stringify(output)}, '')\ntry { await main(['update', '--config', ${JSON.stringify(configFile)}, '--scheduled']) } catch (error) { console.error(new Date().toISOString(), String(error)); process.exitCode = 1 }\n`,
)
// Smoke-test the deployed bundle and native dependency before registering a scheduled job.
execFileSync(process.execPath, [bundle, 'status', '--root', root], { stdio: 'pipe' })
const label = `com.polymarket.research.${family.symbol}-${family.timeframe}`
const plist = launchAgentPlist({ label, node: process.execPath, runner, log, output })
const prepared = path.join(runtime, `${label}.plist`)
await writeFile(prepared, plist)
execFileSync('/usr/bin/plutil', ['-lint', prepared], { stdio: 'inherit' })
if (values.activate) {
  const destination = path.join(homedir(), 'Library', 'LaunchAgents', `${label}.plist`)
  await mkdir(path.dirname(destination), { recursive: true })
  const domain = `gui/${process.getuid!()}`
  await activateResearchSchedule({
    root,
    candidateConfig,
    plistPath: destination,
    plist,
    stop: () => {
      const stopped = spawnSync('/bin/launchctl', ['bootout', `${domain}/${label}`], {
        stdio: 'pipe',
      })
      if (stopped.error) throw stopped.error
      if (stopped.status !== 0) {
        const existing = spawnSync('/bin/launchctl', ['print', `${domain}/${label}`], {
          stdio: 'pipe',
        })
        if (existing.error) throw existing.error
        if (existing.status === 0) throw new Error('Unable to unload the existing research job')
      }
    },
    start: () => {
      execFileSync('/bin/launchctl', ['bootstrap', domain, destination], { stdio: 'inherit' })
    },
    metadata: {
      label,
      timezone: 'Europe/Belgrade',
      hour: 3,
      minute: 0,
      revision,
      runtime,
      config: configFile,
      plist: destination,
      node: process.execPath,
      installed_at: new Date().toISOString(),
    },
  })
}
console.log(
  JSON.stringify(
    {
      activated: values.activate,
      runtime,
      config: values.activate ? configFile : candidateConfig,
      prepared_plist: prepared,
      schedule: '03:00 Europe/Belgrade; catch up at wake/login',
    },
    null,
    2,
  ),
)
