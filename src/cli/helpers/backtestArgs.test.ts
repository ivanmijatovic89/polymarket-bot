import test from 'node:test'
import assert from 'node:assert/strict'
import { parseArgs } from './backtestArgs.js'

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
