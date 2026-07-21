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
 *   --dry-run        pass --dry-run to steps that support it; print the exact
 *                    command for the two that do not (telonex download/convert)
 *   --plan           print the resolved step list and exit (runs nothing)
 *   --only a,b       run only steps whose id starts with one of the prefixes
 *   --skip a,b       skip steps whose id starts with one of the prefixes
 *   --concurrency N  forwarded to steps that support it
 *
 * Step failure: dependent steps are SKIPPED, independent branches continue,
 * the summary table shows per-step status and the exit code is non-zero if
 * anything failed.
 *
 * Docs: docs/datasets/sync.md
 */

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

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
}

const USAGE = [
  'Usage: npm run data:sync:main -- --market <symbol>:<timeframe> [--market ...] [options]',
  '       npm run data:sync:worker -- --market <symbol>:<timeframe> [--market ...] [options]',
  '',
  '  --market btc:15m   repeatable, required (no default scope)',
  '  --dry-run          preflight only; steps without native --dry-run print their command',
  '  --plan             print resolved steps and exit',
  '  --only a,b         run only step ids starting with these prefixes',
  '  --skip a,b         skip step ids starting with these prefixes',
  '  --concurrency N    forwarded to steps that support it',
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
      supportsDryRun: false,
      supportsConcurrency: true,
    })
    steps.push({
      id: 'convert',
      title: 'Convert raw files (delta-typed → R2)',
      script: 'src/telonex/convert.ts',
      args: ['--converter', 'delta-typed', '--output', 'r2', '--slug-pattern', patterns],
      deps: ['orderbook-download'],
      supportsDryRun: false,
      supportsConcurrency: true,
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
  return `${(ms / 1000).toFixed(1)}s`
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

function main(): void {
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
      console.log(`  ${step.id}${deps}`)
      console.log(`    tsx ${stepCommand(step, args).join(' ')}`)
    }
    return
  }

  const status = new Map<string, StepStatus>()
  const durations = new Map<string, number>()

  for (const step of selected) {
    const selectedIds = new Set(selected.map((s) => s.id))
    const activeDeps = step.deps.filter((d) => selectedIds.has(d))
    const blocked = activeDeps.some((d) => status.get(d) !== 'ok')
    if (blocked) {
      status.set(step.id, 'skipped')
      console.log(`\n[data:sync] SKIP ${step.id} (dependency failed)`)
      continue
    }

    const argv = stepCommand(step, args)
    if (args.dryRun && !step.supportsDryRun) {
      status.set(step.id, 'ok')
      console.log(`\n[data:sync] DRY-RUN ${step.id} — no native --dry-run; would run:`)
      console.log(`  tsx ${argv.join(' ')}`)
      continue
    }

    console.log(`\n[data:sync] ===== ${step.id}: ${step.title} =====`)
    const startedAt = Date.now()
    const res = spawnSync(tsxBin, argv, { stdio: 'inherit' })
    durations.set(step.id, Date.now() - startedAt)
    status.set(step.id, res.status === 0 ? 'ok' : 'failed')
    if (res.status !== 0) {
      console.error(`[data:sync] step ${step.id} exited with code ${res.status ?? 'signal'}`)
    }
  }

  console.log('\n[data:sync] summary:')
  let failed = 0
  for (const step of selected) {
    const st = status.get(step.id) ?? 'skipped'
    if (st === 'failed') failed++
    const dur = durations.has(step.id) ? `  ${formatSeconds(durations.get(step.id)!)}` : ''
    console.log(`  ${st.toUpperCase().padEnd(7)} ${step.id}${dur}`)
  }

  if (!args.dryRun) printInventory(args.markets)

  if (failed > 0) {
    console.error(`\n[data:sync] ${failed} step(s) failed`)
    process.exitCode = 1
  }
}

main()
