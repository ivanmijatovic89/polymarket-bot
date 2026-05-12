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

test('parseArgs parses paired-parquet mode with file path', () => {
  const parsed = parseArgs(['--input-mode', 'paired-parquet', '/tmp/pairs.parquet'])
  assert.equal(parsed.inputMode, 'paired-parquet')
  assert.deepEqual(parsed.filePaths, ['/tmp/pairs.parquet'])
})

test('parseArgs requires at least one file for paired-parquet mode', () => {
  assert.throws(
    () => parseArgs(['--input-mode', 'paired-parquet']),
    /\[backtest\] --input-mode=paired-parquet requires at least one parquet file/,
  )
})

test('parseArgs rejects paired-parquet with slug/symbol/dir', () => {
  assert.throws(
    () => parseArgs(['--input-mode', 'paired-parquet', '--slug', 'abc', '/tmp/p.parquet']),
    /\[backtest\] --input-mode=paired-parquet cannot be combined with --symbol, --slug, or --dir/,
  )
  assert.throws(
    () => parseArgs(['--input-mode', 'paired-parquet', '--symbol', 'BTC', '/tmp/p.parquet']),
    /\[backtest\] --input-mode=paired-parquet cannot be combined with --symbol, --slug, or --dir/,
  )
  assert.throws(
    () => parseArgs(['--input-mode', 'paired-parquet', '--dir', '/tmp', '/tmp/p.parquet']),
    /\[backtest\] --input-mode=paired-parquet cannot be combined with --symbol, --slug, or --dir/,
  )
})
