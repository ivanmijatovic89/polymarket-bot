import { DuckDBInstance } from '@duckdb/node-api'

// One in-memory DuckDB per process, shared by every module that needs ad-hoc
// SQL over parquet/CSV (dump conversion, backtest feed loading, verification).
// Lazy so processes that never touch DuckDB pay nothing.
let dbPromise: Promise<DuckDBInstance> | undefined

export function getInMemoryDuckDb(): Promise<DuckDBInstance> {
  dbPromise ??= DuckDBInstance.create(':memory:')
  return dbPromise
}

/** Quote a string as a DuckDB SQL literal (single quotes doubled). */
export function sqlQuote(s: string): string {
  return `'${s.replaceAll("'", "''")}'`
}
