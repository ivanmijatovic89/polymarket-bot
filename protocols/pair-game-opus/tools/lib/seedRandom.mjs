/**
 * seedRandom.mjs — make a backtest's latency jitter reproducible.
 *
 * The ONLY source of non-determinism in a pair-game-opus backtest is
 * `Math.random()` inside `BacktestExecution` (src/trading/execution/
 * BacktestExecution.ts:201), which draws the symmetric ±jitter added to the
 * 140 ms latency RULES pins. Everything else — the tick stream, the feeds, the
 * strategy — is deterministic.
 *
 * That single unseeded stream is why one market can pass a level run and fail
 * the next with no code change, and why a single-market probe of a marginal
 * market tells you nothing: each run draws a different latency sequence.
 *
 * Preloading this module replaces `Math.random` with a seeded mulberry32, so a
 * given `PG_SEED` replays one exact latency sequence. The DISTRIBUTION is
 * unchanged — still uniform, still ±jitter — so a seeded run is a legitimate
 * draw from the same game; it is simply a draw you can repeat. Use it to make a
 * marginal market fail on demand and to check a fix across many draws.
 *
 * Usage (from the repo root):
 *   PG_SEED=7 NODE_OPTIONS="--import file://$PWD/protocols/pair-game-opus/tools/lib/seedRandom.mjs" \
 *     protocols/pair-game-opus/tools/probe2.sh tag "<slugs>"
 *
 * Level EVIDENCE is still recorded from ordinary unseeded runs: the game is
 * played against random latency, not against a chosen seed.
 */
const raw = process.env.PG_SEED
const seed = Number(raw)
if (raw !== undefined && Number.isFinite(seed)) {
  let a = (seed >>> 0) + 0x9e3779b9
  Math.random = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  process.stderr.write(`[seedRandom] Math.random seeded with PG_SEED=${seed}\n`)
}
