/**
 * Rounding utilities for trading calculations.
 * Uses 8 decimal places precision (1e8) for consistency across the codebase.
 */

export function round8(n: number): number {
  return Math.round(n * 1e8) / 1e8
}

export function round2(n: number): number {
  return Math.round(n * 1e8) / 1e8
}
