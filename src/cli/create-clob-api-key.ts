import { ClobClient } from '@polymarket/clob-client'
import { Wallet } from '@ethersproject/wallet'

function getArgValue(args: string[], names: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    for (const name of names) {
      if (a === name && i + 1 < args.length) return args[i + 1]
      if (a.startsWith(name + '=')) return a.slice(name.length + 1)
    }
  }
  return undefined
}

function usage(): void {
  console.log(
    [
      'Usage:',
      '  tsx src/cli/create-clob-api-key.ts --private-key <hex>',
      '  tsx src/cli/create-clob-api-key.ts <hex>',
      '',
      'Optional env:',
      '  CLOB_API_URL (default: https://clob.polymarket.com)',
      '  CLOB_CHAIN_ID (default: 137)',
    ].join('\n'),
  )
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const pk =
    getArgValue(args, ['--private-key', '--privateKey', '-k']) ??
    args.find((a) => !a.startsWith('-'))

  if (!pk) {
    usage()
    process.exit(2)
  }

  const host = process.env.CLOB_API_URL ?? 'https://clob.polymarket.com'
  const chainIdRaw = process.env.CLOB_CHAIN_ID ?? '137'
  const chainIdParsed = Number(chainIdRaw)
  const chainId = Number.isFinite(chainIdParsed) ? Math.trunc(chainIdParsed) : 137

  const wallet = new Wallet(pk)
  const client = new ClobClient(host, chainId, wallet)
  const creds = await client.createOrDeriveApiKey()

  const key = (creds as { key?: string; apiKey?: string }).key ?? (creds as { apiKey?: string }).apiKey
  const secret = (creds as { secret?: string }).secret
  const passphrase = (creds as { passphrase?: string }).passphrase

  if (!key || !secret || !passphrase) {
    throw new Error('[create-clob-api-key] Missing key/secret/passphrase in response')
  }

  console.log('# CLOB API credentials (save to your .env.botX)')
  console.log(`POLYMARKET_API_KEY=${key}`)
  console.log(`POLYMARKET_API_SECRET=${secret}`)
  console.log(`POLYMARKET_API_PASSPHRASE=${passphrase}`)
  console.log(`# EOA address: ${wallet.address}`)
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err)
  console.error('[create-clob-api-key] failed:', msg)
  process.exit(1)
})
