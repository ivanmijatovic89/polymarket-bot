/** Create only namespaced result tables; catalog and artifact queries stay read-only. */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { config } from 'dotenv'
import mysql from 'mysql2/promise'
import type { RowDataPacket } from 'mysql2'
import path from 'node:path'

const [settingsPath, operation = 'prepare'] = process.argv.slice(2)
assert(settingsPath)
const settings = JSON.parse(await readFile(settingsPath, 'utf8'))
assert(/^rbx_[a-f0-9]{8}_$/.test(settings.namespace))
config({ path: path.join(settings.productionRoot, '.env'), quiet: true })
delete process.env.BOT_ENV
const connection = await mysql.createConnection({
  host: process.env.DATABASE_HOST!,
  port: Number(process.env.DATABASE_PORT),
  user: process.env.DATABASE_USERNAME!,
  ...(process.env.DATABASE_PASSWORD !== undefined
    ? { password: process.env.DATABASE_PASSWORD }
    : {}),
  database: process.env.DATABASE_NAME!,
  connectTimeout: 10000,
})
const names = [
  'backtest_runs',
  'backtest_run_markets',
  'backtest_run_segments',
  'backtest_run_failures',
]
const quote = (s: string) => '`' + s.replaceAll('`', '``') + '`'
try {
  if (operation === 'prepare') {
    const ddl: Record<string, string> = {}
    for (const name of names) {
      const [rows] = await connection.query<RowDataPacket[]>('SHOW CREATE TABLE ' + quote(name))
      let statement = rows[0]!['Create Table'] as string
      assert(statement.startsWith('CREATE TABLE ' + quote(name)))
      for (const original of names)
        statement = statement.replaceAll(quote(original), quote(settings.namespace + original))
      statement = statement.replace(
        /CONSTRAINT `([^`]+)`/g,
        (_, constraint) => 'CONSTRAINT ' + quote(settings.namespace + constraint),
      )
      statement = statement.replace(/ AUTO_INCREMENT=\d+/g, '')
      ddl[name] = statement
      // CREATE without IF NOT EXISTS rejects collisions instead of adopting another table.
      await connection.query(statement)
    }
    const [server] = await connection.query<RowDataPacket[]>(
      'SELECT VERSION() version, @@innodb_flush_log_at_trx_commit durable, @@sync_binlog sync_binlog',
    )
    await writeFile(
      path.join(settings.directory, 'database-schema.json'),
      JSON.stringify({ namespace: settings.namespace, server: server[0], ddl }, null, 2),
    )
    console.log(
      JSON.stringify({
        preparedTables: names.map((n) => settings.namespace + n),
        server: server[0],
      }),
    )
  } else if (operation === 'dump') {
    const documents: Record<string, unknown> = {}
    for (const name of names) {
      const [rows] = await connection.query(
        'SELECT * FROM ' + quote(settings.namespace + name) + ' ORDER BY id',
      )
      documents[name] = rows
    }
    await writeFile(
      path.join(settings.directory, 'persisted-results.json'),
      JSON.stringify(documents),
    )
    console.log('Saved isolated persisted result rows')
  } else if (operation === 'cleanup') {
    const proof = JSON.parse(
      await readFile(path.join(settings.directory, 'database-schema.json'), 'utf8'),
    )
    assert.equal(proof.namespace, settings.namespace)
    for (const name of [...names].reverse())
      await connection.query('DROP TABLE ' + quote(settings.namespace + name))
    console.log('Removed only the result tables created by this benchmark')
  } else {
    throw new Error('Unknown operation')
  }
} finally {
  await connection.end()
}
