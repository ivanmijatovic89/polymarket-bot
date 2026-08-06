import { timingSafeEqual } from 'node:crypto'
import net from 'node:net'
import Fastify, { type FastifyInstance } from 'fastify'
import { RuntimeConflictError, RuntimeNotFoundError, RuntimeValidationError } from './errors.js'
import type { GlobalRuntime } from './runtime.js'

interface RunParams {
  id: string
}

export interface RuntimeApiOptions {
  isReady?: () => boolean
  /** When set, every route except /health requires `Authorization: Bearer <token>`. */
  token?: string | undefined
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

function isLoopbackHost(host: string): boolean {
  if (LOOPBACK_HOSTS.has(host)) return true
  // Any 127.0.0.0/8 address is loopback too.
  return net.isIPv4(host) && host.startsWith('127.')
}

/**
 * Daemons on the tailnet share the network with sandboxed mission sessions —
 * an unauthenticated non-loopback bind would let any tailnet process control
 * runs. Refuse it up front (issue #213).
 */
export function assertSafeBind(host: string, token: string | undefined): void {
  if (isLoopbackHost(host) || token) return
  throw new Error(
    `refusing to bind Global Runtime API to non-loopback host ${host} without GLOBAL_RUNTIME_TOKEN — ` +
      'set the token or bind to 127.0.0.1',
  )
}

function isAuthorized(
  request: { headers: { authorization?: string | undefined } },
  token: string,
): boolean {
  const header = request.headers.authorization
  if (!header?.startsWith('Bearer ')) return false
  const presented = Buffer.from(header.slice('Bearer '.length))
  const expected = Buffer.from(token)
  return presented.length === expected.length && timingSafeEqual(presented, expected)
}

export function buildRuntimeApi(
  runtime: GlobalRuntime,
  options: RuntimeApiOptions = {},
): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 32 * 1024 })
  const isReady = options.isReady ?? (() => true)
  const token = options.token

  app.addHook('onRequest', async (request, reply) => {
    if (request.url === '/health') return
    if (token && !isAuthorized(request, token)) {
      return reply.code(401).send({ error: 'missing or invalid bearer token' })
    }
    if (isReady()) return
    return reply.code(503).header('retry-after', '1').send({ error: 'runtime is initializing' })
  })
  app.get('/health', async (_request, reply) =>
    reply.code(isReady() ? 200 : 503).send({ ok: isReady() }),
  )
  app.get('/runs', async () => ({ runs: await runtime.listRuns() }))
  app.post('/runs', async (request, reply) => {
    const run = await runtime.createRun(request.body)
    return reply.code(201).send({ run })
  })
  app.get<{ Params: RunParams }>('/runs/:id', async (request) =>
    runtime.getRunDetail(parseId(request.params.id)),
  )
  app.get<{ Params: RunParams }>('/runs/:id/files', async (request) =>
    runtime.getFiles(parseId(request.params.id)),
  )
  app.post<{ Params: RunParams }>('/runs/:id/extend', async (request) => ({
    run: await runtime.extendMaxSessions(parseId(request.params.id), request.body),
  }))
  app.post<{ Params: RunParams }>('/runs/:id/inbox', async (request, reply) => {
    const entry = await runtime.appendInbox(parseId(request.params.id), request.body)
    return reply.code(201).send(entry)
  })

  for (const action of ['start', 'pause', 'resume', 'stop'] as const) {
    app.post<{ Params: RunParams }>(`/runs/:id/${action}`, async (request) => ({
      run: await runtime[action](parseId(request.params.id)),
    }))
  }

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof RuntimeNotFoundError) {
      return reply.code(404).send({ error: error.message })
    }
    if (error instanceof RuntimeConflictError) {
      return reply.code(409).send({ error: error.message })
    }
    if (error instanceof RuntimeValidationError) {
      return reply.code(400).send({ error: error.message })
    }
    if (isHttpClientError(error)) {
      return reply.code(error.statusCode).send({ error: error.message })
    }
    console.error('[global-runtime] request failed:', error)
    return reply.code(500).send({ error: 'internal runtime error' })
  })

  return app
}

function parseId(value: string): number {
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id < 1) throw new RuntimeValidationError('invalid run id')
  return id
}

function isHttpClientError(error: unknown): error is Error & { statusCode: number } {
  if (!(error instanceof Error) || !('statusCode' in error)) return false
  const statusCode = error.statusCode
  return typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500
}
