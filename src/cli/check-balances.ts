import { loadPolymarketConfigFromEnv } from '../polymarket/config.js'
import { logBalanceAndApproval } from '../blockchain/checkBalanceAndApproval.js'

async function main(): Promise<void> {
  const cfg = loadPolymarketConfigFromEnv()
  const rpcUrl = process.env.POLYGON_RPC_URL ?? 'https://polygon-rpc.com'
  const splitMode = (process.env.POLYMARKET_TX_MODE_SPLIT ?? 'direct').toLowerCase()
  const safeFunder = cfg.clob.funder

  let eoaOk = true
  let safeOk = true

  try {
    await logBalanceAndApproval({
      rpcUrl,
      privateKey: cfg.privateKey,
      chainId: cfg.clob.chainId,
      clobHost: cfg.clob.host,
      addressLabel: 'EOA',
    })
  } catch (err) {
    eoaOk = false
    console.error('[check-balances] EOA check failed', err)
  }

  if (safeFunder) {
    try {
      await logBalanceAndApproval({
        rpcUrl,
        chainId: cfg.clob.chainId,
        clobHost: cfg.clob.host,
        addressOverride: safeFunder,
        addressLabel: 'SAFE',
      })
    } catch (err) {
      safeOk = false
      console.error('[check-balances] SAFE check failed', err)
    }
  }

  if (splitMode === 'relayer' && (!eoaOk || !safeOk)) {
    process.exit(1)
  }

  if (!eoaOk || (safeFunder && !safeOk)) {
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('[check-balances] fatal', err)
  process.exit(1)
})
