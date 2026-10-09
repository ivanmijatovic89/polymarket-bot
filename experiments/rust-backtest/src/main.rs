use sha2::{Digest as ShaDigest, Sha256};
mod context;
mod engine;
mod feeds;
mod fixtures;
mod portfolio;
mod raw_feeds;
mod stats;
mod strategy;
mod types;
use anyhow::{bail, ensure, Context, Result};
use feeds::*;
use parquet::{
    file::reader::{FileReader, SerializedFileReader},
    record::{Field, Row},
};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    fs::File,
    io::{BufReader, BufWriter},
    time::Instant,
};
use strategy::*;
use types::*;

const STRATEGY: &str = "overnight-opus55-lagsnipe.v15";
const ARTIFACT: &str = "304eceb346bdd813d3acda0f5fac38b657237bed8195352b5346c330f6d78ab8";
fn number(f: &Field) -> Result<f64> {
    match f {
        Field::Double(v) => Ok(*v),
        Field::Float(v) => Ok(*v as f64),
        Field::Long(v) => Ok(*v as f64),
        Field::Int(v) => Ok(*v as f64),
        Field::Byte(v) => Ok(*v as f64),
        Field::Short(v) => Ok(*v as f64),
        Field::UByte(v) => Ok(*v as f64),
        Field::UInt(v) => Ok(*v as f64),
        Field::ULong(v) => Ok(*v as f64),
        Field::Str(v) => Ok(v.parse()?),
        Field::Null => Ok(0.0),
        _ => bail!("Unsupported numeric field: {f:?}"),
    }
}
fn text(f: &Field) -> Option<&str> {
    if let Field::Str(s) = f {
        Some(s)
    } else {
        None
    }
}
fn list(f: &Field) -> Result<&[Field]> {
    match f {
        Field::Null => Ok(&[]),
        Field::ListInternal(v) => Ok(v.elements()),
        _ => bail!("Expected repeated list: {f:?}"),
    }
}
struct RawEvent {
    kind: u8,
    ts: i64,
    local: Option<i64>,
    seq: f64,
    snapshot: Option<(usize, Vec<Level>, Vec<Level>)>,
    changes: Vec<(usize, bool, f64, f64)>,
}
struct Decoder {
    columns: BTreeMap<String, usize>,
}
impl Decoder {
    fn new(row: &Row) -> Self {
        Self {
            columns: row
                .get_column_iter()
                .enumerate()
                .map(|(i, (name, _))| (name.clone(), i))
                .collect(),
        }
    }
    fn decode(&self, row: Row, m: &Market) -> Result<Option<RawEvent>> {
        let cols = row.into_columns();
        let field = |name: &str| -> Result<&Field> {
            let i = *self
                .columns
                .get(name)
                .with_context(|| format!("Missing column {name}"))?;
            let (actual, v) = cols.get(i).context("Missing row column")?;
            ensure!(actual == name, "Column order changed");
            Ok(v)
        };
        let kind = match text(field("event_type")?) {
            Some("book") => 0,
            Some("price_change") => 1,
            _ => return Ok(None),
        };
        let market = text(field("market")?).context("Missing market")?;
        ensure!(
            market == m.market_id,
            "Market identity differs from manifest"
        );
        let ts = number(field("ts_exchange_ms")?)? as i64;
        let local = number(field("ts_local_ms")?)? as i64;
        let seq = number(field("ingest_seq")?)?;
        ensure!(
            seq <= 9007199254740991.0,
            "Sequence exceeds exact f64 digest range"
        );
        let ids = [text(field("asset0_id")?), text(field("asset1_id")?)];
        let asset = |index: f64| -> Result<usize> {
            ensure!(index == 0.0 || index == 1.0, "Invalid asset index");
            let id = ids[index as usize].context("Missing asset ID")?;
            if id == m.up_id {
                Ok(0)
            } else if id == m.down_id {
                Ok(1)
            } else {
                bail!("Unknown outcome token {id}")
            }
        };
        let levels = |prices: &str, sizes: &str, buy: bool| -> Result<Vec<Level>> {
            let ps = list(field(prices)?)?;
            let ss = list(field(sizes)?)?;
            let mut out = Vec::new();
            for (p, s) in ps.iter().zip(ss) {
                let price = number(p)?;
                let size = number(s)?;
                ensure!(
                    price.is_finite() && size.is_finite(),
                    "Nonfinite book level"
                );
                if size > 0.0 {
                    out.push(Level { price, size });
                }
            }
            out.sort_by(|a, b| {
                if buy {
                    b.price.total_cmp(&a.price)
                } else {
                    a.price.total_cmp(&b.price)
                }
            });
            let mut unique: Vec<Level> = Vec::with_capacity(out.len());
            for l in out {
                if let Some(prev) = unique.last_mut().filter(|p| p.price == l.price) {
                    *prev = l;
                } else {
                    unique.push(l);
                }
            }
            Ok(unique)
        };
        let mut ev = RawEvent {
            kind,
            ts,
            local: if local > 0 { Some(local) } else { None },
            seq,
            snapshot: None,
            changes: Vec::new(),
        };
        if kind == 0 {
            ev.snapshot = Some((
                asset(number(field("asset_index")?)?)?,
                levels("bid_prices", "bid_sizes", true)?,
                levels("ask_prices", "ask_sizes", false)?,
            ));
        } else {
            let aa = list(field("change_asset_indexes")?)?;
            let sides = list(field("change_side_codes")?)?;
            let prices = list(field("change_prices")?)?;
            let sizes = list(field("change_sizes")?)?;
            for (((a, side), p), s) in aa.iter().zip(sides).zip(prices).zip(sizes) {
                let side = number(side)?;
                ensure!(side == 0.0 || side == 1.0, "Invalid side code");
                let price = number(p)?;
                let size = number(s)?;
                ensure!(price.is_finite() && size.is_finite(), "Nonfinite delta");
                ev.changes
                    .push((asset(number(a)?)?, side == 0.0, price, size));
            }
            if ev.changes.is_empty() {
                return Ok(None);
            }
        }
        Ok(Some(ev))
    }
}
struct Sim<'a> {
    m: &'a Market,
    s: &'a Settings,
    c: &'a Params,
    books: [Book; 2],
    book_ts: Option<i64>,
    strategy: Strategy,
    engine: engine::LocalEngine,
    snapshots: [context::BookSnapshot; 2],
    trades: Vec<Value>,
    splits: Vec<Value>,
    seen_fills: std::collections::HashSet<String>,
    seen_splits: std::collections::HashSet<String>,
    context_digest: Digest,
    cached_context: Option<context::Metrics>,
    cached_feeds: FeedSnapshot,
    provider: FeedProvider,

    schedule_index: usize,
    counts: BTreeMap<&'static str, u64>,
    trace: bool,
    log_events: bool,
    depth: usize,
    digest: Digest,
    feed_digest: Digest,
    decisions: Vec<Value>,
    events: Vec<Value>,
}
impl<'a> Sim<'a> {
    fn new(
        m: &'a Market,
        s: &'a Settings,
        c: &'a Params,
        feeds: Feeds,
        trace: bool,
        depth: usize,
    ) -> Self {
        Self {
            m,
            s,
            c,
            books: [Book::default(), Book::default()],
            book_ts: None,
            strategy: Strategy::new(),
            engine: engine::LocalEngine::new(
                s.starting_capital,
                m.market_id.clone(),
                [m.up_id.clone(), m.down_id.clone()],
                s.delay_ms,
                if s.delay_ms > 0 { s.jitter_ms } else { 0 },
                s.seed,
            ),
            snapshots: std::array::from_fn(|_| context::BookSnapshot::new(&Book::default(), depth)),
            trades: Vec::new(),
            splits: Vec::new(),
            seen_fills: std::collections::HashSet::new(),
            seen_splits: std::collections::HashSet::new(),
            context_digest: Digest::new(),
            cached_context: None,
            cached_feeds: FeedSnapshot::default(),
            provider: FeedProvider::new(feeds, m, s),

            schedule_index: 0,
            counts: BTreeMap::new(),
            trace,
            log_events: std::env::var("RUST_BACKTEST_LOG_EVENTS").as_deref() == Ok("1"),
            depth,
            digest: Digest::new(),
            feed_digest: Digest::new(),
            decisions: Vec::new(),
            events: Vec::new(),
        }
    }
    fn process_events(&mut self, events: Vec<Value>) {
        // Match StrategyRunner: drop queued events after the configured drain limit.
        for event in events.into_iter().take(4200) {
            if portfolio::s(&event, "kind") == "fill" {
                let fill = &event["fill"];
                let notional =
                    portfolio::r(portfolio::n(fill, "price") * portfolio::n(fill, "size"));
                let mut diagnostic = fill.clone();
                diagnostic["timeIso"] = json!(context::iso(portfolio::n(fill, "tsMs") as i64));
                diagnostic["notional"] = json!(notional);
                diagnostic["cashDelta"] = json!(if portfolio::s(fill, "side") == "BUY" {
                    portfolio::r(-notional)
                } else {
                    notional
                });
                diagnostic["feePaid"] = json!(if portfolio::s(fill, "liquidity") == "TAKER" {
                    portfolio::r(portfolio::taker_fee(
                        portfolio::n(fill, "price"),
                        portfolio::n(fill, "size"),
                        portfolio::n(fill, "feeRateBps"),
                    ))
                } else {
                    0.0
                });
                if self.log_events {
                    println!("{{\"message\":\"[trade]\",\"extra\":{diagnostic}}}");
                }
                std::hint::black_box(diagnostic);
            }
            self.engine.ledger.apply(&event);
            self.engine.reconcile(&event);
            let metrics = context::Metrics::new(
                &self.engine.ledger,
                &self.engine.assets,
                &self.snapshots,
                self.depth,
            );
            std::hint::black_box(&metrics);
            let decision_portfolio = self.engine.decision_snapshot();
            std::hint::black_box(&decision_portfolio);
            if self.trace {
                self.events.push(
                    json!({"event":event,"portfolio":decision_portfolio,"metrics":metrics.value()}),
                );
            }
            // The frozen strategy's account callback returns no intents.
            self.strategy.on_account_event(&event);
        }
    }
    fn submit(&mut self, d: Decision, ts: i64) {
        let intent = json!({"kind":"place_limit","clientOrderId":format!("{STRATEGY}:{}:{}",self.m.slug,d.seq),"assetId":if d.asset==0{&self.m.up_id}else{&self.m.down_id},"side":"BUY","price":d.price,"size":d.size,"orderType":"FOK","meta":d.meta,"reason":d.reason});
        if self.trace {
            self.decisions
                .push(json!({"origin":"market","tsMs":ts,"intent":intent}));
        }
        let events = self.engine.handle(vec![intent], ts, &self.books, false);
        self.process_events(events);
    }
    fn dispatch(&mut self, kind: u8, ts: i64, seq: f64, local: Option<i64>) {
        let name = [
            "book",
            "price_change",
            "binance_agg_trade",
            "chainlink_round",
        ][kind as usize];
        *self.counts.entry(name).or_default() += 1;
        if ts < self.m.start_ms || ts > self.m.end_ms {
            return;
        }
        if self.trace {
            self.digest
                .tick(kind, ts, seq, local, &self.books, self.depth);
        }
        self.engine.ledger.initialize(ts);
        if kind < 2 {
            let events = self.engine.tick(ts, &self.books);
            self.process_events(events);
        }
        self.engine.ledger.snapshot();
        let metrics = context::Metrics::new(
            &self.engine.ledger,
            &self.engine.assets,
            &self.snapshots,
            self.depth,
        );
        std::hint::black_box(&metrics);
        if self.trace {
            metrics.digest(&mut self.context_digest);
        }
        self.cached_context = Some(metrics);
        let clock = ts.max(local.unwrap_or(ts));
        let f = self.provider.snapshot(clock, self.m, self.s);
        self.cached_feeds = f;
        if self.trace {
            for v in [
                f.binance,
                f.binance_received,
                f.chainlink,
                f.chainlink_received,
                f.price_to_beat,
                f.binance_ts,
                f.chainlink_ts,
                f.ptb_received,
            ] {
                self.feed_digest.number(v.unwrap_or(f64::NAN));
            }
        }
        if let Some(d) =
            self.strategy
                .tick(ts, &self.snapshots, f, &self.engine.ledger, self.c, self.m)
        {
            self.submit(d, ts);
        }
        self.engine.ledger.snapshot();
        for fill in &self.engine.ledger.fills {
            let id = portfolio::s(fill, "id");
            if portfolio::s(fill, "market") == self.m.market_id
                && self.seen_fills.insert(id.to_owned())
            {
                let mut trade = fill.clone();
                if let Some(order) = self
                    .engine
                    .ledger
                    .history
                    .get(portfolio::s(fill, "clientOrderId"))
                {
                    if let Some(meta) = order.get("meta") {
                        trade["intentMeta"] = meta.clone();
                    }
                }
                self.trades.push(trade);
            }
        }
        for split in &self.engine.ledger.splits {
            if portfolio::s(split, "market") == self.m.market_id
                && self
                    .seen_splits
                    .insert(portfolio::s(split, "id").to_owned())
            {
                self.splits.push(split.clone());
            }
        }
    }
    fn flush(&mut self, clock: i64) {
        while self.schedule_index < self.provider.schedule.len()
            && self.provider.schedule[self.schedule_index].0 < clock
        {
            let (visibility, kind) = self.provider.schedule[self.schedule_index];
            self.schedule_index += 1;
            if let Some(ts) = self.book_ts {
                self.dispatch(kind, visibility.max(ts), 0.0, Some(visibility));
            }
        }
    }
    fn raw(&mut self, e: RawEvent) {
        self.flush(e.ts.max(e.local.unwrap_or(e.ts)));
        if let Some((asset, bids, asks)) = e.snapshot {
            self.books[asset] = Book {
                exists: true,
                ts: e.ts,
                bids,
                asks,
            };
        }
        for (asset, buy, price, size) in e.changes {
            self.books[asset].change(buy, price, size);
            self.books[asset].ts = e.ts;
        }
        self.snapshots =
            std::array::from_fn(|i| context::BookSnapshot::new(&self.books[i], self.depth));
        self.book_ts = Some(e.ts);
        self.dispatch(e.kind, e.ts, e.seq, e.local);
    }
}
fn run(m: &Market, s: &Settings, c: &Params, trace: bool, depth: usize) -> Result<Value> {
    let started = Instant::now();
    let started_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)?
        .as_millis();
    let feeds: Feeds = match &m.raw_feeds {
        Some(files) => raw_feeds::load(files, m)?,
        None => serde_json::from_reader(BufReader::new(File::open(&m.feeds)?))?,
    };
    let mut sim = Sim::new(m, s, c, feeds, trace, depth);
    if sim.log_events {
        println!(
            "{}",
            json!({"message":"feed_summary","extra":{"slug":m.slug,"binanceCount":sim.provider.feeds.binance.len(),"chainlinkCount":sim.provider.feeds.chainlink.len(),"priceToBeat":m.price_to_beat,"syntheticCount":sim.provider.schedule.len()}})
        );
    }
    let reader = SerializedFileReader::new(File::open(&m.file_path)?)?;
    let mut decoder = None;
    for row in reader.get_row_iter(None)? {
        let row = row?;
        let d = decoder.get_or_insert_with(|| Decoder::new(&row));
        if let Some(e) = d.decode(row, m)? {
            sim.raw(e);
        }
    }
    sim.flush(i64::MAX);
    let snapshot = sim.engine.ledger.snapshot().clone();
    let mut market_stats = stats::market(
        &m.slug,
        &m.market_id,
        &sim.engine.assets,
        &m.outcome,
        &snapshot,
        &sim.trades,
        &sim.splits,
    );
    if sim.trades.is_empty() && sim.splits.is_empty() && sim.engine.ledger.positions.is_empty() {
        market_stats["skipReason"] = json!("no_in_window_activity");
    }
    market_stats["execution"] = json!({"machineId":"rust-experiment","workerChildId":null,"startedAtMs":started_at,"finishedAtMs":std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)?.as_millis(),"durationMs":started.elapsed().as_secs_f64()*1000.0,"eventsProcessed":sim.counts.values().sum::<u64>(),"eventsByType":sim.counts,"commitSha":"42bcc992"});
    let mut out = json!({"slug":m.slug,"eventsProcessed":sim.counts.values().sum::<u64>(),"eventsByType":sim.counts,"stats":market_stats,"durationMs":started.elapsed().as_secs_f64()*1000.0});
    if trace {
        out["tickDigest"] = json!(sim.digest.value);
        out["feedDigest"] = json!(sim.feed_digest.value);
        out["tickSha256"] = json!(sim.digest.sha256());
        out["feedSha256"] = json!(sim.feed_digest.sha256());
        out["decisions"] = json!(sim.decisions);
        out["events"] = json!(sim.events);
        out["finalState"] = snapshot;
        out["finalContext"] = json!({"plugins":{"externalFeeds":sim.cached_feeds.value(m)},"market":context::market_meta(m),"metrics":sim.cached_context.as_ref().map(|v|v.value())});
        out["contextDigest"] = json!(sim.context_digest.value);
        out["contextSha256"] = json!(sim.context_digest.sha256());
    }
    Ok(out)
}
fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    ensure!(
        args.len() >= 3,
        "Usage: rust-backtest-experiment manifest.json output.json [trace|no-trace|verify-feeds] [market-index]"
    );
    if args[1] == "fixtures" || args[1] == "aggregate" {
        let input: Value = serde_json::from_reader(BufReader::new(File::open(&args[2])?))?;
        let out = if args[1] == "fixtures" {
            fixtures::run(&input)
        } else {
            let markets = input["markets"].as_array().context("Missing stats")?;
            let initial = portfolio::n(&input, "initialCapital");
            json!({"batch":stats::batch(markets,initial),"segments":stats::segments(markets,initial)})
        };
        serde_json::to_writer(
            BufWriter::new(File::create(args.get(3).context("Missing output")?)?),
            &out,
        )?;
        return Ok(());
    }
    let manifest: Manifest = serde_json::from_reader(BufReader::new(File::open(&args[1])?))?;
    ensure!(
        manifest.format_version == 1
            && manifest.strategy == STRATEGY
            && manifest.artifact_sha256 == ARTIFACT,
        "Only the pinned v15 artifact and fixture format 1 are supported"
    );
    let s = &manifest.settings;
    ensure!(
        s.seed != 0
            && s.delay_ms >= 0
            && s.jitter_ms >= 0
            && s.starting_capital.is_finite()
            && s.starting_capital >= 0.0,
        "Invalid settings"
    );
    let depth = std::env::var("WEB_UI_ORDERBOOK_LEVELS")
        .ok()
        .filter(|v| !v.is_empty())
        .map(|v| v.parse::<f64>())
        .transpose()?
        .unwrap_or(10.0)
        .floor()
        .max(1.0) as usize;
    let raw_mode = manifest.markets.iter().all(|m| m.raw_feeds.is_some());
    ensure!(
        raw_mode || manifest.markets.iter().all(|m| m.raw_feeds.is_none()),
        "Mixed raw/prepared feed modes are unsupported"
    );
    if args.get(3).is_some_and(|v| v == "verify-feeds") {
        ensure!(
            raw_mode,
            "Feed verification requires original Parquet paths"
        );
        let started = Instant::now();
        let mut binance_rows = 0;
        let mut chainlink_rows = 0;
        for (i, m) in manifest.markets.iter().enumerate() {
            let actual = raw_feeds::load(m.raw_feeds.as_ref().unwrap(), m)?;
            let reference: Feeds = serde_json::from_reader(BufReader::new(File::open(&m.feeds)?))?;
            ensure!(
                actual.binance == reference.binance,
                "Binance series differs for {}",
                m.slug
            );
            ensure!(
                actual.chainlink == reference.chainlink,
                "Chainlink series differs for {}",
                m.slug
            );
            binance_rows += actual.binance.len();
            chainlink_rows += actual.chainlink.len();
            if (i + 1) % 25 == 0 {
                eprintln!(
                    "Feed parity: {} markets, {:.1} s, last={}",
                    i + 1,
                    started.elapsed().as_secs_f64(),
                    m.slug
                );
            }
        }
        serde_json::to_writer(
            BufWriter::new(File::create(&args[2])?),
            &json!({"marketCount":manifest.markets.len(),"binanceRows":binance_rows,"chainlinkRows":chainlink_rows,"exactSeriesParity":true,"manifestSha256":format!("{:x}",Sha256::digest(std::fs::read(&args[1])?)),"durationMs":started.elapsed().as_secs_f64()*1000.0}),
        )?;
        return Ok(());
    }
    let trace = args.get(3).is_some_and(|v| v == "trace");
    let started = Instant::now();
    let mut results = Vec::new();
    let progress_every = std::env::var("BENCHMARK_PROGRESS_EVERY")
        .ok()
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(0);
    let chosen = args.get(4).map(|v| v.parse::<usize>()).transpose()?;
    for (i, m) in manifest.markets.iter().enumerate() {
        if chosen.is_some_and(|x| x != i) {
            continue;
        }
        ensure!(
            m.end_ms - m.start_ms == 900000 && (m.outcome == "UP" || m.outcome == "DOWN"),
            "Unsupported market window or outcome"
        );
        results.push(
            run(m, s, &manifest.params, trace, depth)
                .with_context(|| format!("Replay failed for {}", m.slug))?,
        );
        if progress_every > 0 && results.len() % progress_every == 0 {
            eprintln!(
                "Progress: {} markets, {:.1} s, last={}",
                results.len(),
                started.elapsed().as_secs_f64(),
                m.slug
            );
        }
    }
    ensure!(!results.is_empty(), "No market selected");
    serde_json::to_writer(
        BufWriter::new(File::create(&args[2])?),
        &json!({"engine":"rust","manifestSha256":format!("{:x}",Sha256::digest(std::fs::read(&args[1])?)),"mode":if raw_mode { "raw-parquet" } else { "prepared" },"trace":trace,"durationMs":started.elapsed().as_secs_f64()*1000.0,"results":results}),
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn js_round_negative_ties() {
        assert_eq!(round(-1.005, 2), -1.0);
        assert_eq!(js_round(-1.5), -1.0);
    }
    #[test]
    fn fee_per_fill() {
        assert_eq!(portfolio::taker_fee(0.5, 10.0, 700.0), 0.175);
        assert_eq!(portfolio::buy_cost(0.5, 10.0, false), 5.175);
    }
    #[test]
    fn sorted_delta_replacement_and_deletion() {
        let mut b = Book::default();
        b.change(true, 0.3, 2.0);
        b.change(true, 0.6, 1.0);
        b.change(true, 0.3, 7.0);
        assert_eq!(b.bids[0].price, 0.6);
        assert_eq!(b.bids[1].size, 7.0);
        b.change(true, 0.6, 0.0);
        assert_eq!(b.bids[0].price, 0.3);
    }
    #[test]
    fn random_matches_xorshift_reference() {
        let mut r = Random::new(123456789);
        assert_eq!(r.next(), 0.6321277192328125);
        assert_eq!(r.next(), 0.5212643640115857);
    }
    #[test]
    fn synthetic_tie_and_visibility() {
        let m:Market=serde_json::from_value(json!({"slug":"m","filePath":"m","feeds":"m","startMs":1000,"endMs":901000,"marketId":"x","upId":"u","downId":"d","outcome":"UP","priceToBeat":10})).unwrap();
        let s = Settings {
            starting_capital: 100.0,
            delay_ms: 500,
            jitter_ms: 20,
            binance_latency_ms: 110,
            chainlink_latency_ms: 320,
            price_to_beat_latency_ms: 2700,
            seed: 1,
        };
        let f = Feeds {
            binance: vec![[1000.0, 5.0], [1000.0, 6.0]],
            chainlink: vec![[900.0, 790.0, 4.0]],
        };
        let mut p = FeedProvider::new(f, &m, &s);
        assert_eq!(p.schedule, vec![(1110, 2), (1110, 2), (1110, 3)]);
        assert_eq!(p.snapshot(1109, &m, &s).binance, None);
        assert_eq!(p.snapshot(1110, &m, &s).binance, Some(6.0));
        assert_eq!(p.snapshot(1000, &m, &s).chainlink, Some(4.0));
    }
    fn test_inputs() -> (Market, Settings, Params) {
        let plan: Value = serde_json::from_str(include_str!("../sample-plan.json")).unwrap();
        let params: Params = serde_json::from_value(plan["params"].clone()).unwrap();
        let market: Market = serde_json::from_value(json!({"slug":"btc-updown-15m-1","filePath":"unused","feeds":"unused","startMs":1000,"endMs":901000,"marketId":"market","upId":"up","downId":"down","outcome":"UP","priceToBeat":100.0})).unwrap();
        let settings = Settings {
            starting_capital: 100.0,
            delay_ms: 500,
            jitter_ms: 0,
            binance_latency_ms: 110,
            chainlink_latency_ms: 320,
            price_to_beat_latency_ms: 2700,
            seed: 123456789,
        };
        (market, settings, params)
    }
    #[test]
    fn pnl_cent_boundary_matches_shared_statistics_operation_order() {
        let (m, _, _) = test_inputs();
        let p = json!({"positionsByAssetId":{"up":{"qty":149.23,"costBasis":78.7178},"down":{"qty":40.82,"costBasis":20.6072}}});
        assert_eq!(
            stats::market(
                &m.slug,
                &m.market_id,
                &[m.up_id, m.down_id],
                &m.outcome,
                &p,
                &[],
                &[]
            )["pnl"],
            json!(49.91)
        );
    }
    #[test]
    fn delayed_fok_waits_for_real_tick_and_fills_once() {
        let (m, s, c) = test_inputs();
        let mut sim = Sim::new(
            &m,
            &s,
            &c,
            Feeds {
                binance: vec![],
                chainlink: vec![],
            },
            true,
            10,
        );
        sim.books[0] = Book {
            exists: true,
            ts: 1000,
            bids: vec![],
            asks: vec![
                Level {
                    price: 0.4,
                    size: 6.0,
                },
                Level {
                    price: 0.5,
                    size: 4.0,
                },
            ],
        };
        sim.submit(
            Decision {
                asset: 0,
                price: 0.5,
                size: 10.0,
                seq: 1,
                meta: json!({}),
                reason: String::new(),
            },
            1000,
        );
        assert_eq!(sim.engine.ledger.reserved(), 5.175);
        sim.dispatch(2, 1500, 0.0, Some(1500));
        assert_eq!(sim.engine.ledger.cash, 100.0);
        assert!(sim.engine.ledger.fills.is_empty());
        sim.dispatch(0, 1600, 2.0, Some(1600));
        assert_eq!(sim.engine.ledger.fills.len(), 2);
        assert_eq!(sim.engine.ledger.cash, 95.4292);
        assert_eq!(
            portfolio::n(&sim.engine.ledger.positions[&m.up_id], "qty"),
            10.0
        );
        assert_eq!(
            portfolio::n(&sim.engine.ledger.positions[&m.up_id], "costBasis"),
            4.5708
        );
        assert_eq!(sim.engine.ledger.reserved(), 0.0);
        sim.dispatch(0, 1700, 3.0, Some(1700));
        assert_eq!(sim.engine.ledger.fills.len(), 2);
        assert_eq!(
            sim.events
                .iter()
                .map(|v| v["event"]["kind"].as_str().unwrap())
                .collect::<Vec<_>>(),
            vec![
                "order_submitted",
                "order_accepted",
                "ws_order_update",
                "fill",
                "fill",
                "order_done",
                "ws_order_update"
            ]
        );
        assert_eq!(sim.events[3]["event"]["fill"]["tsMs"], json!(1600));
    }
    #[test]
    fn insufficient_fok_releases_reservation_without_partial_fill() {
        let (m, s, c) = test_inputs();
        let mut sim = Sim::new(
            &m,
            &s,
            &c,
            Feeds {
                binance: vec![],
                chainlink: vec![],
            },
            true,
            10,
        );
        sim.books[0] = Book {
            exists: true,
            ts: 1000,
            bids: vec![],
            asks: vec![Level {
                price: 0.5,
                size: 6.0,
            }],
        };
        sim.submit(
            Decision {
                asset: 0,
                price: 0.5,
                size: 10.0,
                seq: 1,
                meta: json!({}),
                reason: String::new(),
            },
            1000,
        );
        sim.dispatch(0, 1500, 2.0, Some(1500));
        assert_eq!(sim.engine.ledger.cash, 100.0);
        assert_eq!(sim.engine.ledger.reserved(), 0.0);
        assert!(sim.engine.ledger.fills.is_empty());
        assert!(sim.engine.ledger.open.is_empty());
        assert_eq!(
            sim.events.last().unwrap()["event"]["reason"],
            json!("killed")
        );
    }
    #[test]
    fn trace_free_callbacks_build_the_same_full_snapshots_as_traced_callbacks() {
        let (m, s, c) = test_inputs();
        let mut results = Vec::new();
        for trace in [false, true] {
            let mut sim = Sim::new(
                &m,
                &s,
                &c,
                Feeds {
                    binance: vec![],
                    chainlink: vec![],
                },
                trace,
                10,
            );
            sim.books[0] = Book {
                exists: true,
                ts: 1000,
                bids: vec![],
                asks: vec![Level {
                    price: 0.5,
                    size: 10.0,
                }],
            };
            sim.submit(
                Decision {
                    asset: 0,
                    price: 0.5,
                    size: 10.0,
                    seq: 1,
                    meta: json!({"case":"same-work"}),
                    reason: String::new(),
                },
                1000,
            );
            sim.dispatch(0, 1600, 2.0, Some(1600));
            let snapshot = sim.engine.ledger.snapshot().clone();
            results.push((snapshot, sim.engine.ledger.snapshot_rebuilds));
        }
        assert_eq!(results[0], results[1]);
        assert!(
            results[0].1 >= 7,
            "each account callback must consume a rebuilt complete snapshot"
        );
    }
    #[test]
    fn risk_rejection_does_not_create_execution_obligation() {
        let (m, s, c) = test_inputs();
        let mut sim = Sim::new(
            &m,
            &s,
            &c,
            Feeds {
                binance: vec![],
                chainlink: vec![],
            },
            true,
            10,
        );
        sim.submit(
            Decision {
                asset: 0,
                price: 0.5,
                size: 2001.0,
                seq: 1,
                meta: json!({}),
                reason: String::new(),
            },
            1000,
        );
        assert!(sim.engine.ledger.open.is_empty());
        assert_eq!(sim.events[0]["event"]["kind"], json!("order_rejected"));
        assert_eq!(
            sim.events[0]["event"]["reason"],
            json!("risk_max_order_size(max=2000)")
        );
    }
}
