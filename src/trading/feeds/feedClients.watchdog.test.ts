import test from 'node:test'
import assert from 'node:assert/strict'
import { WebSocketServer, type WebSocket as ServerSocket } from 'ws'
import { createRtdsCryptoPricesClient } from './rtdsCryptoPricesClient.js'
import { createBinanceWsSpotPriceClient } from './binanceWsSpotPriceClient.js'

/**
 * End-to-end watchdog behavior of the two feed clients against a real
 * in-process server: the stalled-subscription incident shape must reconnect;
 * live data must not.
 */

function startServer(onConnection: (ws: ServerSocket) => void): Promise<{
  url: string
  connections: () => number
  close: () => Promise<void>
}> {
  return new Promise((resolve) => {
    let n = 0
    const sockets: ServerSocket[] = []
    const wss = new WebSocketServer({ port: 0 }, () => {
      const addr = wss.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      resolve({
        url: `ws://127.0.0.1:${port}`,
        connections: () => n,
        close: () =>
          new Promise<void>((r) => {
            for (const s of sockets) s.terminate()
            wss.close(() => r())
          }),
      })
    })
    wss.on('connection', (ws) => {
      n += 1
      sockets.push(ws)
      onConnection(ws)
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

test('rtds client: PONG+ack-only stall trips the watchdog and reconnects', async () => {
  // Transport chatty, data silent — the frozen-28-min incident shape.
  const server = await startServer((ws) => {
    ws.on('message', (raw) => {
      if (raw.toString() === 'PING') ws.send('PONG')
    })
    const acks = setInterval(() => ws.send('{"topic":"subscriptions","type":"ack"}'), 50)
    ws.on('close', () => clearInterval(acks))
  })
  const statuses: string[] = []
  const client = createRtdsCryptoPricesClient({
    url: server.url,
    binanceSymbols: [],
    chainlinkSymbols: ['btc/usd'],
    idleReconnectMs: 300,
    onBinanceUpdate: () => {},
    onChainlinkUpdate: () => {},
    onStatus: (s) => statuses.push(`${s.kind}${s.info ? `:${s.info}` : ''}`),
  })
  client.start()
  const reconnected = await waitFor(() => server.connections() >= 2, 5_000)
  client.stop()
  assert.ok(reconnected, `must reconnect after data stall (statuses: ${statuses.join(' | ')})`)
  assert.ok(
    statuses.some((s) => s.includes('idle watchdog')),
    `idle-watchdog cause must be visible in statuses: ${statuses.join(' | ')}`,
  )
  await server.close()
})

test('rtds client: continuous chainlink data does NOT trip the watchdog', async () => {
  const server = await startServer((ws) => {
    const data = setInterval(
      () =>
        ws.send(
          JSON.stringify({
            topic: 'crypto_prices_chainlink',
            type: 'update',
            timestamp: Date.now(),
            payload: { symbol: 'btc/usd', timestamp: Date.now(), value: 100 },
          }),
        ),
      60,
    )
    ws.on('close', () => clearInterval(data))
  })
  let updates = 0
  const client = createRtdsCryptoPricesClient({
    url: server.url,
    binanceSymbols: [],
    chainlinkSymbols: ['btc/usd'],
    idleReconnectMs: 300,
    onBinanceUpdate: () => {},
    onChainlinkUpdate: () => {
      updates += 1
    },
  })
  client.start()
  await new Promise((r) => setTimeout(r, 1_200)) // 4× the threshold
  const conns = server.connections()
  client.stop()
  assert.equal(conns, 1, 'must not reconnect while data flows')
  assert.ok(updates > 10, `updates flowed (${updates})`)
  await server.close()
})

test('binance client: silent socket trips the watchdog and reconnects', async () => {
  const server = await startServer(() => {}) // accept, then silence
  const statuses: string[] = []
  const client = createBinanceWsSpotPriceClient({
    baseUrl: server.url,
    symbol: 'btcusdt',
    idleReconnectMs: 300,
    onPrice: () => {},
    onStatus: (s) => statuses.push(`${s.kind}${s.info ? `:${s.info}` : ''}`),
  })
  client.start()
  const reconnected = await waitFor(() => server.connections() >= 2, 5_000)
  client.stop()
  assert.ok(reconnected, `must reconnect after silence (statuses: ${statuses.join(' | ')})`)
  assert.ok(
    statuses.some((s) => s.includes('idle watchdog')),
    `idle-watchdog cause visible: ${statuses.join(' | ')}`,
  )
  await server.close()
})

test('binance client: idleReconnectMs=0 disables the watchdog (recorder-style escape)', async () => {
  const server = await startServer(() => {})
  const client = createBinanceWsSpotPriceClient({
    baseUrl: server.url,
    symbol: 'btcusdt',
    idleReconnectMs: 0,
    onPrice: () => {},
  })
  client.start()
  await new Promise((r) => setTimeout(r, 800))
  const conns = server.connections()
  client.stop()
  assert.equal(conns, 1, 'no watchdog when disabled')
  await server.close()
})
