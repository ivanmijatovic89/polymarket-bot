'use client'

import { ExternalLink } from 'lucide-react'
import { useEffect, useState } from 'react'

export function BullBoardLink({ port, className }: { port: number; className?: string }) {
  const [href, setHref] = useState<string>('#')
  useEffect(() => {
    const host = window.location.hostname || '127.0.0.1'
    setHref(`http://${host}:${port}/admin/queues`)
  }, [port])
  return (
    <a href={href} className={className} target="_blank" rel="noreferrer">
      Bull Board
      <ExternalLink className="h-3 w-3" />
    </a>
  )
}
