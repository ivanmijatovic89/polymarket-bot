import type { Variant } from './config.js'

const base = {
  repairStart: 0.04,
  repairEnd: 0.08,
  normalExecution: 'taker',
  repairExecution: 'taker',
} as const
export const variants: readonly Variant[] = [
  {
    ...base,
    id: 'pair-01-no-repair',
    title: 'Pair 01: taker ladder, no repair',
    repairCurve: 'none',
  },
  { ...base, id: 'pair-02-full-4c', title: 'Pair 02: full repair at 4c', repairCurve: 'immediate' },
  {
    ...base,
    id: 'pair-03-linear-4-8c',
    title: 'Pair 03: linear repair from 4c to 8c',
    repairCurve: 'linear',
  },
  {
    ...base,
    id: 'pair-04-linear-3-10c',
    title: 'Pair 04: linear repair from 3c to 10c',
    repairCurve: 'linear',
    repairStart: 0.03,
    repairEnd: 0.1,
  },
  {
    ...base,
    id: 'pair-05-convex-4-8c',
    title: 'Pair 05: late-weighted convex repair',
    repairCurve: 'convex',
  },
  {
    ...base,
    id: 'pair-06-concave-4-8c',
    title: 'Pair 06: early-weighted concave repair',
    repairCurve: 'concave',
  },
  {
    ...base,
    id: 'pair-07-stepped-4-6-8c',
    title: 'Pair 07: stepped 25/60/104 cumulative repair',
    repairCurve: 'stepped',
  },
  {
    ...base,
    id: 'pair-08-maker-ladder',
    title: 'Pair 08: maker ladder, linear taker repair',
    repairCurve: 'linear',
    normalExecution: 'maker',
  },
  {
    ...base,
    id: 'pair-09-maker-both',
    title: 'Pair 09: maker ladder and linear maker repair',
    repairCurve: 'linear',
    normalExecution: 'maker',
    repairExecution: 'maker',
  },
  {
    ...base,
    id: 'pair-10-chunked-repair',
    title: 'Pair 10: linear taker repair in 10-share clips',
    repairCurve: 'linear',
    repairChunk: 10,
  },
]
