import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const cases = [
  {
    name: 'default',
    file: '',
    shell: undefined,
    bot: undefined,
    expected: 'data/recorder-v4-cache',
  },
  {
    name: 'dotenv absolute',
    file: '/tmp/catalog cache',
    shell: undefined,
    bot: undefined,
    expected: '/tmp/catalog cache',
  },
  {
    name: 'dotenv relative',
    file: 'data/custom-cache',
    shell: undefined,
    bot: undefined,
    expected: 'data/custom-cache',
  },
  {
    name: 'shell wins without BOT_ENV',
    file: 'data/base',
    shell: 'data/shell',
    bot: undefined,
    expected: 'data/shell',
  },
  {
    name: 'BOT_ENV wins over shell and base',
    file: 'data/base',
    shell: 'data/shell',
    bot: 'data/bot',
    expected: 'data/bot',
  },
]
for (const example of cases) {
  test(`V4 prefetch and replay share the cache: ${example.name}`, async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'recorder-cache-config-'))
    try {
      await writeFile(
        path.join(cwd, '.env'),
        example.file ? `RECORDER_REPLAY_CACHE_DIR=${example.file}\n` : '',
      )
      if (example.bot)
        await writeFile(path.join(cwd, '.env.review'), `RECORDER_REPLAY_CACHE_DIR=${example.bot}\n`)
      const env = {
        PATH: process.env.PATH,
        ...(example.shell ? { RECORDER_REPLAY_CACHE_DIR: example.shell } : {}),
        ...(example.bot ? { BOT_ENV: 'review' } : {}),
      }
      const common = ['--import', import.meta.resolve('tsx')]
      const plan = spawnSync(
        process.execPath,
        [
          ...common,
          path.join(root, 'src/cli/data-sync.ts'),
          '--role',
          'worker',
          '--dataset',
          'recorder-v4',
          '--market',
          'btc:5m',
          '--plan',
        ],
        { cwd, env, encoding: 'utf8', timeout: 10_000 },
      )
      assert.equal(plan.status, 0, plan.stderr)
      const cache = spawnSync(
        process.execPath,
        [
          ...common,
          '--input-type=module',
          '-e',
          `await import(${JSON.stringify(new URL('../../config/env.ts', import.meta.url).href)}); const {recorderReplayCacheDirectory} = await import(${JSON.stringify(new URL('./cacheDirectory.ts', import.meta.url).href)}); console.log(recorderReplayCacheDirectory());`,
        ],
        { cwd, env, encoding: 'utf8', timeout: 10_000 },
      )
      assert.equal(cache.status, 0, cache.stderr)
      const expected = path.resolve(root, example.expected)
      assert.equal(cache.stdout.trim().split('\n').at(-1), expected)
      assert.ok(plan.stdout.includes(`--output ${expected}`), plan.stdout)
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })
}
