/**
 * Pre-start exchange-rules capture (native spec 11 §13.2.1, decision D37).
 *
 *   npm run rules:capture-prestart -- --out-dir <dir> [--market btc:5m,btc:15m] \
 *     (--watch | --once | --report [--days N])
 *
 * Public Gamma and CLOB endpoints only: no credentials, no .env, no database.
 * PC6 code boundary: imports only Node built-ins and src/exchange-rules/.
 * See docs/datasets/exchange-rules/prestart-capture.md.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import {
  PrestartCapture,
  describeError,
  formatTick,
  onceVerdict,
  resolveCaptureCommit,
  runWatch,
  type CaptureDeps,
} from '../exchange-rules/prestartCapture.js'
import { buildReport, formatReport } from '../exchange-rules/prestartCoverage.js'
import { parseMarketsArg } from '../exchange-rules/prestartGrid.js'

const USAGE =
  'Usage: npm run rules:capture-prestart -- --out-dir <dir> [--market btc:5m,btc:15m] ' +
  '(--watch | --once | --report [--days N])'

function log(line: string): void {
  console.log(`[rules-capture] ${new Date().toISOString()} ${line}`)
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  try {
    await delay(ms, undefined, signal ? { signal } : undefined)
  } catch (error) {
    if ((error as Error).name !== 'AbortError') throw error
  }
}

async function main(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    allowPositionals: false,
    options: {
      'out-dir': { type: 'string' },
      market: { type: 'string', default: 'btc:5m,btc:15m' },
      watch: { type: 'boolean', default: false },
      once: { type: 'boolean', default: false },
      report: { type: 'boolean', default: false },
      days: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  })
  if (values.help) {
    console.log(USAGE)
    return 0
  }
  const outDirArg = values['out-dir']
  if (outDirArg === undefined || outDirArg === '')
    throw new Error(`--out-dir is required\n${USAGE}`)
  const outDir = path.resolve(outDirArg)
  const modes = [values.watch, values.once, values.report].filter(Boolean).length
  if (modes !== 1) throw new Error(`choose exactly one of --watch, --once, --report\n${USAGE}`)
  if (values.days !== undefined && !values.report)
    throw new Error('--days is only valid with --report')
  const timeframes = parseMarketsArg(values.market)

  if (values.report) {
    const days = values.days === undefined ? 1 : Number(values.days)
    if (!Number.isSafeInteger(days) || days < 1)
      throw new Error('--days must be a positive integer')
    if (!fs.existsSync(outDir)) throw new Error(`--out-dir ${outDir} does not exist`)
    console.log(formatReport(buildReport({ outDir, nowMs: Date.now(), timeframes, days }), outDir))
    return 0
  }

  const captureCommit = resolveCaptureCommit(path.dirname(fileURLToPath(import.meta.url)))
  const deps: CaptureDeps = {
    outDir,
    fetch: (url, init) => fetch(url, init),
    now: Date.now,
    sleep,
    random: Math.random,
    host: os.hostname(),
    captureCommit,
    log,
  }
  const capture = new PrestartCapture(deps, timeframes)
  log(
    `${values.watch ? 'watch' : 'once'}: markets ${timeframes.map((tf) => `btc:${tf}`).join(',')}, ` +
      `out-dir ${outDir}, host ${deps.host}, commit ${captureCommit}`,
  )

  if (values.once) {
    const result = await capture.runTick()
    for (const line of formatTick(result)) log(line)
    const verdict = onceVerdict(result)
    for (const line of verdict.lines) console.log(line)
    console.log(
      verdict.complete
        ? `OK: all ${result.markets.length} markets starting in the next 10 minutes have a 200 from gamma and clob`
        : 'INCOMPLETE: not every market in the window has a 200 from both origins',
    )
    return verdict.complete ? 0 : 1
  }

  const controller = new AbortController()
  const stop = (signal: NodeJS.Signals): void => {
    log(`${signal}: stopping after the current request`)
    controller.abort()
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  await runWatch(
    capture,
    { now: deps.now, sleep, onTick: (result) => formatTick(result).forEach(log) },
    controller.signal,
    (error) => log(`tick failed: ${describeError(error)}`),
  )
  log('stopped')
  return 0
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code
  },
  (error: unknown) => {
    console.error(`[rules-capture] ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 2
  },
)
