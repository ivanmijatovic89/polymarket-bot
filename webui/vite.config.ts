import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { Plugin } from 'vite'

const BOT_UI_HOST = process.env.VITE_BOT_UI_HOST ?? '127.0.0.1'
const BOT_UI_PORT_RAW = process.env.VITE_BOT_UI_PORT ?? '3001'
const BOT_UI_PORT = Number.parseInt(BOT_UI_PORT_RAW, 10)
const BOT_UI_TARGET = `http://${BOT_UI_HOST}:${Number.isFinite(BOT_UI_PORT) ? BOT_UI_PORT : 3001}`

// Vite plugin to suppress WebSocket proxy errors at the server level
const suppressWsErrorsPlugin = (): Plugin => {
  return {
    name: 'suppress-ws-errors',
    configureServer(server) {
      // Intercept Vite's logger to filter WebSocket proxy errors
      const originalError = server.config.logger?.error
      if (originalError) {
        server.config.logger.error = (msg, options) => {
          // Check if this is a WebSocket proxy error we want to suppress
          if (typeof msg === 'string' && msg.includes('ws proxy')) {
            const error = options?.error as NodeJS.ErrnoException | undefined
            if (error?.code === 'ECONNREFUSED' || error?.code === 'EPIPE' || error?.code === 'ECONNRESET') {
              return // Silently ignore
            }
          }
          originalError(msg, options)
        }
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), suppressWsErrorsPlugin()],
  server: {
    // Allow access from network (0.0.0.0) while still allowing localhost.
    // This enables LAN access for development without breaking local usage.
    host: true, // Equivalent to '0.0.0.0' but more explicit about intent
    /**
     * In dev, the frontend runs on :5173 but the bot's Web UI server (WS + snapshots)
     * runs on WEB_UI_PORT (default :3001). Proxy `/ws` so the frontend can keep using
     * same-origin `ws(s)://<vite-host>/ws`.
     *
     * Ref: Vite v5 `server.proxy` with `ws: true`.
     */
    proxy: {
      '/ws': {
        target: BOT_UI_TARGET,
        ws: true,
        changeOrigin: true,
        // Suppress common WebSocket proxy errors that are expected in normal operation:
        // - ECONNREFUSED: bot server not running
        // - EPIPE: socket closed during write (client disconnect)
        // - ECONNRESET: connection reset by peer (normal disconnect)
        // The frontend will handle WebSocket connection failures gracefully
        configure: (proxy, _options) => {
          // Handle proxy-level errors
          proxy.on('error', (err, _req, _res) => {
            const code = (err as NodeJS.ErrnoException).code
            // Suppress common, harmless WebSocket proxy errors
            if (code === 'ECONNREFUSED' || code === 'EPIPE' || code === 'ECONNRESET') {
              return // Silently ignore
            }
            // Only log unexpected errors
            console.error('[vite] ws proxy error:', err)
          })
          // Handle WebSocket upgrade and socket errors
          proxy.on('proxyReqWs', (proxyReq, req, socket) => {
            // Handle errors on the client socket
            socket.on('error', (err) => {
              const code = (err as NodeJS.ErrnoException).code
              if (code === 'EPIPE' || code === 'ECONNRESET' || code === 'ECONNREFUSED') {
                return // Silently ignore
              }
              console.error('[vite] ws proxy socket error:', err)
            })
            // Handle errors on the target socket (connection to bot server)
            proxyReq.on('error', (err) => {
              const code = (err as NodeJS.ErrnoException).code
              if (code === 'EPIPE' || code === 'ECONNRESET' || code === 'ECONNREFUSED') {
                return // Silently ignore
              }
              console.error('[vite] ws proxy target error:', err)
            })
          })
        },
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})


