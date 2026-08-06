import assert from 'node:assert/strict'
import net from 'node:net'
import { once } from 'node:events'
import { test } from 'node:test'
import { deriveTunnelSpecs, SandboxTunnels } from './sandboxTunnels.js'

function listenEphemeral(server: net.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      resolve((server.address() as net.AddressInfo).port)
    })
  })
}

async function freePort(): Promise<number> {
  const probe = net.createServer()
  const port = await listenEphemeral(probe)
  await new Promise<void>((resolve) => probe.close(() => resolve()))
  return port
}

test('deriveTunnelSpecs maps DATABASE_* and REDIS_URL onto the fixed local ports', () => {
  const specs = deriveTunnelSpecs({
    DATABASE_HOST: '100.107.149.100',
    DATABASE_PORT: '3307',
    REDIS_URL: 'redis://:secret@100.107.149.100:6380/0',
  })
  assert.deepEqual(specs, [
    { localPort: 13306, remoteHost: '100.107.149.100', remotePort: 3307 },
    { localPort: 16379, remoteHost: '100.107.149.100', remotePort: 6380 },
  ])
})

test('deriveTunnelSpecs defaults ports and returns null on missing or unparseable env', () => {
  const defaulted = deriveTunnelSpecs({
    DATABASE_HOST: 'db.internal',
    REDIS_URL: 'redis://db.internal',
  })
  assert.equal(defaulted?.[0]?.remotePort, 3306)
  assert.equal(defaulted?.[1]?.remotePort, 6379)
  assert.equal(deriveTunnelSpecs({ REDIS_URL: 'redis://x' }), null)
  assert.equal(deriveTunnelSpecs({ DATABASE_HOST: 'x' }), null)
  assert.equal(deriveTunnelSpecs({ DATABASE_HOST: 'x', REDIS_URL: 'not a url' }), null)
})

test('ensureStarted fails loudly when the daemon env lacks tunnel targets', async () => {
  const tunnels = new SandboxTunnels({})
  await assert.rejects(() => tunnels.ensureStarted(), /DATABASE_HOST and a parseable REDIS_URL/u)
  // A failed start is retryable (startPromise reset), not latched.
  await assert.rejects(() => tunnels.ensureStarted(), /DATABASE_HOST and a parseable REDIS_URL/u)
})

test('forwards TCP bytes both ways and stops listening after close', async () => {
  // Upstream echo server standing in for MySQL. The tunnel destroys its side
  // on teardown, which can surface here as an async ECONNRESET — swallow it.
  const upstream = net.createServer((socket) => {
    socket.on('error', () => undefined)
    socket.on('data', (chunk) => socket.write(`echo:${chunk.toString()}`))
  })
  const upstreamPort = await listenEphemeral(upstream)
  const localPort = await freePort()
  const tunnels = new SandboxTunnels({}, [
    { localPort, remoteHost: '127.0.0.1', remotePort: upstreamPort },
  ])
  try {
    await tunnels.ensureStarted()
    await tunnels.ensureStarted() // idempotent

    const client = net.connect({ host: '127.0.0.1', port: localPort })
    await once(client, 'connect')
    client.write('ping')
    const [reply] = (await once(client, 'data')) as [Buffer]
    assert.equal(reply.toString(), 'echo:ping')
    client.destroy()

    await tunnels.close()
    await assert.rejects(async () => {
      const refused = net.connect({ host: '127.0.0.1', port: localPort })
      await once(refused, 'connect')
    })
  } finally {
    await tunnels.close()
    await new Promise<void>((resolve) => upstream.close(() => resolve()))
  }
})

test('tolerates EADDRINUSE from an equivalent already-running forwarder', async () => {
  const occupant = net.createServer()
  const localPort = await listenEphemeral(occupant)
  const tunnels = new SandboxTunnels({}, [{ localPort, remoteHost: '127.0.0.1', remotePort: 9 }])
  try {
    await tunnels.ensureStarted() // must resolve, not reject
  } finally {
    await tunnels.close()
    await new Promise<void>((resolve) => occupant.close(() => resolve()))
  }
})

test('close destroys live piped sockets instead of waiting on them', async () => {
  const upstream = net.createServer((socket) => {
    // Never respond — the connection just stays open. The tunnel's close()
    // destroys its side, which surfaces here as ECONNRESET; swallow it.
    socket.on('error', () => undefined)
  })
  const upstreamPort = await listenEphemeral(upstream)
  const localPort = await freePort()
  const tunnels = new SandboxTunnels({}, [
    { localPort, remoteHost: '127.0.0.1', remotePort: upstreamPort },
  ])
  try {
    await tunnels.ensureStarted()
    const client = net.connect({ host: '127.0.0.1', port: localPort })
    // The tunnel destroys this socket on close(); the resulting ECONNRESET
    // is expected, so wait for 'close' without events.once's error rejection.
    client.on('error', () => undefined)
    await once(client, 'connect')
    const closed = new Promise<void>((resolve) => client.on('close', () => resolve()))
    // With a live connection open, close() must still finish promptly.
    await tunnels.close()
    await closed
  } finally {
    await tunnels.close()
    await new Promise<void>((resolve) => upstream.close(() => resolve()))
  }
})
