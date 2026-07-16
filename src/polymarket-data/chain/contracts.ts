import { keccak256, parseAbiItem, toBytes, type Address, type Hex } from 'viem'

export type ChainContract = {
  name: 'ctf' | 'ctf_exchange' | 'neg_risk_ctf_exchange' | 'neg_risk_adapter'
  address: Address
  source: string
}

/**
 * Polygon mainnet addresses documented by Polymarket for the pUSD deployment.
 * Historical code-hash/deployment-block pinning is performed by the scanner;
 * this registry is never sufficient on its own to claim historical coverage.
 */
export const POLYMARKET_CONTRACTS: readonly ChainContract[] = [
  {
    name: 'ctf',
    address: '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045',
    source: 'https://docs.polymarket.com/resources/contracts',
  },
  {
    name: 'ctf_exchange',
    address: '0xE111180000d2663C0091e4f400237545B87B996B',
    source: 'https://docs.polymarket.com/resources/contracts',
  },
  {
    name: 'neg_risk_ctf_exchange',
    address: '0xe2222D279D744050d28E00520010520000310F59',
    source: 'https://docs.polymarket.com/resources/contracts',
  },
  {
    name: 'neg_risk_adapter',
    address: '0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296',
    source: 'https://docs.polymarket.com/resources/contracts',
  },
] as const

export const EXCHANGE_EVENTS = {
  orderFilled: parseAbiItem(
    'event OrderFilled(bytes32 indexed orderHash, address indexed maker, address indexed taker, uint8 side, uint256 tokenId, uint256 makerAmountFilled, uint256 takerAmountFilled, uint256 fee, bytes32 builder, bytes32 metadata)',
  ),
  ordersMatched: parseAbiItem(
    'event OrdersMatched(bytes32 indexed takerOrderHash, address indexed takerOrderMaker, uint8 side, uint256 tokenId, uint256 makerAmountFilled, uint256 takerAmountFilled)',
  ),
  feeCharged: parseAbiItem('event FeeCharged(address indexed receiver, uint256 amount)'),
} as const

export const CTF_EVENTS = {
  transferSingle: parseAbiItem(
    'event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)',
  ),
  transferBatch: parseAbiItem(
    'event TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values)',
  ),
  positionSplit: parseAbiItem(
    'event PositionSplit(address indexed stakeholder, address collateralToken, bytes32 indexed parentCollectionId, bytes32 indexed conditionId, uint256[] partition, uint256 amount)',
  ),
  positionsMerge: parseAbiItem(
    'event PositionsMerge(address indexed stakeholder, address collateralToken, bytes32 indexed parentCollectionId, bytes32 indexed conditionId, uint256[] partition, uint256 amount)',
  ),
  payoutRedemption: parseAbiItem(
    'event PayoutRedemption(address indexed redeemer, address indexed collateralToken, bytes32 indexed parentCollectionId, bytes32 conditionId, uint256[] indexSets, uint256 payout)',
  ),
} as const

export function eventTopic(signature: string): Hex {
  return keccak256(toBytes(signature))
}
