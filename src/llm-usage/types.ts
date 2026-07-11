/** Shared shapes for all llm-usage providers. */

export interface RateLimitWindow {
  label: string
  percentUsed: number | null
  resetsAt: string // ISO timestamp
}

export interface AccountUsage {
  account: string
  windows: RateLimitWindow[]
  plan?: string
  error?: string
}
