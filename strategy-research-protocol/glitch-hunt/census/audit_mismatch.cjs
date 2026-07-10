// Mismatch magnitude audit: for a subsample of episodes, quantify how far
// reconstructed best bid/ask are from snapshot bests at mismatching snapshots,
// and measure snapshot cadence. Writes mismatch_audit.csv (one row per episode).
// Usage: node audit_mismatch.cjs <manifest.csv> <outCsv> <perMonth>
const { DuckDBInstance } = require('@duckdb/node-api');
const fs = require('fs');
const path = require('path');

const EPISODE_DIR = '/Users/mijat/Sites/polymarket-bot/data/events/telonex/delta-typed/btc/15m';

function items(v) { return v && v.items ? v.items : []; }
function pKey(p) { return Math.round(parseFloat(p) * 1000); }

class Book {
  constructor() { this.bids = new Map(); this.asks = new Map(); this.snapCount = 0; }
  load(bp, bs, ap, as_) {
    this.bids.clear(); this.asks.clear();
    for (let i = 0; i < bp.length; i++) if (parseFloat(bs[i]) > 0) this.bids.set(pKey(bp[i]), parseFloat(bs[i]));
    for (let i = 0; i < ap.length; i++) if (parseFloat(as_[i]) > 0) this.asks.set(pKey(ap[i]), parseFloat(as_[i]));
    this.snapCount++;
  }
  delta(sc, p, s) {
    const k = pKey(p), sz = parseFloat(s);
    const m = sc === 0 ? this.bids : this.asks;
    if (sz === 0) m.delete(k); else m.set(k, sz);
  }
  bb() { let r = null; for (const k of this.bids.keys()) if (r === null || k > r) r = k; return r; }
  ba() { let r = null; for (const k of this.asks.keys()) if (r === null || k < r) r = k; return r; }
}

async function auditFile(conn, slug) {
  const res = await conn.runAndReadAll(
    `SELECT ingest_seq, ts_local_ms, event_type, asset_index, bid_prices, bid_sizes,
            ask_prices, ask_sizes, change_asset_indexes, change_side_codes, change_prices, change_sizes
     FROM read_parquet('${path.join(EPISODE_DIR, slug + '.parquet')}') ORDER BY ingest_seq`);
  const rows = res.getRowObjects();
  const books = [new Book(), new Book()];
  let checked = 0, mismatch = 0, midErrSum = 0, midErrMax = 0;
  let snapTs = [];
  for (const r of rows) {
    if (r.event_type === 'book') {
      const ai = Number(r.asset_index);
      if (ai === 0) snapTs.push(Number(r.ts_local_ms));
      const b = books[ai];
      const bp = items(r.bid_prices), bs = items(r.bid_sizes), ap = items(r.ask_prices), as_ = items(r.ask_sizes);
      if (b.snapCount > 0) {
        let sBB = null, sBA = null;
        for (let i = 0; i < bp.length; i++) if (parseFloat(bs[i]) > 0) { const k = pKey(bp[i]); if (sBB === null || k > sBB) sBB = k; }
        for (let i = 0; i < ap.length; i++) if (parseFloat(as_[i]) > 0) { const k = pKey(ap[i]); if (sBA === null || k < sBA) sBA = k; }
        checked++;
        const rBB = b.bb(), rBA = b.ba();
        if (rBB !== sBB || rBA !== sBA) {
          mismatch++;
          if (rBB !== null && rBA !== null && sBB !== null && sBA !== null) {
            const err = Math.abs((rBB + rBA) - (sBB + sBA)) / 2000; // mid error in $
            midErrSum += err; midErrMax = Math.max(midErrMax, err);
          }
        }
      }
      b.load(bp, bs, ap, as_);
    } else if (r.event_type === 'price_change') {
      const ais = items(r.change_asset_indexes), scs = items(r.change_side_codes),
            cps = items(r.change_prices), css = items(r.change_sizes);
      for (let i = 0; i < ais.length; i++) {
        const ai = Number(ais[i]);
        if (ai === 0 || ai === 1) books[ai].delta(Number(scs[i]), cps[i], css[i]);
      }
    }
  }
  let cad = '';
  if (snapTs.length > 1) cad = ((snapTs[snapTs.length - 1] - snapTs[0]) / (snapTs.length - 1) / 1000).toFixed(1);
  return { checked, mismatch, avgMidErr: mismatch ? (midErrSum / mismatch).toFixed(4) : '', maxMidErr: midErrMax.toFixed(4), cadence: cad };
}

(async () => {
  const [manifestPath, outCsv, perMonthArg] = process.argv.slice(2);
  const perMonth = Number(perMonthArg || 10);
  const rows = fs.readFileSync(manifestPath, 'utf8').trim().split('\n').slice(1).map(l => l.split(','));
  const byMonth = {};
  for (const [slug, , month] of rows) (byMonth[month] = byMonth[month] || []).push(slug);
  const picks = [];
  for (const m of Object.keys(byMonth).sort()) {
    const arr = byMonth[m];
    for (let j = 0; j < Math.min(perMonth, arr.length); j++) picks.push([m, arr[Math.round(j * (arr.length - 1) / Math.max(1, perMonth - 1))]]);
  }
  const inst = await DuckDBInstance.create(':memory:');
  const conn = await inst.connect();
  await conn.run("SET threads TO 2; SET memory_limit='3GB'");
  const out = ['month,slug,snapshots_checked,mismatches,avg_mid_err_at_mismatch,max_mid_err,snap_cadence_s'];
  for (const [m, slug] of picks) {
    const a = await auditFile(conn, slug);
    out.push([m, slug, a.checked, a.mismatch, a.avgMidErr, a.maxMidErr, a.cadence].join(','));
  }
  fs.writeFileSync(outCsv, out.join('\n') + '\n');
  console.log(`audited ${picks.length} files -> ${outCsv}`);
})();
