# Cloudflare Workers + R2 Migration Analysis

## Executive Summary

**Verdict: Partial compatibility with significant refactoring required**

- ✅ **Compatible**: Strategy logic, orderbook processing, portfolio management, backtest execution simulation
- ⚠️ **Requires Refactoring**: Parquet I/O, WebSocket connections, file system operations
- ❌ **Not Compatible**: Long-running processes, Node.js-specific APIs, `ws` library, `blessed` TUI

**Recommendation**: Use a **hybrid architecture**:
- **Cloudflare Workers**: API endpoints, stateless strategy evaluation, batch job orchestration
- **Cloudflare R2**: Parquet file storage (zero-egress pricing)
- **Cloudflare Compute (or dedicated VM)**: Long-running WebSocket connections, recording, live trading
- **Workers Durable Objects**: Optional for maintaining WebSocket state if needed

---

## 1. Components Compatible with Cloudflare Workers

### ✅ Fully Compatible (No Changes Needed)

**Core Business Logic:**
- `src/market/MarketEngine.ts` - Orderbook state management
- `src/market/orderbook/*` - Orderbook data structures and algorithms
- `src/strategy/Strategy.ts` - Strategy interface and implementations
- `src/strategy/StrategyRunner.ts` - Strategy orchestration
- `src/trading/Portfolio.ts` - Portfolio state management
- `src/trading/OrderManager.ts` - Order intent queuing and validation
- `src/trading/riskLimits.ts` - Risk limit enforcement
- `src/trading/execution/BacktestExecution.ts` - Backtest simulation logic
- `src/backtest/stats/*` - Statistics computation
- `src/utils/*` - Utility functions (minHeap, timeWindows, etc.)

**Why Compatible:**
- Pure TypeScript/JavaScript logic
- No file system dependencies
- No Node.js-specific APIs
- Stateless or easily made stateless

### ⚠️ Compatible with Refactoring

**Parquet Reading (Backtesting):**
- `src/cli/backtest.ts` - Core replay logic is compatible
- **Issue**: `@dsnp/parquetjs` uses `ParquetReader.openFile(filePath)` which expects file paths
- **Solution**: Need to adapt to read from R2 using `fetch()` and stream the data, or find a Parquet library that supports streams/ArrayBuffers

**HTTP API Calls:**
- `src/polymarket/resolveUpDown15mAssets.ts` - Gamma API calls
- `src/polymarket/restPollAccountSource.ts` - REST polling
- **Solution**: Replace `fetch` calls if needed (Workers has native `fetch`)

---

## 2. Components NOT Compatible with Cloudflare Workers

### ❌ File System Operations

**Files Affected:**
- `src/parquet/io/eventWriter.ts` - Uses `fs/promises` (mkdir, rename, stat, unlink)
- `src/parquet/cli/list-backtest-files.ts` - Uses `fs.readdir`, `path.resolve`
- `src/parquet/cli/scan-disconnect-events.ts` - Uses `fs.readdir`, recursive directory walking
- `src/parquet/cli/verify-parquet.ts` - Uses `fs.stat`

**Node.js APIs Used:**
```typescript
import { mkdir, rename, stat, unlink } from 'node:fs/promises'
import path from 'node:path'
```

**Workers Limitation:**
- No file system access
- No `fs` module
- No `path` module (though path manipulation can be done manually)

**Migration Path:**
- Replace all file operations with R2 API calls (`@cloudflare/workers-types`)
- Use R2's `put()`, `get()`, `list()`, `delete()` methods
- Replace `path.join()` with string concatenation or URL construction

### ❌ WebSocket Library (`ws`)

**Files Affected:**
- `src/polymarket/ws/wsConnection.ts` - Uses `ws` npm package
- `src/polymarket/ws/marketWs.ts` - WebSocket client wrapper
- `src/polymarket/ws/userWsAccountSource.ts` - User WebSocket
- `src/polymarket/liveMarketEventSource.ts` - Market event source

**Current Implementation:**
```typescript
import WebSocket, { type ClientOptions, type RawData } from 'ws'
const ws = new WebSocket(opts.url, opts.wsOptions)
```

**Workers Limitation:**
- Workers support WebSocket **server** connections (incoming), not **client** connections (outgoing)
- The `ws` npm library is Node.js-specific and won't work in Workers
- Workers can use `fetch()` with `Upgrade: websocket` header, but this is complex and not well-supported

**Migration Path:**
- **Option 1**: Use Cloudflare **Durable Objects** with WebSocket support (still limited)
- **Option 2**: Use **Cloudflare Compute** (dedicated runtime) for WebSocket clients
- **Option 3**: Use **Workers + Queue** pattern: External service maintains WebSocket, sends events to Queue

### ❌ Long-Running Processes

**Files Affected:**
- `src/cli/trading-bot.ts` - Maintains persistent WebSocket connections
- `src/cli/record-live.ts` - Long-running recording process
- Both use `setInterval` for periodic tasks and signal handlers

**Workers Limitation:**
- Workers have **CPU time limits** (10ms free tier, 50ms paid, 30s max)
- Workers are **request-driven** (no persistent processes)
- No support for `process.on('SIGINT')` or `process.on('SIGTERM')`

**Current Usage:**
```typescript
installSignalHandlers({ onSignal: shutdown })
setInterval(() => { /* stats */ }, 10_000)
// Long-running WebSocket connection
source.start() // Runs indefinitely
```

**Migration Path:**
- Use **Cloudflare Compute** (dedicated VMs) for long-running processes
- Or use **Durable Objects** with alarms/cron triggers (limited)

### ❌ Process APIs

**Files Affected:**
- `src/utils/runtime.ts` - Process crash handlers
- All CLI files use `process.env`, `process.argv`, `process.exit()`

**Node.js APIs Used:**
```typescript
process.on('unhandledRejection', ...)
process.on('uncaughtException', ...)
process.on('SIGINT', ...)
process.on('SIGTERM', ...)
process.env.VAR_NAME
process.argv
process.exit(code)
process.cwd()
```

**Workers Limitation:**
- No `process` global (Workers use `globalThis`)
- Environment variables via `env` parameter, not `process.env`
- No `process.exit()` (Workers return responses)
- No signal handlers (Workers are stateless)

**Migration Path:**
- Replace `process.env` with `env` parameter in Worker handlers
- Replace `process.exit()` with `return` statements
- Remove signal handlers (not applicable)

### ❌ TUI Library (`blessed`)

**Dependency:**
- `blessed` - Terminal UI library (if used)

**Workers Limitation:**
- No terminal/stdout access
- Workers return HTTP responses, not console output

**Migration Path:**
- Remove TUI components
- Use HTTP endpoints for status/monitoring
- Use Cloudflare Dashboard or external monitoring

### ❌ Parquet Library Compatibility

**Current Library:**
- `@dsnp/parquetjs` - Uses `ParquetReader.openFile(filePath)` and `ParquetWriter.openFile(schema, filePath)`

**Workers Limitation:**
- File path-based APIs won't work
- Need stream/ArrayBuffer-based APIs

**Investigation Needed:**
- Check if `@dsnp/parquetjs` supports reading from streams/ArrayBuffers
- Alternative: Use `parquet-wasm` or `parquetjs` with stream support
- May need to download entire file from R2 into memory (check size limits)

---

## 3. Parquet File I/O with Cloudflare R2

### Current Implementation

**Reading (Backtesting):**
```typescript
const readers = await Promise.all(
  filePaths.map((p) => parquet.ParquetReader.openFile(p))
)
```

**Writing (Recording):**
```typescript
const writer = await parquet.ParquetWriter.openFile(
  rawMarketEventParquetSchema,
  filePathTmp
)
await writer.appendRow(row)
await writer.close()
await rename(filePathTmp, filePathFinal)
```

### R2 Integration Approach

**Option 1: Download Entire File (Small Files)**
```typescript
// In Workers
const object = await env.R2_BUCKET.get(filePath)
if (!object) throw new Error('File not found')
const arrayBuffer = await object.arrayBuffer()
// Pass to ParquetReader (if it supports ArrayBuffer)
```

**Limitations:**
- Workers have memory limits (~128MB free, 256MB+ paid)
- Parquet files may be large (need to check typical sizes)
- Entire file must fit in memory

**Option 2: Streaming (Preferred)**
```typescript
// In Workers or Compute
const object = await env.R2_BUCKET.get(filePath)
if (!object) throw new Error('File not found')
const stream = object.body // ReadableStream
// Need Parquet library that supports streams
```

**Challenges:**
- `@dsnp/parquetjs` may not support streams
- May need to switch to a different Parquet library
- Streaming requires careful buffer management

**Option 3: R2 Multipart Upload (Writing)**
```typescript
// For writing Parquet files
const writer = new R2MultipartWriter(env.R2_BUCKET, key)
// Stream data to multipart upload
// Finalize on close
```

**Challenges:**
- Parquet format requires footer written at end
- Need to buffer rows, then write header + data + footer
- Complex but feasible

### Efficiency Considerations

**R2 Zero-Egress Pricing:**
- ✅ Reading from R2 within Cloudflare network = free egress
- ✅ Writing to R2 = free ingress
- ✅ Perfect for backtesting (read many files)

**Performance:**
- R2 read latency: ~50-100ms first byte
- Sequential reads may be slower than local disk
- Consider caching frequently accessed files
- Workers can cache responses (up to 512MB)

**File Size Estimates:**
- Need to measure typical Parquet file sizes
- 15-minute market episode = ? MB
- If files are <10MB, downloading entire file is feasible
- If files are >50MB, streaming is required

---

## 4. SDK and Runtime Limitations

### Workers Runtime Limits

**CPU Time:**
- Free: 10ms CPU time per request
- Paid: 50ms CPU time per request
- Maximum: 30 seconds (with paid plan)

**Memory:**
- Free: 128MB
- Paid: 256MB+ (configurable)

**Request Size:**
- 100MB request body limit
- 100MB response body limit

**Concurrent Requests:**
- Unlimited (no hard limit)

**Impact on Backtesting:**
- ⚠️ **Backtesting may exceed CPU limits** if processing large files
- Backtesting is CPU-intensive (orderbook updates, strategy evaluation)
- May need to split backtesting into chunks or use Cloudflare Compute

### Dependencies Compatibility

**Compatible:**
- ✅ `zod` - Pure TypeScript, works in Workers
- ✅ `ethers` - Should work (check WebCrypto compatibility)
- ⚠️ `@polymarket/clob-client` - Check if it uses Node.js-specific APIs
- ❌ `ws` - Not compatible (Node.js-specific)
- ❌ `blessed` - Not compatible (terminal UI)
- ⚠️ `@dsnp/parquetjs` - May need stream support
- ⚠️ `pino` - Logger, may need adapter for Workers

### WebCrypto vs Node.js Crypto

**Current Usage:**
- `ethers` uses crypto for signing
- Polymarket API uses signatures

**Workers Support:**
- ✅ Workers have `WebCrypto` API
- ✅ `ethers` v6 should support WebCrypto
- ⚠️ Verify compatibility before migration

---

## 5. Workers Durable Objects / Queues

### When to Use Durable Objects

**Use Cases:**
- Maintaining WebSocket connections (if Workers supported client WebSockets)
- Stateful order management across requests
- Coordinating multiple Workers

**Current Architecture:**
- Trading bot maintains WebSocket connections (long-running)
- OrderManager maintains in-memory state

**Recommendation:**
- **Not needed** if using Cloudflare Compute for WebSocket clients
- **Consider** if you want to maintain WebSocket state in Workers (but Workers don't support client WebSockets well)

### When to Use Queues

**Use Cases:**
- Decoupling WebSocket event processing from Workers
- Batch processing of market events
- Retry logic for failed operations

**Potential Architecture:**
```
WebSocket Client (Compute) → Queue → Worker (Process Events)
```

**Recommendation:**
- **Optional** - Can simplify architecture if you want to separate concerns
- **Not required** - Can process events directly in Compute

---

## 6. Backtesting on Workers

### Current Backtesting Flow

1. Load Parquet files from disk
2. Heap-merge events by `ingest_seq`
3. Replay events tick-by-tick
4. Update orderbook, run strategy, simulate execution
5. Calculate statistics

### Workers Suitability

**Pros:**
- ✅ Stateless processing (each backtest is independent)
- ✅ Can parallelize multiple backtests
- ✅ R2 zero-egress pricing (read many files cheaply)
- ✅ Auto-scaling (handle many concurrent backtests)

**Cons:**
- ⚠️ **CPU time limits** - Backtesting is CPU-intensive
- ⚠️ **Memory limits** - Large Parquet files may not fit
- ⚠️ **Parquet library compatibility** - May need streaming support

### CPU Time Analysis

**Typical Backtest:**
- Process 15-minute market episode
- ~1000-10000 events (estimate)
- Orderbook updates: O(log n) per event
- Strategy evaluation: Varies by strategy complexity

**Estimate:**
- Small backtest (1 file, 1000 events): ~100-500ms CPU time
- Large backtest (10 files, 10000 events): ~1-5 seconds CPU time

**Workers Limit:**
- Free: 10ms ❌ (too short)
- Paid: 50ms ❌ (still too short for most backtests)
- Max: 30 seconds ✅ (works for single backtest, but tight for batch)

### Recommendation

**Option 1: Cloudflare Compute (Recommended)**
- Use **Cloudflare Compute** (dedicated VMs) for backtesting
- No CPU time limits
- Can process large batches
- Still use R2 for storage (zero-egress)

**Option 2: Chunked Workers**
- Split backtesting into chunks (process N events per request)
- Use Durable Objects or external state store to track progress
- More complex, but scales better

**Option 3: Hybrid**
- Small backtests (<50ms CPU): Workers
- Large backtests: Cloudflare Compute
- Use same R2 storage for both

---

## 7. Migration Approaches

### Approach 1: Minimal Change (Hybrid Architecture)

**Keep Existing:**
- CLI tools (`trading-bot.ts`, `record-live.ts`) run on **Cloudflare Compute** or dedicated VM
- WebSocket connections stay in Compute/VM
- File I/O stays local (or migrate to R2 gradually)

**Migrate to Workers:**
- API endpoints for backtest status/queries
- Stateless strategy evaluation endpoints
- File listing/metadata endpoints

**Migrate to R2:**
- Store Parquet files in R2
- Update `list-backtest-files.ts` to query R2
- Update `backtest.ts` to read from R2 (if Parquet library supports it)

**Changes Required:**
1. Add R2 client to existing code
2. Replace `fs.readdir` with `R2.list()`
3. Replace `ParquetReader.openFile()` with R2 download + ParquetReader
4. Keep WebSocket code in Compute/VM

**Effort:** Medium (2-4 weeks)
**Risk:** Low (gradual migration)

### Approach 2: Full Workers Migration

**Migrate Everything:**
- All components to Workers
- WebSocket clients to Durable Objects or Compute
- File I/O to R2

**Challenges:**
- WebSocket clients don't work well in Workers → Use Compute
- Backtesting CPU limits → Use Compute or chunking
- Parquet library compatibility → Find stream-compatible library

**Changes Required:**
1. Replace all `fs` operations with R2 API
2. Replace `ws` library with Workers WebSocket (server) or Compute
3. Replace `process.*` APIs with Workers equivalents
4. Split backtesting into chunks or use Compute
5. Find Parquet library with stream support
6. Remove TUI/blessed dependencies

**Effort:** High (6-12 weeks)
**Risk:** High (many unknowns)

### Approach 3: Recommended Hybrid

**Architecture:**
```
┌─────────────────────────────────────────┐
│  Cloudflare Workers                    │
│  - API endpoints                        │
│  - Backtest orchestration               │
│  - Strategy evaluation (stateless)      │
└─────────────────────────────────────────┘
              ↓ (reads from)
┌─────────────────────────────────────────┐
│  Cloudflare R2                          │
│  - Parquet file storage                 │
│  - Zero-egress pricing                 │
└─────────────────────────────────────────┘
              ↑ (writes to)
┌─────────────────────────────────────────┐
│  Cloudflare Compute (or VM)             │
│  - WebSocket clients (trading-bot)      │
│  - Recording (record-live)               │
│  - Long-running backtests               │
└─────────────────────────────────────────┘
```

**Components:**

1. **Workers (Stateless)**
   - HTTP API for backtest queries
   - Strategy evaluation endpoints
   - File metadata/listing
   - Small backtests (<50ms CPU)

2. **R2 (Storage)**
   - All Parquet files
   - Zero-egress for Workers reads
   - Multipart uploads for writing

3. **Compute/VM (Stateful)**
   - `trading-bot.ts` - WebSocket clients, live trading
   - `record-live.ts` - WebSocket recording, writes to R2
   - Large backtests - Reads from R2, processes locally

**Migration Steps:**

1. **Phase 1: R2 Storage** (1-2 weeks)
   - Set up R2 bucket
   - Update `record-live.ts` to write to R2 instead of local disk
   - Update `list-backtest-files.ts` to read from R2
   - Keep local disk as fallback

2. **Phase 2: Workers API** (2-3 weeks)
   - Create Workers API for file listing
   - Create Workers API for backtest status
   - Keep Compute/VM for actual backtesting

3. **Phase 3: Workers Backtesting** (3-4 weeks)
   - Migrate small backtests to Workers
   - Keep large backtests in Compute
   - Monitor CPU time usage

4. **Phase 4: Optimization** (ongoing)
   - Optimize Parquet reading (streaming)
   - Cache frequently accessed files
   - Parallelize backtests

**Effort:** Medium-High (6-8 weeks)
**Risk:** Medium (proven architecture, gradual migration)

---

## 8. Final Recommendation

### Is Cloudflare Workers + R2 a Good Fit?

**✅ YES, for:**
- Parquet file storage (R2 zero-egress is perfect)
- Stateless API endpoints
- Small backtests or backtest orchestration
- File metadata/listing operations

**❌ NO, for:**
- Long-running WebSocket clients (use Compute)
- Large CPU-intensive backtests (use Compute or chunking)
- Direct file system operations (migrate to R2 API)

### Recommended Architecture

**Use Cloudflare Workers + R2 + Compute:**

1. **R2**: Store all Parquet files (zero-egress pricing)
2. **Workers**: API endpoints, small backtests, orchestration
3. **Compute**: WebSocket clients, recording, large backtests

**Benefits:**
- ✅ Zero-egress pricing for R2 reads
- ✅ Auto-scaling Workers for API
- ✅ Dedicated Compute for long-running processes
- ✅ Same codebase, different deployment targets

**Cost Estimate:**
- R2: ~$0.015/GB storage, $0.36/GB egress (but zero within Cloudflare)
- Workers: $5/month + $0.50/million requests
- Compute: ~$0.10/hour per instance (or use existing VM)

**Migration Path:**
- Start with R2 storage migration (low risk)
- Gradually move APIs to Workers
- Keep Compute for WebSocket/recording (required)

---

## 9. Action Items

### Immediate Next Steps

1. **Measure Parquet File Sizes**
   - Check typical file sizes for 15-minute episodes
   - Determine if streaming is required

2. **Test Parquet Library Compatibility**
   - Check if `@dsnp/parquetjs` supports ArrayBuffer/streams
   - Research alternatives (`parquet-wasm`, `parquetjs`)

3. **Prototype R2 Integration**
   - Create test Worker that reads Parquet from R2
   - Measure performance and memory usage

4. **Evaluate WebSocket Alternatives**
   - Test Workers WebSocket server capabilities
   - Decide on Compute vs Durable Objects

5. **Benchmark Backtest CPU Time**
   - Measure actual CPU time for typical backtests
   - Determine if Workers limits are feasible

### Code Changes Required (Minimal Approach)

**Priority 1: R2 Storage**
- [ ] Create R2 bucket
- [ ] Update `eventWriter.ts` to write to R2
- [ ] Update `list-backtest-files.ts` to read from R2
- [ ] Update `backtest.ts` to read from R2

**Priority 2: Workers API**
- [ ] Create Workers project structure
- [ ] Implement file listing endpoint
- [ ] Implement backtest status endpoint

**Priority 3: Compute Migration**
- [ ] Set up Cloudflare Compute (or keep VM)
- [ ] Deploy `trading-bot.ts` to Compute
- [ ] Deploy `record-live.ts` to Compute

---

## 10. References

- [Cloudflare Workers Limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Cloudflare R2 Documentation](https://developers.cloudflare.com/r2/)
- [Cloudflare Compute Documentation](https://developers.cloudflare.com/workers/runtime-apis/durable-objects/)
- [Workers WebSocket Support](https://developers.cloudflare.com/workers/runtime-apis/websockets/)

