#!/usr/bin/env npx tsx
/**
 * underwaterScan.ts — how far past its own money does the player commit?
 *
 * For every second of every market in the observation channel:
 *   deficit = |up − down|              shares still owed on the leg that is behind
 *   need    = deficit × that leg's ask  what completing it costs at today's price
 *   left    = qty·pairCeil − spent      what is left of the pair budget
 *
 * r = need / left. Above 1 the player cannot complete the leg it is short of at
 * today's price and is relying on that leg getting cheaper — which happens only
 * if that leg loses. The question this answers is whether the market that blocks
 * the level is an outlier in r, or whether going underwater is simply how the
 * player works.
 *
 *   npx tsx protocols/pair-game-opus/tools/underwaterScan.ts [--until 600] [--obs ...]
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, basename, join } from 'node:path'

const argv = process.argv.slice(2)
const arg = (k: string, d: string): string => {
  const i = argv.indexOf(`--${k}`)
  return i >= 0 ? (argv[i + 1] as string) : d
}
const until = Number(arg('until', '600'))
const budget = Number(arg('budget', '970'))
const pattern = arg('obs', '/tmp/pg/obs_*.err')
const dir = dirname(pattern)
const [head, tail] = basename(pattern).split('*')

type Worst = { r: number; t: number; deficit: number; spent: number; ask: number }
const worst = new Map<string, Worst>()

for (const f of readdirSync(dir).filter((x) => x.startsWith(head) && x.endsWith(tail ?? ''))) {
  for (const line of readFileSync(join(dir, f), 'utf8').split('\n')) {
    if (!line.includes('obs slug=')) continue
    const kv = new Map<string, string>()
    for (const part of line.split(/\s+/)) {
      const i = part.indexOf('=')
      if (i > 0) kv.set(part.slice(0, i), part.slice(i + 1))
    }
    const slug = kv.get('slug')
    const t = Number((line.match(/ t\+(\d+)s /) ?? [])[1])
    const held = (kv.get('held') ?? '').split('/').map(Number)
    if (!slug || !Number.isFinite(t) || t > until || held.length !== 2) continue
    const [up, down] = held as [number, number]
    const spent = Number(kv.get('spent'))
    const deficit = Math.abs(up - down)
    const ask = up > down ? Number(kv.get('askDown')) : Number(kv.get('askUp'))
    const left = Math.max(budget - spent, 1e-9)
    const r = deficit === 0 ? 0 : (deficit * ask) / left
    const cur = worst.get(slug)
    if (!cur || r > cur.r) worst.set(slug, { r, t, deficit, spent, ask })
  }
}

console.log(`worst underwater ratio by t+${until}s (budget ${budget})`)
for (const [slug, v] of [...worst.entries()].sort((a, b) => b[1].r - a[1].r)) {
  console.log(
    `  ${slug} r=${v.r.toFixed(2)} at t+${v.t}s deficit=${v.deficit.toFixed(0)} ` +
      `ask=${v.ask.toFixed(2)} spent=${v.spent.toFixed(0)}`,
  )
}
