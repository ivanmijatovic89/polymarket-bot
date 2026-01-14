import { Contract, JsonRpcProvider, Wallet, parseUnits } from 'ethers'

import { loadPolymarketConfigFromEnv } from '../polymarket/config.js'
import { USDC_ADDRESS } from '../polymarket/contractAddresses.js'
import {
  approveViaRelayer,
  deploySafeIfNeeded,
  getExpectedSafeAddress,
  withdrawUsdcViaRelayer,
} from '../polymarket/relayerClient.js'

const ERC20_TRANSFER_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
] as const

function readArg(name: string, args: string[]): string | undefined {
  const idx = args.indexOf(name)
  if (idx === -1) return undefined
  return args[idx + 1]
}

async function depositUsdcFromEoa(args: string[]): Promise<void> {
  const to = readArg('--to', args)
  const amountRaw = readArg('--amount', args)
  const gasPriceGweiRaw = readArg('--gas-price-gwei', args)
  const nonceRaw = readArg('--nonce', args)
  if (!to || !amountRaw) {
    throw new Error('[relayer] deposit-usdc requires --to and --amount')
  }
  const amount = Number(amountRaw)
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('[relayer] invalid --amount')
  }
  let gasPriceGwei: number | undefined
  if (gasPriceGweiRaw) {
    const parsed = Number(gasPriceGweiRaw)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error('[relayer] invalid --gas-price-gwei')
    }
    gasPriceGwei = parsed
  }
  let nonce: number | undefined
  if (nonceRaw) {
    const parsed = Number(nonceRaw)
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new Error('[relayer] invalid --nonce')
    }
    nonce = parsed
  }
  const cfg = loadPolymarketConfigFromEnv()
  if (!cfg.privateKey) {
    throw new Error('[relayer] missing PRIVATE_KEY (or POLYMARKET_PRIVATE_KEY)')
  }
  const rpcUrl = process.env.POLYGON_RPC_URL ?? 'https://polygon-rpc.com'
  const provider = new JsonRpcProvider(rpcUrl, cfg.clob.chainId, { staticNetwork: true })
  const wallet = new Wallet(cfg.privateKey, provider)
  const usdc = new Contract(USDC_ADDRESS, ERC20_TRANSFER_ABI, wallet) as unknown as {
    transfer: (
      to: string,
      amount: bigint,
      overrides?: { gasPrice?: bigint; nonce?: number },
    ) => Promise<{ wait: () => Promise<{ hash?: string }>; hash: string; nonce: number }>
  }
  const amountUnits = parseUnits(String(amount), 6)
  const overrides: { gasPrice?: bigint; nonce?: number } = {}
  if (gasPriceGwei !== undefined) {
    overrides.gasPrice = parseUnits(String(gasPriceGwei), 9)
  }
  if (nonce !== undefined) {
    overrides.nonce = nonce
  }
  if (overrides.gasPrice === undefined) {
    const feeData = await provider.getFeeData()
    if (feeData.gasPrice) {
      // Use a higher default gas price to avoid stuck txs on Polygon.
      overrides.gasPrice = feeData.gasPrice * 2n
    }
  }
  const tx = await usdc.transfer(to, amountUnits, overrides)
  console.log('[relayer][deposit-usdc] submitted txHash=', tx.hash)
  const receipt = await Promise.race([
    tx.wait(),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 60_000)),
  ])
  if (receipt?.hash) {
    console.log('[relayer][deposit-usdc] confirmed txHash=', receipt.hash)
  } else {
    console.log('[relayer][deposit-usdc] still pending after 60s; check explorer for', tx.hash)
  }
}

async function withdrawUsdcToEoa(args: string[]): Promise<void> {
  const to = readArg('--to', args)
  const amountRaw = readArg('--amount', args)
  if (!to || !amountRaw) {
    throw new Error('[relayer] withdraw-usdc requires --to and --amount')
  }
  const amount = Number(amountRaw)
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('[relayer] invalid --amount')
  }
  const res = await withdrawUsdcViaRelayer({ to, amount })
  console.log('[relayer][withdraw-usdc] txHash=', res.txHash)
}

async function approveRelayer(): Promise<void> {
  const cfg = loadPolymarketConfigFromEnv()
  const res = await approveViaRelayer({ clobHost: cfg.clob.host, chainId: cfg.clob.chainId })
  console.log('[relayer][approve] txHash=', res.txHash)
}

async function deploySafe(): Promise<void> {
  const res = await deploySafeIfNeeded()
  if (!res) {
    console.log('[relayer][deploy-safe] no result')
    return
  }
  console.log('[relayer][deploy-safe] proxyAddress=', res.proxyAddress)
  console.log('[relayer][deploy-safe] txHash=', res.transactionHash)
}

async function showSafe(): Promise<void> {
  const cfg = loadPolymarketConfigFromEnv()
  if (cfg.clob.funder) {
    console.log('[relayer][show-safe] safeAddress=', cfg.clob.funder)
    return
  }
  const expected = await getExpectedSafeAddress()
  console.log('[relayer][show-safe] safeAddress=', expected)
  console.log('[relayer][show-safe] Tip: set CLOB_FUNDER to this address')
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const cmd = args[0]
  if (!cmd) {
    throw new Error('[relayer] missing command (deploy-safe|show-safe|approve|withdraw-usdc|deposit-usdc)')
  }
  if (cmd === 'deploy-safe') {
    await deploySafe()
    return
  }
  if (cmd === 'show-safe') {
    await showSafe()
    return
  }
  if (cmd === 'approve') {
    await approveRelayer()
    return
  }
  if (cmd === 'withdraw-usdc') {
    await withdrawUsdcToEoa(args)
    return
  }
  if (cmd === 'deposit-usdc') {
    await depositUsdcFromEoa(args)
    return
  }
  throw new Error(`[relayer] unknown command: ${cmd}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
