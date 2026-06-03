'use client'

import { useEffect, useMemo, useState } from 'react'
import { Check, Copy, Terminal, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export type CmdModalProps = {
  open: boolean
  onClose: () => void
  cmd: string | null
  batchUid?: string | null
}

/**
 * Lightweight modal showing the reproducible `cmd` string for a batch run.
 * Closes on Escape, backdrop click, or the close button. Includes a
 * copy-to-clipboard control with a 1.5s "copied" confirmation.
 */
export function CmdModal({ open, onClose, cmd, batchUid }: CmdModalProps) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Reset the "copied" indicator each time the modal opens.
  useEffect(() => {
    if (open) setCopied(false)
  }, [open])

  const display = useMemo(() => cmd?.trim() ?? '', [cmd])

  if (!open) return null

  const handleCopy = async () => {
    if (!display) return
    try {
      await navigator.clipboard.writeText(display)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* ignore */
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Reproduce command"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl rounded-lg border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Reproduce command</span>
            {batchUid && (
              <span className="font-mono text-xs text-muted-foreground">
                · {batchUid}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4">
          {display ? (
            <div className="relative">
              <pre className="max-h-[60vh] overflow-auto rounded-md bg-muted/40 p-3 pr-12 font-mono text-xs text-foreground whitespace-pre-wrap break-all">
                {display}
              </pre>
              <button
                type="button"
                onClick={handleCopy}
                className={cn(
                  'absolute right-2 top-2 inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs transition-colors',
                  copied
                    ? 'border-[color:var(--success)]/40 text-[color:var(--success)]'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent',
                )}
                aria-label={copied ? 'Copied' : 'Copy command'}
              >
                {copied ? (
                  <>
                    <Check className="h-3 w-3" /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" /> Copy
                  </>
                )}
              </button>
            </div>
          ) : (
            <div className="rounded-md border border-dashed p-6 text-center text-xs text-muted-foreground">
              No <code className="font-mono">cmd</code> recorded for this batch.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
