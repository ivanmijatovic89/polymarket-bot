/**
 * sql.ts — read-only SQL runner against the backtest MySQL database.
 *
 * Usage:
 *   tsx protocols/pair-game-opus/tools/sql.ts "SELECT ... "
 *
 * Prints the result rows as JSON. Only SELECT/SHOW/DESCRIBE/EXPLAIN statements
 * are accepted — this tool never mutates engine state (tools/README.md).
 * Ad-hoc verification queries only; anything recurring should become a
 * dedicated tool (results.ts, compare.ts, fleet.ts).
 */
import '../../../src/config/env.js'
import { openDb } from './lib/runQueries.js'

const sql = process.argv[2]
if (!sql) {
  console.error('usage: tsx protocols/pair-game-opus/tools/sql.ts "<SELECT ...>"')
  process.exit(2)
}
if (!/^\s*(select|show|describe|desc|explain)\b/i.test(sql)) {
  console.error('refused: only SELECT/SHOW/DESCRIBE/EXPLAIN statements are allowed')
  process.exit(2)
}

const conn = await openDb()
try {
  const [rows] = await conn.query(sql)
  console.log(JSON.stringify(rows, (_k, v) => (typeof v === 'bigint' ? String(v) : v), 2))
} finally {
  await conn.end()
}
