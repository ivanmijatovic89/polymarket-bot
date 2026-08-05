import assert from 'node:assert/strict'
import test from 'node:test'
import { CliArgsError, parseStrategyArgs } from '../../strategy/strategyDefinition.js'
import { parseArgs } from './backtestArgs.js'

/**
 * Strategy selection parsing: `--strategy` vs `--strategy-artifact` (#211),
 * and the backtest argv parser's handling of the artifact flag (its bare-sha
 * value must never be mistaken for a positional parquet path).
 */

const SHA = 'a'.repeat(64)

test('parseStrategyArgs: registry selection is unchanged', () => {
  const parsed = parseStrategyArgs(['--strategy', 'x.v1', '--param', 'size=2'])
  assert.equal(parsed.strategyId, 'x.v1')
  assert.equal(parsed.artifactSha256, null)
  assert.deepEqual(parsed.rawParams, { size: '2' })
})

test('parseStrategyArgs: artifact selection, both flag forms', () => {
  assert.equal(parseStrategyArgs(['--strategy-artifact', SHA]).artifactSha256, SHA)
  const eq = parseStrategyArgs([`--strategy-artifact=${SHA}`, '--param', 'size=2'])
  assert.equal(eq.artifactSha256, SHA)
  assert.equal(eq.strategyId, null)
  assert.deepEqual(eq.rawParams, { size: '2' })
})

test('parseStrategyArgs: uppercase sha is normalized to lowercase', () => {
  assert.equal(parseStrategyArgs(['--strategy-artifact', SHA.toUpperCase()]).artifactSha256, SHA)
})

test('parseStrategyArgs: --strategy and --strategy-artifact are mutually exclusive', () => {
  assert.throws(
    () => parseStrategyArgs(['--strategy', 'x.v1', '--strategy-artifact', SHA]),
    (err: unknown) =>
      err instanceof CliArgsError && /mutually exclusive/.test((err as Error).message),
  )
})

test('parseStrategyArgs: missing both selections is rejected', () => {
  assert.throws(
    () => parseStrategyArgs(['--param', 'size=2']),
    (err: unknown) =>
      err instanceof CliArgsError &&
      /--strategy <id> or --strategy-artifact/.test((err as Error).message),
  )
})

test('parseStrategyArgs: malformed sha is rejected', () => {
  for (const bad of ['deadbeef', 'g'.repeat(64), `${SHA}0`]) {
    assert.throws(
      () => parseStrategyArgs(['--strategy-artifact', bad]),
      (err: unknown) =>
        err instanceof CliArgsError && /invalid --strategy-artifact/.test((err as Error).message),
    )
  }
})

test('backtest parseArgs: artifact sha value is not treated as a parquet path', () => {
  const spaced = parseArgs(['--strategy-artifact', SHA, '--symbol', 'btc'])
  assert.deepEqual(spaced.filePaths, [])
  const inline = parseArgs([`--strategy-artifact=${SHA}`, '--symbol', 'btc'])
  assert.deepEqual(inline.filePaths, [])
})

test('backtest parseArgs: --extend rejects --strategy-artifact', () => {
  assert.throws(
    () => parseArgs(['--extend', '42', '--strategy-artifact', SHA]),
    /--extend 42 cannot be combined with: --strategy-artifact/,
  )
})
