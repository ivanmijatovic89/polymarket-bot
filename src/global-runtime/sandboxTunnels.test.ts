import assert from 'node:assert/strict'
import net from 'node:net'
import { once } from 'node:events'
import { test } from 'node:test'
import { deriveTunnelTargets, SandboxTunnels } from './sandboxTunnels.js'

function listenEphemeral(server: net.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      resolve((server.address() as net.AddressInfo).port)
    })
  })
}

/** Echo server standing in for MySQL/Redis; swallows teardown resets. */
function echoServer(): net.Server {
  return net.createServer((socket) => {
    socket.on('error', () => undefined)
    socket.on('data', (chunk) => socket.write(`echo:${chunk.toString()}`))
  })
}

test('deriveTunnelTargets reads DATABASE_* and REDIS_URL from the daemon env', () => {
  const targets = deriveTunnelTargets({
    DATABASE_HOST: '100.107.149.100',
    DATABASE_PORT: '3307',
    REDIS_URL: 'redis://:secret@100.107.149.100:6380/0',
  })
  assert.deepEqual(targets, {
    mysql: { host: '100.107.149.100', port: 3307 },
    redis: { host: '100.107.149.100', port: 6380 },
  })
})

test('deriveTunnelTargets defaults ports and returns null on missing or unparseable env', () => {
  const defaulted = deriveTunnelTargets({
    DATABASE_HOST: 'db.internal',
    REDIS_URL: 'redis://db.internal',
  })
  assert.equal(defaulted?.mysql.port, 3306)
  assert.equal(defaulted?.redis.port, 6379)
  assert.equal(deriveTunnelTargets({ REDIS_URL: 'redis://x' }), null)
  assert.equal(deriveTunnelTargets({ DATABASE_HOST: 'x' }), null)
  assert.equal(deriveTunnelTargets({ DATABASE_HOST: 'x', REDIS_URL: 'not a url' }), null)
})

test('ensureStarted fails loudly when the daemon env lacks tunnel targets', async () => {
  const tunnels = new SandboxTunnels({})
  await assert.rejects(() => tunnels.ensureStarted(), /DATABASE_HOST and a parseable REDIS_URL/u)
  // A failed start is retryable (startPromise reset), not latched.
  await assert.rejects(() => tunnels.ensureStarted(), /DATABASE_HOST and a parseable REDIS_URL/u)
})

test('forwards TCP bytes on daemon-owned ephemeral ports and stops after close', async () => {
  const mysql = echoServer()
  const redis = echoServer()
  const mysqlUpstream = await listenEphemeral(mysql)
  const redisUpstream = await listenEphemeral(redis)
  const tunnels = new SandboxTunnels(
    {},
    {
      mysql: { host: '127.0.0.1', port: mysqlUpstream },
      redis: { host: '127.0.0.1', port: redisUpstream },
    },
  )
  try {
    const ports = await tunnels.ensureStarted()
    // Ephemeral, daemon-owned: never the old fixed 13306/16379, and stable
    // across calls (idempotent).
    assert.ok(ports.mysqlPort > 0 && ports.redisPort > 0)
    assert.notEqual(ports.mysqlPort, 13306)
    assert.notEqual(ports.redisPort, 16379)
    assert.notEqual(ports.mysqlPort, ports.redisPort)
    assert.deepEqual(await tunnels.ensureStarted(), ports)

    for (const [port, label] of [
      [ports.mysqlPort, 'mysql'],
      [ports.redisPort, 'redis'],
    ] as const) {
      const client = net.connect({ host: '127.0.0.1', port })
      client.on('error', () => undefined)
      await once(client, 'connect')
      client.write(label)
      const [reply] = (await once(client, 'data')) as [Buffer]
      assert.equal(reply.toString(), `echo:${label}`)
      client.destroy()
    }

    await tunnels.close()
    await assert.rejects(async () => {
      const refused = net.connect({ host: '127.0.0.1', port: ports.mysqlPort })
      await once(refused, 'connect')
    })
  } finally {
    await tunnels.close()
    await new Promise<void>((resolve) => mysql.close(() => resolve()))
    await new Promise<void>((resolve) => redis.close(() => resolve()))
  }
})

test('a second daemon instance gets its own ports instead of trusting a squatter', async () => {
  const upstream = echoServer()
  const upstreamPort = await listenEphemeral(upstream)
  const targets = {
    mysql: { host: '127.0.0.1', port: upstreamPort },
    redis: { host: '127.0.0.1', port: upstreamPort },
  }
  const first = new SandboxTunnels({}, targets)
  const second = new SandboxTunnels({}, targets)
  try {
    const firstPorts = await first.ensureStarted()
    const secondPorts = await second.ensureStarted()
    // No fixed port to collide on, so no EADDRINUSE and no chance of
    // adopting a foreign forwarder whose target may differ.
    assert.notEqual(firstPorts.mysqlPort, secondPorts.mysqlPort)
    assert.notEqual(firstPorts.redisPort, secondPorts.redisPort)
  } finally {
    await first.close()
    await second.close()
    await new Promise<void>((resolve) => upstream.close(() => resolve()))
  }
})

test('close destroys live piped sockets instead of waiting on them', async () => {
  const upstream = net.createServer((socket) => {
    // Never respond — the connection just stays open.
    socket.on('error', () => undefined)
  })
  const upstreamPort = await listenEphemeral(upstream)
  const tunnels = new SandboxTunnels(
    {},
    {
      mysql: { host: '127.0.0.1', port: upstreamPort },
      redis: { host: '127.0.0.1', port: upstreamPort },
    },
  )
  try {
    const ports = await tunnels.ensureStarted()
    const client = net.connect({ host: '127.0.0.1', port: ports.mysqlPort })
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

test('close re-arms ensureStarted with fresh ports', async () => {
  const upstream = echoServer()
  const upstreamPort = await listenEphemeral(upstream)
  const tunnels = new SandboxTunnels(
    {},
    {
      mysql: { host: '127.0.0.1', port: upstreamPort },
      redis: { host: '127.0.0.1', port: upstreamPort },
    },
  )
  try {
    const before = await tunnels.ensureStarted()
    await tunnels.close()
    const after = await tunnels.ensureStarted()
    assert.ok(after.mysqlPort > 0)
    const client = net.connect({ host: '127.0.0.1', port: after.mysqlPort })
    client.on('error', () => undefined)
    await once(client, 'connect')
    client.destroy()
    void before
  } finally {
    await tunnels.close()
    await new Promise<void>((resolve) => upstream.close(() => resolve()))
  }
})
