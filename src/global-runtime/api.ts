import Fastify, { type FastifyInstance } from 'fastify'
import { RuntimeConflictError, RuntimeNotFoundError, RuntimeValidationError } from './errors.js'
import type { GlobalRuntime } from './runtime.js'

interface RunParams {
  id: string
}

export interface RuntimeApiOptions {
  isReady?: () => boolean
}

export function buildRuntimeApi(
  runtime: GlobalRuntime,
  options: RuntimeApiOptions = {},
): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 32 * 1024 })
  const isReady = options.isReady ?? (() => true)

  app.addHook('onRequest', async (request, reply) => {
    if (request.url === '/health' || isReady()) return
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
