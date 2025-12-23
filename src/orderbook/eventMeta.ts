export type EventMeta =
  | {
      source: 'live'
      /** Local receipt time (ms since epoch) */
      tsLocalMs: bigint
      /** Connection attempt number from the WS source (best-effort). */
      attempt: number
    }
  | {
      source: 'parquet'
      filePath: string
      ingestSeq: bigint
      tsLocalMs: bigint
      tsExchangeMs?: bigint
    }

