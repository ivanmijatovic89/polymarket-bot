import type { Address, Hex } from 'viem'
import type { DecodedChainEvent } from './decode.js'
import type { TokenMarket } from './discovery.js'

export type ActivityMarket = {
  marketId: number
  conditionId: Hex
}

export type ExactChainActivity = {
  type: 'SPLIT' | 'MERGE' | 'REDEEM' | 'CONVERSION' | 'TRANSFER'
  marketId: number | null
  conditionId: Hex | null
  tokenId: string | null
  outcomeIndex: number | null
  wallet: Address
  counterparty: Address | null
  operator: Address | null
  amountAtomic: bigint | null
  payoutAtomic: bigint | null
  indexSet: bigint | null
  blockNumber: bigint
  transactionHash: Hex
  transactionIndex: number
  logIndex: number
  contract: Hex
}

function stringArg(event: DecodedChainEvent, key: string): string {
  const value = event.args[key]
  if (typeof value !== 'string') throw new Error(`${event.eventName}.${key} is not a string`)
  return value
}

function addressArg(event: DecodedChainEvent, key: string): Address {
  const value = stringArg(event, key)
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`${event.eventName}.${key} is not an address`)
  }
  return value.toLowerCase() as Address
}

function bigintArg(event: DecodedChainEvent, key: string): bigint {
  const value = event.args[key]
  if (typeof value !== 'bigint') throw new Error(`${event.eventName}.${key} is not bigint`)
  return value
}

function hex32Arg(event: DecodedChainEvent, key: string): Hex {
  const value = stringArg(event, key)
  if (!/^0x[0-9a-fA-F]{64}$/.test(value))
    throw new Error(`${event.eventName}.${key} is not bytes32`)
  return value.toLowerCase() as Hex
}

function base(
  event: DecodedChainEvent,
): Pick<
  ExactChainActivity,
  'blockNumber' | 'transactionHash' | 'transactionIndex' | 'logIndex' | 'contract'
> {
  return {
    blockNumber: event.blockNumber,
    transactionHash: event.transactionHash,
    transactionIndex: event.transactionIndex,
    logIndex: event.logIndex,
    contract: event.contract,
  }
}

export function normalizeActivityEvent(
  event: DecodedChainEvent,
  conditionIndex: ReadonlyMap<string, ActivityMarket>,
  tokenIndex: ReadonlyMap<string, TokenMarket>,
): ExactChainActivity[] {
  if (event.eventName === 'PositionSplit' || event.eventName === 'PositionsMerge') {
    const conditionId = hex32Arg(event, 'conditionId')
    const market = conditionIndex.get(conditionId)
    if (!market) return []
    return [
      {
        ...base(event),
        type: event.eventName === 'PositionSplit' ? 'SPLIT' : 'MERGE',
        ...market,
        tokenId: null,
        outcomeIndex: null,
        wallet: addressArg(event, 'stakeholder'),
        counterparty: null,
        operator: null,
        amountAtomic: bigintArg(event, 'amount'),
        payoutAtomic: null,
        indexSet: null,
      },
    ]
  }
  if (event.eventName === 'PayoutRedemption') {
    const conditionId = hex32Arg(event, 'conditionId')
    const market = conditionIndex.get(conditionId)
    if (!market) return []
    return [
      {
        ...base(event),
        type: 'REDEEM',
        ...market,
        tokenId: null,
        outcomeIndex: null,
        wallet: addressArg(event, 'redeemer'),
        counterparty: null,
        operator: null,
        amountAtomic: null,
        payoutAtomic: bigintArg(event, 'payout'),
        indexSet: null,
      },
    ]
  }
  if (event.eventName === 'PositionsConverted') {
    return [
      {
        ...base(event),
        type: 'CONVERSION',
        marketId: null,
        conditionId: null,
        tokenId: null,
        outcomeIndex: null,
        wallet: addressArg(event, 'stakeholder'),
        counterparty: null,
        operator: null,
        amountAtomic: bigintArg(event, 'amount'),
        payoutAtomic: null,
        indexSet: bigintArg(event, 'indexSet'),
      },
    ]
  }
  if (event.eventName === 'TransferSingle') {
    const tokenId = bigintArg(event, 'id').toString()
    const market = tokenIndex.get(tokenId)
    if (!market) return []
    return [
      {
        ...base(event),
        type: 'TRANSFER',
        marketId: market.marketId,
        conditionId: market.conditionId,
        tokenId,
        outcomeIndex: market.outcomeIndex,
        wallet: addressArg(event, 'from'),
        counterparty: addressArg(event, 'to'),
        operator: addressArg(event, 'operator'),
        amountAtomic: bigintArg(event, 'value'),
        payoutAtomic: null,
        indexSet: null,
      },
    ]
  }
  if (event.eventName === 'TransferBatch') {
    const ids = event.args.ids
    const values = event.args.values
    if (!Array.isArray(ids) || !Array.isArray(values) || ids.length !== values.length) {
      throw new Error('TransferBatch ids/values are invalid')
    }
    const output: ExactChainActivity[] = []
    for (let i = 0; i < ids.length; i++) {
      if (typeof ids[i] !== 'bigint' || typeof values[i] !== 'bigint') {
        throw new Error('TransferBatch ids/values are not bigint arrays')
      }
      const tokenId = ids[i].toString()
      const market = tokenIndex.get(tokenId)
      if (!market) continue
      output.push({
        ...base(event),
        type: 'TRANSFER',
        marketId: market.marketId,
        conditionId: market.conditionId,
        tokenId,
        outcomeIndex: market.outcomeIndex,
        wallet: addressArg(event, 'from'),
        counterparty: addressArg(event, 'to'),
        operator: addressArg(event, 'operator'),
        amountAtomic: values[i],
        payoutAtomic: null,
        indexSet: null,
      })
    }
    return output
  }
  return []
}
