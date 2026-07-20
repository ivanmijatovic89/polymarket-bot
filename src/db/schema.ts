import {
  mysqlTable,
  text,
  longtext,
  varchar,
  decimal,
  double,
  timestamp,
  datetime,
  date,
  boolean,
  json,
  int,
  bigint,
  mysqlEnum,
  unique,
  index,
} from 'drizzle-orm/mysql-core'

// Markets table
export const markets = mysqlTable('markets', {
  id: int('id').primaryKey().autoincrement(), // Auto-increment primary key
  polymarketId: varchar('polymarket_id', { length: 255 }).notNull().unique(), // Polymarket market ID (e.g., "996575")
  slug: varchar('slug', { length: 255 }).notNull().unique(), // Market slug (e.g., "btc-updown-15m-1766524500")
  symbol: varchar('symbol', { length: 10 }).notNull(), // Symbol extracted from folder path (e.g., "btc", "eth", "sol")
  dataset: text('dataset'),

  conditionId: text('condition_id'), // Blockchain condition ID
  outcomes: json('outcomes').$type<string[]>().notNull(), // Array of outcome strings (e.g., ["Up", "Down"])
  outcomePrices: json('outcome_prices').$type<string[] | number[]>(), // Array of outcome prices (e.g., ["0", "1"] or [0, 1])
  resolvedOutcome: text('resolved_outcome'), // Winning outcome (e.g., "Up" or "Down") - null if not resolved yet
  endDate: timestamp('end_date'), // Market resolution end date
  startDate: timestamp('start_date'), // Market start date
  startDateIso: text('start_date_iso'), // ISO date string from API (e.g., "2024-01-01T00:00:00Z")
  umaResolutionStatus: text('uma_resolution_status'), // UMA resolution status (e.g., "resolved", "pending")
  clobTokenIds: json('clob_token_ids').$type<string[]>(), // Array of CLOB token IDs for each outcome
  active: boolean('active').default(false).notNull(),
  closed: boolean('closed').default(false).notNull(),
  volume: decimal('volume'), // Trading volume
  question: text('question').notNull(), // Market question/title
  rawJson: json('raw_json').$type<Record<string, unknown>>(), // Complete API response as JSON
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// PMXT dataset catalogue
export const pmxtDatasetCatalogue = mysqlTable('pmxt_dataset_catalogue', {
  id: int('id').primaryKey().autoincrement(),
  version: varchar('version', { length: 4 }).notNull(),
  filename: varchar('filename', { length: 100 }).notNull().unique(),
  url: varchar('url', { length: 255 }).notNull(),
  hourTs: datetime('hour_ts').notNull(),
  symbol: varchar('symbol', { length: 10 }).notNull(),
  status: mysqlEnum('status', [
    'pending',
    'downloading',
    'converting',
    'done',
    'master_done',
    'failed',
  ])
    .notNull()
    .default('pending'),
  outDir: varchar('out_dir', { length: 255 }),
  slugs: json('slugs').$type<string[]>(),
  windowsWritten: int('windows_written'),
  sourceSizeMb: decimal('source_size_mb', { precision: 10, scale: 2 }),
  error: text('error'),
  startedAt: timestamp('started_at'),
  finishedAt: timestamp('finished_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// PMXT slug → conditionId resolution cache (avoids re-hitting Gamma)
export const pmxtSlugCache = mysqlTable('pmxt_slug_cache', {
  slug: varchar('slug', { length: 100 }).primaryKey(),
  symbol: varchar('symbol', { length: 10 }).notNull(),
  conditionId: varchar('condition_id', { length: 66 }).notNull(),
  tokenIds: json('token_ids').$type<string[]>().notNull(),
  windowStart: datetime('window_start').notNull(),
  resolvedAt: timestamp('resolved_at').defaultNow().notNull(),
})

// Backtest result storage.
//
// `backtest_runs` stores run identity, CLI metadata, lifecycle, and audit
// fields. Computed performance stats live in `backtest_run_segments`; the
// full-run totals are the `all` segment.
export const backtestRuns = mysqlTable(
  'backtest_runs',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().autoincrement(),
    // Human-chosen label grouping related runs (e.g. every cell of one param
    // sweep). NOT unique — many runs may share it. Defaults to submissionUid
    // when the CLI is run without --batchUid.
    batchUid: varchar('batch_uid', { length: 255 }).notNull(),
    // Internal per-submission identity (auto-UUID). Unique. Keys the BullMQ
    // flow (job ids) that produced/extended this run. Never user-chosen.
    submissionUid: varchar('submission_uid', { length: 255 }).notNull(),
    status: mysqlEnum('status', ['completed', 'partial', 'failed']).notNull(),

    strategy: varchar('strategy', { length: 255 }).notNull(),
    params: json('params').$type<Record<string, unknown>>().notNull(),

    symbol: varchar('symbol', { length: 10 }),
    timeframe: varchar('timeframe', { length: 16 }),
    inputMode: varchar('input_mode', { length: 32 }),
    converter: varchar('converter', { length: 32 }),
    readFrom: varchar('read_from', { length: 40 }),
    slugs: json('slugs').$type<string[] | null>(),
    limit: int('limit'),
    random: boolean('random').default(false).notNull(),
    latest: boolean('latest').default(false).notNull(),

    baselineId: varchar('baseline_id', { length: 255 }),
    cmd: longtext('cmd'),
    comment: text('comment'),

    inputMarketsTotal: int('input_markets_total'),
    marketsPersisted: int('markets_persisted').notNull().default(0),
    failuresCount: int('failures_count').notNull().default(0),

    capitalInitial: decimal('capital_initial', { precision: 14, scale: 4 }).notNull(),

    // Set when a `--extend <runId>` invocation has enqueued an extension
    // batch but the aggregateProcessor hasn't merged it yet. Cleared in the
    // same DB transaction as the merge UPDATE. While set, a second concurrent
    // `--extend` on this run is rejected with a clear error. NULL during
    // normal life, NULL after extend completes or fails.
    //
    // If a process crashes mid-extend, this stays set. Manual recovery:
    //   UPDATE backtest_runs SET extending_at = NULL WHERE id = <runId>;
    extendingAt: timestamp('extending_at'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    batchUidIdx: index('idx_backtest_runs_batch_uid').on(t.batchUid),
    submissionUidUnique: unique('uniq_backtest_runs_submission_uid').on(t.submissionUid),
    createdAtIdx: index('idx_backtest_runs_created_at').on(t.createdAt),
    strategyCreatedAtIdx: index('idx_backtest_runs_strategy_created_at').on(
      t.strategy,
      t.createdAt,
    ),
    symbolCreatedAtIdx: index('idx_backtest_runs_symbol_created_at').on(t.symbol, t.createdAt),
  }),
)

export const backtestRunMarkets = mysqlTable(
  'backtest_run_markets',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().autoincrement(),
    runId: bigint('run_id', { mode: 'number' })
      .notNull()
      .references(() => backtestRuns.id, { onDelete: 'cascade' }),
    idx: int('idx').notNull(),

    marketId: varchar('market_id', { length: 255 }).notNull(),
    slug: varchar('slug', { length: 255 }).notNull(),
    // Denormalized at insert time so segmenting (last_n / daily / weekly /
    // monthly buckets in `backtest_run_segments`) can sort/group without
    // re-parsing slugs or joining `telonex_markets`. For recorded mode this
    // is `slugTs(slug)`; for Telonex mode it's `telonex_markets.market_start_ms`.
    marketStartMs: bigint('market_start_ms', { mode: 'number' }).notNull(),
    finalOutcome: mysqlEnum('final_outcome', ['UP', 'DOWN']).notNull(),
    skipReason: mysqlEnum('skip_reason', ['no_in_window_activity']),

    pnl: decimal('pnl', { precision: 14, scale: 4 }).notNull(),
    tradeCount: int('trade_count').notNull(),
    tradeAsMaker: int('trade_as_maker').notNull(),
    tradeAsTaker: int('trade_as_taker').notNull(),
    feesPaid: decimal('fees_paid', { precision: 14, scale: 4 }).notNull(),

    avgEntryPriceUp: decimal('avg_entry_price_up', { precision: 10, scale: 6 }),
    avgEntryPriceDown: decimal('avg_entry_price_down', { precision: 10, scale: 6 }),
    upShares: decimal('up_shares', { precision: 18, scale: 6 }).notNull(),
    downShares: decimal('down_shares', { precision: 18, scale: 6 }).notNull(),
    mergableShares: decimal('mergable_shares', { precision: 18, scale: 6 }).notNull(),
    cost: decimal('cost', { precision: 14, scale: 4 }).notNull(),
    splitCost: decimal('split_cost', { precision: 14, scale: 4 }).notNull(),

    intentMeta: json('intent_meta').$type<Array<Record<string, unknown>>>().notNull(),

    machineId: varchar('machine_id', { length: 32 }),
    workerChildId: int('worker_child_id'),
    startedAtMs: bigint('started_at_ms', { mode: 'number' }),
    finishedAtMs: bigint('finished_at_ms', { mode: 'number' }),
    durationMs: int('duration_ms'),
    eventsProcessed: int('events_processed'),
    eventsByType: json('events_by_type').$type<Record<string, number> | null>(),
    commitSha: varchar('commit_sha', { length: 64 }),
  },
  (t) => ({
    runIdxUnique: unique('uniq_backtest_run_markets_run_idx').on(t.runId, t.idx),
    // UNIQUE rather than plain index: schema-level guarantee that no slug is
    // inserted twice for the same run. Backstop against any code path (most
    // notably stalled-aggregate-job recovery for --extend) that could
    // re-apply the same set of markets. applyExtensionToRun ALSO checks for
    // overlap inside the transaction and no-ops if all incoming slugs already
    // exist; this constraint is the last line of defense.
    runSlugUnique: unique('uniq_backtest_run_markets_run_slug').on(t.runId, t.slug),
    runPnlIdx: index('idx_backtest_run_markets_run_pnl').on(t.runId, t.pnl),
    slugIdx: index('idx_backtest_run_markets_slug').on(t.slug),
    runDurationIdx: index('idx_backtest_run_markets_run_duration').on(t.runId, t.durationMs),
    machineIdIdx: index('idx_backtest_run_markets_machine_id').on(t.machineId),
    runMarketStartMsIdx: index('idx_backtest_run_markets_run_market_start_ms').on(
      t.runId,
      t.marketStartMs,
    ),
  }),
)

// Per-segment stats for each backtest run. Replaces the previous
// `backtest_runs.chunked_batch_stats` JSON column. One row per
// (run, segment_kind, segment_key). Segment kinds:
//
//   all     — single row over the whole run. This is the source of truth for
//             run-level performance stats.
//   last_n  — most recent N markets (sorted by market_start_ms desc). Emitted
//             only when total markets >= N. segment_key = '500' / '1000' / etc.
//             segment_ord = N (sort key across last_n rows).
//   daily   — calendar-day buckets (UTC). segment_key = 'YYYY-MM-DD'.
//   weekly  — ISO-week buckets. segment_key = 'YYYY-Www'.
//   monthly — calendar-month buckets (UTC). segment_key = 'YYYY-MM'.
//
// For date kinds, segment_ord = start_ms of the bucket — gives one ORDER BY
// that works across all kinds.
export const backtestRunSegments = mysqlTable(
  'backtest_run_segments',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().autoincrement(),
    runId: bigint('run_id', { mode: 'number' })
      .notNull()
      .references(() => backtestRuns.id, { onDelete: 'cascade' }),
    segmentKind: mysqlEnum('segment_kind', [
      'all',
      'last_n',
      'daily',
      'weekly',
      'monthly',
    ]).notNull(),
    segmentKey: varchar('segment_key', { length: 32 }).notNull(),
    segmentOrd: bigint('segment_ord', { mode: 'number' }).notNull(),

    fromMs: bigint('from_ms', { mode: 'number' }).notNull(),
    toMs: bigint('to_ms', { mode: 'number' }).notNull(),

    capitalInitial: decimal('capital_initial', { precision: 14, scale: 4 }).notNull(),
    capitalFinal: decimal('capital_final', { precision: 14, scale: 4 }).notNull(),
    pnlTotal: decimal('pnl_total', { precision: 14, scale: 4 }).notNull(),
    totalFeesPaid: decimal('total_fees_paid', { precision: 14, scale: 4 }).notNull(),
    qualitySystem: decimal('quality_system', { precision: 14, scale: 6 }),
    qualityTrade: decimal('quality_trade', { precision: 14, scale: 6 }),
    evPerMarketPlayed: decimal('ev_per_market_played', { precision: 14, scale: 4 }).notNull(),
    evPerMarketTotal: decimal('ev_per_market_total', { precision: 14, scale: 4 }).notNull(),

    marketsTotal: int('markets_total').notNull(),
    marketsSkipped: int('markets_skipped').notNull(),
    marketsNoInWindowActivity: int('markets_no_in_window_activity').notNull(),
    marketsFlatWithTrades: int('markets_flat_with_trades').notNull(),
    marketsPlayed: int('markets_played').notNull(),
    marketsWon: int('markets_won').notNull(),
    marketsLost: int('markets_lost').notNull(),

    winRate: decimal('win_rate', { precision: 10, scale: 6 }).notNull(),
    winRatePct: decimal('win_rate_pct', { precision: 10, scale: 4 }).notNull(),
    tradesTotal: int('trades_total').notNull(),
    tradesMaker: int('trades_maker').notNull(),
    tradesTaker: int('trades_taker').notNull(),

    pnlAvgWin: decimal('pnl_avg_win', { precision: 14, scale: 4 }).notNull(),
    pnlAvgLose: decimal('pnl_avg_lose', { precision: 14, scale: 4 }).notNull(),
    pnlMaxWin: decimal('pnl_max_win', { precision: 14, scale: 4 }).notNull(),
    pnlMaxLose: decimal('pnl_max_lose', { precision: 14, scale: 4 }).notNull(),
    streakMaxWin: int('streak_max_win').notNull(),
    streakMaxLose: int('streak_max_lose').notNull(),
    streakMaxWinPnl: decimal('streak_max_win_pnl', { precision: 14, scale: 4 }).notNull(),
    streakMaxLosePnl: decimal('streak_max_lose_pnl', { precision: 14, scale: 4 }).notNull(),
    streakMaxSkipped: int('streak_max_skipped').notNull(),

    // Backtest compute cost for the markets in this segment. Nullable: rows
    // written before these columns existed were backfilled once (migrations
    // 0025/0026); new runs + `--extend` populate them via computeBatchStats.
    // `durationTotalMs` = sum of per-market compute time (total CPU, not
    // wall-clock — markets run in parallel); `durationAvgMs` = mean over
    // markets that recorded a duration.
    durationTotalMs: bigint('duration_total_ms', { mode: 'number' }),
    durationAvgMs: decimal('duration_avg_ms', { precision: 14, scale: 2 }),
    // Real elapsed span (max finished − min started). For the `all` segment
    // this is the run's true wall-clock; includes idle gaps on `--extend` runs.
    durationWallClockMs: bigint('duration_wall_clock_ms', { mode: 'number' }),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => ({
    runKindKeyUnique: unique('uniq_backtest_run_segments_run_kind_key').on(
      t.runId,
      t.segmentKind,
      t.segmentKey,
    ),
    kindKeyIdx: index('idx_backtest_run_segments_kind_key').on(t.segmentKind, t.segmentKey),
    runKindOrdIdx: index('idx_backtest_run_segments_run_kind_ord').on(
      t.runId,
      t.segmentKind,
      t.segmentOrd,
    ),
  }),
)

export const backtestRunFailures = mysqlTable(
  'backtest_run_failures',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().autoincrement(),
    runId: bigint('run_id', { mode: 'number' })
      .notNull()
      .references(() => backtestRuns.id, { onDelete: 'cascade' }),
    jobId: varchar('job_id', { length: 255 }),
    idx: int('idx'),
    slug: varchar('slug', { length: 255 }),
    reason: text('reason').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => ({
    runIdx: index('idx_backtest_run_failures_run_idx').on(t.runId, t.idx),
    runSlug: index('idx_backtest_run_failures_run_slug').on(t.runId, t.slug),
  }),
)

// ---------------------------------------------------------------------------
// Telonex sync pipeline — see docs/datasets/telonex/sync-design.md
// ---------------------------------------------------------------------------

// Telonex catalog row + local pipeline state (Step 1 upload).
//
// Ground truth for market window time is the slug suffix. `market_start_ms`,
// `symbol`, and `timeframe` are derived from the slug at sync time and kept
// as indexed columns so queries don't have to parse the slug. Telonex's own
// `start_date_us` / `end_date_us` columns are kept for backward compatibility
// but represent something other than the trading window — verified
// empirically that `start_date_us` differs from the slug epoch in 100% of
// rows (avg ~22h earlier, likely creation/announcement time), while
// `end_date_us` matches the slug epoch + timeframe deterministically. Always
// use `market_start_ms` and `timeframe` for ordering/filtering by market
// time; never use `start_date_us` for that purpose.
export const telonexMarkets = mysqlTable(
  'telonex_markets',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().autoincrement(),

    // Telonex catalog (full schema mirror)
    exchange: varchar('exchange', { length: 20 }).notNull(),
    marketId: varchar('market_id', { length: 66 }).notNull(),
    slug: varchar('slug', { length: 100 }).notNull().unique(),

    // Derived from slug at sync time (ground truth, indexed)
    symbol: varchar('symbol', { length: 10 }).notNull(),
    timeframe: varchar('timeframe', { length: 16 }).notNull(),
    marketStartMs: bigint('market_start_ms', { mode: 'number' }).notNull(),
    eventId: varchar('event_id', { length: 100 }),
    eventSlug: varchar('event_slug', { length: 100 }),
    eventTitle: varchar('event_title', { length: 255 }),
    question: text('question'),
    description: text('description'),
    category: varchar('category', { length: 100 }),
    tags: json('tags').$type<string[]>(),
    outcome0: varchar('outcome_0', { length: 20 }),
    outcome1: varchar('outcome_1', { length: 20 }),
    assetId0: varchar('asset_id_0', { length: 80 }),
    assetId1: varchar('asset_id_1', { length: 80 }),
    telonexStatus: varchar('telonex_status', { length: 20 }),
    resultId: varchar('result_id', { length: 10 }),
    settledAtUs: bigint('settled_at_us', { mode: 'number' }),
    preparedAtUs: bigint('prepared_at_us', { mode: 'number' }),
    startDateUs: bigint('start_date_us', { mode: 'number' }),
    endDateUs: bigint('end_date_us', { mode: 'number' }),
    createdAtUs: bigint('created_at_us', { mode: 'number' }),
    resolutionSource: varchar('resolution_source', { length: 255 }),
    rulesUrl: varchar('rules_url', { length: 255 }),
    tradesFrom: date('trades_from'),
    tradesTo: date('trades_to'),
    quotesFrom: date('quotes_from'),
    quotesTo: date('quotes_to'),
    bookSnapshot5From: date('book_snapshot_5_from'),
    bookSnapshot5To: date('book_snapshot_5_to'),
    bookSnapshot25From: date('book_snapshot_25_from'),
    bookSnapshot25To: date('book_snapshot_25_to'),
    bookSnapshotFullFrom: date('book_snapshot_full_from'),
    bookSnapshotFullTo: date('book_snapshot_full_to'),
    onchainFillsFrom: date('onchain_fills_from'),
    onchainFillsTo: date('onchain_fills_to'),

    // Gamma `events[].eventMetadata` (backfilled by
    // `telonex:sync-pricetobeat-and-final-price`, NOT by telonex
    // sync — Gamma is the only bulk-history source; see
    // docs/datasets/data-coverage.md for the field epoch boundaries).
    // `priceToBeat` = Chainlink open/strike of the window (exists ~2026-02-19+),
    // `finalPrice`  = Chainlink settle price (exists ~2026-03-21+).
    // `gammaMetadataSyncedAt` records that a fetch was ATTEMPTED — a synced row
    // with NULL prices means Gamma genuinely has no data for that market, so
    // the backfill never re-fetches it.
    priceToBeat: double('price_to_beat'),
    finalPrice: double('final_price'),
    gammaMetadataSyncedAt: timestamp('gamma_metadata_synced_at'),

    // Local pipeline state (Step 1)
    uploadStatus: mysqlEnum('upload_status', ['pending', 'processing', 'done', 'partial', 'failed'])
      .notNull()
      .default('pending'),
    filesUploaded: int('files_uploaded').notNull().default(0),
    lastError: text('last_error'),
    syncedAt: timestamp('synced_at').defaultNow().notNull(),
    processedAt: timestamp('processed_at'),
  },
  (t) => ({
    symbolTfStartIdx: index('idx_telonex_markets_symbol_tf_start').on(
      t.symbol,
      t.timeframe,
      t.marketStartMs,
    ),
    tfStartIdx: index('idx_telonex_markets_tf_start').on(t.timeframe, t.marketStartMs),
    // Supports the download claim's candidate read: walk claimable rows
    // (upload_status) in market_start_ms order without a filesort. The previous
    // single-column upload_status index could not satisfy the ORDER BY.
    uploadStatusStartIdx: index('idx_telonex_markets_upload_status_start').on(
      t.uploadStatus,
      t.marketStartMs,
    ),
  }),
)

// Raw files uploaded to R2 (Step 1 output, one row per source parquet).
// Created lazily by the download-raw-files worker, not by sync.
export const telonexMarketFiles = mysqlTable(
  'telonex_market_files',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().autoincrement(),
    slug: varchar('slug', { length: 100 }).notNull(),
    channel: varchar('channel', { length: 40 }).notNull(),
    date: date('date').notNull(),
    assetId: varchar('asset_id', { length: 80 }).notNull(),
    r2Key: varchar('r2_key', { length: 255 }).notNull(),
    r2Etag: varchar('r2_etag', { length: 64 }),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    status: mysqlEnum('status', ['uploaded', 'no_file', 'failed']).notNull(),
    attempts: int('attempts').notNull().default(0),
    lastError: text('last_error'),
    startedAt: timestamp('started_at'),
    uploadedAt: timestamp('uploaded_at'),
  },
  (t) => ({
    uniqFile: unique('uniq_telonex_market_files').on(t.slug, t.channel, t.date, t.assetId),
    slugIdx: index('idx_telonex_market_files_slug').on(t.slug),
  }),
)

// Converted parquet per (market, converter) — Step 2 output.
export const telonexMarketConversions = mysqlTable(
  'telonex_market_conversions',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().autoincrement(),
    marketId: bigint('market_id', { mode: 'number' }).notNull(),
    converter: varchar('converter', { length: 40 }).notNull(),
    status: mysqlEnum('status', ['pending', 'in_progress', 'done', 'failed'])
      .notNull()
      .default('pending'),
    r2Url: varchar('r2_url', { length: 255 }),
    localPath: varchar('local_path', { length: 255 }),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    etag: varchar('etag', { length: 64 }),
    attempts: int('attempts').notNull().default(0),
    lastError: text('last_error'),
    startedAt: timestamp('started_at'),
    completedAt: timestamp('completed_at'),
  },
  (t) => ({
    uniqConversion: unique('uniq_telonex_market_conversions').on(t.marketId, t.converter),
    marketIdx: index('idx_telonex_market_conversions_market').on(t.marketId),
  }),
)
