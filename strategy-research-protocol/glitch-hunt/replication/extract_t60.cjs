// REPLICATOR independent extractor — ANOMALY 001 holdout check.
// Written fresh from the memo's falsifiable claim; not derived from census/extract.cjs.
// For each holdout episode: replay deltas in ingest_seq order up to t=61s past
// window open, emit book state at checkpoints t = 0,15,30,45,60, plus a
// self-check of reconstruction vs every `book` snapshot encountered.
//
// Fold rules (per MISSION.md data facts):
//   book event        -> full replacement of that asset's book
//   price_change      -> per-entry: side 0=bid, 1=ask; size 0 removes level,
//                        non-zero upserts (arrays: change_asset_indexes/side_codes/prices/sizes)
// Checkpoint at T = state after all events with ts_local_ms <= epoch*1000 + T*1000
// (applied in ingest_seq order; emit before first event past the cutoff).

const fs = require('fs');
const path = require('path');
const { DuckDBInstance } = require('@duckdb/node-api');

const REPO = '/Users/mijat/Sites/polymarket-bot';
const EPDIR = path.join(REPO, 'data/events/telonex/delta-typed/btc/15m');
const OUTDIR = process.env.OUTDIR_OVERRIDE || path.join(REPO, 'strategy-research-protocol/glitch-hunt/replication/data');
const MANIFEST = process.env.MANIFEST_OVERRIDE || path.join(REPO, 'strategy-research-protocol/glitch-hunt/replication/data/holdout_manifest.csv');
const BATCH = 500;
const CHECKPOINTS = [0, 15, 30, 45, 60];

function parseManifest() {
  const lines = fs.readFileSync(MANIFEST, 'utf8').trim().split('\n').slice(1);
  return lines.map((l) => {
    const [slug, epoch, month, result_id] = l.split(',');
    return { slug, epoch: Number(epoch), month, result_id };
  });
}

function newBook() {
  return { bid: new Map(), ask: new Map() };
}

function bestBid(book) {
  let b = null;
  for (const [p, s] of book.bid) if (s > 0 && (b === null || p > b)) b = p;
  return b;
}
function bestAsk(book) {
  let a = null;
  for (const [p, s] of book.ask) if (s > 0 && (a === null || p < a)) a = p;
  return a;
}
function topNAskDepth(book, n) {
  const lv = [...book.ask.entries()].filter(([, s]) => s > 0).sort((x, y) => x[0] - y[0]);
  return lv.slice(0, n).reduce((acc, [, s]) => acc + s, 0);
}

async function main() {
  const eps = parseManifest();
  const inst = await DuckDBInstance.create(':memory:', { threads: '2', memory_limit: '2GB' });
  const conn = await inst.connect();

  const nBatches = Math.ceil(eps.length / BATCH);
  for (let b = 0; b < nBatches; b++) {
    const cpOut = path.join(OUTDIR, `cp-batch-${String(b).padStart(3, '0')}.csv`);
    const scOut = path.join(OUTDIR, `sc-batch-${String(b).padStart(3, '0')}.csv`);
    if (fs.existsSync(cpOut) && fs.existsSync(scOut)) continue; // resume
    const cpRows = ['slug,epoch,month,result_id,t_sec,up_bid,up_ask,down_bid,down_ask,up_ask_d1,up_ask_d3,down_ask_d1,down_ask_d3,age_ms'];
    const scRows = ['slug,snaps_checked,mism_bid,mism_ask'];
    const slice = eps.slice(b * BATCH, (b + 1) * BATCH);
    for (const ep of slice) {
      const file = path.join(EPDIR, `${ep.slug}.parquet`);
      if (!fs.existsSync(file)) { scRows.push(`${ep.slug},-1,-1,-1`); continue; }
      const cutoffLast = (ep.epoch + 61) * 1000;
      const reader = await conn.runAndReadAll(`
        SELECT event_type, asset_index, ts_local_ms,
               bid_prices, bid_sizes, ask_prices, ask_sizes,
               change_asset_indexes, change_side_codes, change_prices, change_sizes
        FROM read_parquet('${file}')
        WHERE ts_local_ms <= ${cutoffLast}
        ORDER BY ingest_seq`);
      const rows = reader.getRowObjects();

      const books = [newBook(), newBook()];
      const seenSnap = [false, false];
      let snapsChecked = 0, mismBid = 0, mismAsk = 0;
      let lastTs = null;
      let cpIdx = 0;
      const states = [];

      const emitUpTo = (ts) => {
        while (cpIdx < CHECKPOINTS.length && ts > (ep.epoch + CHECKPOINTS[cpIdx]) * 1000) {
          states.push(snapshotState(CHECKPOINTS[cpIdx]));
          cpIdx++;
        }
      };
      const snapshotState = (t) => ({
        t,
        ub: bestBid(books[0]), ua: bestAsk(books[0]),
        db: bestBid(books[1]), da: bestAsk(books[1]),
        ud1: topNAskDepth(books[0], 1), ud3: topNAskDepth(books[0], 3),
        dd1: topNAskDepth(books[1], 1), dd3: topNAskDepth(books[1], 3),
        age: lastTs === null ? null : (ep.epoch + t) * 1000 - Number(lastTs),
      });

      for (const r of rows) {
        const ts = Number(r.ts_local_ms);
        emitUpTo(ts);
        if (r.event_type === 'book') {
          const ai = Number(r.asset_index);
          if (seenSnap[ai]) {
            // self-check reconstructed state vs incoming snapshot
            const rb = bestBid(books[ai]), ra = bestAsk(books[ai]);
            const bp = r.bid_prices.items, bs = r.bid_sizes.items;
            const ap = r.ask_prices.items, as_ = r.ask_sizes.items;
            let sb = null, sa = null;
            for (let i = 0; i < bp.length; i++) { const p = Number(bp[i]); if (Number(bs[i]) > 0 && (sb === null || p > sb)) sb = p; }
            for (let i = 0; i < ap.length; i++) { const p = Number(ap[i]); if (Number(as_[i]) > 0 && (sa === null || p < sa)) sa = p; }
            snapsChecked++;
            if ((rb === null) !== (sb === null) || (rb !== null && Math.abs(rb - sb) > 1e-9)) mismBid++;
            if ((ra === null) !== (sa === null) || (ra !== null && Math.abs(ra - sa) > 1e-9)) mismAsk++;
          }
          seenSnap[ai] = true;
          const nb = newBook();
          const bp = r.bid_prices.items, bs = r.bid_sizes.items;
          const ap = r.ask_prices.items, as_ = r.ask_sizes.items;
          for (let i = 0; i < bp.length; i++) { const s = Number(bs[i]); if (s > 0) nb.bid.set(Number(bp[i]), s); }
          for (let i = 0; i < ap.length; i++) { const s = Number(as_[i]); if (s > 0) nb.ask.set(Number(ap[i]), s); }
          books[ai] = nb;
        } else if (r.event_type === 'price_change') {
          const cai = r.change_asset_indexes.items, csc = r.change_side_codes.items;
          const cpr = r.change_prices.items, csz = r.change_sizes.items;
          for (let i = 0; i < cai.length; i++) {
            const book = books[Number(cai[i])];
            const side = Number(csc[i]) === 0 ? book.bid : book.ask;
            const price = Number(cpr[i]);
            const size = Number(csz[i]);
            if (size === 0) side.delete(price); else side.set(price, size);
          }
        }
        lastTs = ts;
      }
      emitUpTo(Infinity); // flush remaining checkpoints (state at end-of-read)

      for (const s of states) {
        const f = (x) => (x === null || x === undefined ? '' : x);
        cpRows.push(`${ep.slug},${ep.epoch},${ep.month},${ep.result_id},${s.t},${f(s.ub)},${f(s.ua)},${f(s.db)},${f(s.da)},${s.ud1},${s.ud3},${s.dd1},${s.dd3},${f(s.age)}`);
      }
      scRows.push(`${ep.slug},${snapsChecked},${mismBid},${mismAsk}`);
    }
    fs.writeFileSync(cpOut + '.tmp', cpRows.join('\n') + '\n');
    fs.renameSync(cpOut + '.tmp', cpOut);
    fs.writeFileSync(scOut + '.tmp', scRows.join('\n') + '\n');
    fs.renameSync(scOut + '.tmp', scOut);
    console.log(`batch ${b + 1}/${nBatches} done (${slice.length} eps)`);
  }
  console.log('ALL DONE');
}

main().catch((e) => { console.error(e); process.exit(1); });
