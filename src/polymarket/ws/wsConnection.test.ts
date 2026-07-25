import test from 'node:test'
import assert from 'node:assert/strict'
import { WebSocketServer, type WebSocket as ServerSocket } from 'ws'
import { createWsConnection, deadCheckIntervalMs } from './wsConnection.js'

/**
 * Dead-check contract, verified against a real in-process WebSocket server:
 * the silent-stall failure mode (socket alive, zero frames, no close event)
 * must terminate within the deadAfterMs budget — independent of ping
 * settings, and immune to PONG-only "liveness".
 */

type Server = {
  wss: WebSocketServer
  url: string
  sockets: ServerSocket[]
  close: () => Promise<void>
}

function startServer(onConnection?: (ws: ServerSocket) => void): Promise<Server> {
  return new Promise((resolve) => {
    const sockets: ServerSocket[] = []
    const wss = new WebSocketServer({ port: 0 }, () => {
      const addr = wss.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      resolve({
        wss,
        url: `ws://127.0.0.1:${port}`,
        sockets,
        close: () =>
          new Promise<void>((r) => {
            for (const s of sockets) s.terminate()
            wss.close(() => r())
          }),
      })
    })
    wss.on('connection', (ws) => {
      sockets.push(ws)
      onConnection?.(ws)
    })
  })
}

function waitFor(cond: () => boolean, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const t0 = Date.now()
    const t = setInterval(() => {
      if (cond()) {
        clearInterval(t)
        resolve(true)
      } else if (Date.now() - t0 > timeoutMs) {
        clearInterval(t)
        resolve(false)
      }
    }, 10)
  })
}

test('deadCheckIntervalMs: fine for short thresholds, capped at 5s', () => {
  assert.equal(deadCheckIntervalMs(200), 50)
  assert.equal(deadCheckIntervalMs(1_000), 250)
  assert.equal(deadCheckIntervalMs(30_000), 5_000)
  assert.equal(deadCheckIntervalMs(60_000), 5_000)
})

test('silent socket is terminated within the deadAfterMs budget even with pingIntervalMs=0', async () => {
  const server = await startServer() // accepts, then total silence
  let closed = false
  let deadIdleMs: number | null = null
  const t0 = Date.now()
  createWsConnection({
    url: server.url,
    heartbeat: {
      pingIntervalMs: 0, // the exact config that made deadAfterMs inert before
      deadAfterMs: 300,
      onDead: ({ idleMs }) => {
        deadIdleMs = idleMs
      },
    },
    onClose: () => {
      closed = true
    },
  })
  assert.ok(await waitFor(() => closed, 3_000), 'dead-check must fire and close')
  const elapsed = Date.now() - t0
  // terminate() closes immediately — nowhere near ws's ~30s graceful-close timeout
  assert.ok(elapsed < 2_000, `closed in ${elapsed}ms`)
  assert.ok(deadIdleMs !== null && deadIdleMs! > 300, `onDead reported idleMs=${deadIdleMs}`)
  await server.close()
})

test('PONG-only traffic does NOT keep the connection alive when isActivity excludes it', async () => {
  // Server answers every text PING with text PONG — the stalled-subscription
  // incident shape (transport chatty, data silent).
  const server = await startServer((ws) => {
    ws.on('message', (raw) => {
      if (raw.toString() === 'PING') ws.send('PONG')
    })
  })
  let closed = false
  let pings: NodeJS.Timeout | undefined
  const conn = createWsConnection({
    url: server.url,
    heartbeat: {
      pingIntervalMs: 0,
      deadAfterMs: 300,
      isActivity: (raw) => raw !== 'PONG',
    },
    onOpen: () => {
      pings = setInterval(() => conn.send('PING'), 50)
    },
    onClose: () => {
      closed = true
    },
  })
  const fired = await waitFor(() => closed, 3_000)
  if (pings) clearInterval(pings)
  assert.ok(fired, 'dead-check must fire despite continuous PONGs')
  await server.close()
})

test('data traffic keeps the connection alive', async () => {
  const server = await startServer((ws) => {
    const t = setInterval(() => ws.send('{"topic":"data"}'), 60)
    ws.on('close', () => clearInterval(t))
  })
  let closed = false
  createWsConnection({
    url: server.url,
    heartbeat: { pingIntervalMs: 0, deadAfterMs: 300 },
    onClose: () => {
      closed = true
    },
  })
  // 4× the threshold: with data every 60ms the dead-check must never fire.
  const fired = await waitFor(() => closed, 1_200)
  assert.equal(fired, false, 'must stay alive under data traffic')
  await server.close()
})

test('no deadAfterMs → quiet streams are allowed (user-WS semantics)', async () => {
  const server = await startServer() // silence
  let closed = false
  createWsConnection({
    url: server.url,
    heartbeat: { pingIntervalMs: 0 },
    onClose: () => {
      closed = true
    },
  })
  const fired = await waitFor(() => closed, 1_000)
  assert.equal(fired, false, 'no dead-check without deadAfterMs')
  await server.close()
})

test('local close() stops the dead-check (no terminate after deliberate shutdown)', async () => {
  const server = await startServer()
  let deadFired = false
  let closes = 0
  const conn = createWsConnection({
    url: server.url,
    heartbeat: { pingIntervalMs: 0, deadAfterMs: 200, onDead: () => (deadFired = true) },
    onOpen: () => conn.close(),
    onClose: () => {
      closes += 1
    },
  })
  await waitFor(() => closes > 0, 2_000)
  await new Promise((r) => setTimeout(r, 500))
  assert.equal(deadFired, false, 'dead-check must not fire after close()')
  assert.equal(closes, 1)
  await server.close()
})
