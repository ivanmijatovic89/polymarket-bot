import mysql, { type Pool, type PoolOptions } from 'mysql2/promise'

export function createDatabasePool(config: PoolOptions): Pool {
  const pool = mysql.createPool(config)
  if (config.host !== '127.0.0.1') return pool

  // A new sandbox can briefly deny its first connection to the runtime tunnel.
  // Retry acquisition before any SQL is sent, never a query or transaction.
  const getConnection = pool.pool.getConnection.bind(pool.pool)
  pool.pool.getConnection = (callback) => {
    let attempts = 0
    const connect = () => {
      attempts += 1
      getConnection((error, connection) => {
        if (error?.code === 'EPERM' && error.syscall === 'connect' && attempts < 3) {
          setTimeout(connect, 250)
          return
        }
        callback(error, connection)
      })
    }
    connect()
  }
  return pool
}
