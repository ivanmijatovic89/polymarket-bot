import assert from 'node:assert/strict'
import test from 'node:test'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import {
  closeSync,
  existsSync,
  ftruncateSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

for (const action of ['disconnect', 'SIGTERM', 'SIGINT', 'deadline', 'storage'] as const) {
  test(
    `simulator child bounds a stalled read on ${action} and cleans only session input`,
    { timeout: 15_000 },
    async (t) => {
      const directory = mkdtempSync(path.join(tmpdir(), 'simulator-child-'))
      t.after(() => rmSync(directory, { recursive: true, force: true }))
      const input = path.join(directory, 'session', 'input')
      mkdirSync(input, { recursive: true })
      const original = path.join(directory, 'original.parquet')
      writeFileSync(original, 'preserve original dataset')
      symlinkSync(original, path.join(input, 'original-link'))
      writeFileSync(path.join(input, 'download.partial'), 'interrupted download')
      if (action === 'storage') {
        const file = openSync(path.join(input, 'large.partial'), 'w')
        ftruncateSync(file, 2 * 1024 ** 3 + 1) // Sparse fixture; does not allocate 2 GiB.
        closeSync(file)
      }
      // A loopback fixture accepts the DB connection but never sends a handshake.
      const sockets = new Set<import('node:net').Socket>()
      const server = createServer((socket) => {
        sockets.add(socket)
        socket.once('close', () => sockets.delete(socket))
      })
      server.listen(0, '127.0.0.1')
      await once(server, 'listening')
      t.after(async () => {
        for (const socket of sockets) socket.destroy()
        await new Promise<void>((resolve) => server.close(() => resolve()))
      })
      const address = server.address()
      assert.ok(address && typeof address !== 'string')
      const connected = once(server, 'connection')
      const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
      const shortGuards =
        'data:text/javascript,' +
        encodeURIComponent(
          action === 'deadline'
            ? 'const original = globalThis.setTimeout; globalThis.setTimeout = (callback, delay, ...args) => original(callback, delay === 300000 ? 2500 : delay, ...args)'
            : 'const original = globalThis.setInterval; globalThis.setInterval = (callback, delay, ...args) => original(callback, delay === 5000 ? 2500 : delay, ...args)',
        )
      const child = spawn(
        process.execPath,
        [
          ...(action === 'deadline' || action === 'storage' ? ['--import', shortGuards] : []),
          '--import',
          'tsx',
          path.join(root, 'src/cli/backtest-simulator.ts'),
          '1',
          'btc-updown-5m-1791284400',
          path.join(directory, 'session'),
        ],
        {
          cwd: root,
          stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
          env: {
            ...process.env,
            BOT_ENV: '',
            DRY_RUN: 'true',
            DATABASE_HOST: '127.0.0.1',
            DATABASE_PORT: String(address.port),
            DATABASE_USERNAME: 'fixture',
            DATABASE_PASSWORD: '',
            DATABASE_NAME: 'fixture',
          },
        },
      )
      const exited = once(child, 'exit')
      const messages: { type?: string; message?: string }[] = []
      child.on('message', (message) => messages.push(message as (typeof messages)[number]))
      t.after(async () => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
        await exited
      })
      await Promise.race([
        connected,
        exited.then(() => {
          throw new Error('Child exited before fixture read')
        }),
      ])
      if (action === 'disconnect') child.disconnect()
      else if (action === 'SIGTERM' || action === 'SIGINT') child.kill(action)
      const [code, signal] = await exited
      assert.equal(code, action === 'SIGTERM' ? 143 : action === 'SIGINT' ? 130 : 1)
      assert.equal(signal, null)
      assert.equal(existsSync(input), false)
      assert.equal(readFileSync(original, 'utf8'), 'preserve original dataset')
      if (action === 'storage') assert.ok(messages.some((m) => m.message?.includes('2 GiB')))
      if (action === 'deadline') assert.ok(messages.some((m) => m.message?.includes('five-minute')))
    },
  )
}
