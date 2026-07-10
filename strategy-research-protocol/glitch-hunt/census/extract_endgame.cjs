// Glitch Foundry endgame checkpoint extractor (holdout set).
// Differences from extract.cjs (census):
//   - Checkpoints only at t in {780, 840, 870, 885, 897, 899}.
//   - KEEPS one-sided and empty books: best bid and best ask are recorded
//     independently (with sizes and top-3 depth per side, BOTH assets);
//     a row is never dropped/NULLed because mid is undefined.
//   - Fast start: replay begins at the last `book` snapshot per asset with
//     ts <= epoch+780s (min across the two assets); falls back to full-file
//     replay when either asset has no such snapshot. Self-check runs on every
//     snapshot encountered in the replayed range (after the first per asset).
//
// Semantics identical to extract.cjs / ENGINE.md: book = full replacement;
// price_change size 0 removes a level, non-zero upserts; side 0=bid, 1=ask.
// Checkpoint at T = state after all events with ts_local_ms <= epoch*1000+T*1000
// applied in ingest_seq order. Prices keyed as round(price*1000).
//
// Usage: node extract_endgame.cjs <manifest.csv> <outDir> [batchSize=100]
// Resumable via <outDir>/progress.json.

const { DuckDBInstance } = require('@duckdb/node-api');
const fs = require('fs');
const path = require('path');

const EPISODE_DIR = '/Users/mijat/Sites/polymarket-bot/data/events/telonex/delta-typed/btc/15m';
const CP_GRID = [780, 840, 870, 885, 897, 899];

function items(v) { return v && v.items ? v.items : (Array.isArray(v) ? v : []); }
function pKey(p) { return Math.round(parseFloat(p) * 1000); }

class Book {
  constructor() {
    this.bids = new Map();
    this.asks = new Map();
    this.bestBid = null;
    this.bestAsk = null;
    this.snapCount = 0;
  }
  loadSnapshot(bidP, bidS, askP, askS) {
    this.bids.clear(); this.asks.clear();
    this.bestBid = null; this.bestAsk = null;
    for (let i = 0; i < bidP.length; i++) {
      const k = pKey(bidP[i]), s = parseFloat(bidS[i]);
      if (s > 0) { this.bids.set(k, s); if (this.bestBid === null || k > this.bestBid) this.bestBid = k; }
    }
    for (let i = 0; i < askP.length; i++) {
      const k = pKey(askP[i]), s = parseFloat(askS[i]);
      if (s > 0) { this.asks.set(k, s); if (this.bestAsk === null || k < this.bestAsk) this.bestAsk = k; }
    }
    this.snapCount++;
  }
  applyDelta(sideCode, price, size) {
    const k = pKey(price), s = parseFloat(size);
    const m = sideCode === 0 ? this.bids : this.asks;
    if (s === 0) {
      m.delete(k);
      if (sideCode === 0 && k === this.bestBid) this.bestBid = this._max(this.bids);
      if (sideCode === 1 && k === this.bestAsk) this.bestAsk = this._min(this.asks);
    } else {
      m.set(k, s);
      if (sideCode === 0 && (this.bestBid === null || k > this.bestBid)) this.bestBid = k;
      if (sideCode === 1 && (this.bestAsk === null || k < this.bestAsk)) this.bestAsk = k;
    }
  }
  _max(m) { let r = null; for (const k of m.keys()) if (r === null || k > r) r = k; return r; }
  _min(m) { let r = null; for (const k of m.keys()) if (r === null || k < r) r = k; return r; }
  top3(side) {
    const m = side === 'bid' ? this.bids : this.asks;
    const ks = [...m.keys()].sort((a, b) => side === 'bid' ? b - a : a - b);
    let d = 0;
    for (let i = 0; i < Math.min(3, ks.length); i++) d += m.get(ks[i]);
    return d;
  }
}

function fmt(x, dp = 4) { return x === null || x === undefined ? '' : (+x).toFixed(dp).replace(/\.?0+$/, ''); }

async function processFile(conn, ep) {
  const file = path.join(EPISODE_DIR, `${ep.slug}.parquet`);
  const winStart = ep.epoch * 1000;
  const cutoff = winStart + 900000;
  const anchor = winStart + 780000;

  // Fast start: last book snapshot per asset at ts <= t780.
  const agg = await conn.runAndReadAll(
    `SELECT asset_index, max(ts_local_ms) AS mts
     FROM read_parquet('${file}')
     WHERE event_type = 'book' AND ts_local_ms <= ${anchor}
     GROUP BY asset_index`);
  const mts = new Map(agg.getRowObjects().map(r => [Number(r.asset_index), Number(r.mts)]));
  let startTs = 0;
  if (mts.has(0) && mts.has(1)) startTs = Math.min(mts.get(0), mts.get(1));

  const res = await conn.runAndReadAll(
    `SELECT ingest_seq, ts_local_ms, event_type, asset_index,
            bid_prices, bid_sizes, ask_prices, ask_sizes,
            change_asset_indexes, change_side_codes, change_prices, change_sizes
     FROM read_parquet('${file}')
     WHERE ts_local_ms >= ${startTs} AND ts_local_ms <= ${cutoff}
     ORDER BY ingest_seq`);
  const rows = res.getRowObjects();

  const books = [new Book(), new Book()];
  let checked = 0, mismatch = 0, staleExplained = 0;
  const trails = [[], []];
  const cpRows = [];
  let cpIdx = 0;
  let lastEvTs = null;
  const startOff = startTs === 0 ? '' : fmt((startTs - winStart) / 1000, 1);

  const emitCp = (tSec) => {
    const cpTs = winStart + tSec * 1000;
    const cols = [ep.slug, ep.epoch, ep.month, ep.result_id, tSec];
    for (const b of books) {
      const bb = b.bestBid, ba = b.bestAsk;
      cols.push(
        bb === null ? '' : fmt(bb / 1000),
        bb === null ? '' : fmt(b.bids.get(bb), 2),
        ba === null ? '' : fmt(ba / 1000),
        ba === null ? '' : fmt(b.asks.get(ba), 2),
        fmt(b.top3('bid'), 2), fmt(b.top3('ask'), 2),
      );
    }
    cols.push(lastEvTs === null ? '' : (cpTs - lastEvTs), startOff);
    cpRows.push(cols.join(','));
  };

  for (const r of rows) {
    const ts = Number(r.ts_local_ms);
    while (cpIdx < CP_GRID.length && winStart + CP_GRID[cpIdx] * 1000 < ts) {
      emitCp(CP_GRID[cpIdx]); cpIdx++;
    }
    if (r.event_type === 'book') {
      const ai = Number(r.asset_index);
      const b = books[ai];
      const bidP = items(r.bid_prices), bidS = items(r.bid_sizes);
      const askP = items(r.ask_prices), askS = items(r.ask_sizes);
      if (b.snapCount > 0) {
        let snapBB = null, snapBA = null;
        for (let i = 0; i < bidP.length; i++) if (parseFloat(bidS[i]) > 0) { const k = pKey(bidP[i]); if (snapBB === null || k > snapBB) snapBB = k; }
        for (let i = 0; i < askP.length; i++) if (parseFloat(askS[i]) > 0) { const k = pKey(askP[i]); if (snapBA === null || k < snapBA) snapBA = k; }
        checked++;
        if (b.bestBid !== snapBB || b.bestAsk !== snapBA) {
          mismatch++;
          if (trails[ai].some(t => t.bb === snapBB && t.ba === snapBA)) staleExplained++;
        }
      }
      b.loadSnapshot(bidP, bidS, askP, askS);
    } else if (r.event_type === 'price_change') {
      const ais = items(r.change_asset_indexes), scs = items(r.change_side_codes);
      const cps = items(r.change_prices), css = items(r.change_sizes);
      const n = Math.min(ais.length, scs.length, cps.length, css.length);
      for (let i = 0; i < n; i++) {
        const ai = Number(ais[i]);
        if (ai !== 0 && ai !== 1) continue;
        books[ai].applyDelta(Number(scs[i]), cps[i], css[i]);
      }
    }
    lastEvTs = ts;
    for (const ai of [0, 1]) {
      const tr = trails[ai], b = books[ai];
      const last = tr[tr.length - 1];
      if (!last || last.bb !== b.bestBid || last.ba !== b.bestAsk) tr.push({ ts, bb: b.bestBid, ba: b.bestAsk });
      while (tr.length > 1 && tr[1].ts <= ts - 10000) tr.shift();
    }
  }
  while (cpIdx < CP_GRID.length) { emitCp(CP_GRID[cpIdx]); cpIdx++; }

  return { cpRows, checked, mismatch, staleExplained, nEvents: rows.length, fastStart: startTs !== 0 };
}

async function main() {
  const [manifestPath, outDir, batchSizeArg] = process.argv.slice(2);
  const batchSize = Number(batchSizeArg || 100);
  const manifest = fs.readFileSync(manifestPath, 'utf8').trim().split('\n').slice(1)
    .map(l => { const [slug, epoch, month, result_id] = l.split(','); return { slug, epoch: Number(epoch), month, result_id }; });

  fs.mkdirSync(path.join(outDir, 'checkpoints'), { recursive: true });
  const progressPath = path.join(outDir, 'progress.json');
  const progress = fs.existsSync(progressPath)
    ? JSON.parse(fs.readFileSync(progressPath, 'utf8'))
    : { completedBatches: {}, selfCheck: { checked: 0, mismatch: 0, staleExplained: 0 }, fastStart: 0, fullReplay: 0 };

  const inst = await DuckDBInstance.create(':memory:');
  const conn = await inst.connect();
  await conn.run("SET threads TO 2; SET memory_limit='3GB'");

  const cpHeader = 'slug,epoch,month,result_id,t_sec,'
    + 'up_bid,up_bid_sz,up_ask,up_ask_sz,up_top3_bid,up_top3_ask,'
    + 'down_bid,down_bid_sz,down_ask,down_ask_sz,down_top3_bid,down_top3_ask,'
    + 'age_ms,replay_start_off_s';

  const nBatches = Math.ceil(manifest.length / batchSize);
  for (let b = 0; b < nBatches; b++) {
    const key = `batch-${String(b).padStart(4, '0')}`;
    if (progress.completedBatches[key]) continue;
    const slice = manifest.slice(b * batchSize, (b + 1) * batchSize);
    const cpLines = [cpHeader], scLines = [];
    let bChecked = 0, bMismatch = 0, bStale = 0, bFast = 0, bFull = 0;
    for (const m of slice) {
      try {
        const r = await processFile(conn, m);
        cpLines.push(...r.cpRows);
        scLines.push(`${m.slug},${r.checked},${r.mismatch},${r.staleExplained},${r.nEvents}`);
        bChecked += r.checked; bMismatch += r.mismatch; bStale += r.staleExplained;
        if (r.fastStart) bFast++; else bFull++;
      } catch (e) {
        scLines.push(`${m.slug},ERROR,ERROR,ERROR,${String(e.message).replace(/[,\n]/g, ' ')}`);
      }
    }
    const cpTmp = path.join(outDir, 'checkpoints', `${key}.csv.tmp`);
    fs.writeFileSync(cpTmp, cpLines.join('\n') + '\n');
    fs.renameSync(cpTmp, path.join(outDir, 'checkpoints', `${key}.csv`));
    const scPath = path.join(outDir, 'selfcheck.csv');
    if (!fs.existsSync(scPath)) fs.writeFileSync(scPath, 'slug,snapshots_checked,mismatches,stale_explained,n_events\n');
    fs.appendFileSync(scPath, scLines.join('\n') + '\n');
    progress.completedBatches[key] = { files: slice.length, checked: bChecked, mismatch: bMismatch, staleExplained: bStale, at: new Date().toISOString() };
    progress.selfCheck.checked += bChecked;
    progress.selfCheck.mismatch += bMismatch;
    progress.selfCheck.staleExplained += bStale;
    progress.fastStart += bFast;
    progress.fullReplay += bFull;
    fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2));
    const sc = progress.selfCheck;
    const pct = (x) => sc.checked ? (100 * x / sc.checked).toFixed(4) : 'n/a';
    console.log(`${key} done (${slice.length} files, fast ${bFast}/full ${bFull}). Cumulative self-check: ${sc.mismatch}/${sc.checked} (${pct(sc.mismatch)}%), stale-explained ${sc.staleExplained} (hard ${pct(sc.mismatch - sc.staleExplained)}%)`);
  }
  console.log('ALL BATCHES DONE');
}

main().catch(e => { console.error(e); process.exit(1); });
