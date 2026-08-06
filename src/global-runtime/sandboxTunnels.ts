import net from 'node:net'

/**
 * In-daemon localhost TCP forwarders for SANDBOXED sessions (issue #213).
 *
 * srt-sandboxed processes cannot open raw TCP (macOS Seatbelt routes
 * everything through srt's HTTP/SOCKS proxies, which mysql2/ioredis do not
 * speak) — but connects to 127.0.0.1 ARE allowed. The daemon therefore hosts
 * plain TCP forwarders on loopback and rewrites the session's
 * DATABASE_HOST/DATABASE_PORT/REDIS_URL to point at them (see
 * `wrapWithSandbox` in providers.ts).
 *
 * Ports are EPHEMERAL and daemon-owned: the forwarders bind port 0 and the
 * assigned ports are handed to each session. Fixed well-known ports would be
 * squattable — any local process (including a sandboxed session, which may
 * bind loopback) could claim the port first and become a transparent
 * man-in-the-middle for every session's MySQL/Redis traffic, or simply point
 * somewhere else. Owning the listener also means a forwarder can never
 * silently disappear while the daemon believes it is up.
 */

export type SandboxTunnelPorts = {
  mysqlPort: number
  redisPort: number
}

export interface SandboxTunnelController {
  /** Idempotent; resolves with the live loopback ports once both forwarders listen. */
  ensureStarted(): Promise<SandboxTunnelPorts>
  close(): Promise<void>
}

export type TunnelTarget = {
  host: string
  port: number
}

export type TunnelTargets = {
  mysql: TunnelTarget
  redis: TunnelTarget
}

/**
 * Forwarder targets from the daemon's own environment (the daemon runs
 * unsandboxed in the repo and has the real `.env`). Returns null when the
 * env lacks a target — starting a sandboxed run then fails loudly.
 */
export function deriveTunnelTargets(env: NodeJS.ProcessEnv): TunnelTargets | null {
  const dbHost = env.DATABASE_HOST?.trim()
  const redisUrlRaw = env.REDIS_URL?.trim()
  if (!dbHost || !redisUrlRaw) return null
  let redis: TunnelTarget
  try {
    const parsed = new URL(redisUrlRaw)
    if (!parsed.hostname) return null
    redis = { host: parsed.hostname, port: parsed.port ? Number(parsed.port) : 6379 }
  } catch {
    return null
  }
  return {
    mysql: { host: dbHost, port: Number(env.DATABASE_PORT?.trim() || 3306) },
    redis,
  }
}

export class SandboxTunnels implements SandboxTunnelController {
  private readonly servers: net.Server[] = []
  private readonly sockets = new Set<net.Socket>()
  private startPromise: Promise<SandboxTunnelPorts> | null = null
  private closing = false

  constructor(
    private readonly env: NodeJS.ProcessEnv = process.env,
    /** Test hook: explicit targets instead of env-derived ones. */
    private readonly targetsOverride?: TunnelTargets,
  ) {}

  ensureStarted(): Promise<SandboxTunnelPorts> {
    // close() re-arms this controller (a later session starts fresh
    // forwarders) rather than latching it shut.
    this.closing = false
    if (!this.startPromise) {
      this.startPromise = this.start().catch((error: unknown) => {
        // Failed start is retryable on the next sandboxed session.
        this.startPromise = null
        throw error
      })
    }
    return this.startPromise
  }

  private async start(): Promise<SandboxTunnelPorts> {
    const targets = this.targetsOverride ?? deriveTunnelTargets(this.env)
    if (!targets) {
      throw new Error(
        'sandboxed runs need DATABASE_HOST and a parseable REDIS_URL in the daemon environment (tunnel targets)',
      )
    }
    const [mysqlPort, redisPort] = await Promise.all([
      this.listen(targets.mysql),
      this.listen(targets.redis),
    ])
    return { mysqlPort, redisPort }
  }

  /** Binds an ephemeral loopback port forwarding to `target`; resolves with the port. */
  private listen(target: TunnelTarget): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = net.createServer((client) => {
        const upstream = net.connect({ host: target.host, port: target.port })
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
      let settled = false
      server.on('error', (error) => {
        // Pre-listen: the bind failed. Post-listen: the forwarder is dead, so
        // drop it rather than keep handing out a port nothing serves.
        if (!settled) {
          settled = true
          reject(error)
          return
        }
        this.startPromise = null
        server.close()
      })
      // Port 0 + loopback: the OS assigns a free port that only this daemon
      // holds, so there is no squatter to trust and no fixed port to hijack.
      server.listen(0, '127.0.0.1', () => {
        settled = true
        const port = (server.address() as net.AddressInfo).port
        if (this.closing) {
          // A close() that raced this bind already drained `servers`; this
          // one would never be closed and would hold the event loop open.
          server.close()
          resolve(port)
          return
        }
        this.servers.push(server)
        resolve(port)
      })
    })
  }

  async close(): Promise<void> {
    this.closing = true
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
