import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import mysql from 'mysql2'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

// A local protocol fixture never contacts an application database or R2. It
// accepts a lease, then deliberately leaves SQL unanswered like a blackholed link.
async function exercise(mode, t) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'catalog-recovery-'))
  const connections = []
  let lease
  let child
  let blocked = false
  let stderr = ''
  let queriedScope = false
  let leaseTimeoutConfigured = false
  let lockAcquiredWithTimeout = false
  const statusMode = mode.startsWith('status')
  const expectedPrefix = mode === 'status override' ? 'recorder-v4/explicit' : 'recorder-v4/review'
  const expectedScope = createHash('sha256')
    .update(JSON.stringify(['review-catalog', expectedPrefix]))
    .digest('hex')
  const server = mysql.createServer((connection) => {
    connections.push(connection)
    connection.on('error', () => {})
    connection.serverHandshake({
      protocolVersion: 10,
      serverVersion: '8.4.0-test',
      connectionId: connections.length,
      statusFlags: 2,
      characterSet: 45,
      capabilityFlags: 0x00088201,
    })
    connection.on('stmt_prepare', (sql) => {
      if (sql.startsWith('SET SESSION wait_timeout')) leaseTimeoutConfigured = true
      connection.writeOk()
    })
    connection.on('query', (sql) => {
      if (statusMode) {
        queriedScope = sql.includes(expectedScope)
        connection.writeColumns([
          {
            catalog: 'def',
            schema: '',
            table: '',
            orgTable: '',
            name: 'id',
            orgName: '',
            characterSet: 63,
            columnLength: 64,
            columnType: 253,
            flags: 0,
            decimals: 0,
          },
        ])
        connection.writeEof()
      } else if (sql.includes('GET_LOCK')) {
        lease = connection
        lockAcquiredWithTimeout = leaseTimeoutConfigured
        if (mode === 'stalled acquisition') {
          blocked = true
          return
        }
        connection.writeColumns([
          {
            catalog: 'def',
            schema: '',
            table: '',
            orgTable: '',
            name: 'acquired',
            orgName: '',
            characterSet: 63,
            columnLength: 1,
            columnType: 3,
            flags: 0,
            decimals: 0,
          },
        ])
        connection.writeTextRow(['1'])
        connection.writeEof()
      } else if (/insert into `recorder_v4_catalog_syncs`/i.test(sql)) {
        blocked = true
        if (mode === 'lease loss') lease.stream.destroy()
        if (mode === 'SIGTERM') child.kill('SIGTERM')
      } else {
        connection.writeOk()
      }
    })
  })
  t.after(async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit')
      child.kill('SIGKILL')
      await exited
    }
    for (const connection of connections) connection.stream.destroy()
    await new Promise((resolve) => server.close(resolve))
    await rm(cwd, { recursive: true, force: true })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server._server.address().port
  await writeFile(
    path.join(cwd, 'catalog.env'),
    `DATABASE_HOST=127.0.0.1\nDATABASE_PORT=${port}\nDATABASE_USERNAME=review\nDATABASE_NAME=review\nR2_ENDPOINT=https://r2.invalid\nR2_BUCKET=review-catalog\nR2_ACCESS_KEY_ID=dummy\nR2_SECRET_ACCESS_KEY=dummy\nRECORDER_R2_PREFIX=recorder-v4/review\n`,
  )
  child = spawn(
    process.execPath,
    [
      '--import',
      import.meta.resolve('tsx'),
      path.join(root, 'src/cli/recorder-v4-catalog.ts'),
      ...(statusMode ? ['status'] : ['sync', '--watch']),
      ...(mode === 'status override' ? ['--prefix', 'recorder-v4/explicit'] : []),
      '--env-file',
      path.join(cwd, 'catalog.env'),
    ],
    { cwd, env: { PATH: process.env.PATH }, stdio: ['ignore', 'ignore', 'pipe'] },
  )
  child.stderr.on('data', (data) => {
    stderr = (stderr + data.toString()).slice(-10_000)
  })
  const [code, signal] = await once(child, 'exit')
  if (statusMode) {
    assert.equal(queriedScope, true, 'status must honor the selected configuration prefix')
    assert.equal(code, 0, stderr)
    assert.equal(signal, null, stderr)
    assert.doesNotMatch(stderr, /shutdown exceeded|database operation exceeded/)
    return
  }
  assert.equal(
    lockAcquiredWithTimeout,
    true,
    'configure the server timeout before acquiring a possibly orphaned lock',
  )
  assert.equal(blocked, true, stderr)
  assert.equal(signal, null, stderr)
  assert.equal(code, 1, stderr)
  assert.match(stderr, /shutdown exceeded 5 seconds/)
  if (mode === 'lease loss') assert.match(stderr, /database lease lost/)
  if (mode.startsWith('stalled')) assert.match(stderr, /database operation exceeded 30 seconds/)
}

test(
  'catalog exits for supervisor recovery when database operations stop responding',
  { concurrency: 4 },
  async (t) => {
    await Promise.all(
      [
        'lease loss',
        'SIGTERM',
        'stalled query',
        'stalled acquisition',
        'status',
        'status override',
      ].map((mode) => t.test(mode, { timeout: 50_000 }, (t) => exercise(mode, t))),
    )
  },
)
