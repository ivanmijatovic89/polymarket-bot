# 10 — Exchange facts (CLOB V2 adapter and probe session P0)

> Citations of the form `11 §…`, `50 §…`, `51 §…`, `02-decisions.md`, `early-audits` refer to the previous attempt's spec on branch `native-engine` (`native/spec/` there), not to files in this tree. `11-v4-input.md` in this tree is a different document.

Reference for the first milestone: a minimal CLOB V2 exchange adapter plus
user-run probe sessions. Every fact is copied from the old spec or repo docs
and cited; nothing here is new evidence. Paths are relative to the
repository root. Abbreviations: `11` = `native/spec/11-exchange-rules.md`,
`50` = `native/spec/50-live-runtime.md`, `51` = `native/spec/51-calibration-plan.md`,
`EA` = `native/spec/research/early-audits.md` section A (row number after `A`).
The old spec fetched docs pages on 2026-10-09 (11:60) and dates the audit
2026-10-08 (EA:1).

Status vocabulary: **verified** = observed or charged data in this repo
(class C/S in 11 §2.1); **documented-unverified** = official docs or
changelog (classes P/L), never checked against our own orders;
**third-party** = class T; **assumed** = class A. **UNKNOWN** marks an item
the old spec itself lists as unknown or as a probe item.

## 1. CLOB V2 facts the adapter depends on

| Fact | Value per sources | Status | Source |
|---|---|---|---|
| V2 cutover | CLOB V2 since 2026-04-28; V1-signed orders unsupported in production; "fees set at match time" | documented-unverified | EA A14 (EA:23); `docs/live-trading/live-trading-bot.md:10-12` |
| TS live is broken | Installed `@polymarket/clob-client` 5.8.1 signs V1 (issue #249); live trading must stay disabled until signing and collateral migration is done | documented (repo) | EA A14; `docs/polymarket/index.md:205`; `package.json:217` (`^5.1.2`, lockfile resolves 5.8.1) |
| Signed order struct | `salt, maker, signer, tokenId, makerAmount, takerAmount, side, signatureType, timestamp (ms), metadata (bytes32), builder (bytes32)`; V1 fields `taker, expiration, nonce, feeRateBps` removed; `expiration` stays in the POST body for GTD only | documented-unverified | 50 §8.2.2 (50:431-434); EA A14 |
| EIP-712 domain | name `Polymarket CTF Exchange`; per market: CTF v1 non-negRisk → version "2", `0xE111180000d2663C0091e4f400237545B87B996B`; CTF v1 negRisk → "2", `0xe2222d279d744050d28e00520010520000310F59`; Gamma `version:"v2"` → "3", `0xe3333700cA9d93003F00f0F71f8515005F6c00Aa`. Only the first is in scope (BTC 5m/15m today); others refused by a version guard | documented-unverified | 11 §10 (11:461-465); 50:426-429 |
| Signing details | `makerAmount`/`takerAmount` integers in 1e-6 units; rounding recipe "round up to amount decimals + 4, then down to amount decimals"; `salt` from OS CSPRNG, journaled; `timestamp` = egress wall ms; `metadata`/`builder` zero unless a builder code is set; signatures deterministic (RFC 6979) | documented-unverified | 50:436-453; 11 TK4 (11:374-379) |
| Golden vectors | Rust signatures, hashes and POST bodies must match `@polymarket/clob-client-v2` byte for byte (offline fixture, throwaway key). That package is **not installed** in this repo | spec rule | 50:453-459; `node_modules/@polymarket` (only `clob-client`, `builder-relayer-client`, `builder-signing-sdk`) |
| Market version, asset ids | Gamma `version`: `v1` → `clobTokenIds` (JSON string), `v2` → `positionIds` (array); choose by `version`, not field presence. Every BTC 15m fixture is `v1`, `negRisk:false`; negRisk markets out of scope | verified (fixtures) | 11 §10 V1-V4 (11:453-472) |
| negRisk source | Gamma only; CLOB `ClobMarketDetails` has `t, mos, mts, mbf, tbf, rfqe, itode, ibce, fd{r,e,to}, oas, gst, r` and no negRisk | documented-unverified | 11 K8 (11:89) |
| Collateral | pUSD. Adapter balance = CLOB COLLATERAL balance via `GET /balance-allowance?asset_type=COLLATERAL`. TS on-chain stack is still USDC.e and V1-only | documented-unverified | EA A14; 50 §10.1 (50:722-724); 50 §16 (50:982-989); `src/polymarket/contractAddresses.ts:4` |
| L2 auth | HMAC headers `POLY_ADDRESS, POLY_SIGNATURE, POLY_TIMESTAMP, POLY_API_KEY, POLY_PASSPHRASE`; signature over timestamp + method + path + exact body bytes; ClobAuthDomain stays version "1". L1 key creation stays in TS (`clob:api-key`) | documented-unverified | 50 §8.2.1 (50:417-422) |
| Endpoints | place `POST /order`, batch `POST /orders`; cancel `DELETE /order`, `DELETE /orders`, `DELETE /cancel-market-orders`, `DELETE /cancel-all`; open orders `GET /data/orders?market=`; one order `GET /data/order/{id}`; trades `GET /data/trades?market=&after=` (also `?id=`); heartbeat `POST /v1/heartbeats`; balances `GET /balance-allowance`; account `GET /auth/ban-status/closed-only`, `https://polymarket.com/api/geoblock`; time `GET /time` (second resolution) | documented-unverified | 50 §8.2.3 (50:463-475); 50:582; 50 §5.3 (50:225-228) |
| Order types | GTC/GTD (limit, rest remainder), FOK/FAK (market, never rest); market orders use expiration `0` | documented-unverified | EA A1; `docs/polymarket/index.md:198-203`; 11 GT4 (11:436) |
| Post-only | GTC/GTD only; checked at arrival; BUY `price >= best ask` / SELL `price <= best bid` rejects the whole order (equality crosses); empty opposite side accepted; never delayed | documented-unverified (R8) | 11 §11 (11:478); 11 TD1 (11:290-294) |
| Market BUY sizing | FOK/FAK BUY targets pre-fee collateral, fee added on top; GTC/GTD BUY targets shares; fills `floor(fill × takerAmt / makerAmt)` in 1e-6 units | documented-unverified (R7, R16) | EA A3, A7; 11 §14 `market_buy.collateral` (11:883) |
| FAK/FOK `tradeIDs` | Responses carry `tradeIDs` since 2026-07-24; track each until CONFIRMED or FAILED; if a status is missing for 30 s, read `GET /data/trades?id=` | documented-unverified | EA:25; 50 §8.2.5 (50:580-582) |
| GTD | Sent as `floor(expire_at_ms/1000)` s; must be `>= arrival + 180 s` (P: "at least 3 minutes"), else rejected; effective expiry = stated − 60 s. TS live omitted the 60 s | documented-unverified (R1, R2) | 11 §8 GT1-GT5 (11:429-440); EA A2 |
| Tick table | 0.1 (price 1 dp, size 2, amount 3); 0.01 (2, 2, 4); 0.005 (3, 2, 5); 0.0025 (4, 2, 6, World Cup only); 0.001 (3, 2, 5); 0.0001 (4, 2, 6). Off-tick → reject | documented-unverified (R5) | 11 §7.1 (11:343-354), TK1 (11:359-361) |
| Tick change | 0.01 → 0.001 on both outcomes in 15 of 36 recorded BTC 15m markets (2026-07-21..25), 427-898 s after start, book at extremes; never back; WS `tick_size_change` arrives twice per outcome | verified (observed) | 11 TT1-TT2 (11:396-411) |
| Price bounds | `tick <= price <= 1 − tick`. Old spec: docs only state tick conformance, so this is an assumption to probe | assumed; UNKNOWN | 11 TK2 (11:362-364); EA A7 lists it as docs |
| Precision | Shares at most 2 dp; market-BUY collateral at most the tick's amount decimals; no silent rounding; fills up to 6 dp | documented-unverified | 11 TK3, TK5 (11:368-380) |
| Minimum size | GTC/GTD 5 shares (Gamma `orderMinSize: 5`, CLOB `mos`); FOK/FAK $1 notional. Unit conflict K2 (market-details says "in USDC"); trade prints are no evidence | 5 shares: documented + snapshot; $1: assumed; UNKNOWN (R6) | 11 §7.4 (11:384-393); 11 K2 (11:83); `docs/polymarket/index.md:198-207` |
| Batch caps | `POST /orders` 1-15 orders (changelog 2025-08-21); `DELETE /orders` <= 1,000 ids (changelog 2026-06-15; older docs and TS 3,000, K7); market/all cancels uncapped; per-entry results, `success:true` with `errorMsg` is a rejection | documented-unverified (R9, R10) | 11 §9 (11:444-449); 11 K7 (11:88); EA A12-A13 |
| Taker delay scope | Only orders marketable at arrival on markets with CLOB `itode` (fallback true for BTC up/down); status `delayed`, REST returns zero amounts and no trade ids; re-validated at release (balance, tick, state), then match; resting remainder rests, market remainder killed; cancel in window fails (irrevocable eras). Gamma `secondsDelay` is not the crypto delay | documented-unverified (R3, R4) | 11 TD1-TD5 (11:290-307), §6.3 (11:332-339) |
| Taker delay response | Order-lifecycle says API "waits and returns the final result"; place-orders says it returns `delayed` with zero amounts (K3) | UNKNOWN (R3) | 11 K3 (11:84) |
| Taker delay history | first market → ~2026-02-15: 500 ms (T); ~02-15 → 2026-02-25: 0 (T); 02-25 → 2026-06-05: 250 ms, cancellable (T); 06-05 → 2026-08-17T11:00Z: 250 ms, irrevocable (T + P); 08-17T11:00Z → 2026-09-04T14:00Z: 50 ms, irrevocable (changelog); from 2026-09-04T14:00Z: 150 ms, irrevocable (changelog; `itode` docs still say 250 ms, K1). Keyed by exchange arrival time | rows D0-D3 third-party; D4-D5 documented-unverified | 11 §6.2 (11:311-326); 11 K1 (11:82); EA A6 |
| Fee formula (current) | `fee = C × rate × (p(1−p))^exponent`, `feeType:"crypto_fees_v2"`, `feeSchedule {exponent:1, rate:0.07, takerOnly:true, rebateRate:0.2}`; 100 sh @ 0.50 = $1.75; rounded to 5 dp, min 0.00001; taker only; added to BUY spend, deducted from SELL proceeds | documented-unverified; rounding direction and per-match vs per-order granularity UNKNOWN (R14) | 11 FE1, FC2-FC4 (11:181-226); EA A4 |
| Fee eras (BTC, keyed by market start) | F0 before 2026-01-05: none; F1 01-05 → 2026-03-30: `0.25 · p · (p(1−p))²` per share (peak 1.56%); F2 03-30 → ~2026-05-08: 0.07 · p(1−p) (repo docs: 0.072, K6); F3 from ~05-08: 0.07 · p(1−p). All rows `unverified` until the fee study | documented-unverified; K5, K6 open | 11 §5.3 (11:250-258); `docs/polymarket/index.md:146-151` |
| Fields not to trust | Gamma `takerBaseFee/makerBaseFee`; CLOB `mbf/tbf`; WS `last_trade_price.fee_rate_bps` = "0" on all 36,983 prints of 2026-07-21..25 (fee era) | verified (observed) | 11 PR3 (11:70-76); 50:587-591 |
| Rebates | Maker rebates 20% of crypto taker fees; taker rebate tiers from ~2026-05-27; excluded from fills and PnL | documented-unverified | 11 FC5 (11:227-229); `docs/polymarket/index.md:181-183`; EA A5 (says 05-28) |
| Order statuses | POST: `live`, `matched`, `delayed`, `unmatched`; user-WS order events `PLACEMENT`, `UPDATE` (`size_matched`), `CANCELLATION`. Meaning of `unmatched` | documented-unverified; `unmatched` UNKNOWN (R13) | 50 §8.2.4 (50:495-509); EA A10 |
| Trade statuses | `MATCHED`, `MATCHED_NOT_BROADCASTED` (ranks as Matched), `MINED`, `CONFIRMED`, `RETRYING`, `FAILED` (final, fill reversal). TS dropped FAILED/RETRYING → phantom fills | documented-unverified | 50:510-513; EA A10 |
| Fill attribution | Owner = API key (user-WS `owner`); maker fills from `maker_orders[]` with our owner; leg ids `{tradeId}:M:{ourOrderId}` / `{tradeId}:T:{makerOrderId}`. Units of `maker_orders[].matched_amount` | spec rule; units UNKNOWN (R13) | 50 §8.2.5 (50:562-577) |
| Timestamp units | order `timestamp` ms; `created_at`, `match_time`, `last_update`, `expiration` seconds | documented-unverified | 50:556-558 |
| `orderID` | Expected to equal the locally computed EIP-712 order hash; until probed, reconciliation also matches `(asset, side, price, original_size, created_at window)` | UNKNOWN (R13) | 50:447-450 |
| Matched vs mined | Status at which bought shares become sellable is a probe item; repo rule: wait for `MINED` before selling or merging; settlement timing distribution not in sources (51 measures median/p90) | UNKNOWN (R13); timing not in sources | 51 R13 (51:137); `CLAUDE.md` "Critical gotchas"; 51 §5 (51:102) |
| Heartbeat | `POST /v1/heartbeats`; first body `{"heartbeat_id":""}` accepted before the first order; then every 5 s with the latest id; `400 Invalid Heartbeat ID` → retry with the id from the error body; no heartbeat → all orders of the key cancelled after 10 s (11, EA) or "within 10-15 s" (50, 51) | documented-unverified; path UNKNOWN (R13), timing R11 | 50 §8.2.9 (50:638-647); 11 §11 (11:486-487); EA A11; 51 R11, R13 |
| Rate limits | Changelog 2026-06-01: `POST /orders` and `DELETE /orders` 2,000 per 10 s burst; EA: `POST /order` 500/s burst, 200/s sustained; exchange throttles (delays) instead of rejecting; client buckets default 20 placements/s, 40 cancels/s, queueing delay journaled | documented-unverified | 11 §9 (11:449); EA A13; 50 §8.2.10 (50:662-667) |
| 425 / 503 | 425 + `Retry-After` = engine restarting: backoff 1 s doubling to 30 s, then PostOnly for 120 s after first non-425; 503 `post_only_mode` (2 min, `retry_after_seconds`), 503 cancel-only, 503 trading disabled. Weekly restart Tuesday 07:00 ET, ~90 s | documented-unverified | 50 §8.2.8 (50:620-634); EA A12 |
| 429 on trading endpoints | Not in sources (only the public capture script's Gamma/CLOB GET retry rule: wait `Retry-After` if <= 20 s) | not in sources | 11 PC3 (11:579-582) |
| Cancel semantics | Responses list `canceled` and `not_canceled` (with code); cancels "idempotent on the exchange" (source class not given) | documented-unverified (R10) | 50:544-552, 50:602-604 |
| Order acceptance window | From Gamma `acceptingOrdersTimestamp` (~24 h before start) until market end; resting orders cancelled at end | assumed; UNKNOWN (R15) | 11 §11 (11:479) |
| Minimum order age | CLOB `oas` ("Minimum order age in seconds"): captured, meaning unknown | UNKNOWN (R12) | 11 §11 (11:480) |
| Self-trade | Undocumented; engine blocks self-crossing; never probed | UNKNOWN, not probed (D54) | 11 §11 (11:481); EA A9 |
| Market WS (for probes) | `book`, `price_change`, `last_trade_price`, `tick_size_change`; `custom_feature_enabled` adds `best_bid_ask`, `new_market`, `market_resolved`; text `PING` every 10 s | documented-unverified | EA A8 |

## 2. Probe session P0

Basis: 51 §6.1 R1-R16 (51:123-140), latency cycles 51 §6.2 (51:144-163),
and the D34 day-0 list "GTD lead, taker delay, tick, minimum sizes,
post-only, batch cap, using non-marketable or $1 orders"
(`native/spec/02-decisions.md:433`). Caps carried over from 51 §4
(51:75-91): GTC/GTD 5 shares, FAK $1 notional, wallet exposure <= $15.
**P0 loss cap: $20** (this document; the old spec gave rules + latency $5,
expected < $2). The user launches every real-order session; the agent never
places real orders (D34 decision, 02:437). "Far" = post-only BUY at least 3
ticks below best bid (51:146-147). No new order in the first 5 s or last
60 s of a window except R2 and flatten orders (51:222-223). No probe trades
against its own orders (51:120-121). Costs are estimates from 51's own
per-unit figures: far orders ~$0 (51:99), ~$0.09 per FAK pair (51:186),
~$0.30 adverse selection per filled 5-share maker order (51:206-207).

| Probe | Action | Measures | Expected per docs | Approx. cost |
|---|---|---|---|---|
| R1 | Far GTD 5 sh, expiration now+170 s (×5) and now+190 s (×5) | GTD lead check | 170 s rejected, 190 s accepted (11 GT2) | $0 |
| R2 | 10 accepted far GTD 5 sh, left to expire | `CANCELLATION` time vs stated expiration | cancelled ~60 s before stated (11 GT3) | $0 |
| R3a | 10 pairs of $1 collateral FAK BUY at best ask, one per outcome (51 §6.3 pair form); one cancel sent during the delay on each | POST status, ack → match interval, cancel answer in window | `delayed`, zero amounts, match ~150 ms later; cancel refused (11 D5, TD4); or final result (K3) | ~$0.90 |
| R3b | 5 non-crossing $1 FAK BUY | kill timing | killed, at once or after delay (UNKNOWN) | $0 |
| R3c | Up to 3 GTC 5 sh at best ask when that level holds < 5 sh (opportunistic), remainder cancelled | whether a partial-cross GTC is delayed as a whole | delayed, crossing part matches, remainder rests (TD3) | <= ~$1 plus directional risk <= 5 sh each |
| R4 | From L cycles | non-marketable not delayed | far post-only GTC returns `live` | $0 |
| R5 | 5 off-tick far orders; passive `tick_size_change` watch, one far order at the new tick if one occurs | tick validation | off-tick rejected; new tick accepted | $0 |
| R5b | Proposed, not in 51 (gap: 11 §14 `tick.bounds` says "day-0 probe", 51 has none): far BUY 5 sh at price 0 (×3) | lower price bound | rejected (assumed, 11 TK2) | $0 |
| R6 | 4.99 vs 5.00 sh far GTC (×3 each); $0.99 vs $1.00 FAK BUY (×3 each, pair form if marketable) | minimums and their unit (K2) | 4.99 sh and $0.99 rejected | ~$0.30 |
| R7 | From R3a fills | shares received and cash delta vs shared ExchangeRules function | collateral sizing, fee on top, 1e-6 truncation | $0 extra |
| R8 | 5 post-only orders at the opposite best | equality cross | rejected whole | $0 (<= $0.30 each if docs are wrong) |
| R9 | 15-order and 16-order batches of far post-only (×2 each), then batch cancel | batch cap | 15 accepted, 16 rejected (L 2025-08-21) | $0 |
| R10 | 5 batch cancels including one unknown id; one market cancel | `canceled` / `not_canceled` reasons | unknown id in `not_canceled` | $0 |
| R11 | 3 × (one far order, `heartbeat_pause` 30 s; real mode with `calibration.allowHeartbeatPause = true`) | dead-man cancel delay; `Canceled(HeartbeatLoss)` mapping | cancelled 10-15 s after last heartbeat | $0 |
| R12 | Far orders cancelled 0, 100, 500 ms after ack (×5 each) | effect of `oas` | not documented | $0 |
| R13 | All orders (hash vs `orderID`); 5 far orders cancelled by local hash before the ack; COLLATERAL + token `balance-allowance` after `Matched` and after `Mined` of 10 fills (no SELL before `Mined`) | adapter facts of §4 | not documented | $0 extra |
| R14 | Every taker fill vs wallet activity | fee formula, rounding, granularity | `0.07·C·p(1−p)`, 5 dp (FE1, FC3) | $0 extra |
| R15 | Passive at every market end; REST answers to window-end cancels | when acceptance stops; are resting orders cancelled at end | assumed: closed at end (11 §11) | $0 |
| R16 | Every partial maker and taker fill | fill amounts vs signed amounts | `floor(fill × takerAmt / makerAmt)` (EA A7) | $0 extra |
| L | Latency cycles: far post-only GTC BUY 5 sh, alternating outcomes; wait ack + `PLACEMENT` + inserting `price_change`; hold U(0.5, 5) s; cancel; wait cancel ack + `CANCELLATION` + book removal; ~1 cycle / 10 s; HTTP/1.1 vs HTTP/2 interleave; >= 200 cycles (D35 n >= 200 per component) | decision → bytes written / REST ack / `PLACEMENT` / inserting `price_change`, same for cancel | non-marketable `live`, no delay | ~$0 (rare fill ~$0.30) |
| RD | One redeem of winning shares after resolution (51 P8: "one verified redeem"), via the TS on-chain path | redeem works on CLOB V2 with pUSD | not documented | gas: not in sources |

Expected total ≈ $2-3; worst case bounded by the $20 cap and $15 exposure.
Old prerequisites that P0 still needs (51 §3, 51:57-71): P6 probe strategy
with a paper rehearsal, P8 funded wallet with approvals and one verified
redeem, P9 calibration host plus worker-2 V4 coverage (own orders are the
ground truth for own-order removal, 51:161-163), P10 alerts. P1-P5, P7,
P11-P13 belong to the backtest-calibration track, not to P0.

## 3. What the adapter must journal

From 50 §12 (50:793-817); the JSONL layout and durability rules are
owned by `22-trace-ledger-journal.md` §6.4 (not in sources here):

- **Every input envelope** in core consumption order, each stamped with its
  own observation time, never the decision tick time (50:800-802).
- **Per-intent execution records**: decision seq, egress queue delay
  (including client rate-limiter wait, 50:666), sign start/end, socket write
  time, response receive time, full sanitized request and response,
  computed order hash, salt (50:794-796).
- **WS frames** (market and user) with receive times as input envelopes;
  user-WS subscription frame with `auth` replaced by the key id (50:805-807);
  raw trade status (e.g. `MATCHED_NOT_BROADCASTED`) and WS `fee_rate_bps`
  kept raw (50:511, 50:587-589); raw fill legs in the sidecar (50:572-573);
  foreign trades/orders journaled and counted (50:583-586).
- **REST reads** (open orders, trades, balances) as REST-response envelopes
  (50:611-613, 50:722-724); exchange-state transitions (425/503) as input
  envelopes (50:632-633).
- **Clock samples**: `GET /time` and the lower envelope of
  `receive − exchange_ts`, at startup and every 60 s (50:225-230);
  monotonic anchor re-anchored only by journaled samples (50:220-223);
  timer requests and OS-timer fire lateness (50:231-237).
- **Rules**: raw Gamma and CLOB bodies fetched before the first tick of each
  market (11 §13.6, 11:809-813).
- **Identity**: binary sha256, source hash, params, profile, ModelConfig,
  seed, live config (file sha256, 50:1029-1030), operator commands incl.
  `heartbeat_pause` (50:652-656), host load (50:796-798).
- **Never**: private key, API secret, passphrase, HMAC signatures, auth
  frames (50:803-807).

## 4. Open questions that only a probe can answer

- Is `orderID` the locally computed EIP-712 hash? — R13
- Does a cancel addressed by the local hash work before the REST ack? — R13
- What does POST status `unmatched` mean? — R13
- Units of `maker_orders[].matched_amount` per side. — R13
- Heartbeat path: `/heartbeats` or `/v1/heartbeats`? — R13
- At which settlement status are bought shares sellable (MATCHED vs MINED)? — R13
- MATCHED → MINED → CONFIRMED timing (median, p90). — every fill (51 §5)
- Does POST return `delayed` with zero amounts, or block until the final result (K3)? — R3a
- Answer to a cancel during the taker delay; is 150 ms the observed delay? — R3a
- Is a non-crossing FOK/FAK killed at once or after the delay? — R3b
- Is a partially crossing GTC delayed as a whole? — R3c
- Are non-marketable orders never delayed? — R4, L
- GTD lead 180 s and effective expiry stated − 60 s. — R1, R2
- Off-tick rejection and acceptance at a new tick. — R5
- Price bounds `[tick, 1 − tick]`. — R5b (gap in 51)
- Minimum sizes and their unit (5 shares, $1, K2). — R6
- FOK/FAK BUY collateral sizing, fee on top, share truncation. — R7
- Post-only rejection at equality. — R8
- Batch cap 15 (cancel cap 1,000 stays docs-only). — R9
- `not_canceled` reasons for batch and market cancels. — R10
- Dead-man cancel delay: 10 s or 10-15 s? — R11
- Meaning of `oas` (minimum order age). — R12
- Fee rounding direction and per-match vs per-order granularity. — R14
- When acceptance stops and whether resting orders are cancelled at end. — R15
- Partial-fill cash amounts vs signed amounts. — R16
- Faster transport (HTTP/1.1 pool vs one HTTP/2 connection). — L
- Not probe-able here: fee eras F0-F2 (K5, K6; fee study 11 §14.1),
  taker-delay rows D0-D3 (historical), self-trade (D54), 429 behavior of
  trading endpoints (not in sources).

## 5. TS pieces still needed on-chain

Ownership: split/merge/redeem transactions belong to the TS launcher,
answering `chain_request` with `chain_response` (50 §3, 50:99; 50 §16,
50:948); pUSD wrapping, approvals and balance display are user-run TS
scripts (50:100). Probes need no split/merge; P0 needs redeem only (51 P8).

| Need | Status per sources | Files involved |
|---|---|---|
| Collateral switch USDC.e → pUSD | TS stack is USDC.e and V1-only; must be updated and verified for v1 markets on CLOB V2 before real funds (50:982-989) | `src/polymarket/contractAddresses.ts:4` (`USDC_ADDRESS` = USDC.e) |
| pUSD wrapping | user-run TS script (50:100); wrap contract and flow not in sources | not in sources |
| Approvals to the V2 exchange | required for the wallet type chosen at G4 (EOA recommended, 50:1153-1159) | `src/cli/relayer.ts` (`relayer:approve`, `eoa:approve`, `eoa:approve-ctf`, `package.json:124-136`); `src/blockchain/checkBalanceAndApproval.ts` |
| Redeem after resolution | runtime emits `chain_request {kind: redeem}`, re-reads collateral on response; `onchain_timeout_ms` 120 s then balance reads; redeem watcher may stay as fallback and sends `refresh_balance` (50 §8.3, 50:677-683) | `src/polymarket/relayerClient.ts`; `src/blockchain/conditionalTokens.ts`; `src/cli/redeem-watcher.ts:58-98` |
| Split / merge | same `chain_request` path; real mode refuses a strategy that declares split/merge until the pUSD/V2 verification is recorded (50:987-989) | `src/polymarket/relayerClient.ts`; `src/blockchain/conditionalTokens.ts` |
| Relayer / SAFE mode | `POLYMARKET_TX_MODE_{SPLIT,MERGE,REDEEM}` = `relayer` or `direct`; SAFE support deferred if an EOA is chosen (50:1158-1159) | `src/cli/relayer.ts`; `@polymarket/builder-relayer-client` 0.0.8, `@polymarket/builder-signing-sdk` 0.0.8 (`package.json:215-216`) |
| Balance checks | collateral and token balances for P8 proof | `src/cli/check-balances.ts`; `src/blockchain/balanceTracker.ts` |
| API key creation (L1) | stays in TS; Rust receives ready credentials via `--secrets-fd` | `src/cli/create-clob-api-key.ts` (`clob:api-key`); 50:421-422, 50:1025-1028 |
| Golden-vector generator | needs `@polymarket/clob-client-v2` (not installed) | `native/crates/domain/tests/fixtures/*_gen.ts` pattern (50:457-458) |

## Contradictions between sources

1. Dead-man delay: 10 s (11:486-487, EA A11) vs "within 10-15 s" (50:645, 51 R11).
2. Heartbeat path: stated as `/v1/heartbeats` (50:469, 50:638) but listed as unknown (51 R13).
3. Rate limits: 2,000 per 10 s for `POST/DELETE /orders` (11:449) vs `POST /order` 500/s burst, 200/s sustained (EA A13).
4. Fee eras: F0 end 01-05 vs 01-06 (K5); F2 rate 0.07 vs 0.072 (K6) (11:250-255 vs `docs/polymarket/index.md:148-150`); EA A4 calls the Jan-Mar curve third-party while 11 F1 rates it changelog.
5. Taker rebate tiers: ~2026-05-27 (`docs/polymarket/index.md:181`) vs 2026-05-28 (EA A5).
6. Price bounds: a docs fact in EA A7, an assumption in 11 TK2; 11 §14 says a day-0 probe verifies it, but 51 R1-R16 has none.
7. FOK/FAK minimum: $1 notional (`docs/polymarket/index.md:202-203`) vs "only the much smaller per-market `min_order_size`" (same file :207); unit conflict K2.
8. Cancel-id cap 1,000 (changelog) vs 3,000 (older docs, TS) — resolved to 1,000 by 11 K7.
9. Taker delay: `itode` docs say 250 ms vs changelog 150 ms (K1); EA A6 "250 ms before" conflates D2 and D3 (11 TD6).
10. Client library: `package.json` declares `^5.1.2`, installed 5.8.1 signs V1; 50 requires `@polymarket/clob-client-v2` for golden vectors, which is not installed.
