// OL-002 support: neighbor-market liveness during PR-005 frozen tails.
// For each favorite-cell episode (stale standing ask 80-96c at t=899,
// derived from endgame_checkpoints.parquet), the frozen interval is
// [t899_ms - age_ms, t899_ms]. A neighbor file (successor = epoch+900,
// predecessor = epoch-900) is ALIVE if it records >= 1 event with
// ts_local_ms inside that interval; SILENT if the file exists but has no
// event inside; NO_FILE if the episode file does not exist locally.
// Successor run re-derives mantis's round-5 classification (67/26/7);
// predecessor run is the new second witness (gap item 3(i)).
//
// Usage: node ol002_liveness.cjs <fav_cell_t899.csv> <out.csv>

const { DuckDBInstance } = require('@duckdb/node-api');
const fs = require('fs');
const path = require('path');

const EPISODE_DIR = '/Users/mijat/Sites/polymarket-bot/data/events/telonex/delta-typed/btc/15m';

async function checkNeighbor(conn, epoch, startMs, endMs) {
  const file = path.join(EPISODE_DIR, `btc-updown-15m-${epoch}.parquet`);
  if (!fs.existsSync(file)) return { status: 'no_file', events: '' };
  const r = await conn.runAndReadAll(
    `SELECT count(*) AS n FROM read_parquet('${file}')
     WHERE ts_local_ms > ${startMs} AND ts_local_ms <= ${endMs}`);
  const n = Number(r.getRowObjects()[0].n);
  return { status: n > 0 ? 'alive' : 'silent', events: n };
}

async function main() {
  const [inPath, outPath] = process.argv.slice(2);
  const rows = fs.readFileSync(inPath, 'utf8').trim().split('\n').slice(1)
    .map(l => { const [slug, epoch, month, age_ms] = l.split(','); return { slug, epoch: Number(epoch), month, age_ms: Number(age_ms) }; });

  const inst = await DuckDBInstance.create(':memory:');
  const conn = await inst.connect();
  await conn.run("SET threads TO 2; SET memory_limit='3GB'");

  const out = ['slug,epoch,month,freeze_start_ms,freeze_end_ms,freeze_dur_s,succ_status,succ_events,pred_status,pred_events'];
  const tally = { succ: { alive: 0, silent: 0, no_file: 0 }, pred: { alive: 0, silent: 0, no_file: 0 } };
  for (const e of rows) {
    const endMs = (e.epoch + 899) * 1000;
    const startMs = endMs - e.age_ms;
    const succ = await checkNeighbor(conn, e.epoch + 900, startMs, endMs);
    const pred = await checkNeighbor(conn, e.epoch - 900, startMs, endMs);
    tally.succ[succ.status]++; tally.pred[pred.status]++;
    out.push([e.slug, e.epoch, e.month, startMs, endMs, ((endMs - startMs) / 1000).toFixed(1),
      succ.status, succ.events, pred.status, pred.events].join(','));
  }
  fs.writeFileSync(outPath, out.join('\n') + '\n');
  console.log('successor:', JSON.stringify(tally.succ));
  console.log('predecessor:', JSON.stringify(tally.pred));
}

main().catch(e => { console.error(e); process.exit(1); });
