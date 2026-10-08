import assert from 'node:assert/strict'
import test from 'node:test'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readRecorderV4CatalogWorker } from './recorderV4CatalogWorker.js'

test('catalog IPC worker returns metadata without database or archive access for an empty explicit scope', async () => {
  const report = await readRecorderV4CatalogWorker({ kind: 'explicit', inputs: [] }, {}, {}, false)
  assert.deepEqual(report.rows, [])
  assert.deepEqual(report.summary, {
    candidates: 0,
    eligible: 0,
    selected: 0,
    excluded: 0,
    exclusions: {},
  })
  assert.equal(typeof report.inspectedAtMs, 'number')
})

test('catalog IPC worker reports input failures instead of hanging or retaining a child', async () => {
  await assert.rejects(
    readRecorderV4CatalogWorker(
      { kind: 'explicit', inputs: ['/intentionally-absent-v4-catalog-input/manifest.json'] },
      {},
      {},
      false,
    ),
    /ENOENT/,
  )
})

for (const action of ['disconnect', 'SIGTERM', 'SIGINT', 'deadline'] as const) {
  test(`catalog child stops an active metadata request on ${action}`, { timeout: 15_000 }, async (t) => {
    // A loopback S3 fixture holds a read open. No real archive or credentials are used.
    const server = createServer()
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    t.after(async () => {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    })
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    const requestReceived = once(server, 'request')
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
    // Exercise the real five-minute watchdog without making the suite wait five
    // minutes. Other timers, including SDK request timeouts, are unchanged.
    const shortDeadline =
      'data:text/javascript,' +
      encodeURIComponent(
        'const original = globalThis.setTimeout; globalThis.setTimeout = (callback, delay, ...args) => original(callback, delay === 300000 ? 2500 : delay, ...args)',
      )
    const child = spawn(
      process.execPath,
      [
        ...(action === 'deadline' ? ['--import', shortDeadline] : []),
        '--import',
        'tsx',
        path.join(root, 'src/cli/recorder-v4-catalog-overview.ts'),
      ],
      {
        cwd: root,
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        env: {
          ...process.env,
          BOT_ENV: '',
          R2_ENDPOINT: `http://127.0.0.1:${address.port}`,
          R2_ACCESS_KEY_ID: 'fixture-access',
          R2_SECRET_ACCESS_KEY: 'fixture-secret',
        },
      },
    )
    const exited = once(child, 'exit')
    t.after(async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      await exited
    })
    child.send({
      source: { kind: 'explicit', inputs: [`r2://fixture/recorder-v4/btc/5m/btc-updown-5m-1000/fixture/manifest-${'a'.repeat(64)}.json`] },
      filters: {},
      requiredFeeds: {},
      allowGaps: false,
    })
    await Promise.race([
      requestReceived,
      exited.then(() => {
        throw new Error('Catalog child exited before starting the fixture read')
      }),
    ])
    if (action === 'disconnect') child.disconnect()
    else if (action !== 'deadline') child.kill(action)
    const [code, signal] = await exited
    assert.equal(code, action === 'SIGTERM' ? 143 : action === 'SIGINT' ? 130 : 1)
    assert.equal(signal, null)
  })
}
