'use client'

import { useEffect, useState } from 'react'

/**
 * Bull Board runs in a separate Fastify process (see `npm run bull-board`).
 * The default port is 3003 (overridable via BULL_BOARD_PORT on the proc side
 * and NEXT_PUBLIC_BULL_BOARD_PORT for this UI link). We derive the host from
 * `window.location.hostname` so the link works whether the dashboard is
 * opened locally or over SSH/port-forward.
 */
export function BullBoardLink({ className }: { className?: string }) {
  const [href, setHref] = useState<string>('#')
  useEffect(() => {
    const port = process.env.NEXT_PUBLIC_BULL_BOARD_PORT ?? '3003'
    const host = window.location.hostname || '127.0.0.1'
    setHref(`http://${host}:${port}/admin/queues`)
  }, [])
  return (
    <a href={href} className={className} target="_blank" rel="noreferrer">
      Bull Board (raw)
    </a>
  )
}
