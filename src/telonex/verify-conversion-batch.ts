#!/usr/bin/env tsx
/**
 * Batch wrapper for Telonex conversion verification.
 *
 * This file intentionally does not duplicate verifier logic. It selects slugs
 * from telonex_markets and runs the single-slug verifier for each one.
 */

import '../config/env.js'
import { spawn } from 'node:child_process'
import { eq, sql } from 'drizzle-orm'
import { closeDb, getDb, telonexMarkets } from '../db/index.js'

type ConverterChoice = 'paired' | 'delta' | 'both'

type Args = {
  limit: number
  random: boolean
  converter: ConverterChoice
  bookInterval: number
  continueOnError: boolean
}

type VerifyResult = {
  slug: string
  ok: boolean
  elapsedMs: number
  error: string | null
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    limit: 20,
    random: false,
    converter: 'both',
    bookInterval: 500,
    continueOnError: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--limit') out.limit = Math.max(1, Number(argv[++i] ?? '20') || 20)
    else if (a === '--random') out.random = true
    else if (a === '--converter') {
      const v = argv[++i]
      if (v !== 'paired' && v !== 'delta' && v !== 'both') {
        throw new Error(`[telonex:verify-batch] --converter must be paired|delta|both, got ${v}`)
      }
      out.converter = v
    } else if (a === '--book-interval') {
      out.bookInterval = Math.max(1, Number(argv[++i] ?? '500') || 500)
    } else if (a === '--continue-on-error') out.continueOnError = true
    else throw new Error(`[telonex:verify-batch] unknown arg: ${a}`)
  }

  return out
}

async function selectSlugs(args: Args): Promise<string[]> {
  const db = getDb()
  const orderExpr = args.random ? sql`RAND()` : telonexMarkets.slug
  const rows = await db
    .select({ slug: telonexMarkets.slug })
    .from(telonexMarkets)
    .where(eq(telonexMarkets.uploadStatus, 'done'))
    .orderBy(orderExpr)
    .limit(args.limit)
  return rows.map((r) => r.slug)
}

function runSingleVerifier(args: {
  slug: string
  converter: ConverterChoice
  bookInterval: number
}): Promise<void> {
  const argv = [
    'run',
    'telonex:verify',
    '--',
    '--slug',
    args.slug,
    '--converter',
    args.converter,
    '--book-interval',
    String(args.bookInterval),
  ]

  return new Promise((resolve, reject) => {
    const child = spawn('npm', argv, { stdio: 'inherit' })
    child.on('error', reject)
    child.on('exit', (code, signal) => {
      if (code === 0) resolve()
      else
        reject(
          new Error(
            `slug=${args.slug} verifier exited code=${code ?? 'null'} signal=${signal ?? 'null'}`,
          ),
        )
    })
  })
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  return `${m}m ${(s - m * 60).toFixed(1)}s`
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const slugs = await selectSlugs(args)
  if (slugs.length === 0)
    throw new Error('[telonex:verify-batch] no upload_status=done markets found')

  console.log(
    `[telonex:verify-batch] selected=${slugs.length} random=${args.random} converter=${args.converter} book_interval=${args.bookInterval} stop_at_first=${!args.continueOnError}`,
  )

  const results: VerifyResult[] = []
  for (let i = 0; i < slugs.length; i += 1) {
    const slug = slugs[i]!
    const started = Date.now()
    console.log(`[telonex:verify-batch] ${i + 1}/${slugs.length} ${slug} START`)
    try {
      await runSingleVerifier({
        slug,
        converter: args.converter,
        bookInterval: args.bookInterval,
      })
      const elapsedMs = Date.now() - started
      results.push({ slug, ok: true, elapsedMs, error: null })
      console.log(
        `[telonex:verify-batch] ${i + 1}/${slugs.length} ${slug} OK elapsed=${fmtMs(elapsedMs)}`,
      )
    } catch (err) {
      const elapsedMs = Date.now() - started
      const msg = err instanceof Error ? err.message : String(err)
      results.push({ slug, ok: false, elapsedMs, error: msg })
      console.error(
        `[telonex:verify-batch] ${i + 1}/${slugs.length} ${slug} FAIL elapsed=${fmtMs(elapsedMs)} error=${msg}`,
      )
      if (!args.continueOnError) break
    }
  }

  const ok = results.filter((r) => r.ok).length
  const failed = results.length - ok
  console.log(
    `[telonex:verify-batch] summary ok=${ok} failed=${failed} attempted=${results.length}/${slugs.length}`,
  )

  if (failed > 0) {
    for (const result of results.filter((r) => !r.ok)) {
      console.error(`[telonex:verify-batch] failed slug=${result.slug} error=${result.error}`)
    }
    process.exitCode = 1
  }
}

main()
  .then(async () => {
    await closeDb().catch(() => undefined)
  })
  .catch(async (err) => {
    console.error('[telonex:verify-batch] fatal', err)
    await closeDb().catch(() => undefined)
    process.exit(1)
  })
