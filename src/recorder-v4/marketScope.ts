/** Legacy envelopes without a scope apply to every market on their shared connection. */
export function includesMarket(
  scope: { marketSlug?: unknown; marketSlugs?: unknown },
  slug: string,
): boolean {
  if (scope.marketSlugs !== undefined) {
    if (
      !Array.isArray(scope.marketSlugs) ||
      !scope.marketSlugs.every((value) => typeof value === 'string')
    )
      throw new Error('Invalid capture market scope')
    if (!scope.marketSlugs.includes(slug)) return false
  }
  return scope.marketSlug === undefined || scope.marketSlug === slug
}
