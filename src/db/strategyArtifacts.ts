// -----------------------------------------------------------------------------
// SOURCE OF TRUTH for queries against `strategy_artifacts`. Do NOT write
// inline SQL against this table elsewhere — add a function here instead.
//
// Rows are immutable once inserted (content-addressed by sha256): publish is
// insert-if-missing, never update. Workers do not read this table at all.
// -----------------------------------------------------------------------------

import { desc, eq } from 'drizzle-orm'
import { getDb } from './index.js'
import { strategyArtifacts } from './schema.js'

export type StrategyArtifactRow = typeof strategyArtifacts.$inferSelect
export type InsertStrategyArtifactRow = typeof strategyArtifacts.$inferInsert

export async function getStrategyArtifactBySha(
  sha256: string,
): Promise<StrategyArtifactRow | null> {
  const rows = await getDb()
    .select()
    .from(strategyArtifacts)
    .where(eq(strategyArtifacts.sha256, sha256))
    .limit(1)
  return rows[0] ?? null
}

/**
 * Insert the artifact row unless the sha already exists. Returns whether a
 * new row was written. A concurrent duplicate insert loses the unique-key
 * race and is treated as "already present" (content-addressed rows for the
 * same sha are interchangeable by construction).
 */
export async function insertStrategyArtifactIfMissing(
  row: InsertStrategyArtifactRow,
): Promise<{ inserted: boolean }> {
  const existing = await getStrategyArtifactBySha(row.sha256)
  if (existing) return { inserted: false }
  try {
    await getDb().insert(strategyArtifacts).values(row)
    return { inserted: true }
  } catch (err) {
    if ((err as { code?: string }).code === 'ER_DUP_ENTRY') return { inserted: false }
    throw err
  }
}

export async function listStrategyArtifacts(limit = 50): Promise<StrategyArtifactRow[]> {
  return getDb()
    .select()
    .from(strategyArtifacts)
    .orderBy(desc(strategyArtifacts.createdAt), desc(strategyArtifacts.id))
    .limit(limit)
}
