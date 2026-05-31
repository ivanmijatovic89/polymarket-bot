'use client'

import { useEffect, useState } from 'react'

/**
 * Bull Board runs in a separate Fastify process (see `npm run bull-board`).
 * The port comes from the server (env `BULL_BOARD_PORT`, default 3003,
 * passed via prop from the layout). We derive the host from
 * `window.location.hostname` so the link works whether the dashboard is
 * opened locally or over SSH/port-forward.
 */
export function BullBoardLink({ port, className }: { port: number; className?: string }) {
  const [href, setHref] = useState<string>('#')
  useEffect(() => {
    const host = window.location.hostname || '127.0.0.1'
    setHref(`http://${host}:${port}/admin/queues`)
  }, [port])
  return (
    <a href={href} className={className} target="_blank" rel="noreferrer">
      Bull Board (raw)
    </a>
  )
}
