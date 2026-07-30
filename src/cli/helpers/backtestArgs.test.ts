import test from 'node:test'
import assert from 'node:assert/strict'
import { parseArgs, parseLatencyFlagsFromCmd, resolveBacktestProvenance } from './backtestArgs.js'

test('parseArgs parses repeated --dir and --dir= forms', () => {
  const parsed = parseArgs(['--dir', '/tmp/a', '--dir=/tmp/b', 'x.parquet'])
  assert.deepEqual(parsed.dirs, ['/tmp/a', '/tmp/b'])
  assert.deepEqual(parsed.filePaths, ['x.parquet'])
})

test('parseArgs rejects missing --dir value', () => {
  assert.throws(() => parseArgs(['--dir']), /\[backtest\] missing value for --dir/)
  assert.throws(() => parseArgs(['--dir=']), /\[backtest\] missing value for --dir/)
})

test('parseArgs rejects --dir with --symbol', () => {
  assert.throws(
    () => parseArgs(['--dir', '/tmp/a', '--symbol', 'btc']),
    /\[backtest\] --dir and --symbol are mutually exclusive/,
  )
})

test('parseArgs rejects --dir with --slug', () => {
  assert.throws(
    () => parseArgs(['--dir', '/tmp/a', '--slug', 'btc-updown-15m-1']),
    /\[backtest\] --dir and --slug are mutually exclusive/,
  )
})

test('parseArgs parses telonex-paired mode with file path + --read-from', () => {
  const parsed = parseArgs([
    '--input-mode',
    'telonex-paired',
    '--read-from',
    'local',
    '/tmp/pairs.parquet',
  ])
  assert.equal(parsed.inputMode, 'telonex-paired')
  assert.equal(parsed.readFrom, 'local')
  assert.deepEqual(parsed.filePaths, ['/tmp/pairs.parquet'])
})

test('parseArgs parses telonex-delta mode with --symbol + --read-from', () => {
  const parsed = parseArgs([
    '--input-mode',
    'telonex-delta',
    '--read-from',
    'r2',
    '--symbol',
    'btc',
    '--limit',
    '5',
  ])
  assert.equal(parsed.inputMode, 'telonex-delta')
  assert.equal(parsed.readFrom, 'r2')
  assert.equal(parsed.symbol, 'btc')
  assert.equal(parsed.timeframe, '15m')
})

test('parseArgs rejects old telonex-*-parquet alias', () => {
  assert.throws(
    () => parseArgs(['--input-mode', 'telonex-delta-parquet', '/tmp/p.parquet']),
    /\[backtest\] --input-mode must be one of: recorded, telonex-delta, telonex-paired/,
  )
})

test('parseArgs requires --read-from for telonex modes', () => {
  assert.throws(
    () => parseArgs(['--input-mode', 'telonex-delta', '--symbol', 'btc']),
    /\[backtest\] --input-mode=telonex-delta requires --read-from \(local\|r2\)/,
  )
})

test('parseArgs forbids --read-from for recorded mode', () => {
  assert.throws(
    () => parseArgs(['--input-mode', 'recorded', '--read-from', 'local', '--symbol', 'btc']),
    /\[backtest\] --read-from is only valid with --input-mode=telonex-delta\|telonex-paired/,
  )
})

test('parseArgs rejects --read-from with invalid value', () => {
  assert.throws(
    () => parseArgs(['--input-mode', 'telonex-delta', '--read-from', 'gcs', '--symbol', 'btc']),
    /\[backtest\] --read-from must be one of: local, r2/,
  )
})

test('parseArgs allows telonex-delta combined with --slug/--symbol/--dir', () => {
  const a = parseArgs(['--input-mode', 'telonex-delta', '--read-from', 'local', '--slug', 'foo'])
  assert.deepEqual(a.slugs, ['foo'])
  const b = parseArgs([
    '--input-mode',
    'telonex-delta',
    '--read-from',
    'r2',
    '--symbol',
    'btc',
    '--limit',
    '2',
    '--random',
  ])
  assert.equal(b.symbol, 'btc')
  assert.equal(b.random, true)
  const c = parseArgs(['--input-mode', 'telonex-delta', '--read-from', 'local', '--dir', '/tmp/a'])
  assert.deepEqual(c.dirs, ['/tmp/a'])
})

test('parseArgs --timeframe defaults to 15m', () => {
  const parsed = parseArgs([
    '--input-mode',
    'telonex-delta',
    '--read-from',
    'local',
    '--symbol',
    'btc',
  ])
  assert.equal(parsed.timeframe, '15m')
})

test('parseArgs --timeframe overrides default', () => {
  const parsed = parseArgs([
    '--input-mode',
    'telonex-delta',
    '--read-from',
    'local',
    '--symbol',
    'btc',
    '--timeframe',
    '5m',
  ])
  assert.equal(parsed.timeframe, '5m')
})

test('parseArgs --timeframe rejects use without --symbol', () => {
  assert.throws(
    () => parseArgs(['--input-mode', 'telonex-delta', '--read-from', 'local', '--timeframe', '5m']),
    /\[backtest\] --timeframe is only valid together with --symbol/,
  )
})

test('parseArgs --extend parses positive integer', () => {
  const a = parseArgs(['--extend', '103'])
  assert.equal(a.extend, 103)
  const b = parseArgs(['--extend=42'])
  assert.equal(b.extend, 42)
})

test('parseArgs --extend rejects non-positive / non-integer values', () => {
  assert.throws(() => parseArgs(['--extend', '0']), /--extend must be a positive integer/)
  assert.throws(() => parseArgs(['--extend', '-5']), /--extend must be a positive integer/)
  assert.throws(() => parseArgs(['--extend', 'abc']), /--extend must be a positive integer/)
  assert.throws(() => parseArgs(['--extend', '1.5']), /--extend must be a positive integer/)
})

test('parseArgs --from-ms and --to-ms parse and round-trip', () => {
  const a = parseArgs(['--extend', '5', '--from-ms', '1700000000000'])
  assert.equal(a.fromMs, 1700000000000)
  assert.equal(a.toMs, undefined)
  const b = parseArgs(['--extend', '5', '--to-ms=1800000000000', '--from-ms=1700000000000'])
  assert.equal(b.fromMs, 1700000000000)
  assert.equal(b.toMs, 1800000000000)
})

test('parseArgs --from-ms / --to-ms reject negative / non-integer', () => {
  assert.throws(() => parseArgs(['--from-ms', '-1']), /--from-ms must be a non-negative integer/)
  assert.throws(() => parseArgs(['--to-ms', 'abc']), /--to-ms must be a non-negative integer/)
})

test('parseArgs rejects --from-ms > --to-ms', () => {
  assert.throws(
    () => parseArgs(['--from-ms', '2000', '--to-ms', '1000']),
    /--from-ms .* must be less than or equal to --to-ms/,
  )
})

test('parseArgs --extend rejects --symbol / --timeframe / --input-mode / --read-from', () => {
  assert.throws(
    () => parseArgs(['--extend', '5', '--symbol', 'btc']),
    /--extend 5 cannot be combined with: --symbol/,
  )
  assert.throws(
    () => parseArgs(['--extend', '5', '--input-mode', 'telonex-delta', '--read-from', 'local']),
    /--extend 5 cannot be combined with: --input-mode, --read-from/,
  )
  // Explicit --input-mode=recorded must also be rejected: it matches the
  // default parsed value, but the user passing it intends to override —
  // which the extend path silently ignores in favor of the parent's mode.
  assert.throws(
    () => parseArgs(['--extend', '5', '--input-mode', 'recorded']),
    /--extend 5 cannot be combined with: --input-mode/,
  )
  assert.throws(
    () => parseArgs(['--extend', '5', '--input-mode=recorded']),
    /--extend 5 cannot be combined with: --input-mode/,
  )
})

test('parseArgs --extend rejects --slug / --dir / file paths', () => {
  assert.throws(
    () => parseArgs(['--extend', '5', '--slug', 'foo']),
    /--extend 5 cannot be combined with: --slug/,
  )
  assert.throws(
    () => parseArgs(['--extend', '5', '--dir', '/tmp/a']),
    /--extend 5 cannot be combined with: --dir/,
  )
  assert.throws(
    () => parseArgs(['--extend', '5', 'file.parquet']),
    /--extend 5 cannot be combined with: <positional file path>/,
  )
})

test('parseArgs --extend rejects --strategy / --param / --batchUid / --baselineId', () => {
  assert.throws(
    () => parseArgs(['--extend', '5', '--strategy', 'X']),
    /--extend 5 cannot be combined with: --strategy/,
  )
  assert.throws(
    () => parseArgs(['--extend', '5', '--param', 'foo=bar']),
    /--extend 5 cannot be combined with: --param/,
  )
  assert.throws(
    () => parseArgs(['--extend', '5', '--batchUid', 'x']),
    /--extend 5 cannot be combined with: --batchUid/,
  )
  assert.throws(
    () => parseArgs(['--extend', '5', '--baselineId', 'x']),
    /--extend 5 cannot be combined with: --baselineId/,
  )
})

test('parseArgs --extend allows --limit / --latest / --random / --from-ms / --to-ms', () => {
  const parsed = parseArgs([
    '--extend',
    '5',
    '--limit',
    '500',
    '--latest',
    '--from-ms',
    '1700000000000',
  ])
  assert.equal(parsed.extend, 5)
  assert.equal(parsed.limit, 500)
  assert.equal(parsed.latest, true)
  assert.equal(parsed.fromMs, 1700000000000)
})

test('parseArgs --extend rejects --comment (launch-time only)', () => {
  assert.throws(
    () => parseArgs(['--extend', '5', '--comment', 'foo']),
    /--extend 5 cannot be combined with: --comment/,
  )
})

test('parseArgs parses protocol and model provenance flags', () => {
  const parsed = parseArgs([
    '--protocol',
    ' strategy-research-protocol ',
    '--model=claude-opus-4-8',
  ])
  assert.equal(parsed.protocol, 'strategy-research-protocol')
  assert.equal(parsed.model, 'claude-opus-4-8')
})

test('parseArgs rejects empty protocol and model provenance flags', () => {
  assert.throws(() => parseArgs(['--protocol']), /missing value for --protocol/)
  assert.throws(() => parseArgs(['--protocol=']), /missing value for --protocol/)
  assert.throws(() => parseArgs(['--model', '']), /missing value for --model/)
  assert.throws(() => parseArgs(['--model=  ']), /missing value for --model/)
})

test('parseArgs --extend rejects explicit protocol and model provenance', () => {
  assert.throws(
    () => parseArgs(['--extend', '5', '--protocol', 'fable-lab', '--model', 'claude-fable-5']),
    /--extend 5 cannot be combined with: --protocol, --model/,
  )
})

test('parseArgs parses explicit latency flags in both spellings', () => {
  const parsed = parseArgs(['--latency-delay-ms', '140', '--latency-jitter-ms=20'])
  assert.equal(parsed.latencyDelayMs, 140)
  assert.equal(parsed.latencyJitterMs, 20)
  assert.equal(parseArgs([]).latencyDelayMs, undefined)
})

test('parseArgs rejects invalid latency flag values', () => {
  assert.throws(
    () => parseArgs(['--latency-delay-ms', '-1']),
    /--latency-delay-ms must be a non-negative integer/,
  )
  assert.throws(
    () => parseArgs(['--latency-jitter-ms', 'abc']),
    /--latency-jitter-ms must be a non-negative integer/,
  )
  assert.throws(
    () => parseArgs(['--latency-delay-ms=1.5']),
    /--latency-delay-ms must be a non-negative integer/,
  )
})

test('parseArgs --extend rejects explicit latency flags', () => {
  assert.throws(
    () => parseArgs(['--extend', '5', '--latency-delay-ms', '140', '--latency-jitter-ms', '20']),
    /--extend 5 cannot be combined with: --latency-delay-ms, --latency-jitter-ms/,
  )
})

test('parseLatencyFlagsFromCmd recovers latency flags from a recorded cmd', () => {
  assert.deepEqual(
    parseLatencyFlagsFromCmd(
      'npm run backtest -- --strategy x --latency-delay-ms 140 --latency-jitter-ms=20 --protocol pair-fable',
    ),
    { delayMs: 140, jitterMs: 20 },
  )
  assert.deepEqual(parseLatencyFlagsFromCmd('npm run backtest -- --latency-delay-ms 140'), {
    delayMs: 140,
  })
  assert.deepEqual(parseLatencyFlagsFromCmd('npm run backtest -- --strategy x'), {})
  assert.deepEqual(parseLatencyFlagsFromCmd(null), {})
  assert.deepEqual(parseLatencyFlagsFromCmd(undefined), {})
})

test('parseLatencyFlagsFromCmd ignores flag text inside quoted comment and param values', () => {
  assert.deepEqual(
    parseLatencyFlagsFromCmd(
      'npm run backtest -- --strategy x --comment "baseline vs --latency-delay-ms 250 run"',
    ),
    {},
  )
  assert.deepEqual(
    parseLatencyFlagsFromCmd('npm run backtest -- --param "note=--latency-jitter-ms=999"'),
    {},
  )
  assert.deepEqual(
    parseLatencyFlagsFromCmd(
      'npm run backtest -- --comment "sweep --latency-delay-ms 250" --latency-delay-ms 140',
    ),
    { delayMs: 140 },
  )
})

test('resolveBacktestProvenance uses CLI values before launcher environment values', () => {
  assert.deepEqual(
    resolveBacktestProvenance(
      { protocol: 'manual-review', model: 'gpt-5.6' },
      { BACKTEST_PROTOCOL: 'fable-lab', BACKTEST_MODEL: 'claude-fable-5' },
    ),
    { protocol: 'manual-review', model: 'gpt-5.6' },
  )
  assert.deepEqual(
    resolveBacktestProvenance(
      {},
      { BACKTEST_PROTOCOL: ' gabagool-lab ', BACKTEST_MODEL: ' claude-fable-5 ' },
    ),
    { protocol: 'gabagool-lab', model: 'claude-fable-5' },
  )
  assert.deepEqual(resolveBacktestProvenance({}, {}), { protocol: null, model: null })
})

test('resolveBacktestProvenance rejects values wider than the database columns', () => {
  assert.throws(
    () => resolveBacktestProvenance({ protocol: 'x'.repeat(101) }, {}),
    /protocol must be at most 100 characters/,
  )
  assert.throws(
    () => resolveBacktestProvenance({}, { BACKTEST_MODEL: 'x'.repeat(256) }),
    /model must be at most 255 characters/,
  )
})
