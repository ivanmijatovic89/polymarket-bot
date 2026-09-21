/** Shared by live trading, local replay, and fleet market workers. */
export const DEFAULT_MAX_EVENTS_PER_DRAIN = 4200

export function resolveMaxEventsPerDrain(override?: number): number {
  const raw = process.env.MAX_EVENTS_PER_DRAIN?.trim()
  const value = override ?? (raw ? Number(raw) : DEFAULT_MAX_EVENTS_PER_DRAIN)
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error('MAX_EVENTS_PER_DRAIN must be a positive safe integer')
  return value
}
