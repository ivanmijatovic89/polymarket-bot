import '../../config/env.js'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, type ChildProcess } from 'node:child_process'
import { installProcessCrashHandlers } from '../../utils/runtime.js'
import {
  binanceFeedLatencyMs,
  rtdsChainlinkLatencyMs,
} from '../../backtest/feeds/wireBacktestExternalFeeds.js'
import { compareParityLogs, parseParityJsonl, type ParityReport } from './feedsParityCompare.js'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

/**
 * Feeds parity harness — measure and tune how closely backtests track live.
 *
 *   npm run feeds:parity -- replay  --run <id> [--base recorded|telonex] [--env K=V ...] [--suffix name]
 *   npm run feeds:parity -- compare --run <id> [--replay-file replay-recorded.jsonl] [--live-file live.jsonl]
 *   npm run feeds:parity -- tune    --run <id> [--apply]
 *
 * Existing-run analysis only. New capture uses Recorder V4; the retired
 * capture command depended on the removed standalone orderbook recorder.
 * This harness retains the historical latency-calibration evidence and
 * does not accept V4 packages or model their already-recorded receipt times.
 *
 * replay: replays the captured recording with the SAME probe strategy
 * (deterministic: jitter=0) writing a second JSONL. --base telonex replays
 * from the canonical telonex dataset instead (next day, once synced).
 *
 * compare: live vs replay report — per-feed value agreement on a 1s grid,
 * boundary-lag distributions (the tuning signal), priceToBeat timing,
 * top-of-book agreement. Writes report JSON next to the logs.
 *
 * tune: prints suggested BACKTEST_*_LATENCY_MS values from the measured mean
 * bias; --apply re-runs replay+compare with them and prints the residual.
 * Suggestions are never written into code or env files.
 */

const PARITY_ROOT = path.join(REPO_ROOT, 'data', 'feeds-parity')

type Manifest = {
  runId: string
  symbol: string
  startedAtMs: number
  plannedMinutes: number
  endedAtMs?: number
  gitSha?: string
  env: Record<string, string>
  /** --param k=v pairs passed to the probe strategy in BOTH capture and replay. */
  probeParams?: string[]
  coveredFiles?: string[]
  replays?: Record<string, { base: string; env: Record<string, string>; file: string }>
}

function fail(msg: string): never {
  console.error(msg)
  process.exit(2)
}

async function readManifest(runId: string): Promise<Manifest> {
  const p = path.join(PARITY_ROOT, runId, 'manifest.json')
  try {
    return JSON.parse(await fs.readFile(p, 'utf8')) as Manifest
  } catch {
    return fail(
      `[feeds:parity] no manifest at ${p} — select an existing calibration run with --run`,
    )
  }
}

async function writeManifest(m: Manifest): Promise<void> {
  const p = path.join(PARITY_ROOT, m.runId, 'manifest.json')
  await fs.writeFile(p, `${JSON.stringify(m, null, 2)}\n`)
}

function spawnNpm(args: string[], extraEnv: Record<string, string>, logPath: string): ChildProcess {
  const child = spawn('npm', args, {
    cwd: REPO_ROOT,
    env: { ...process.env, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const sink = (chunk: Buffer): void => {
    void fs.appendFile(logPath, chunk).catch(() => {})
  }
  child.stdout?.on('data', sink)
  child.stderr?.on('data', sink)
  return child
}

function waitForExit(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve) => child.once('exit', (code) => resolve(code)))
}

// ---------------------------------------------------------------------------
// replay
// ---------------------------------------------------------------------------

async function replay(argv: string[]): Promise<void> {
  let runId = ''
  let base: 'recorded' | 'telonex' = 'recorded'
  let suffix = ''
  const envOverrides: Record<string, string> = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--run') runId = argv[++i] ?? ''
    else if (argv[i] === '--base') {
      const b = argv[++i]
      if (b !== 'recorded' && b !== 'telonex') fail('[feeds:parity] --base recorded|telonex')
      base = b
    } else if (argv[i] === '--suffix') suffix = argv[++i] ?? ''
    else if (argv[i] === '--env') {
      const kv = argv[++i] ?? ''
      const eq = kv.indexOf('=')
      if (eq <= 0) fail(`[feeds:parity] --env expects KEY=VALUE, got: ${kv}`)
      envOverrides[kv.slice(0, eq)] = kv.slice(eq + 1)
    } else fail(`[feeds:parity] unknown replay arg: ${argv[i]}`)
  }
  if (!runId) fail('[feeds:parity] replay requires --run <id>')
  const manifest = await readManifest(runId)
  const runDir = path.join(PARITY_ROOT, runId)
  const covered = manifest.coveredFiles ?? []
  if (covered.length === 0) fail('[feeds:parity] manifest has no covered recording files')

  const name = `replay-${base}${suffix ? `-${suffix}` : ''}`
  const outFile = path.join(runDir, `${name}.jsonl`)
  await fs.rm(outFile, { force: true }).catch(() => {})
  const env: Record<string, string> = {
    ...manifest.env,
    ...envOverrides,
    BACKTEST_LATENCY_JITTER: '0',
    FEEDS_PARITY_OUT: outFile,
  }

  const args = [
    'run',
    'backtest',
    '--',
    '--strategy',
    'feedsParityProbe.v1',
    '--sequential',
    '--batchUid',
    `parity-${runId}-${name}`,
    ...(manifest.probeParams ?? []).flatMap((kv) => ['--param', kv]),
  ]
  if (base === 'recorded') {
    args.push(...covered)
  } else {
    // Recordings interrupted by SIGINT are named `<slug>-terminated.parquet`;
    // the Telonex dataset knows only the bare slug.
    const slugs = covered
      .map((f) => path.basename(f, '.parquet').replace(/-terminated$/, ''))
      .filter((s) => /^[a-z]+-updown-/.test(s))
    args.push('--input-mode', 'telonex-delta', '--read-from', 'local', '--slug', slugs.join(','))
  }

  console.log(`[feeds:parity] replaying ${covered.length} market(s), base=${base} → ${outFile}`)
  console.log(
    `[feeds:parity] latency env: ${Object.entries(env)
      .filter(([k]) => k.startsWith('BACKTEST_'))
      .map(([k, v]) => `${k}=${v}`)
      .join(' ')}`,
  )
  const child = spawnNpm(args, env, path.join(runDir, `${name}.log`))
  const code = await waitForExit(child)
  if (code !== 0) {
    fail(
      `[feeds:parity] replay child exited ${code} — see ${path.join(runDir, `${name}.log`)}` +
        (base === 'telonex'
          ? ' (telonex base needs the slugs synced+converted locally: telonex:sync → telonex:download → telonex:convert)'
          : ''),
    )
  }
  manifest.replays = { ...(manifest.replays ?? {}), [name]: { base, env, file: `${name}.jsonl` } }
  await writeManifest(manifest)
  console.log(
    `[feeds:parity] replay done. next: npm run feeds:parity -- compare --run ${runId} --replay-file ${name}.jsonl`,
  )
}

// ---------------------------------------------------------------------------
// compare / tune
// ---------------------------------------------------------------------------

async function loadReport(
  runId: string,
  replayFile: string,
  liveFile = 'live.jsonl',
): Promise<{ report: ParityReport; manifest: Manifest; replayName: string }> {
  const manifest = await readManifest(runId)
  const runDir = path.join(PARITY_ROOT, runId)
  const replayName = replayFile.replace(/\.jsonl$/, '')
  const replayMeta = manifest.replays?.[replayName]
  const live = parseParityJsonl(await fs.readFile(path.join(runDir, liveFile), 'utf8'))
  const rep = parseParityJsonl(await fs.readFile(path.join(runDir, replayFile), 'utf8'))
  const cur = replayMeta?.env ?? manifest.env
  const report = compareParityLogs({
    live,
    replay: rep,
    currentLatency: {
      binanceMs: Number(cur.BACKTEST_BINANCE_FEED_LATENCY_MS ?? binanceFeedLatencyMs()),
      chainlinkMs: Number(cur.BACKTEST_RTDS_CHAINLINK_LATENCY_MS ?? rtdsChainlinkLatencyMs()),
    },
  })
  if (!report) fail('[feeds:parity] no overlap between live and replay logs')
  return { report, manifest, replayName }
}

function printReport(r: ParityReport): void {
  const lag = (
    s: { count: number; meanMs: number; p50Ms: number; p90Ms: number; p99Ms: number } | null,
  ): string =>
    s
      ? `n=${s.count} mean=${s.meanMs.toFixed(0)}ms p50=${s.p50Ms.toFixed(0)} p90=${s.p90Ms.toFixed(0)} p99=${s.p99Ms.toFixed(0)}`
      : 'n/a'
  console.log(
    `overlap: ${new Date(r.overlap.fromMs).toISOString()} .. ${new Date(r.overlap.toMs).toISOString()} (${r.overlap.minutes.toFixed(1)} min; rows live=${r.rows.live} replay=${r.rows.replay})`,
  )
  console.log(
    `binance   agreement=${r.binance.agreement.pct.toFixed(2)}%  lag: ${lag(r.binance.lag.stats)}  unmatched live/replay=${r.binance.lag.unmatchedLive}/${r.binance.lag.unmatchedReplay}`,
  )
  console.log(
    `chainlink agreement=${r.chainlink.agreement.pct.toFixed(2)}%  lag: ${lag(r.chainlink.lag.stats)}  unmatched live/replay=${r.chainlink.lag.unmatchedLive}/${r.chainlink.lag.unmatchedReplay}`,
  )
  console.log(
    `priceToBeat first-seen Δ: ${r.ptb.dtMs === null ? 'n/a' : `${r.ptb.dtMs}ms (replay − live)`}`,
  )
  console.log(
    `top-of-book agreement (exchange-ts aligned): ${r.book.pct.toFixed(2)}% (${r.book.agree}/${r.book.total})`,
  )
  if (r.syntheticTicks) {
    const st = r.syntheticTicks
    console.log(
      `synthetic ticks: live=${st.live} replay=${st.replay} (Δ=${st.replay - st.live})  backward-time live/replay=${st.backwardTimeLive}/${st.backwardTimeReplay}`,
    )
  }
  for (const f of [r.binance, r.chainlink]) {
    if (f.suggestion && f.lag.stats) {
      console.log(
        `  → ${f.suggestion.env}: current=${f.suggestion.currentMs} suggested=${f.suggestion.suggestedMs} (mean bias ${f.lag.stats.meanMs.toFixed(0)}ms)`,
      )
    }
  }
}

async function compare(argv: string[]): Promise<void> {
  let runId = ''
  let replayFile = 'replay-recorded.jsonl'
  let liveFile = 'live.jsonl'
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--run') runId = argv[++i] ?? ''
    else if (argv[i] === '--replay-file') replayFile = argv[++i] ?? replayFile
    else if (argv[i] === '--live-file') liveFile = argv[++i] ?? liveFile
    else fail(`[feeds:parity] unknown compare arg: ${argv[i]}`)
  }
  if (!runId) fail('[feeds:parity] compare requires --run <id>')
  const { report, replayName } = await loadReport(runId, replayFile, liveFile)
  printReport(report)
  // Replay-vs-replay cuts (--live-file replay-*.jsonl) get a two-sided report
  // name so they never overwrite the live-based report for the same replay.
  const liveName = liveFile.replace(/\.jsonl$/, '')
  const reportName = liveName === 'live' ? replayName : `${liveName}-vs-${replayName}`
  const outPath = path.join(PARITY_ROOT, runId, `report-${reportName}.json`)
  await fs.writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(`[feeds:parity] report written: ${outPath}`)
}

async function tune(argv: string[]): Promise<void> {
  let runId = ''
  let replayFile = 'replay-recorded.jsonl'
  let apply = false
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--run') runId = argv[++i] ?? ''
    else if (argv[i] === '--replay-file') replayFile = argv[++i] ?? replayFile
    else if (argv[i] === '--apply') apply = true
    else fail(`[feeds:parity] unknown tune arg: ${argv[i]}`)
  }
  if (!runId) fail('[feeds:parity] tune requires --run <id>')
  const { report, manifest, replayName } = await loadReport(runId, replayFile)
  printReport(report)
  const suggestions = [report.binance.suggestion, report.chainlink.suggestion].filter(
    (s): s is NonNullable<typeof s> => s !== null && s.suggestedMs !== s.currentMs,
  )
  if (suggestions.length === 0) {
    console.log(
      '[feeds:parity] no adjustment suggested — current latency settings already unbiased',
    )
    return
  }
  console.log('\n[feeds:parity] suggested env block:')
  for (const s of suggestions) console.log(`  ${s.env}=${s.suggestedMs}`)
  if (!apply) {
    console.log(
      '[feeds:parity] re-run with --apply to replay+compare using these values (nothing is written to code/env files)',
    )
    return
  }
  const base = (manifest.replays?.[replayName]?.base ?? 'recorded') as 'recorded' | 'telonex'
  const envArgs = suggestions.flatMap((s) => ['--env', `${s.env}=${s.suggestedMs}`])
  console.log('\n[feeds:parity] --apply: re-running replay with suggested values...')
  await replay(['--run', runId, '--base', base, '--suffix', 'tuned', ...envArgs])
  console.log('\n[feeds:parity] residual after tuning:')
  const tuned = await loadReport(runId, `replay-${base}-tuned.jsonl`)
  printReport(tuned.report)
  const outPath = path.join(PARITY_ROOT, runId, `report-replay-${base}-tuned.json`)
  await fs.writeFile(outPath, `${JSON.stringify(tuned.report, null, 2)}\n`)
}

async function main(): Promise<void> {
  installProcessCrashHandlers({ prefix: 'feeds:parity' })
  const [cmd, ...rest] = process.argv.slice(2)
  if (cmd === 'capture')
    fail(
      '[feeds:parity] capture was retired; use record:v4 for new recordings. This tool analyzes existing calibration runs only.',
    )
  if (cmd === 'replay') return replay(rest)
  if (cmd === 'compare') return compare(rest)
  if (cmd === 'tune') return tune(rest)
  fail(
    'Usage: npm run feeds:parity -- replay --run <id> [--base recorded|telonex] [--env K=V] [--suffix s] | compare --run <id> [--replay-file f] | tune --run <id> [--apply]',
  )
}

main().catch((err) => {
  console.error('[feeds:parity] fatal:', err)
  process.exit(1)
})
