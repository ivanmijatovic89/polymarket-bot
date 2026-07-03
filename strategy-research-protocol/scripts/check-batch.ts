/**
 * research:check-batch — is a submitted experiment's backtest work finished?
 *
 * Completion is OPERATIONAL state owned by the database (a backtest_runs row
 * exists per submissionUid only after the aggregate worker persists it), so
 * it is queried on demand — never stored in family files.
 *
 *   npm run research:check-batch -- --family book-imbalance --experiment 000-baseline
 *   npm run research:check-batch -- --submission-uids <uid1>,<uid2>
 *
 * Read-only. Exit codes: 0 = all runs persisted, 2 = still incomplete,
 * 1 = usage/error.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { inArray } from 'drizzle-orm'
import { backtestRuns, closeDb, getDb } from '../../src/db/index.js'
import { FamilyIndex } from '../schemas/index.js'

type Group = { label: string; submissionUids: string[] }

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`)
  const value = i >= 0 ? process.argv[i + 1] : undefined
  return value !== undefined && !value.startsWith('--') ? value : null
}

function groupsFromArgs(): Group[] {
  const uids = arg('submission-uids')
  if (uids) return [{ label: 'submissions', submissionUids: uids.split(',').filter(Boolean) }]

  const family = arg('family')
  const experimentId = arg('experiment')
  if (!family || !experimentId) {
    console.error(
      'usage: --family <slug> --experiment <experiment-id> | --submission-uids <uid,uid,...>',
    )
    process.exit(1)
  }

  const familyPath = join(process.cwd(), 'src', 'strategies', 'research', family, 'FAMILY.json')
  const fam = FamilyIndex.parse(JSON.parse(readFileSync(familyPath, 'utf8')))
  const exp = fam.experiments.find((e) => e.id === experimentId)
  if (!exp) {
    console.error(`[check-batch] experiment ${experimentId} not found in ${family}`)
    process.exit(1)
  }

  if (exp.search) {
    return exp.search.passes
      .filter((p) => p.submissionUids.length > 0)
      .map((p) => ({ label: p.batchUid, submissionUids: p.submissionUids }))
  }
  if (exp.submissionUids.length > 0)
    return [{ label: exp.batchUid ?? experimentId, submissionUids: exp.submissionUids }]
  return []
}

const groups = groupsFromArgs()
if (groups.length === 0) {
  console.log('[check-batch] nothing submitted yet — no submissionUids recorded')
  process.exit(2)
}

const allUids = groups.flatMap((g) => g.submissionUids)
const db = getDb()
const rows = await db
  .select({
    submissionUid: backtestRuns.submissionUid,
    id: backtestRuns.id,
    status: backtestRuns.status,
    marketsPersisted: backtestRuns.marketsPersisted,
    failuresCount: backtestRuns.failuresCount,
  })
  .from(backtestRuns)
  .where(inArray(backtestRuns.submissionUid, allUids))
await closeDb()

const bySubmission = new Map(rows.map((r) => [r.submissionUid, r]))
let allDone = true

for (const group of groups) {
  const done = group.submissionUids.filter((uid) => bySubmission.has(uid))
  const complete = done.length === group.submissionUids.length
  if (!complete) allDone = false
  console.log(
    `${complete ? 'done   ' : 'waiting'} ${group.label}: ${done.length}/${group.submissionUids.length} persisted`,
  )
  for (const uid of group.submissionUids) {
    const row = bySubmission.get(uid)
    if (!row) continue
    const flag = row.status === 'completed' ? '' : `  <-- ${row.status}`
    console.log(
      `        run ${row.id} (${row.status}, ${row.marketsPersisted} markets, ` +
        `${row.failuresCount} failures)${flag}`,
    )
  }
}

console.log(allDone ? '[check-batch] COMPLETE — ready for evaluation' : '[check-batch] INCOMPLETE')
process.exit(allDone ? 0 : 2)
