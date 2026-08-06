import net from 'node:net'

/**
 * In-daemon localhost TCP forwarders for SANDBOXED sessions (issue #213).
 *
 * srt-sandboxed processes cannot open raw TCP (macOS Seatbelt routes
 * everything through srt's HTTP/SOCKS proxies, which mysql2/ioredis do not
 * speak) — but connects to 127.0.0.1 ARE allowed. The daemon therefore hosts
 * plain TCP forwarders on the same well-known ports the manual
 * polymarket-protocols `run.sh` uses:
 *
 *   127.0.0.1:13306 → DATABASE_HOST:DATABASE_PORT   (MySQL)
 *   127.0.0.1:16379 → REDIS_URL host:port           (Redis)
 *
 * `wrapWithSandbox` (providers.ts) points the session's env at these ports.
 * EADDRINUSE is tolerated: a concurrent run.sh (or a second daemon start
 * racing shutdown) already forwards the identical targets.
 */

export const SANDBOX_MYSQL_PORT = 13306
export const SANDBOX_REDIS_PORT = 16379

export interface SandboxTunnelController {
  /** Idempotent; resolves when both forwarders are listening (or already were). */
  ensureStarted(): Promise<void>
  close(): Promise<void>
}

export type TunnelSpec = {
  localPort: number
  remoteHost: string
  remotePort: number
}

/**
 * Forwarder targets from the daemon's own environment (the daemon runs
 * unsandboxed in the repo and has the real `.env`). Returns null when the
 * env lacks a target — starting a sandboxed run then fails loudly.
 */
export function deriveTunnelSpecs(env: NodeJS.ProcessEnv): TunnelSpec[] | null {
  const dbHost = env.DATABASE_HOST?.trim()
  const redisUrlRaw = env.REDIS_URL?.trim()
  if (!dbHost || !redisUrlRaw) return null
  let redisHost: string
  let redisPort: number
  try {
    const parsed = new URL(redisUrlRaw)
    redisHost = parsed.hostname
    redisPort = parsed.port ? Number(parsed.port) : 6379
  } catch {
    return null
  }
  return [
    {
      localPort: SANDBOX_MYSQL_PORT,
      remoteHost: dbHost,
      remotePort: Number(env.DATABASE_PORT?.trim() || 3306),
    },
    { localPort: SANDBOX_REDIS_PORT, remoteHost: redisHost, remotePort: redisPort },
  ]
}

export class SandboxTunnels implements SandboxTunnelController {
  private readonly servers: net.Server[] = []
  private readonly sockets = new Set<net.Socket>()
  private startPromise: Promise<void> | null = null

  constructor(
    private readonly env: NodeJS.ProcessEnv = process.env,
    /** Test hook: explicit specs instead of env-derived fixed ports. */
    private readonly specsOverride?: TunnelSpec[],
  ) {}

  ensureStarted(): Promise<void> {
    if (!this.startPromise) {
      this.startPromise = this.start().catch((error: unknown) => {
        // Failed start is retryable on the next sandboxed session.
        this.startPromise = null
        throw error
      })
    }
    return this.startPromise
  }

  private async start(): Promise<void> {
    const specs = this.specsOverride ?? deriveTunnelSpecs(this.env)
    if (!specs) {
      throw new Error(
        'sandboxed runs need DATABASE_HOST and a parseable REDIS_URL in the daemon environment (tunnel targets)',
      )
    }
    await Promise.all(specs.map((spec) => this.listen(spec)))
  }

  private listen(spec: TunnelSpec): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = net.createServer((client) => {
        const upstream = net.connect({ host: spec.remoteHost, port: spec.remotePort })
        this.sockets.add(client)
        this.sockets.add(upstream)
        client.pipe(upstream).pipe(client)
        const drop = () => {
          this.sockets.delete(client)
          this.sockets.delete(upstream)
          client.destroy()
          upstream.destroy()
        }
        client.on('error', drop)
        upstream.on('error', drop)
        client.on('close', drop)
        upstream.on('close', drop)
      })
      server.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE') {
          // Another forwarder (run.sh, prior daemon) already serves this
          // port with the identical target — treat as started.
          resolve()
          return
        }
        reject(error)
      })
      server.listen(spec.localPort, '127.0.0.1', () => {
        this.servers.push(server)
        resolve()
      })
    })
  }

  async close(): Promise<void> {
    const servers = this.servers.splice(0)
    this.startPromise = null
    // Live piped sockets would otherwise hold server.close() open forever.
    for (const socket of this.sockets) socket.destroy()
    this.sockets.clear()
    await Promise.all(
      servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
    )
  }
}
