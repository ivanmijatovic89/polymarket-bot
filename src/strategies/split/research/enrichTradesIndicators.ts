import fs from "node:fs";
import path from "node:path";
import { EMA, ATR, ADX, BollingerBands } from "technicalindicators";

/**
 * Enrich Polymarket trades with Binance BTCUSDT indicators.
 *
 * Trade -> market start time:
 * - slug format: btc-updown-15m-<unixSeconds>
 * - T0ms = unixSeconds * 1000
 *
 * Snapshot rule (no lookahead):
 * - Use ONLY candles that are closed by the market start boundary.
 * - Binance kline closeTime is the LAST millisecond of the candle (inclusive), e.g. T0ms-1.
 * - So the "15m candle ending at market start" has closeTime = T0ms - 1.
 *
 * Minimal indicators:
 * 1h: atr14Pct, bbWidth, adx14, ema20, ema50, ema20Over50, rv20, rv80, rv20Over80
 * 15m: hlRangePct, wickRatio, atr14Pct, rv20
 * meta: session, hourOfDayUTC, dayOfWeekUTC
 */

// =====================
// Config
// =====================
const BINANCE_BASE = "https://api.binance.com";
const SYMBOL = "BTCUSDT";

const LOOKBACK_1H = 200;
const LOOKBACK_15M = 300;

const PAGE_SLEEP_MS = 120;

// =====================
// Types
// =====================
type TradeIn = {
  slug: string;
  startedAt?: string | number | null;
  isWin: boolean;
  pnl?: number;
  PNL?: number;
};

type Candle = {
  openTime: number; // ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number; // ms (inclusive candle end, e.g. 12:14:59.999)
};

type Features = {
  asOfTimeMs: number; // market start time in ms
  symbol: string;
  tf1h: {
    atr14Pct: number | null;
    bbWidth: number | null;
    adx14: number | null;
    ema20: number | null;
    ema50: number | null;
    ema20Over50: number | null;
    rv20: number | null;
    rv80: number | null;
    rv20Over80: number | null;
  };
  tf15m: {
    hlRangePct: number | null;
    wickRatio: number | null;
    atr14Pct: number | null;
    rv20: number | null;
  };
  meta: {
    session: "ASIA" | "EU" | "US";
    hourOfDayUTC: number; // 0..23
    dayOfWeekUTC: number; // 0..6 (0=Sunday)
  };
};

type TradeOut = {
  slug: string;
  startedAt: string | number | null;
  isWin: boolean;
  pnl: number | null;
  features: Features | null;
  error?: string;
};

// =====================
// Utils
// =====================
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function extractMarketStartSecFromSlug(slug: string): number | null {
  const parts = slug.split("-");
  const last = parts[parts.length - 1];
  const t = Number(last);
  if (!Number.isFinite(t) || !Number.isInteger(t)) return null;
  // sanity: seconds epoch range
  if (t < 1_500_000_000 || t > 2_500_000_000) return null;
  return t;
}

function std(arr: number[]): number {
  const n = arr.length;
  if (n <= 1) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / n;
  const v = arr.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
  return Math.sqrt(v);
}

function realizedVolFromCloses(closes: number[], N: number): number | null {
  // std of log returns over last N returns (needs N+1 closes)
  if (closes.length < N + 1) return null;
  const slice = closes.slice(-(N + 1));
  const rets: number[] = [];
  for (let i = 1; i < slice.length; i++) {
    const a = slice[i - 1];
    const b = slice[i];
    if (!(a > 0 && b > 0)) return null;
    rets.push(Math.log(b / a));
  }
  return std(rets);
}

function sessionFromHourUTC(h: number): "ASIA" | "EU" | "US" {
  if (h >= 0 && h <= 7) return "ASIA";
  if (h >= 8 && h <= 15) return "EU";
  return "US";
}

/**
 * Include candles with closeTime <= asOfMs, return last neededCount.
 * candles must be sorted by time.
 */
function sliceCandlesAsOf(candles: Candle[], asOfMs: number, neededCount: number): Candle[] | null {
  // binary search end index
  let lo = 0;
  let hi = candles.length - 1;
  let endIdx = -1;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid].closeTime <= asOfMs) {
      endIdx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  if (endIdx < 0) return null;
  const eligibleCount = endIdx + 1;
  if (eligibleCount < neededCount) return null;
  return candles.slice(eligibleCount - neededCount, eligibleCount);
}

// =====================
// Binance fetch (paginates automatically)
// =====================
async function fetchKlines(params: {
  symbol: string;
  interval: "1h" | "15m";
  startTimeMs: number;
  endTimeMs: number;
}): Promise<Candle[]> {
  const { symbol, interval, startTimeMs, endTimeMs } = params;

  const out: Candle[] = [];
  let cursor = startTimeMs;

  while (cursor <= endTimeMs) {
    const url = new URL(`${BINANCE_BASE}/api/v3/klines`);
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("interval", interval);
    url.searchParams.set("startTime", String(cursor));
    url.searchParams.set("endTime", String(endTimeMs));
    url.searchParams.set("limit", "1000");

    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Binance klines error ${res.status}: ${text}`);
    }

    const data = (await res.json()) as any[];
    if (!Array.isArray(data) || data.length === 0) break;

    for (const k of data) {
      out.push({
        openTime: Number(k[0]),
        open: Number(k[1]),
        high: Number(k[2]),
        low: Number(k[3]),
        close: Number(k[4]),
        volume: Number(k[5]),
        closeTime: Number(k[6]),
      });
    }

    const lastOpen = out[out.length - 1]?.openTime;
    if (!Number.isFinite(lastOpen)) break;

    const next = lastOpen + 1; // prevent duplicates
    if (next <= cursor) break;
    cursor = next;

    await sleep(PAGE_SLEEP_MS);
    if (data.length < 2) break;
  }

  // dedupe + sort
  const map = new Map<number, Candle>();
  for (const c of out) map.set(c.openTime, c);
  return Array.from(map.values()).sort((a, b) => a.openTime - b.openTime);
}

// =====================
// Indicators
// =====================
function computeIndicators1h(candles1h: Candle[]) {
  const closes = candles1h.map((c) => c.close);
  const highs = candles1h.map((c) => c.high);
  const lows = candles1h.map((c) => c.low);

  const ema20Arr = EMA.calculate({ period: 20, values: closes });
  const ema50Arr = EMA.calculate({ period: 50, values: closes });
  const atrArr = ATR.calculate({ period: 14, high: highs, low: lows, close: closes });
  const adxArr = ADX.calculate({ period: 14, high: highs, low: lows, close: closes });
  const bbArr = BollingerBands.calculate({ period: 20, stdDev: 2, values: closes });

  const lastClose = closes[closes.length - 1];

  const ema20 = ema20Arr.length ? ema20Arr[ema20Arr.length - 1] : null;
  const ema50 = ema50Arr.length ? ema50Arr[ema50Arr.length - 1] : null;

  const atr14 = atrArr.length ? atrArr[atrArr.length - 1] : null;
  const atr14Pct = atr14 != null && lastClose > 0 ? atr14 / lastClose : null;

  const adx14 = adxArr.length ? adxArr[adxArr.length - 1].adx : null;

  const bbLast = bbArr.length ? bbArr[bbArr.length - 1] : null;
  const bbWidth = bbLast && bbLast.middle ? (bbLast.upper - bbLast.lower) / bbLast.middle : null;

  const ema20Over50 = ema20 != null && ema50 != null && ema50 !== 0 ? ema20 / ema50 - 1 : null;

  const rv20 = realizedVolFromCloses(closes, 20);
  const rv80 = realizedVolFromCloses(closes, 80);
  const rv20Over80 = rv20 != null && rv80 != null && rv80 !== 0 ? rv20 / rv80 : null;

  return { atr14Pct, bbWidth, adx14, ema20, ema50, ema20Over50, rv20, rv80, rv20Over80 };
}

function computeIndicators15m(candles15m: Candle[]) {
  const closes = candles15m.map((c) => c.close);
  const highs = candles15m.map((c) => c.high);
  const lows = candles15m.map((c) => c.low);

  const atrArr = ATR.calculate({ period: 14, high: highs, low: lows, close: closes });
  const lastClose = closes[closes.length - 1];
  const atr14 = atrArr.length ? atrArr[atrArr.length - 1] : null;
  const atr14Pct = atr14 != null && lastClose > 0 ? atr14 / lastClose : null;

  const rv20 = realizedVolFromCloses(closes, 20);

  const last = candles15m[candles15m.length - 1];

  const hlRangePct = last.low > 0 ? (last.high - last.low) / last.low : null;

  const body = Math.abs(last.close - last.open);
  const upperWick = last.high - Math.max(last.open, last.close);
  const lowerWick = Math.min(last.open, last.close) - last.low;
  const eps = 1e-12;
  const wickRatio = (upperWick + lowerWick) / Math.max(body, eps);

  return { hlRangePct, wickRatio, atr14Pct, rv20 };
}

// =====================
// IO
// =====================
function readTrades(filePath: string): TradeIn[] {
  const raw = fs.readFileSync(filePath, "utf8");
  const data = JSON.parse(raw);
  if (!Array.isArray(data)) throw new Error("Input JSON must be an array");
  return data as TradeIn[];
}

function writeJson(filePath: string, obj: unknown) {
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), "utf8");
}

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function writeCsv(filePath: string, rows: TradeOut[]) {
  const header = [
    "slug",
    "startedAt",
    "isWin",
    "pnl",
    "asOfTimeMs",
    "symbol",
    "session",
    "hourOfDayUTC",
    "dayOfWeekUTC",
    "tf1h_atr14Pct",
    "tf1h_bbWidth",
    "tf1h_adx14",
    "tf1h_ema20",
    "tf1h_ema50",
    "tf1h_ema20Over50",
    "tf1h_rv20",
    "tf1h_rv80",
    "tf1h_rv20Over80",
    "tf15m_hlRangePct",
    "tf15m_wickRatio",
    "tf15m_atr14Pct",
    "tf15m_rv20",
    "error",
  ];

  const lines: string[] = [];
  lines.push(header.join(","));

  for (const r of rows) {
    const f = r.features;
    const line = [
      r.slug,
      r.startedAt ?? "",
      r.isWin,
      r.pnl ?? "",
      f?.asOfTimeMs ?? "",
      f?.symbol ?? "",
      f?.meta.session ?? "",
      f?.meta.hourOfDayUTC ?? "",
      f?.meta.dayOfWeekUTC ?? "",
      f?.tf1h.atr14Pct ?? "",
      f?.tf1h.bbWidth ?? "",
      f?.tf1h.adx14 ?? "",
      f?.tf1h.ema20 ?? "",
      f?.tf1h.ema50 ?? "",
      f?.tf1h.ema20Over50 ?? "",
      f?.tf1h.rv20 ?? "",
      f?.tf1h.rv80 ?? "",
      f?.tf1h.rv20Over80 ?? "",
      f?.tf15m.hlRangePct ?? "",
      f?.tf15m.wickRatio ?? "",
      f?.tf15m.atr14Pct ?? "",
      f?.tf15m.rv20 ?? "",
      r.error ?? "",
    ].map(csvEscape);

    lines.push(line.join(","));
  }

  fs.writeFileSync(filePath, lines.join("\n"), "utf8");
}

// =====================
// Main
// =====================
async function run() {
  const inPath = process.argv[2];
  const outPath = process.argv[3] ?? "./trades_with_features.json";

  if (!inPath) {
    console.error("Usage: npx tsx enrichTradesIndicators.ts <trades.json> <out.(json|csv)>");
    process.exit(1);
  }

  const trades = readTrades(inPath);

  // Collect market start times from slugs
  const t0sSec: number[] = [];
  for (const t of trades) {
    const sec = extractMarketStartSecFromSlug(t.slug);
    if (sec != null) t0sSec.push(sec);
  }
  if (t0sSec.length === 0) throw new Error("No valid slugs found (expected ...-<unixSeconds>)");

  const minT0ms = Math.min(...t0sSec) * 1000;
  const maxT0ms = Math.max(...t0sSec) * 1000;

  // Bulk-fetch once, then slice per trade
  const start1h = minT0ms - (LOOKBACK_1H + 50) * 60 * 60 * 1000; // buffer
  const start15m = minT0ms - (LOOKBACK_15M + 100) * 15 * 60 * 1000; // buffer
  const endMs = maxT0ms; // include candles closing right before/at last boundary

  console.log(`[fetch] 1h ${SYMBOL} ${new Date(start1h).toISOString()} -> ${new Date(endMs).toISOString()}`);
  const klines1h = await fetchKlines({ symbol: SYMBOL, interval: "1h", startTimeMs: start1h, endTimeMs: endMs });

  console.log(`[fetch] 15m ${SYMBOL} ${new Date(start15m).toISOString()} -> ${new Date(endMs).toISOString()}`);
  const klines15m = await fetchKlines({ symbol: SYMBOL, interval: "15m", startTimeMs: start15m, endTimeMs: endMs });

  console.log(`[fetched] 1h=${klines1h.length} candles, 15m=${klines15m.length} candles`);

  const enriched: TradeOut[] = trades.map((t) => {
    const startSec = extractMarketStartSecFromSlug(t.slug);
    const pnl = typeof t.pnl === "number" ? t.pnl : typeof t.PNL === "number" ? t.PNL : null;

    if (startSec == null) {
      return {
        slug: t.slug,
        startedAt: t.startedAt ?? null,
        isWin: Boolean(t.isWin),
        pnl,
        features: null,
        error: "bad_slug",
      };
    }

    const T0ms = startSec * 1000;

    // Binance closeTime for the candle ending at T0 is T0ms - 1 (inclusive end).
    const asOfMs = T0ms - 1;

    const c1h = sliceCandlesAsOf(klines1h, asOfMs, LOOKBACK_1H);
    const c15m = sliceCandlesAsOf(klines15m, asOfMs, LOOKBACK_15M);

    if (!c1h) {
      return { slug: t.slug, startedAt: t.startedAt ?? null, isWin: Boolean(t.isWin), pnl, features: null, error: "not_enough_1h_history" };
    }
    if (!c15m) {
      return { slug: t.slug, startedAt: t.startedAt ?? null, isWin: Boolean(t.isWin), pnl, features: null, error: "not_enough_15m_history" };
    }

    // Alignment check (now correct for Binance)
    const expected15mClose = T0ms - 1;
    const last15m = c15m[c15m.length - 1];
    if (last15m.closeTime !== expected15mClose) {
      return {
        slug: t.slug,
        startedAt: t.startedAt ?? null,
        isWin: Boolean(t.isWin),
        pnl,
        features: null,
        error: `missing_15m_close_at_T0msMinus1(lastClose=${last15m.closeTime},expected=${expected15mClose},T0=${T0ms})`,
      };
    }

    const tf1h = computeIndicators1h(c1h);
    const tf15m = computeIndicators15m(c15m);

    const d = new Date(T0ms);
    const hourUTC = d.getUTCHours();
    const dayUTC = d.getUTCDay();

    const features: Features = {
      asOfTimeMs: T0ms, // keep market boundary for your analysis; internally we used asOfMs=T0-1
      symbol: SYMBOL,
      tf1h,
      tf15m,
      meta: {
        session: sessionFromHourUTC(hourUTC),
        hourOfDayUTC: hourUTC,
        dayOfWeekUTC: dayUTC,
      },
    };

    return {
      slug: t.slug,
      startedAt: t.startedAt ?? null,
      isWin: Boolean(t.isWin),
      pnl,
      features,
    };
  });

  // Always write JSON
  writeJson(outPath, enriched);

  // Also write CSV alongside JSON
  const csvPath =
    outPath.toLowerCase().endsWith(".json")
      ? outPath.replace(/\.json$/i, ".csv")
      : `${outPath}.csv`;

  writeCsv(csvPath, enriched);

  console.log(`✅ Wrote JSON: ${path.resolve(outPath)}`);
  console.log(`✅ Wrote CSV : ${path.resolve(csvPath)}`);
}

run().catch((e) => {
  console.error("❌ Failed:", e);
  process.exit(1);
});
