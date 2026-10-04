import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { loadRecorderConfig } from './config.js'

async function fixture(
  t: { after: (fn: () => Promise<void>) => void },
  extra = '',
): Promise<string[]> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'recorder-config-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const file = path.join(directory, '.env.recorder')
  await writeFile(
    file,
    `POLYMARKET_API_KEY=test-key\nPOLYMARKET_API_SECRET=test-secret\nPOLYMARKET_API_PASSPHRASE=test-passphrase\nPRIVATE_KEY=unneeded-wallet-sentinel\nTRADING_ENABLED=true\n${extra}`,
  )
  return ['--env-file', file, '--no-upload']
}

test('explicit recorder configuration neither loads wallet secrets nor mutates process.env', async (t) => {
  const before = { ...process.env }
  const config = await loadRecorderConfig(await fixture(t), {})
  assert.ok(
    JSON.stringify({ ...process.env }) === JSON.stringify(before),
    'Recorder must not mutate process.env',
  )
  assert.doesNotMatch(
    JSON.stringify(config),
    /unneeded-wallet-sentinel|TRADING_ENABLED|PRIVATE_KEY/,
  )
  assert.deepEqual(config.timeframes, ['5m', '15m'])
  assert.match(config.recorderId, /^[a-zA-Z0-9_-]{1,96}$/)
  assert.equal(config.r2, null)
  assert.equal(config.statusEnabled, false)
})

test('dashboard publishing can be explicitly disabled without discarding its configuration', async (t) => {
  const args = await fixture(t, 'REDIS_URL=redis://localhost:6379\n')
  assert.equal((await loadRecorderConfig(args, {})).statusEnabled, true)
  const disabled = await loadRecorderConfig([...args, '--no-dashboard'], {})
  assert.equal(disabled.statusEnabled, false)
  assert.equal(disabled.redisUrl, 'redis://localhost:6379')
  assert.equal(
    (await loadRecorderConfig(args, { RECORDER_STATUS_ENABLED: 'false' })).statusEnabled,
    false,
  )
  await assert.rejects(
    loadRecorderConfig(args, { RECORDER_STATUS_ENABLED: 'yes' }),
    /must be true or false/,
  )
})

test('no-upload recordings preserve their archive prefix without requiring R2 credentials', async (t) => {
  const config = await loadRecorderConfig(
    await fixture(t, 'RECORDER_R2_PREFIX=recorder-v3-validation/session\n'),
    {},
  )
  assert.equal(config.upload, false)
  assert.equal(config.r2, null)
  assert.equal(config.archivePrefix, 'recorder-v3-validation/session')
})

test('duration validation rejects timer overflow and malformed arguments', async (t) => {
  const args = await fixture(t)
  assert.equal(
    (await loadRecorderConfig([...args, '--duration-seconds', '600'], {})).durationMs,
    600_000,
  )
  for (const duration of ['2147484', '9007199254740991', 'Infinity', '0', '-1', '1.5']) {
    await assert.rejects(loadRecorderConfig([...args, '--duration-seconds', duration], {}))
  }
  await assert.rejects(loadRecorderConfig([...args, '--timeframes', '1h'], {}), /timeframes/)
  await assert.rejects(
    loadRecorderConfig([...args, '--timeframes', '5m', '--timeframes', '15m'], {}),
    /duplicate option/,
  )
})

test('archive endpoint and prefix validation fail without echoing URL credentials', async (t) => {
  const args = (
    await fixture(
      t,
      'R2_ENDPOINT=https://example.r2.cloudflarestorage.com\nR2_BUCKET=recorder-test\nR2_ACCESS_KEY_ID=test-access\nR2_SECRET_ACCESS_KEY=test-r2-secret\n',
    )
  ).filter((arg) => arg !== '--no-upload')
  assert.equal((await loadRecorderConfig(args, {})).r2?.prefix, 'recorder-v3')
  for (const endpoint of [
    'http://example.com',
    'https://user:password-sentinel@example.com',
    'https://example.com/path',
    'https://example.com?secret=password-sentinel',
  ]) {
    await assert.rejects(
      loadRecorderConfig(args, { R2_ENDPOINT: endpoint }),
      (error: Error) =>
        !error.message.includes('password-sentinel') && error.message.includes('R2_ENDPOINT'),
    )
  }
  for (const prefix of ['../recordings', '/root', 'recorder-v3/', 'recorder//v3'])
    await assert.rejects(loadRecorderConfig(args, { RECORDER_R2_PREFIX: prefix }), /PREFIX/)
})
