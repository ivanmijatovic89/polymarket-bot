import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const secret = 'never-print-this-recorder-secret'
const entries = {
  recorder: fileURLToPath(new URL('../cli/record-v4.ts', import.meta.url)),
  catalog: fileURLToPath(new URL('../cli/record-v4-data.ts', import.meta.url)),
}

function invoke(entry: keyof typeof entries, cwd: string, args: string[]) {
  const child = spawnSync(
    process.execPath,
    ['--import', import.meta.resolve('tsx'), entries[entry], ...args],
    {
      cwd,
      env: { PATH: process.env.PATH, NODE_ENV: 'test' },
      encoding: 'utf8',
      timeout: 15_000,
    },
  )
  assert.equal(child.error, undefined)
  const output = child.stdout + child.stderr
  assert.doesNotMatch(output, new RegExp(secret))
  return { code: child.status, output }
}

test('recorder CLIs provide help without configuration and actionable argument errors', async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'recorder-cli-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  for (const entry of ['recorder', 'catalog'] as const) {
    const help = invoke(entry, cwd, ['--help'])
    assert.equal(help.code, 0)
    assert.match(help.output, /Usage:/)
  }
  const unknown = invoke('recorder', cwd, [`--${secret}`])
  assert.equal(unknown.code, 1)
  assert.match(unknown.output, /unknown option.*--help/)
  const missingFile = invoke('recorder', cwd, [])
  assert.equal(missingFile.code, 1)
  assert.match(missingFile.output, /cannot read.*--env-file/)
  const missingOutput = invoke('catalog', cwd, ['download'])
  assert.equal(missingOutput.code, 1)
  assert.match(missingOutput.output, /requires an explicit --output/)
})

test('recorder CLIs show invalid credential-bearing endpoint errors without disclosing values', async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'recorder-cli-secret-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  const file = path.join(cwd, 'invalid.env')
  await writeFile(
    file,
    `R2_ENDPOINT=https://user:${secret}@example.invalid\nR2_BUCKET=recorder-test\nR2_ACCESS_KEY_ID=${secret}\nR2_SECRET_ACCESS_KEY=${secret}\n`,
  )
  for (const [entry, args] of [
    ['recorder', ['--env-file', file]],
    ['catalog', ['list', '--env-file', file]],
  ] as const) {
    const result = invoke(entry, cwd, [...args])
    assert.equal(result.code, 1)
    assert.match(result.output, /R2_ENDPOINT must be an HTTPS/)
  }
})
