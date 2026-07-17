/**
 * submit.ts — the ONLY way lab backtests are launched (EPISTEMOLOGY §3).
 *
 * Mechanical carriers of the lab's rules:
 *  - pins BACKTEST_LATENCY_DELAY/_JITTER explicitly (ambient .env trap);
 *  - derives the batchUid `glab--<exp>--<suffix>[--lat<ms>]`;
 *  - refuses `--latest` (window discipline) — windows are explicit;
 *  - holdout guard: only suffix `holdout` may touch >= 2026-06-01, and
 *    it must cover exactly the holdout window;
 *  - evidence runs (suffix not starting with smoke/probe) require a clean
 *    tree pushed to origin (workers run committed code; specs auditable);
 *  - always telonex btc/15m delta-typed via the standard producer.
 *
 * Usage:
 *   npx tsx gabagool-lab/tools/submit.ts \
 *     --exp E001-smoke --suffix smoke --strategy glab.E001-smoke \
 *     --window search|holdout|transition|<fromIso>..<toIso> \
 *     --lat 140 [--limit 10] [--param k=v ...] [--sequential] [--detach]
 *
 * Prints the exact command + env pins (paste into the ledger), then runs.
 */
import { spawn, execSync } from 'node:child_process'
import { WINDOWS } from './lib.js'

type Args = {
  exp: string
  suffix: string
  strategy: string
  window: string
  lat: number
  limit?: number
  params: string[]
  sequential: boolean
  detach: boolean
  dryRun: boolean
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const params: string[] = []
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--param' && argv[i + 1]) params.push(argv[i + 1]!)
  }
  const exp = get('--exp') ?? ''
  const suffix = get('--suffix') ?? ''
  const strategy = get('--strategy') ?? ''
  const window = get('--window') ?? ''
  const lat = Number(get('--lat'))
  const limitRaw = get('--limit')
  return {
    exp,
    suffix,
    strategy,
    window,
    lat,
    ...(limitRaw !== undefined ? { limit: Number(limitRaw) } : {}),
    params,
    sequential: argv.includes('--sequential'),
    detach: argv.includes('--detach'),
    dryRun: argv.includes('--dry-run'),
  }
}

function fail(msg: string): never {
  console.error(`[submit] REFUSED: ${msg}`)
  process.exit(1)
}

function resolveWindow(w: string): { fromMs: number; toMs: number; label: string } {
  if (w === 'search')
    return { fromMs: WINDOWS.searchFromMs, toMs: WINDOWS.searchToMs, label: 'search' }
  if (w === 'holdout')
    return { fromMs: WINDOWS.holdoutFromMs, toMs: WINDOWS.holdoutToMs, label: 'holdout' }
  if (w === 'transition')
    return { fromMs: WINDOWS.transitionFromMs, toMs: WINDOWS.transitionToMs, label: 'transition' }
  const m = w.match(/^(.+)\.\.(.+)$/)
  if (!m) fail(`--window must be search|holdout|transition|<fromIso>..<toIso>, got "${w}"`)
  const fromMs = Date.parse(m[1]!)
  const toMs = Date.parse(m[2]!)
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs >= toMs)
    fail(`unparseable window "${w}"`)
  return { fromMs, toMs, label: 'custom' }
}

async function main(): Promise<void> {
  const a = parseArgs(process.argv.slice(2))
  if (!a.exp || !/^E\d{3}-[a-z0-9-]+$/.test(a.exp))
    fail(`--exp must match E###-<slug>, got "${a.exp}"`)
  if (!a.suffix || !/^[a-z0-9-]+$/.test(a.suffix)) fail(`--suffix required (kebab), got "${a.suffix}"`)
  if (!a.strategy) fail('--strategy required (glab.<E###-slug> registry id)')
  if (!Number.isFinite(a.lat) || a.lat < 0) fail('--lat <ms> required (explicit latency pin)')
  if (process.argv.includes('--latest')) fail('--latest is banned; use explicit windows')

  const isSmoke = a.suffix.startsWith('smoke') || a.suffix.startsWith('probe')
  const win = resolveWindow(a.window)

  // Holdout guard (mechanical carrier; EVALUATION §1).
  if (a.suffix === 'holdout') {
    if (win.fromMs !== WINDOWS.holdoutFromMs || win.toMs !== WINDOWS.holdoutToMs)
      fail('suffix "holdout" must use --window holdout exactly')
  } else if (win.toMs >= WINDOWS.holdoutFromMs) {
    fail(
      `window touches the holdout (>= 2026-06-01). Only --suffix holdout may do that. ` +
        `Search window ends at ${new Date(WINDOWS.searchToMs).toISOString()}`,
    )
  }

  // Evidence runs need a clean, pushed tree (frozen spec auditability).
  if (!isSmoke) {
    const dirty = execSync('git status --porcelain', { encoding: 'utf8' }).trim()
    if (dirty) fail(`evidence run on dirty tree:\n${dirty}`)
    const head = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim()
    let upstream = ''
    try {
      upstream = execSync('git rev-parse @{u}', { encoding: 'utf8' }).trim()
    } catch {
      fail('no upstream configured; push the branch first')
    }
    if (head !== upstream) fail(`HEAD ${head.slice(0, 8)} != origin ${upstream.slice(0, 8)}; push first`)
  }

  const batchUid = `glab--${a.exp}--${a.suffix}--lat${a.lat}`
  const cli = [
    'src/cli/backtest.ts',
    '--strategy',
    a.strategy,
    '--input-mode',
    'telonex-delta',
    '--read-from',
    'local-or-download-from-r2-to-local',
    '--symbol',
    'btc',
    '--timeframe',
    '15m',
    '--from-ms',
    String(win.fromMs),
    '--to-ms',
    String(win.toMs),
    '--batchUid',
    batchUid,
  ]
  if (a.limit !== undefined) cli.push('--limit', String(a.limit))
  for (const p of a.params) cli.push('--param', p)
  if (a.sequential) cli.push('--sequential')
  if (a.detach) cli.push('--detach')

  const env = {
    ...process.env,
    BACKTEST_LATENCY_DELAY: String(a.lat),
    BACKTEST_LATENCY_JITTER: '0',
  }

  console.log(`[submit] batchUid: ${batchUid}`)
  console.log(`[submit] window: ${win.label} ${new Date(win.fromMs).toISOString()} .. ${new Date(win.toMs).toISOString()} (to-ms INCLUSIVE)`)
  console.log(`[submit] env pins: BACKTEST_LATENCY_DELAY=${a.lat} BACKTEST_LATENCY_JITTER=0`)
  console.log(`[submit] cmd: npx tsx ${cli.join(' ')}`)
  if (a.dryRun) {
    console.log('[submit] --dry-run: not executing')
    return
  }

  const child = spawn('npx', ['tsx', ...cli], { env, stdio: 'inherit' })
  child.on('exit', (code) => {
    process.exitCode = code ?? 1
  })
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
