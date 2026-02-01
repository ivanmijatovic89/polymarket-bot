import type { BalanceAndApprovalResult, CheckBalanceAndApprovalOptions, UsdcBalanceResult } from './checkBalanceAndApproval.js'
import { checkUsdcBalance } from './checkBalanceAndApproval.js'

export type UsdcBalanceLite = Omit<UsdcBalanceResult, 'usdcBalanceRaw' | 'polBalanceRaw'> & {
  usdcBalanceRaw: string
  polBalanceRaw: string
}

export type BalanceSnapshot = {
  updatedAtMs: number
  reason: string
  eoa?: UsdcBalanceLite
  safe?: UsdcBalanceLite
  error?: string
}

export type BalanceTrackerOptions = {
  rpcUrl: string
  chainId?: number
  clobHost: string
  privateKey?: string
  safeAddress?: string
  cooldownMs?: number
  log?: (msg: string, extra?: unknown) => void
}

export type BalanceRefreshOptions = {
  force?: boolean
}

function toLite(r: UsdcBalanceResult): UsdcBalanceLite {
  return {
    ...r,
    usdcBalanceRaw: r.usdcBalanceRaw.toString(),
    polBalanceRaw: r.polBalanceRaw.toString(),
  }
}

function toLiteFromApprovalResult(r: BalanceAndApprovalResult): UsdcBalanceLite {
  return {
    address: r.address,
    usdcBalance: r.usdcBalance,
    usdcBalanceRaw: r.usdcBalanceRaw.toString(),
    polBalance: r.polBalance,
    polBalanceRaw: r.polBalanceRaw.toString(),
  }
}

export function createBalanceTracker(opts: BalanceTrackerOptions): {
  refresh: (reason: string, options?: BalanceRefreshOptions) => Promise<BalanceSnapshot | undefined>
  snapshot: () => BalanceSnapshot | undefined
  seedFromApprovalResult: (input: {
    reason: string
    updatedAtMs?: number
    eoa?: BalanceAndApprovalResult
    safe?: BalanceAndApprovalResult
  }) => BalanceSnapshot
} {
  let last: BalanceSnapshot | undefined
  let inFlight: Promise<BalanceSnapshot> | null = null
  const cooldownMs = Math.max(0, Math.trunc(opts.cooldownMs ?? 5000))

  const refresh = async (reason: string, options?: BalanceRefreshOptions): Promise<BalanceSnapshot | undefined> => {
    if (inFlight) return inFlight
    const nowMs = Date.now()
    if (!options?.force && last && nowMs - last.updatedAtMs < cooldownMs) return last

    const base: Omit<CheckBalanceAndApprovalOptions, 'privateKey' | 'addressOverride' | 'addressLabel'> = {
      rpcUrl: opts.rpcUrl,
      clobHost: opts.clobHost,
      ...(typeof opts.chainId === 'number' ? { chainId: opts.chainId } : {}),
    }

    inFlight = (async (): Promise<BalanceSnapshot> => {
      let eoa: BalanceAndApprovalLite | undefined
      let safe: BalanceAndApprovalLite | undefined
      let error: string | undefined

      if (opts.privateKey) {
        try {
          const res = await checkUsdcBalance({
            ...base,
            privateKey: opts.privateKey,
            addressLabel: 'EOA',
          })
          eoa = toLite(res)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          error = `eoa_check_failed: ${msg}`
          opts.log?.('[balance-tracker][⛔️] EOA check failed', { err: msg })
        }
      }

      if (opts.safeAddress) {
        try {
          const res = await checkUsdcBalance({
            ...base,
            addressOverride: opts.safeAddress,
            addressLabel: 'SAFE',
          })
          safe = toLite(res)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          error = error ? `${error}; safe_check_failed: ${msg}` : `safe_check_failed: ${msg}`
          opts.log?.('[balance-tracker][⛔️] SAFE check failed', { err: msg })
        }
      }

      if (!eoa && !safe && !error) {
        error = 'missing_privateKey_or_safeAddress'
      }

      const snap: BalanceSnapshot = {
        updatedAtMs: nowMs,
        reason,
        ...(eoa ? { eoa } : {}),
        ...(safe ? { safe } : {}),
        ...(error ? { error } : {}),
      }
      last = snap
      if (!error) {
        opts.log?.('[balance-tracker] refreshed', {
          reason,
          ...(eoa ? { eoa: { address: eoa.address, usdcBalance: eoa.usdcBalance, polBalance: eoa.polBalance } } : {}),
          ...(safe ? { safe: { address: safe.address, usdcBalance: safe.usdcBalance, polBalance: safe.polBalance } } : {}),
        })
      }
      return snap
    })()

    try {
      return await inFlight
    } finally {
      inFlight = null
    }
  }

  const snapshot = (): BalanceSnapshot | undefined => last

  const seedFromApprovalResult = (input: {
    reason: string
    updatedAtMs?: number
    eoa?: BalanceAndApprovalResult
    safe?: BalanceAndApprovalResult
  }): BalanceSnapshot => {
    const updatedAtMs = typeof input.updatedAtMs === 'number' ? input.updatedAtMs : Date.now()
    const snap: BalanceSnapshot = {
      updatedAtMs,
      reason: input.reason,
      ...(input.eoa ? { eoa: toLiteFromApprovalResult(input.eoa) } : {}),
      ...(input.safe ? { safe: toLiteFromApprovalResult(input.safe) } : {}),
    }
    last = snap
    return snap
  }

  return { refresh, snapshot, seedFromApprovalResult }
}
