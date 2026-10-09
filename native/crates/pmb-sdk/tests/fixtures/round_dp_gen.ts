/**
 * Golden generator (60 §6.4 LS-1(a), §7.1 GF-1/GF-2): `round_dp(x, k)` of
 * pmb-sdk (30 §14) must equal TS `Number(x.toFixed(k))` bit for bit. The
 * oracle is the JS builtin itself, so this script imports no repo module.
 *
 * Inputs (12,800, each with k in 1..4, so 51,200 cases), rebuilt by the
 * Rust test with the same arithmetic:
 *  - ties: every odd n / 2^q (q in 2..5, n in 1..399), an exact binary tie
 *    at k = q - 1 (0.25 at k = 1, 0.125 at k = 2, ...), its two f64
 *    neighbors, and their negations;
 *  - decimal: the nearest f64 of the decimal text (10i + 5) / 10^(d + 1)
 *    (d in 1..4, i in 0..499), e.g. 1.005, and its negation;
 *  - random: splitmix64 (seed 0x5eed0001): 2,000 uniform values in
 *    (-1000, 1000) and 2,000 random finite values from 2^-23 to 2^67.
 * Each section's digest is the sha256 of its lines `<x bits> <k> <y bits>\n`
 * (16 lowercase hex digits per f64), inputs in order, k inner.
 *
 * Usage: npx tsx native/crates/pmb-sdk/tests/fixtures/round_dp_gen.ts
 */
import { createHash } from 'node:crypto'
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const MASK = (1n << 64n) - 1n
const buf = new DataView(new ArrayBuffer(8))

const bitsOf = (x: number): bigint => {
  buf.setFloat64(0, x)
  return buf.getBigUint64(0)
}
const fromBits = (b: bigint): number => {
  buf.setBigUint64(0, b)
  return buf.getFloat64(0)
}
const hex = (x: number): string => bitsOf(x).toString(16).padStart(16, '0')

function splitmix64(seed: bigint): () => bigint {
  let state = seed
  return () => {
    state = (state + 0x9e3779b97f4a7c15n) & MASK
    let z = state
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK
    return z ^ (z >> 31n)
  }
}

function ties(): number[] {
  const out: number[] = []
  for (let q = 2; q <= 5; q++) {
    for (let n = 1; n <= 399; n += 2) {
      const t = n / 2 ** q
      for (const v of [t, fromBits(bitsOf(t) + 1n), fromBits(bitsOf(t) - 1n)]) out.push(v, -v)
    }
  }
  return out
}

function decimal(): number[] {
  const out: number[] = []
  for (let d = 1; d <= 4; d++) {
    const scale = 10 ** (d + 1)
    for (let i = 0; i < 500; i++) {
      const m = 10 * i + 5
      const text = `${Math.floor(m / scale)}.${String(m % scale).padStart(d + 1, '0')}`
      const v = Number(text)
      out.push(v, -v)
    }
  }
  return out
}

function random(): number[] {
  const next = splitmix64(0x5eed0001n)
  const out: number[] = []
  for (let i = 0; i < 2000; i++) {
    const u = Number(next() >> 11n) / 2 ** 53
    out.push((u * 2 - 1) * 1000)
  }
  for (let i = 0; i < 2000; i++) {
    const b = next()
    const sign = b >> 63n
    const exp = 1000n + (((b >> 52n) & 0x7ffn) % 91n)
    const mant = b & ((1n << 52n) - 1n)
    out.push(fromBits((sign << 63n) | (exp << 52n) | mant))
  }
  return out
}

function digest(inputs: number[]): string {
  const h = createHash('sha256')
  for (const x of inputs) {
    for (let k = 1; k <= 4; k++) h.update(`${hex(x)} ${k} ${hex(Number(x.toFixed(k)))}\n`)
  }
  return h.digest('hex')
}

const sections: Record<string, number[]> = { decimal: decimal(), random: random(), ties: ties() }
const digests: Record<string, string> = {}
let inputs = 0
for (const [name, xs] of Object.entries(sections)) {
  digests[name] = digest(xs)
  inputs += xs.length
}
// The ties 60 §6.4 names, with their neighbors, written out for debugging.
const named: string[] = []
for (const [x, k] of [
  [0.25, 1],
  [0.125, 2],
  [-0.125, 2],
] as const) {
  for (const v of [x, fromBits(bitsOf(x) + 1n), fromBits(bitsOf(x) - 1n)]) {
    named.push(`${hex(v)} ${k} ${hex(Number(v.toFixed(k)))}`)
  }
}

const generator = 'native/crates/pmb-sdk/tests/fixtures/round_dp_gen.ts'
const repoRoot = path.resolve(import.meta.dirname, '../../../../..')
const out = {
  header: {
    contentPin: execSync('git rev-parse HEAD', { cwd: repoRoot }).toString().trim(),
    generator,
    generatorSha256: createHash('sha256')
      .update(readFileSync(path.join(repoRoot, generator)))
      .digest('hex'),
  },
  cases: inputs * 4,
  digests,
  inputs,
  named,
  spec: 'native-spec-g1 60 §6.4 LS-1(a); 30 §14',
}
writeFileSync(
  path.join(import.meta.dirname, 'round_dp_golden.json'),
  JSON.stringify(out, null, 2) + '\n',
)
console.log(`round_dp golden: ${inputs} inputs, ${inputs * 4} cases`)
