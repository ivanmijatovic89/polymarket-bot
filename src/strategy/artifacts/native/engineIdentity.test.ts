import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { computeEngineIdentity } from './engineIdentity.js'

const ENV = { PATH: process.env['PATH'] ?? '/usr/bin:/bin', LANG: 'C', HOME: os.tmpdir() }

function git(dir: string, ...args: string[]): string {
  const r = spawnSync(
    'git',
    ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@localhost', ...args],
    { encoding: 'utf8', env: ENV },
  )
  assert.equal(r.status, 0, r.stderr)
  return r.stdout.trim()
}

function write(root: string, rel: string, text: string): void {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
  writeFileSync(path.join(root, rel), text)
}

// spec: 31 §5.3 — engineCommit is the last commit that changed the engine
// source set (not HEAD); the hash covers tracked and untracked, not ignored
// working-tree files, native/build/** included; engineDirty follows the tree.
test('computeEngineIdentity: engine commit, dirty flag and ignored files', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'pmb-engine-id-'))
  try {
    git(root, 'init', '-q')
    write(root, '.gitignore', 'build/\n.DS_Store\n')
    write(root, 'native/Cargo.toml', '[workspace]\n')
    write(root, 'native/build/artifact-build.toml', '[build]\n')
    write(root, 'native/crates/a/src/lib.rs', 'pub fn a() {}\n')
    write(root, 'native/crates/a/README.md', 'docs are outside the set\n')
    git(root, 'add', '.gitignore', 'native')
    git(root, 'add', '-f', 'native/build')
    git(root, 'commit', '-q', '-m', 'engine')
    const engineCommit = git(root, 'rev-parse', 'HEAD')
    write(root, 'docs/x.md', 'unrelated\n')
    git(root, 'add', 'docs')
    git(root, 'commit', '-q', '-m', 'docs')

    const clean = computeEngineIdentity(root, ENV)
    assert.equal(clean.commit, engineCommit, 'engineCommit is not the repository HEAD')
    assert.equal(clean.dirty, false)
    assert.equal(clean.fileCount, 3)

    // Ignored litter (Finder) changes neither the hash nor the dirty flag.
    write(root, 'native/build/.DS_Store', 'x')
    write(root, 'native/crates/a/.DS_Store', 'x')
    const litter = computeEngineIdentity(root, ENV)
    assert.equal(litter.sourceHash, clean.sourceHash)
    assert.equal(litter.dirty, false)

    // An untracked file under native/build (hidden from git status by build/) counts.
    write(root, 'native/build/pgo/profile.profdata', 'p')
    const untracked = computeEngineIdentity(root, ENV)
    assert.notEqual(untracked.sourceHash, clean.sourceHash)
    assert.equal(untracked.dirty, true)
    unlinkSync(path.join(root, 'native/build/pgo/profile.profdata'))

    // A modified engine file makes the tree dirty; a docs file does not count.
    write(root, 'native/crates/a/README.md', 'changed docs\n')
    assert.equal(computeEngineIdentity(root, ENV).sourceHash, clean.sourceHash)
    write(root, 'native/crates/a/src/lib.rs', 'pub fn a() { }\n')
    const modified = computeEngineIdentity(root, ENV)
    assert.notEqual(modified.sourceHash, clean.sourceHash)
    assert.equal(modified.dirty, true)
    assert.equal(modified.commit, engineCommit)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
