/**
 * sql.ts — read-only SQL runner against the backtest MySQL database.
 *
 * Usage:
 *   tsx protocols/pair-fable/tools/sql.ts "SELECT ... "
 *
 * Prints the result rows as JSON. Only SELECT/SHOW/DESCRIBE/EXPLAIN statements
 * are accepted — this tool never mutates engine state (tools/README.md).
 * Ad-hoc verification queries only; anything recurring should become a
 * dedicated tool (results.ts, compare.ts, fleet.ts).
 */
import '../../../src/config/env.js'
import mysql from 'mysql2/promise'

const sql = process.argv[2]
if (!sql) {
  console.error('usage: tsx protocols/pair-fable/tools/sql.ts "<SELECT ...>"')
  process.exit(2)
}
if (!/^\s*(select|show|describe|desc|explain)\b/i.test(sql)) {
  console.error('refused: only SELECT/SHOW/DESCRIBE/EXPLAIN statements are allowed')
  process.exit(2)
}

const conn = await mysql.createConnection({
  host: process.env.DATABASE_HOST,
  port: Number(process.env.DATABASE_PORT ?? 3306),
  user: process.env.DATABASE_USERNAME,
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME,
})
try {
  const [rows] = await conn.query(sql)
  console.log(JSON.stringify(rows, (_k, v) => (typeof v === 'bigint' ? String(v) : v), 2))
} finally {
  await conn.end()
}
