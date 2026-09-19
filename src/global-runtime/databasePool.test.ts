import assert from 'node:assert/strict'
import net from 'node:net'
import test, { type TestContext } from 'node:test'
import mysql from 'mysql2'
import { createDatabasePool } from '../db/pool.js'

function connectionError(code = 'EPERM', syscall = 'connect'): NodeJS.ErrnoException {
  return Object.assign(new Error('test connection failure'), { code, syscall })
}

async function fixture(
  t: TestContext,
  options: {
    failures?: number
    error?: NodeJS.ErrnoException
    host?: string
    rejectQuery?: boolean
  } = {},
) {
  let attempts = 0
  const queries: string[] = []
  const sockets = new Set<net.Socket>()
  const server = net.createServer((socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    const connection = mysql.createConnection({ stream: socket, isServer: true })
    connection.on('error', () => {})
    connection.serverHandshake({
      protocolVersion: 10,
      serverVersion: '5.7.0',
      connectionId: 1,
      statusFlags: 2,
      characterSet: 8,
      capabilityFlags: 2181036031,
      authCallback: (_params: unknown, done: () => void) => {
        done()
        connection.sequenceId = 0
      },
    })
    connection.on('query', (query: string) => {
      queries.push(query)
      if (options.rejectQuery) {
        connection.writeError({ code: 1064, message: 'test query failure' })
      } else {
        connection.writeOk({ affectedRows: 1 })
      }
      connection.sequenceId = 0
    })
    connection.on('quit', () => connection.destroy())
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as net.AddressInfo).port
  const pool = createDatabasePool({
    host: options.host ?? '127.0.0.1',
    port,
    user: 'test',
    connectionLimit: 1,
    stream: () => {
      attempts += 1
      if (attempts <= (options.failures ?? 0)) {
        const socket = new net.Socket()
        queueMicrotask(() => socket.destroy(options.error ?? connectionError()))
        return socket
      }
      return net.connect(port, '127.0.0.1')
    },
  })
  t.after(async () => {
    await pool.end()
    for (const socket of sockets) socket.destroy()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })
  return { pool, queries, attempts: () => attempts }
}

test('a loopback connection recovers from EPERM and sends the write only once', async (t) => {
  const f = await fixture(t, { failures: 1 })
  await f.pool.query('UPDATE test SET value = value + 1')
  assert.equal(f.attempts(), 2)
  assert.deepEqual(f.queries, ['UPDATE test SET value = value + 1'])

  // The failed socket did not consume the pool's only slot; reuse works too.
  await f.pool.query('SELECT 1')
  assert.equal(f.attempts(), 2)
  assert.deepEqual(f.queries, ['UPDATE test SET value = value + 1', 'SELECT 1'])
})

test('explicit connection acquisition can succeed on the third attempt', async (t) => {
  const f = await fixture(t, { failures: 2 })
  const connection = await f.pool.getConnection()
  connection.release()
  assert.equal(f.attempts(), 3)
  assert.deepEqual(f.queries, [])
})

test('a persistent connection denial fails after three attempts without sending SQL', async (t) => {
  const f = await fixture(t, { failures: Infinity })
  await assert.rejects(f.pool.query('UPDATE test SET value = value + 1'), { code: 'EPERM' })
  assert.equal(f.attempts(), 3)
  assert.deepEqual(f.queries, [])
})

for (const [name, options] of [
  ['authentication error', { error: connectionError('ER_ACCESS_DENIED_ERROR') }],
  ['other operation', { error: connectionError('EPERM', 'open') }],
  ['remote host', { host: '192.0.2.1' }],
] as const) {
  test(`${name} is not retried`, async (t) => {
    const f = await fixture(t, { ...options, failures: Infinity })
    await assert.rejects(f.pool.getConnection())
    assert.equal(f.attempts(), 1)
    assert.deepEqual(f.queries, [])
  })
}

test('an SQL failure is returned without replaying the statement', async (t) => {
  const f = await fixture(t, { rejectQuery: true })
  await assert.rejects(f.pool.query('UPDATE test SET value = value + 1'), {
    code: 'ER_PARSE_ERROR',
  })
  assert.equal(f.attempts(), 1)
  assert.deepEqual(f.queries, ['UPDATE test SET value = value + 1'])
})
