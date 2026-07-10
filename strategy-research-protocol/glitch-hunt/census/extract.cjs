// Glitch Foundry census checkpoint extractor.
// Replays delta-typed parquet episodes (book snapshots + price_change deltas),
// maintains both asset books, emits checkpoint rows + jump rows, and
// self-checks reconstruction against every real book snapshot encountered.
//
// Usage: node extract.mjs <manifest.csv> <outDir> [batchSize=100]
// Resumable: skips batches listed in <outDir>/progress.json.
//
// Semantics (ENGINE.md): price_change size 0 removes a level, non-zero upserts.
// Side code 0 = BUY (bid), 1 = SELL (ask)  [src/telonex/converters/deltaTyped.ts].
// Window anchor: epoch in slug = window start seconds; window = [epoch, epoch+900].
// Prices keyed as integer milli-cents: round(price*1000).

const { DuckDBInstance } = require('@duckdb/node-api');
const fs = require('fs');
const path = require('path');

const EPISODE_DIR = '/Users/mijat/Sites/polymarket-bot/data/events/telonex/delta-typed/btc/15m';

// Checkpoint grid: every 15s 0..900, plus 5s resolution 840..900, plus 897, 899.
const CP_GRID = (() => {
  const s = new Set();
  for (let t = 0; t <= 900; t += 15) s.add(t);
  for (let t = 840; t <= 900; t += 5) s.add(t);
  s.add(897); s.add(899);
  return [...s].sort((a, b) => a - b);
})();

function items(v) { return v && v.items ? v.items : (Array.isArray(v) ? v : []); }
function pKey(p) { return Math.round(parseFloat(p) * 1000); }

class Book {
  constructor() {
    this.bids = new Map(); // pKey -> size
    this.asks = new Map();
    this.bestBid = null;   // pKey or null
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
  mid() {
    if (this.bestBid === null || this.bestAsk === null) return null;
    return (this.bestBid + this.bestAsk) / 2000;
  }
}

function fmt(x, dp = 4) { return x === null || x === undefined ? '' : (+x).toFixed(dp).replace(/\.?0+$/, ''); }

async function processFile(conn, slug, epoch) {
  const file = path.join(EPISODE_DIR, `${slug}.parquet`);
  const res = await conn.runAndReadAll(
    `SELECT ingest_seq, ts_local_ms, event_type, asset_index,
            bid_prices, bid_sizes, ask_prices, ask_sizes,
            change_asset_indexes, change_side_codes, change_prices, change_sizes
     FROM read_parquet('${file}') ORDER BY ingest_seq`);
  const rows = res.getRowObjects();

  const winStart = epoch * 1000, winEnd = winStart + 900000;
  const books = [new Book(), new Book()];
  let checked = 0, mismatch = 0, staleExplained = 0;
  // Per-asset trail of recent recon (ts, bestBid, bestAsk) states (~10s),
  // used to classify snapshot mismatches as stale-snapshot artifacts (the
  // snapshot payload reflects a state older than deltas already ingested).
  const trails = [[], []];
  const cpRows = [];
  let cpIdx = 0;
  let lastEvTs = null;
  const midSeries = []; // [ts, upMid] for every event with valid up mid
  const jumps = [];     // {ts, tSec, jump, midAt}
  let lastJumpTs = -Infinity;
  let dqStart = 0;      // deque head index into midSeries for 10s-ago lookback

  const emitCp = (tSec) => {
    const cpTs = winStart + tSec * 1000;
    const up = books[0], dn = books[1];
    const bb = up.bestBid, ba = up.bestAsk;
    const mid = up.mid();
    cpRows.push([
      slug, epoch, tSec,
      bb === null ? '' : fmt(bb / 1000), ba === null ? '' : fmt(ba / 1000),
      mid === null ? '' : fmt(mid),
      (bb !== null && ba !== null) ? fmt((ba - bb) / 1000) : '',
      fmt(up.top3('bid'), 2), fmt(up.top3('ask'), 2),
      dn.bestBid === null ? '' : fmt(dn.bestBid / 1000),
      dn.bestAsk === null ? '' : fmt(dn.bestAsk / 1000),
      lastEvTs === null ? '' : (cpTs - lastEvTs),
    ].join(','));
  };

  for (const r of rows) {
    const ts = Number(r.ts_local_ms);
    // Emit any checkpoints strictly before this event's timestamp.
    while (cpIdx < CP_GRID.length && winStart + CP_GRID[cpIdx] * 1000 < ts) {
      emitCp(CP_GRID[cpIdx]); cpIdx++;
    }
    if (r.event_type === 'book') {
      const ai = Number(r.asset_index);
      const b = books[ai];
      const bidP = items(r.bid_prices), bidS = items(r.bid_sizes);
      const askP = items(r.ask_prices), askS = items(r.ask_sizes);
      if (b.snapCount > 0) {
        // Self-check: reconstructed best bid/ask vs real snapshot best.
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
    // Maintain staleness trails (dedupe consecutive identical states, keep ~10s).
    for (const ai of [0, 1]) {
      const tr = trails[ai], b = books[ai];
      const last = tr[tr.length - 1];
      if (!last || last.bb !== b.bestBid || last.ba !== b.bestAsk) tr.push({ ts, bb: b.bestBid, ba: b.bestAsk });
      while (tr.length > 1 && tr[1].ts <= ts - 10000) tr.shift();
    }
    // Jump detection on up mid (within window only).
    const mid = books[0].mid();
    if (mid !== null) {
      midSeries.push([ts, mid]);
      if (ts >= winStart && ts <= winEnd) {
        while (dqStart + 1 < midSeries.length && midSeries[dqStart + 1][0] <= ts - 10000) dqStart++;
        const ref = midSeries[dqStart];
        if (ref[0] <= ts - 10000 && Math.abs(mid - ref[1]) >= 0.03 && ts - lastJumpTs >= 10000) {
          jumps.push({ ts, tSec: (ts - winStart) / 1000, jump: mid - ref[1], midAt: mid });
          lastJumpTs = ts;
        }
      }
    }
  }
  while (cpIdx < CP_GRID.length) { emitCp(CP_GRID[cpIdx]); cpIdx++; }

  // Jump drift: mid at jumpTs + 30/60/120s (latest sample <= target, capped at window end).
  const midAtOrBefore = (target) => {
    let lo = 0, hi = midSeries.length - 1, ans = null;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (midSeries[m][0] <= target) { ans = midSeries[m][1]; lo = m + 1; } else hi = m - 1; }
    return ans;
  };
  const jumpRows = jumps.map(j => {
    const drift = [30000, 60000, 120000].map(h => {
      if (j.ts + h > winEnd) return '';
      const m = midAtOrBefore(j.ts + h);
      return m === null ? '' : fmt(m - j.midAt);
    });
    return [slug, epoch, fmt(j.tSec, 1), fmt(j.jump), fmt(j.midAt), ...drift].join(',');
  });

  return { cpRows, jumpRows, checked, mismatch, staleExplained, nEvents: rows.length };
}

async function main() {
  const [manifestPath, outDir, batchSizeArg] = process.argv.slice(2);
  const batchSize = Number(batchSizeArg || 100);
  const manifest = fs.readFileSync(manifestPath, 'utf8').trim().split('\n').slice(1)
    .map(l => { const [slug, epoch, month] = l.split(','); return { slug, epoch: Number(epoch), month }; });

  fs.mkdirSync(path.join(outDir, 'checkpoints'), { recursive: true });
  fs.mkdirSync(path.join(outDir, 'jumps'), { recursive: true });
  const progressPath = path.join(outDir, 'progress.json');
  const progress = fs.existsSync(progressPath) ? JSON.parse(fs.readFileSync(progressPath, 'utf8')) : { completedBatches: {}, selfCheck: { checked: 0, mismatch: 0, staleExplained: 0 } };

  const inst = await DuckDBInstance.create(':memory:');
  const conn = await inst.connect();
  await conn.run("SET threads TO 2; SET memory_limit='3GB'");

  const cpHeader = 'slug,epoch,t_sec,up_best_bid,up_best_ask,up_mid,spread,top3_bid_depth,top3_ask_depth,down_best_bid,down_best_ask,last_event_age_ms';
  const jHeader = 'slug,epoch,t_sec,jump_size,mid_at_jump,drift_30s,drift_60s,drift_120s';

  const nBatches = Math.ceil(manifest.length / batchSize);
  for (let b = 0; b < nBatches; b++) {
    const key = `batch-${String(b).padStart(4, '0')}`;
    if (progress.completedBatches[key]) continue;
    const slice = manifest.slice(b * batchSize, (b + 1) * batchSize);
    const cpLines = [cpHeader], jLines = [jHeader], scLines = [];
    let bChecked = 0, bMismatch = 0, bStale = 0;
    for (const m of slice) {
      try {
        const r = await processFile(conn, m.slug, m.epoch);
        cpLines.push(...r.cpRows);
        jLines.push(...r.jumpRows);
        scLines.push(`${m.slug},${r.checked},${r.mismatch},${r.staleExplained},${r.nEvents}`);
        bChecked += r.checked; bMismatch += r.mismatch; bStale += r.staleExplained;
      } catch (e) {
        scLines.push(`${m.slug},ERROR,ERROR,ERROR,${String(e.message).replace(/[,\n]/g, ' ')}`);
      }
    }
    const cpTmp = path.join(outDir, 'checkpoints', `${key}.csv.tmp`);
    fs.writeFileSync(cpTmp, cpLines.join('\n') + '\n');
    fs.renameSync(cpTmp, path.join(outDir, 'checkpoints', `${key}.csv`));
    const jTmp = path.join(outDir, 'jumps', `${key}.csv.tmp`);
    fs.writeFileSync(jTmp, jLines.join('\n') + '\n');
    fs.renameSync(jTmp, path.join(outDir, 'jumps', `${key}.csv`));
    const scPath = path.join(outDir, 'selfcheck.csv');
    if (!fs.existsSync(scPath)) fs.writeFileSync(scPath, 'slug,snapshots_checked,mismatches,stale_explained,n_events\n');
    fs.appendFileSync(scPath, scLines.join('\n') + '\n');
    progress.completedBatches[key] = { files: slice.length, checked: bChecked, mismatch: bMismatch, staleExplained: bStale, at: new Date().toISOString() };
    progress.selfCheck.checked += bChecked;
    progress.selfCheck.mismatch += bMismatch;
    progress.selfCheck.staleExplained = (progress.selfCheck.staleExplained || 0) + bStale;
    fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2));
    const sc = progress.selfCheck;
    const pct = (x) => sc.checked ? (100 * x / sc.checked).toFixed(4) : 'n/a';
    console.log(`${key} done (${slice.length} files). Cumulative self-check: ${sc.mismatch}/${sc.checked} mismatched (${pct(sc.mismatch)}%), stale-explained ${sc.staleExplained} (hard rate ${pct(sc.mismatch - sc.staleExplained)}%)`);
  }
  console.log('ALL BATCHES DONE');
}

main().catch(e => { console.error(e); process.exit(1); });
