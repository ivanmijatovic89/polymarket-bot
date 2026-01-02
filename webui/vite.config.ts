import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const BOT_UI_HOST = process.env.VITE_BOT_UI_HOST ?? '127.0.0.1'
const BOT_UI_PORT_RAW = process.env.VITE_BOT_UI_PORT ?? '3001'
const BOT_UI_PORT = Number.parseInt(BOT_UI_PORT_RAW, 10)
const BOT_UI_TARGET = `http://${BOT_UI_HOST}:${Number.isFinite(BOT_UI_PORT) ? BOT_UI_PORT : 3001}`

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Bind explicitly to IPv4 to avoid environments where listening on ::1 fails.
    host: '127.0.0.1',
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
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})


