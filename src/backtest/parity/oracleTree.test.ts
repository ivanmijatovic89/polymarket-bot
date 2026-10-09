import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { dirtyToolingPaths } from './oracleTree.js'

function gitIn(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

describe('pin oracle tree (60 OR-17, OR-12)', () => {
  it('lists modified and untracked tooling files, and only tooling files', () => {
    // spec: 60 OR-17 (tooling copied into the pin tree), OR-12 (the cache marker keys on git trees)
    const repo = mkdtempSync(path.join(tmpdir(), 'oracle-tree-'))
    gitIn(repo, 'init', '-q')
    gitIn(repo, 'config', 'user.email', 't@example.com')
    gitIn(repo, 'config', 'user.name', 't')
    mkdirSync(path.join(repo, 'src', 'backtest', 'parity'), { recursive: true })
    mkdirSync(path.join(repo, 'src', 'trading'), { recursive: true })
    writeFileSync(path.join(repo, 'src', 'backtest', 'parity', 'a.ts'), 'a\n')
    writeFileSync(path.join(repo, 'src', 'trading', 'b.ts'), 'b\n')
    gitIn(repo, 'add', '.')
    gitIn(repo, 'commit', '-q', '-m', 'init')
    assert.deepEqual(dirtyToolingPaths(repo), [])
    // A change outside the tooling paths does not matter here (OR-3 covers engine paths).
    writeFileSync(path.join(repo, 'src', 'trading', 'b.ts'), 'b2\n')
    assert.deepEqual(dirtyToolingPaths(repo), [])
    writeFileSync(path.join(repo, 'src', 'backtest', 'parity', 'a.ts'), 'a2\n')
    mkdirSync(path.join(repo, 'src', 'cli', 'parity'), { recursive: true })
    writeFileSync(path.join(repo, 'src', 'cli', 'parity', 'new.ts'), 'n\n')
    assert.deepEqual(dirtyToolingPaths(repo), ['src/backtest/parity/a.ts', 'src/cli/parity/new.ts'])
  })
})
