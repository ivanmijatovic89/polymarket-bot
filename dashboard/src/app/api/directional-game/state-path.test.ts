import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { protocolStatePath } from './state-path'

test('reads legacy state before migration and only nested state after migration', async (t) => {
  const repo = mkdtempSync(path.join(tmpdir(), 'directional-state-test-'))
  t.after(() => rmSync(repo, { recursive: true, force: true }))
  const runGit = (args: string[]) =>
    execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  const git = async (args: string[]) => runGit(args)
  runGit(['init', '-q'])
  runGit(['config', 'user.name', 'test'])
  runGit(['config', 'user.email', 'test@example.invalid'])
  mkdirSync(path.join(repo, 'demo/state'), { recursive: true })
  writeFileSync(path.join(repo, 'demo/state/STATUS.md'), 'legacy')
  runGit(['add', '.'])
  runGit(['commit', '-qm', 'legacy'])
  assert.equal(await protocolStatePath(git, 'HEAD', 'demo'), 'demo/state')
  mkdirSync(path.join(repo, 'protocols/demo'), { recursive: true })
  writeFileSync(path.join(repo, 'protocols/demo/README.md'), 'new directory; status absent')
  runGit(['add', '.'])
  runGit(['commit', '-qm', 'nested'])
  const selected = await protocolStatePath(git, 'HEAD', 'demo')
  assert.equal(selected, 'protocols/demo/state')
  assert.throws(() => runGit(['show', `HEAD:${selected}/STATUS.md`]))
})
