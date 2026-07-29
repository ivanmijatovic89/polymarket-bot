import type { TokenUsage } from './types.js'

interface TokenPrices {
  input: number
  cacheRead: number
  cacheWrite: number
  output: number
}

// USD per one million tokens. These are API-equivalent estimates for Codex
// subscription runs; they are not a statement of what the subscription billed.
const CODEX_TOKEN_PRICES: Record<string, TokenPrices> = {
  'gpt-5.6-sol': { input: 5, cacheRead: 0.5, cacheWrite: 6.25, output: 30 },
  'gpt-5.6-terra': { input: 2.5, cacheRead: 0.25, cacheWrite: 3.125, output: 15 },
  'gpt-5.6-luna': { input: 1, cacheRead: 0.1, cacheWrite: 1.25, output: 6 },
}

export function resolveCodexModel(model: string): string {
  return model === 'gpt-5.6' ? 'gpt-5.6-sol' : model
}

export function estimateCodexApiCost(model: string, usage: TokenUsage): number | null {
  const prices = CODEX_TOKEN_PRICES[resolveCodexModel(model)]
  if (!prices) return null
  const present = [
    usage.inputTokens,
    usage.cacheReadInputTokens,
    usage.cacheCreationInputTokens,
    usage.outputTokens,
  ].some((value) => value !== null)
  if (!present) return null

  return (
    ((usage.inputTokens ?? 0) * prices.input +
      (usage.cacheReadInputTokens ?? 0) * prices.cacheRead +
      (usage.cacheCreationInputTokens ?? 0) * prices.cacheWrite +
      (usage.outputTokens ?? 0) * prices.output) /
    1_000_000
  )
}
