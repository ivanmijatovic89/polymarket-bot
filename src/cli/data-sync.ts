/**
 * data-sync — one command to sync every dataset a machine role needs.
 *
 * Composes the existing per-dataset CLIs as child processes; it adds no sync
 * logic of its own. Every underlying command is idempotent and incremental
 * (self-healing --sync ranges, claim-based download/convert, skip-if-exists
 * R2 pulls), so gap-fill, full backfill and the daily delta are all the same
 * invocation — the data decides how much work there is.
 *
 * Usage:
 *   npm run data:sync:main   -- --market btc:15m [--market eth:15m ...] [opts]
 *   npm run data:sync:worker -- --market btc:15m [--market eth:15m ...] [opts]
 *
 * Scope is explicit on purpose — there is no default market.
 *
 * Options:
 *   --market <symbol>:<timeframe>   repeatable; e.g. btc:15m (required)
 *   --dry-run        full preflight: every step runs with --dry-run and
 *                    reports what it WOULD do (missing markets/days/files)
 *   --plan           print the resolved step list and exit (runs nothing)
 *   --only a,b       run only steps whose id starts with one of the prefixes
 *   --skip a,b       skip steps whose id starts with one of the prefixes
 *   --concurrency N  forwarded to steps that support it
 *   --fanout N       N parallel processes for claim-based steps (orderbook
 *                    download + convert; conversion is CPU-bound so real
 *                    parallelism needs processes — same idea as the tmux
 *                    fan-out scripts, see docs/contribution/tmuxinator-workspace.md)
 *
 * Step failure: dependent steps are SKIPPED, independent branches continue,
 * the summary table shows per-step status and the exit code is non-zero if
 * anything failed.
 *
 * Docs: docs/datasets/sync.md
 */

import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { spawn } from 'node:child_process'

interface Market {
  symbol: string
  timeframe: string
}

interface Step {
  id: string
  title: string
  script: string
  args: string[]
  deps: string[]
  supportsDryRun: boolean
  supportsConcurrency: boolean
  /**
   * True for steps whose underlying CLI claims work items in the DB
   * (SELECT ... FOR UPDATE SKIP LOCKED), so N identical processes can
   * cooperatively drain the same queue. Conversion in particular is
   * CPU-bound single-threaded JS — real parallelism needs processes, which
   * is what --fanout provides (same idea as the tmux fan-out scripts).
   */
  fanoutable?: boolean
}

type StepStatus = 'ok' | 'failed' | 'skipped'

interface Args {
  role: 'main' | 'worker'
  markets: Market[]
  dryRun: boolean
  plan: boolean
  only: string[]
  skip: string[]
  concurrency: number | null
  fanout: number
}

const USAGE = [
  'Usage: npm run data:sync:main -- --market <symbol>:<timeframe> [--market ...] [options]',
  '       npm run data:sync:worker -- --market <symbol>:<timeframe> [--market ...] [options]',
  '',
  '  --market btc:15m   repeatable, required (no default scope)',
  '  --dry-run          full preflight; every step reports what it would do',
  '  --plan             print resolved steps and exit',
  '  --only a,b         run only step ids starting with these prefixes',
  '  --skip a,b         skip step ids starting with these prefixes',
  '  --concurrency N    forwarded to steps that support it',
  '  --fanout N         run N parallel processes for claim-based steps',
  '                     (orderbook-download, convert) — same idea as the tmux fan-outs',
].join('\n')

function parseArgs(argv: string[]): Args {
  const out: Args = {
    role: 'main',
    markets: [],
    dryRun: false,
    plan: false,
    only: [],
    skip: [],
    concurrency: null,
    fanout: 1,
  }
  let roleSeen = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--role') {
      const v = argv[++i]
      if (v !== 'main' && v !== 'worker')
        throw new Error(`[data:sync] --role must be main|worker, got ${v}`)
      out.role = v
      roleSeen = true
    } else if (a === '--market') {
      const raw = argv[++i] ?? ''
      const m = raw.match(/^([a-z0-9]+):(\d+[mhd])$/)
      if (!m || m[1] === undefined || m[2] === undefined) {
        throw new Error(`[data:sync] --market must look like btc:15m, got '${raw}'`)
      }
      out.markets.push({ symbol: m[1], timeframe: m[2] })
    } else if (a === '--dry-run') out.dryRun = true
    else if (a === '--plan') out.plan = true
    else if (a === '--only') out.only = splitList(argv[++i])
    else if (a === '--skip') out.skip = splitList(argv[++i])
    else if (a === '--concurrency') out.concurrency = Math.max(1, Number(argv[++i] ?? '1'))
    else if (a === '--fanout') out.fanout = Math.max(1, Number(argv[++i] ?? '1'))
    else throw new Error(`[data:sync] unknown arg: ${a}\n${USAGE}`)
  }
  if (!roleSeen)
    throw new Error(`[data:sync] --role is required (the npm aliases pass it)\n${USAGE}`)
  if (out.markets.length === 0)
    throw new Error(`[data:sync] at least one --market is required\n${USAGE}`)
  return out
}

function splitList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function unique<T>(xs: T[]): T[] {
  return [...new Set(xs)]
}

function buildSteps(role: Args['role'], markets: Market[]): Step[] {
  const patterns = markets.map((m) => `${m.symbol}-updown-${m.timeframe}-%`).join(',')
  const symbols = unique(markets.map((m) => m.symbol))
  const steps: Step[] = []

  if (role === 'main') {
    steps.push({
      id: 'catalog',
      title: 'Telonex catalog (telonex_markets)',
      script: 'src/telonex/sync-markets.ts',
      args: ['--slug-pattern', patterns],
      deps: [],
      supportsDryRun: true,
      supportsConcurrency: false,
    })
    steps.push({
      id: 'pricetobeat',
      title: 'priceToBeat + finalPrice backfill (Gamma)',
      script: 'src/telonex/sync-pricetobeat-and-final-price.ts',
      args: [],
      deps: ['catalog'],
      supportsDryRun: true,
      supportsConcurrency: false,
    })
    steps.push({
      id: 'orderbook-download',
      title: 'Telonex raw orderbook files',
      script: 'src/telonex/download-raw-files.ts',
      args: ['--slug-pattern', patterns],
      deps: ['catalog'],
      supportsDryRun: true,
      supportsConcurrency: true,
      fanoutable: true,
    })
    steps.push({
      id: 'convert',
      title: 'Convert raw files (delta-typed → R2)',
      script: 'src/telonex/convert.ts',
      args: ['--converter', 'delta-typed', '--output', 'r2', '--slug-pattern', patterns],
      deps: ['orderbook-download'],
      supportsDryRun: true,
      supportsConcurrency: true,
      fanoutable: true,
    })
    for (const sym of symbols) {
      steps.push({
        id: `binance-download-${sym}`,
        title: `Binance aggTrades day files (${sym})`,
        script: 'src/binance/download-aggtrades.ts',
        args: ['--symbol', sym, '--sync'],
        deps: [],
        supportsDryRun: true,
        supportsConcurrency: true,
      })
    }
    for (const sym of symbols) {
      steps.push({
        id: `binance-upload-${sym}`,
        title: `Binance aggTrades → R2 mirror (${sym})`,
        script: 'src/binance/upload-aggtrades-r2.ts',
        args: ['--symbol', sym],
        deps: [`binance-download-${sym}`],
        supportsDryRun: true,
        supportsConcurrency: true,
      })
    }
    for (const sym of symbols) {
      steps.push({
        id: `crypto-prices-download-${sym}`,
        title: `Chainlink crypto_prices day files (${sym})`,
        script: 'src/telonex/cryptoPrices/download-crypto-prices.ts',
        args: ['--symbol', sym, '--sync'],
        deps: [],
        supportsDryRun: true,
        supportsConcurrency: true,
      })
    }
    for (const sym of symbols) {
      steps.push({
        id: `crypto-prices-upload-${sym}`,
        title: `crypto_prices → R2 mirror (${sym})`,
        script: 'src/telonex/cryptoPrices/upload-crypto-prices-r2.ts',
        args: ['--symbol', sym],
        deps: [`crypto-prices-download-${sym}`],
        supportsDryRun: true,
        supportsConcurrency: true,
      })
    }
    return steps
  }

  for (const m of markets) {
    steps.push({
      id: `converted-${m.symbol}-${m.timeframe}`,
      title: `Converted orderbook parquet (${m.symbol} ${m.timeframe})`,
      script: 'src/telonex/download-converted-r2-to-local.ts',
      args: ['--converter', 'delta-typed', '--symbol', m.symbol, '--timeframe', m.timeframe],
      deps: [],
      supportsDryRun: true,
      supportsConcurrency: true,
    })
  }
  const workerSymbols = unique(markets.map((m) => m.symbol))
  for (const sym of workerSymbols) {
    steps.push({
      id: `binance-local-${sym}`,
      title: `Binance aggTrades R2 → local (${sym})`,
      script: 'src/binance/download-aggtrades-r2-to-local.ts',
      args: ['--symbol', sym],
      deps: [],
      supportsDryRun: true,
      supportsConcurrency: true,
    })
  }
  for (const sym of workerSymbols) {
    steps.push({
      id: `crypto-prices-local-${sym}`,
      title: `crypto_prices R2 → local (${sym})`,
      script: 'src/telonex/cryptoPrices/download-crypto-prices-r2-to-local.ts',
      args: ['--symbol', sym],
      deps: [],
      supportsDryRun: true,
      supportsConcurrency: true,
    })
  }
  return steps
}

function stepCommand(step: Step, args: Args): string[] {
  const argv = [step.script, ...step.args]
  if (args.concurrency != null && step.supportsConcurrency) {
    argv.push('--concurrency', String(args.concurrency))
  }
  if (args.dryRun && step.supportsDryRun) argv.push('--dry-run')
  return argv
}

function matchesPrefix(id: string, prefixes: string[]): boolean {
  return prefixes.some((p) => id.startsWith(p))
}

function formatSeconds(ms: number): string {
  if (ms < 90_000) return `${(ms / 1000).toFixed(1)}s`
  const totalMin = Math.floor(ms / 60_000)
  const h = Math.floor(totalMin / 60)
  const min = totalMin % 60
  return h > 0
    ? `${h}h${String(min).padStart(2, '0')}m`
    : `${min}m${Math.floor((ms % 60_000) / 1000)}s`
}

function clock(): string {
  return new Date().toTimeString().slice(0, 8)
}

/** Count parquet files + newest filename in a directory (flat, non-recursive). */
function inventoryDir(dir: string): string {
  if (!fs.existsSync(dir)) return 'missing'
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.parquet'))
    .sort()
  if (files.length === 0) return 'empty'
  return `${files.length} files, newest ${files[files.length - 1]}`
}

function printInventory(markets: Market[]): void {
  const symbols = unique(markets.map((m) => m.symbol))
  console.log('\n[data:sync] local dataset inventory:')
  for (const m of markets) {
    const dir = path.join('data', 'events', 'telonex', 'delta-typed', m.symbol, m.timeframe)
    console.log(`  converted ${m.symbol} ${m.timeframe}:  ${inventoryDir(dir)}  (${dir})`)
  }
  for (const sym of symbols) {
    const pair = `${sym.toUpperCase()}USDT`
    const dir = path.join('data', 'binance', 'aggTrades', pair)
    console.log(`  binance aggTrades ${pair}:  ${inventoryDir(dir)}  (${dir})`)
  }
  for (const sym of symbols) {
    const asset = `${sym}usd`
    const dir = path.join('data', 'telonex', 'crypto_prices', asset)
    console.log(`  crypto_prices ${asset}:  ${inventoryDir(dir)}  (${dir})`)
  }
}

/**
 * Run one child process; resolve with its exit code. Output is piped through
 * line-by-line (prefixed when several children run in parallel) so `onLine`
 * can harvest the children's own preflight/result counts for the summary.
 */
function runChild(
  tsxBin: string,
  argv: string[],
  prefix: string | null,
  onLine: (line: string) => void,
): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(tsxBin, argv, { stdio: ['ignore', 'pipe', 'pipe'] })
    if (child.stdout && child.stderr) {
      for (const stream of [child.stdout, child.stderr]) {
        const rl = readline.createInterface({ input: stream })
        rl.on('line', (line) => {
          console.log(prefix != null ? `${prefix} ${line}` : line)
          onLine(line)
        })
      }
    }
    child.on('close', (code) => resolve(code ?? 1))
  })
}

/** Lines worth surfacing in the final summary — the children's own counts. */
const FINDING_RE =
  /queue size=|queue=\d|to-download=|to-upload=|to download:|matched \d+ market|pending=\d/

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const allSteps = buildSteps(args.role, args.markets)

  const selected = allSteps.filter((s) => {
    if (args.only.length > 0 && !matchesPrefix(s.id, args.only)) return false
    if (matchesPrefix(s.id, args.skip)) return false
    return true
  })
  if (selected.length === 0) {
    throw new Error('[data:sync] --only/--skip filtered out every step')
  }

  const tsxBin = path.join(process.cwd(), 'node_modules', '.bin', 'tsx')
  const scope = args.markets.map((m) => `${m.symbol}:${m.timeframe}`).join(' ')
  console.log(`[data:sync] role=${args.role} markets=${scope} steps=${selected.length}`)

  if (args.plan) {
    for (const step of selected) {
      const deps = step.deps.length > 0 ? `  (after: ${step.deps.join(', ')})` : ''
      const fan = args.fanout > 1 && step.fanoutable ? `  ×${args.fanout} processes` : ''
      console.log(`  ${step.id}${deps}${fan}`)
      console.log(`    tsx ${stepCommand(step, args).join(' ')}`)
    }
    return
  }

  const status = new Map<string, StepStatus>()
  const durations = new Map<string, number>()
  const findings = new Map<string, string>()
  const runStart = Date.now()
  let position = 0

  for (const step of selected) {
    position++
    const pos = `[${position}/${selected.length}]`
    const selectedIds = new Set(selected.map((s) => s.id))
    const activeDeps = step.deps.filter((d) => selectedIds.has(d))
    const blocked = activeDeps.some((d) => status.get(d) !== 'ok')
    if (blocked) {
      status.set(step.id, 'skipped')
      console.log(`\n[data:sync] ${pos} SKIP ${step.id} (dependency failed)`)
      continue
    }

    const argv = stepCommand(step, args)
    if (args.dryRun && !step.supportsDryRun) {
      status.set(step.id, 'ok')
      console.log(`\n[data:sync] ${pos} DRY-RUN ${step.id} — no native --dry-run; would run:`)
      console.log(`  tsx ${argv.join(' ')}`)
      continue
    }

    const fanout = step.fanoutable ? args.fanout : 1
    const fanNote = fanout > 1 ? ` (${fanout} parallel processes)` : ''
    console.log(
      `\n[data:sync] ===== ${pos} ${step.id}: ${step.title}${fanNote} ===== (started ${clock()}, run elapsed ${formatSeconds(Date.now() - runStart)})`,
    )
    const startedAt = Date.now()
    const onLine = (line: string): void => {
      if (FINDING_RE.test(line)) {
        findings.set(step.id, line.replace(/^\[[^\]]+\]\s*/, '').trim())
      }
    }
    let exitCodes: number[]
    if (fanout > 1) {
      exitCodes = await Promise.all(
        Array.from({ length: fanout }, (_, k) =>
          runChild(tsxBin, argv, `[${step.id}#${k + 1}]`, onLine),
        ),
      )
    } else {
      exitCodes = [await runChild(tsxBin, argv, null, onLine)]
    }
    durations.set(step.id, Date.now() - startedAt)
    const failedCodes = exitCodes.filter((c) => c !== 0)
    const ok = failedCodes.length === 0
    status.set(step.id, ok ? 'ok' : 'failed')
    if (!ok) {
      console.error(
        `[data:sync] step ${step.id}: ${failedCodes.length}/${exitCodes.length} process(es) failed (codes: ${failedCodes.join(', ')})`,
      )
    }
    const remaining = selected
      .slice(position)
      .map((s) => s.id)
      .join(', ')
    console.log(
      `[data:sync] ${pos} ${step.id} ${ok ? 'OK' : 'FAILED'} in ${formatSeconds(durations.get(step.id)!)} (run elapsed ${formatSeconds(Date.now() - runStart)}${remaining ? `; remaining: ${remaining}` : '; last step'})`,
    )
  }

  console.log('\n[data:sync] summary:')
  let failed = 0
  const idWidth = Math.max(...selected.map((s) => s.id.length))
  for (const step of selected) {
    const st = status.get(step.id) ?? 'skipped'
    if (st === 'failed') failed++
    const dur = durations.has(step.id)
      ? formatSeconds(durations.get(step.id)!).padStart(7)
      : ''.padStart(7)
    const finding = findings.get(step.id)
    console.log(
      `  ${st.toUpperCase().padEnd(7)} ${step.id.padEnd(idWidth)} ${dur}${finding ? `  — ${finding}` : ''}`,
    )
  }

  if (!args.dryRun) printInventory(args.markets)

  if (failed > 0) {
    console.error(`\n[data:sync] ${failed} step(s) failed`)
    process.exitCode = 1
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err)
  process.exitCode = 1
})
