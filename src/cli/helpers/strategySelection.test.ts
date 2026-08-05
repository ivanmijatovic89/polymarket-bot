import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { CliArgsError, parseStrategyArgs } from '../../strategy/strategyDefinition.js'
import { parseArgs } from './backtestArgs.js'
import { deriveStrategyFileSource } from './strategyArgs.js'

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
      err instanceof CliArgsError && /missing required --strategy/.test((err as Error).message),
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

test('parseStrategyArgs: --strategy-file selection, both flag forms', () => {
  const spaced = parseStrategyArgs(['--strategy-file', 'strategies/x.v1.ts', '--param', 'size=2'])
  assert.equal(spaced.strategyFile, 'strategies/x.v1.ts')
  assert.equal(spaced.strategyId, null)
  assert.equal(spaced.artifactSha256, null)
  assert.equal(parseStrategyArgs(['--strategy-file=./x.ts']).strategyFile, './x.ts')
})

test('parseStrategyArgs: --strategy-file is mutually exclusive with the other selectors', () => {
  for (const argv of [
    ['--strategy', 'x.v1', '--strategy-file', 'x.ts'],
    ['--strategy-artifact', SHA, '--strategy-file', 'x.ts'],
  ]) {
    assert.throws(
      () => parseStrategyArgs(argv),
      (err: unknown) =>
        err instanceof CliArgsError && /mutually exclusive/.test((err as Error).message),
    )
  }
})

test('backtest parseArgs: strategy-file value is not treated as a parquet path', () => {
  const spaced = parseArgs(['--strategy-file', 'strategies/x.v1.ts', '--symbol', 'btc'])
  assert.deepEqual(spaced.filePaths, [])
  const inline = parseArgs(['--strategy-file=strategies/x.v1.ts', '--symbol', 'btc'])
  assert.deepEqual(inline.filePaths, [])
})

test('backtest parseArgs: --extend rejects --strategy-file', () => {
  assert.throws(
    () => parseArgs(['--extend', '42', '--strategy-file', 'x.ts']),
    /--extend 42 cannot be combined with: --strategy-file/,
  )
})

test('deriveStrategyFileSource: anchors at the nearest .git (dir or worktree-style file)', (t) => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'sfile-derive-')))
  t.after(() => rmSync(root, { recursive: true, force: true }))

  // .git DIRECTORY at repo root, strategy nested two levels down.
  mkdirSync(path.join(root, 'repo/.git'), { recursive: true })
  mkdirSync(path.join(root, 'repo/proto/strategies'), { recursive: true })
  writeFileSync(path.join(root, 'repo/proto/strategies/x.ts'), 'export const definition = {}\n')
  const a = deriveStrategyFileSource(path.join(root, 'repo/proto/strategies/x.ts'))
  assert.equal(a.repoDir, path.join(root, 'repo'))
  assert.equal(a.entrypoint, 'proto/strategies/x.ts')

  // .git FILE (worktree/submodule style).
  mkdirSync(path.join(root, 'wt/strategies'), { recursive: true })
  writeFileSync(path.join(root, 'wt/.git'), 'gitdir: /elsewhere\n')
  writeFileSync(path.join(root, 'wt/strategies/y.ts'), 'export const definition = {}\n')
  const b = deriveStrategyFileSource(path.join(root, 'wt/strategies/y.ts'))
  assert.equal(b.repoDir, path.join(root, 'wt'))
  assert.equal(b.entrypoint, 'strategies/y.ts')

  // Symlink to the strategy from OUTSIDE the repo resolves to the real repo.
  symlinkSync(path.join(root, 'repo/proto/strategies/x.ts'), path.join(root, 'link.ts'))
  const c = deriveStrategyFileSource(path.join(root, 'link.ts'))
  assert.equal(c.repoDir, path.join(root, 'repo'))
  assert.equal(c.entrypoint, 'proto/strategies/x.ts')
})

test('deriveStrategyFileSource: file outside any git repo is rejected', (t) => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'sfile-norepo-')))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  writeFileSync(path.join(root, 'x.ts'), 'export const definition = {}\n')
  assert.throws(
    () => deriveStrategyFileSource(path.join(root, 'x.ts')),
    (err: unknown) =>
      err instanceof CliArgsError &&
      /must live inside a git repository/.test((err as Error).message),
  )
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
