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

test('parseArgs parses telonex-paired-parquet mode with file path', () => {
  const parsed = parseArgs(['--input-mode', 'telonex-paired-parquet', '/tmp/pairs.parquet'])
  assert.equal(parsed.inputMode, 'telonex-paired-parquet')
  assert.deepEqual(parsed.filePaths, ['/tmp/pairs.parquet'])
})

test('parseArgs parses telonex-delta-parquet mode with file path', () => {
  const parsed = parseArgs(['--input-mode', 'telonex-delta-parquet', '/tmp/delta.parquet'])
  assert.equal(parsed.inputMode, 'telonex-delta-parquet')
  assert.deepEqual(parsed.filePaths, ['/tmp/delta.parquet'])
})

test('parseArgs rejects old paired-parquet alias', () => {
  assert.throws(
    () => parseArgs(['--input-mode', 'paired-parquet', '/tmp/pairs.parquet']),
    /\[backtest\] --input-mode must be one of: recorded, telonex-paired-parquet, telonex-delta-parquet/,
  )
})

test('parseArgs requires at least one file for telonex-paired-parquet mode', () => {
  assert.throws(
    () => parseArgs(['--input-mode', 'telonex-paired-parquet']),
    /\[backtest\] --input-mode=telonex-paired-parquet requires at least one parquet file/,
  )
})

test('parseArgs rejects telonex-paired-parquet with slug/symbol/dir', () => {
  assert.throws(
    () => parseArgs(['--input-mode', 'telonex-paired-parquet', '--slug', 'abc', '/tmp/p.parquet']),
    /\[backtest\] --input-mode=telonex-paired-parquet cannot be combined with --symbol, --slug, --dir, --limit, --random, --latest, --order, or --time-driven/,
  )
  assert.throws(
    () =>
      parseArgs(['--input-mode', 'telonex-paired-parquet', '--symbol', 'BTC', '/tmp/p.parquet']),
    /\[backtest\] --input-mode=telonex-paired-parquet cannot be combined with --symbol, --slug, --dir, --limit, --random, --latest, --order, or --time-driven/,
  )
  assert.throws(
    () => parseArgs(['--input-mode', 'telonex-paired-parquet', '--dir', '/tmp', '/tmp/p.parquet']),
    /\[backtest\] --input-mode=telonex-paired-parquet cannot be combined with --symbol, --slug, --dir, --limit, --random, --latest, --order, or --time-driven/,
  )
})

test('parseArgs rejects telonex-delta-parquet with query or replay flags', () => {
  assert.throws(
    () =>
      parseArgs([
        '--input-mode',
        'telonex-delta-parquet',
        '--order',
        'exchange_time',
        '/tmp/p.parquet',
      ]),
    /\[backtest\] --input-mode=telonex-delta-parquet cannot be combined with --symbol, --slug, --dir, --limit, --random, --latest, --order, or --time-driven/,
  )
  assert.throws(
    () => parseArgs(['--input-mode', 'telonex-delta-parquet', '--time-driven', '/tmp/p.parquet']),
    /\[backtest\] --input-mode=telonex-delta-parquet cannot be combined with --symbol, --slug, --dir, --limit, --random, --latest, --order, or --time-driven/,
  )
  assert.throws(
    () => parseArgs(['--input-mode', 'telonex-delta-parquet', '--limit', '1', '/tmp/p.parquet']),
    /\[backtest\] --input-mode=telonex-delta-parquet cannot be combined with --symbol, --slug, --dir, --limit, --random, --latest, --order, or --time-driven/,
  )
})
