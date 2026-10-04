import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { R2BlobStore } from './blobStore.js'
import { digestStream } from './files.js'

for (const operation of ['get-headers', 'get-body', 'put'] as const) {
  test(
    `R2 lifetime cancellation promptly aborts stalled ${operation} and rejects future requests`,
    { timeout: 10_000 },
    async (t) => {
      const directory = await mkdtemp(path.join(os.tmpdir(), 'recorder-r2-abort-'))
      t.after(() => rm(directory, { recursive: true, force: true }))
      const file = path.join(directory, 'upload.bin')
      await writeFile(file, 'local cancellation fixture')
      const server = createServer((request, response) => {
        request.resume()
        if (operation === 'get-body') {
          response.writeHead(200, {
            'content-length': '1000000',
            'content-type': 'application/octet-stream',
          })
          response.write('partial body')
        }
        // Deliberately leave the HTTP response unfinished until the client cancels.
      })
      server.listen(0, '127.0.0.1')
      await once(server, 'listening')
      t.after(async () => {
        server.closeAllConnections()
        await new Promise<void>((resolve) => server.close(() => resolve()))
      })
      const store = new R2BlobStore({
        endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        bucket: 'recorder-test',
        accessKeyId: 'local-test-key',
        secretAccessKey: 'local-test-secret',
        timeoutMs: 60_000,
      })
      t.after(() => store.close())
      const requested = once(server, 'request')
      const pending =
        operation === 'put'
          ? store.putFile('object', file, 'application/octet-stream')
          : store.get('object').then(async (body) => {
              assert.ok(body)
              return digestStream(body)
            })
      const rejected = assert.rejects(pending)
      await requested
      if (operation === 'get-body') await new Promise((resolve) => setTimeout(resolve, 20))
      const start = Date.now()
      store.close()
      await rejected
      assert.ok(
        Date.now() - start < 1000,
        'Shutdown must not wait for the 60-second request timeout',
      )
      await assert.rejects(store.get('next'), /abort/i)
      await assert.rejects(store.putFile('next', file, 'application/octet-stream'), /abort/i)
    },
  )
}
