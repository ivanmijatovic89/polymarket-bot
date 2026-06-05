/**
 * One-shot backfill for backtest_runs metadata columns introduced in PR#30
 * (input_mode, converter, read_from, timeframe). Legacy rows have these as
 * NULL but their `cmd` string contains the flags. Parse and populate so the
 * dashboard coverage section can show data for older runs.
 *
 * Safe to re-run: only updates rows where input_mode IS NULL.
 *
 * Usage:  npx tsx scripts/backfill-backtest-coverage-meta.ts [--dry-run]
 */
import '../src/config/env.js'
import { getDb, closeDb } from '../src/db/index.js'
import { sql } from 'drizzle-orm'

const DRY_RUN = process.argv.includes('--dry-run')

function flag(cmd: string, name: string): string | null {
  // Match "--name value" with optional `=`, value may be quoted or bare token.
  const re = new RegExp(`--${name}(?:[= ]+)("([^"]+)"|'([^']+)'|([^\\s]+))`, 'i')
  const m = cmd.match(re)
  if (!m) return null
  return (m[2] ?? m[3] ?? m[4] ?? '').trim() || null
}

function converterFromInputMode(inputMode: string | null): string | null {
  if (inputMode === 'telonex-delta') return 'delta-typed'
  if (inputMode === 'telonex-paired') return 'paired'
  return null
}

async function main() {
  const db = getDb()!

  const rows: any = await db.execute(sql`
    SELECT id, cmd
    FROM backtest_runs
    WHERE input_mode IS NULL AND cmd IS NOT NULL
    ORDER BY id ASC
  `)
  const list = rows[0] as Array<{ id: number; cmd: string }>
  console.log(`[backfill] inspecting ${list.length} rows with input_mode IS NULL`)

  let updated = 0
  let skipped = 0
  for (const r of list) {
    const cmd = r.cmd ?? ''
    const inputMode = flag(cmd, 'input-mode')
    if (!inputMode || (inputMode !== 'telonex-delta' && inputMode !== 'telonex-paired')) {
      // recorded / unknown → mark as 'recorded' so coverage skips deterministically
      if (!DRY_RUN) {
        await db.execute(sql`
          UPDATE backtest_runs SET input_mode = 'recorded' WHERE id = ${r.id}
        `)
      }
      skipped++
      continue
    }
    const converter = converterFromInputMode(inputMode)
    const readFrom = flag(cmd, 'read-from')
    const timeframe = flag(cmd, 'timeframe')

    console.log(
      `[backfill] id=${r.id} inputMode=${inputMode} converter=${converter} readFrom=${readFrom} timeframe=${timeframe}`,
    )

    if (!DRY_RUN) {
      await db.execute(sql`
        UPDATE backtest_runs
        SET input_mode = ${inputMode},
            converter = ${converter},
            read_from = ${readFrom},
            timeframe = ${timeframe}
        WHERE id = ${r.id}
      `)
    }
    updated++
  }

  console.log(`[backfill] done — telonex rows updated: ${updated}, recorded/unknown: ${skipped}`)
  if (DRY_RUN) console.log('[backfill] DRY RUN — no writes performed')

  await closeDb()
  process.exit(0)
}

main().catch(async (e) => {
  console.error(e)
  await closeDb().catch(() => {})
  process.exit(1)
})
