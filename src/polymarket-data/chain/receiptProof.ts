import { RLP } from '@ethereumjs/rlp'
import { createMPT } from '@ethereumjs/mpt'
import { bytesToHex, concatBytes, hexToBytes, type Hex } from 'viem'
import type { RpcLog, RpcReceipt } from './types.js'

function quantityBytes(value: Hex): Uint8Array {
  const n = BigInt(value)
  if (n === 0n) return new Uint8Array()
  let raw = n.toString(16)
  if (raw.length % 2 !== 0) raw = `0${raw}`
  return hexToBytes(`0x${raw}`)
}

function serializeLog(log: RpcLog): Array<Uint8Array | Uint8Array[]> {
  return [
    hexToBytes(log.address),
    log.topics.map((topic) => hexToBytes(topic)),
    hexToBytes(log.data),
  ]
}

export function serializeReceipt(receipt: RpcReceipt): Uint8Array {
  const statusOrRoot = receipt.status ? quantityBytes(receipt.status) : hexToBytes(receipt.root!)
  const payload = RLP.encode([
    statusOrRoot,
    quantityBytes(receipt.cumulativeGasUsed),
    hexToBytes(receipt.logsBloom),
    receipt.logs.map(serializeLog),
  ])
  const type = BigInt(receipt.type)
  if (type === 0n) return payload
  if (type > 0x7fn) throw new Error(`unsupported receipt type ${receipt.type}`)
  return concatBytes([new Uint8Array([Number(type)]), payload])
}

export async function calculateReceiptsRoot(receipts: RpcReceipt[]): Promise<Hex> {
  const sorted = [...receipts].sort((a, b) =>
    Number(BigInt(a.transactionIndex) - BigInt(b.transactionIndex)),
  )
  for (let i = 0; i < sorted.length; i++) {
    if (BigInt(sorted[i]!.transactionIndex) !== BigInt(i)) {
      throw new Error(`receipt transaction indexes are not contiguous at ${i}`)
    }
  }
  const trie = await createMPT()
  for (let i = 0; i < sorted.length; i++) {
    await trie.put(RLP.encode(i), serializeReceipt(sorted[i]!))
  }
  return bytesToHex(trie.root())
}
