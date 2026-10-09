# Conformance test plan (60 §10.2) — C1 deliverable

Spec: tag `native-spec-g1`, documents 10, 11, 12, 13, 20, 21, 22, 30, 60
(no `research/`). Method: every clause of a §10.2 row gets (a) a vector row
with the clause id, (b) a test that names the clause, (c) an input: a vector
(data checked today), a scripted testkit session (C2), the engine exerciser
(60 §5, read through its trace) or a crafted `EngineJob` run through the
binary (20). "Status" is `data` (runs now against the spec-derived helpers),
`C2` (skeleton, needs the testkit), `bin` (skeleton, needs the canonical
binary), `G3`/`G4` (outline, later phase).

Totals today: 16 vector files, 86 data tests green, 151 ignored skeletons.

## 1. G2 rows in detail

### 1.1 Order state machine — 10 §8.1, §8.2, §8.3, §8.4; 13 §5.1; 13 §6.7

| Clause | Test (`tests/order_state_machine.rs`) | Input | Status |
|---|---|---|---|
| 10 §8.1 state sets, 10 §8.4 TS strings | `state_sets_and_ts_mapping` | `order_state_machine.json` `states` | data |
| 10 §8.2 rows 1–21 (ids `r01`–`r21`) | `rows_reference_known_states`, `terminal_rows_name_one_terminal_event` (consistency); `r01_submitted` … `r21_late_fill` (one per row) | one scripted session per row; ts-compat rows assert the full `ts_compat_events` sequence of 13 §5.1 (acceptance-time `SettlementUpdate{Matched}`, FOK `Confirmed`) | data + C2 (rows 1–5, 12, 13, 15, 17–19); G3 (6–11, 14, 16, 21); G4 (20) |
| 10 S1, S2, S4, S6; FOK/FAK never rest; Killed/Expired only where allowed; ts-compat never `OrderDelayed`/`CancelAcked`/`Mined`/`SelfCross`; post-only never delayed | `forbidden_list_well_formed`, `forbidden_patterns_absent_from_all_traces` | every G2 session's trace scanned for the 16 `forbidden` patterns | data + C2 |
| 10 S3, 12 §9.4 final quantity table | `s3_final_quantity_table` | Rejected / Killed-without-filled / Filled / OrderDone-with-filled sessions | C2 |
| 10 S5 fills never dropped | covered by `r21_late_fill` and cid `cg-11` | — | G3/G4 |

Exerciser cross-check (60 §5.3/§5.5): x2/x6 (FOK fill vs kill, rows 17–18),
x1/x7 (post-only cross, row 3), x3 (GTD expiry, row 15), x5 (crossing GTC with
remainder, row 5), x13 (engine reject, row 2) — the exerciser trace of the
fixture markets is read as a second input for these rows.

### 1.2 Account event ordering and cascades — 12 §6.1–§6.4, 12 §4.2, 12 §5.3, 12 §9.1, 30 §4, §4.1, 22 §3.3

| Clause | Test (`tests/cascades.rs`) | Input | Status |
|---|---|---|---|
| 12 §6.2 breadth-first FIFO; 30 §4 rule 6; 22 §3.3 ordering contract | `cs01_literal_sequence_is_breadth_first` (data), `cs01_breadth_first` | `cs-01`: on_tick places a, b; OrderSubmitted(a) callback places c | data + C2 |
| 12 §6.2 siblings before second-level results; 60 §5.4 A1/A2 | `cs02_second_level_cascade`, `cs13_engine_origin_events_offered` | `cs-02`, `cs-13` (exerciser x11 / x11-sib / A2 as second input) | C2 |
| 12 §6.2 delivery order (ledger → OM → trace → callback → Decision → OM); 12 §9.1; 12 §9.2 `submitted_delivered` | `cs03_ledger_applied_before_callback` | `cs-03`: portfolio read inside each callback | C2 |
| 12 §6.1 every delivered event offered (incl. OrderSubmitted, every SettlementUpdate) | `cs04_fok_callback_kinds` (data), `cs04_every_event_offered` | `cs-04` | data + C2 |
| 30 §4.1 interests skip only the callback; 16 TF-3 | `cs05_interests_skip_only_callback` | `cs-05`: LIFECYCLE omitted; trace, digest, stats identical | C2 (see A-07) |
| 12 §6.3 cascade budget → `strategy_fault: cascade_limit`, no MarketStats, group isolation (21 §14) | `cs06_cascade_budget_fault` | `cs-06` with `runner.maxEventsPerDrain = 8` | C2 (see A-08) |
| 12 §4.2 `event_clock`; 30 §5 | `cs07_event_clock` | `cs-07` | C2 |
| 12 §4.2 decision stamp; 13 TC-C8 | `cs08_decision_stamp_ts_compat` | `cs-08`: GTD at T+60000 vs T+59999 from an account callback | C2 |
| 12 §5.4, 60 INV-13, D23, TC-C9/TC-C13 window gate on callbacks | `cs09_no_callbacks_outside_window` | `cs-09` | C2 (ts-compat), G3 (realistic end handling) |
| 12 §6.4 plugin snapshot of the previous tick; 14 P-4 | `cs10_plugin_snapshot_previous_tick` | `cs-10` (needs a plugin via `Requirements`) | C2 if the testkit exposes plugins (see A-09) |
| 12 §5.3 synthetic ticks never run the execution step; 14 F-36 | `cs11_synthetic_tick_no_execution` | `cs-11` (needs scripted feed updates) | C2 |
| 30 §4 rule 4 fresh instance per market | `cs12_fresh_instance_per_market` | `cs-12` | C2 |

### 1.3 Capital C1–C4 — 10 §9.4, 10 R5/R6/R9, 12 §7.5, 12 §9.4–§9.6, 11 §4, 60 INV-1/2/3/7

| Clause | Test (`tests/capital.rs`) | Input | Status |
|---|---|---|---|
| 10 R9 ts-compat reservation (notional HalfAwayFromZero + fee at limit, 0 if post-only); 11 §4 row 2 | `c1_ts_compat_reservation_vectors` (data), `c1_ts_compat_reservation_in_session`, `c1_ts_compat_post_only_in_session` | `c1-ts-compat-*` (4 vectors) | data + C2 |
| 10 C1 share-sized (Ceil notional + fee at limit), post-only notional only | `c1_realistic_share_sized_reservation_vectors` (data), `c1_realistic_share_sized_in_session` | `c1-realistic-*` | data + G3 (see A-10) |
| 10 C1 collateral-sized (amount + amount × rate × (1 − tick)) | `c1_realistic_collateral_sized_reservation` (data), `c1_realistic_collateral_in_session` | `c1-realistic-collateral-sized` | data + G3 |
| 10 C1 exception `reservation_dust`; 60 INV-2 | `c1_reservation_dust_counted_not_rejected` | `c1-reservation-dust` | G3 |
| 12 §7.5 exact comparison, no 1e-8 tolerance; 10 §10.2 reject string | `funding_boundary_vectors` (data), `funding_exact_boundary`, `funding_cascade_visibility` | `funding-*` | data + C2 |
| 10 C2 realistic SELL reserves shares; 12 §9.3 sellable | `c2_sell_reserves_shares` | `c2-realistic-sell-reserves-shares` | G3 |
| 13 TC-C4 naked sells, `oversold_qty` | `c2_ts_compat_naked_sell` | `c2-ts-compat-no-inventory-check` (exerciser x14 as second input) | C2 |
| 10 C3 release only on authoritative final quantity; 12 §9.4 obligations table; 60 INV-3 | `c3_release_partial_then_terminal_steps` (data), `c3_partial_then_cancel`, `c3_killed_releases`, `c3_rejected_releases`, `c3_zero_reserved_at_end` | `c3-*` | data + C2 (see A-11) |
| 10 C4 PnL identity; 12 §9.5 BUY/SELL/split/merge arithmetic; 12 §9.6; 21 §11; 60 INV-7 | `c4_identity_taker_buy_vectors`, `c4_sell_realized_vector`, `c4_split_and_merge_vectors`, `turnover_vector_arithmetic` (data); `c4_identity_sessions`, `c4_merge_realizes_not_ts_bug` | `c4-*`, `turnover-exceeds-capital` | data + C2 |
| 12 §7.3 merge clamp incl. pending merges; 10 N4; split funding | `merge_clamp_and_zero`, `split_insufficient_and_zero` | `merge-clamp-pending`, `split-insufficient`, `split-zero`, `merge-zero` (exerciser 390/395/405) | C2 |
| 12 §9.4 per-market allowance; 21 §6.3 | `per_market_allowance_isolated` | `per-market-allowance` | C2 |
| 60 INV-1 cash conservation | `inv1_cash_conservation` | mixed scenario | C2 |

### 1.4 cid generations — 10 §6, 10 S4, 12 §7.1, 12 §7.3, 13 §5.1 Cancels, 13 §5.4, 30 §5.2, 60 §5.10

| Clause | Test (`tests/cid_generations.rs`) | Input | Status |
|---|---|---|---|
| 10 §6 OrderKey dense from 0 per submission; engine rejects consume no key (12 §9.2) | `cg01_dense_keys` | `cg-01` | C2 (see A-14) |
| 10 S4, 12 §7.1 reuse → new generation; `cancellation.test.ts` "client ID reuse creates distinct exchange identities" | `cg02_reuse_after_fill` | `cg-02` (transcribed TS scenario) | C2 |
| 13 §5.1 Cancels bound at decision time (TC-C5); `cancellation.test.ts` "delayed cancel cannot cancel a new submission" | `cg03_delayed_cancel_old_generation` | `cg-03` (delay 100, jitter 0) | C2 |
| 12 §7.1, 13 §6.6 realistic in-flight cancel of an old generation | `cg04_realistic_in_flight_cancel` | `cg-04` | G3 |
| 12 §7.1 cid → current key | `cg05_cancel_targets_current` | `cg-05` | C2 |
| 12 §7.3 known terminal skipped; unknown cid; TC-C5/TC-C10; exerciser x6 / x-never | `cg06_cancel_known_terminal`, `cg07_cancel_never_placed` | `cg-06`, `cg-07` | C2 (see A-12) |
| 10 §6 FillKey, TradeSeq | `fill_key_and_trade_seq_shape` (data), `cg08_fill_keys` | `cg-08` (ledger-level) | data + C2 |
| 12 §7.1 late events of old generations (live), 10 S5/I3 | `cg09_*`, `cg10_*`, `cg11_*` | transcribed TS live scenarios | G4 |
| 10 §6 session scope; 12 §10 | `cg12_keys_session_scoped` | `cg-12` (run-group of two markets) | C2 |

### 1.5 Dedupe — 12 §7.6, 12 §7.2, 10 N5, 21 §10, 60 §5.5

| Clause | Test (`tests/dedupe.rs`) | Input | Status |
|---|---|---|---|
| 12 §7.6 rule: active cid dropped, no event/record, counted | `dd01_same_list_duplicate`, `dd02_across_ticks`, `dd10_replace_active_dropped` | `dd-01`, `dd-02`, `dd-10` (exerciser x10 at 330) | C2 |
| 12 §7.6 release on delivered terminal (rule 2), sync terminal (rule 1, ts-compat), full fill (rule 3) | `dd03_reuse_after_terminal`, `dd04_sync_terminal_releases`, `dd15_full_fill_releases_before_callback`, `dd05_realistic_deduped_until_delivered` | `dd-03`, `dd-04`, `dd-15`, `dd-05` | C2 (A-06, A-13); G3 for dd-05 |
| 12 §7.2 dedupe position per profile (before validation / after the TS risk pass); 12 §8.2 | `dd06_invalid_duplicate_dropped`, `dd07_risk_rejection_dropped` | `dd-06`, `dd-07` | C2 |
| 60 §5.5 x10 at 320 (cancel-and-replace in one list; delay 0 vs delayed) | `dd08_cancel_replace_delay0`, `dd09_cancel_replace_delayed` | `dd-08`, `dd-09` | C2 |
| 12 §7.6 new session has no active cids | `dd11_new_session_no_active_cids` | `dd-11` | C2 |
| 12 §7.3 cancels, splits, merges never deduped | `dd12_cancels_never_deduped`, `dd13_splits_never_deduped` | `dd-12`, `dd-13` | C2 (A-12) |
| 10 N5, 21 §17, 21 §10 counter key not a reason | `counter_is_not_a_reject_reason` (data), `dd14_counter_in_diagnostics` | `dd-14` | data + C2 |

### 1.6 Output quantization — 10 §4 Q1–Q3, 10 R-1, R14, R15, 21 §11, 21 §18

| Clause | Test (`tests/output_quantization.rs`) | Input | Status |
|---|---|---|---|
| 10 §4 Q3 table (6 rows), HalfAwayFromZero, one rounding (R-3) | `q3_rows_round_half_away_from_zero`, `q3_rows_differ_from_ts_as_documented` (data); `q3_rows_as_sessions` | `q3-*` with maker-fill scenarios that produce the exact pnl | data + C2 |
| 10 R-1 no half-toward-+∞ | `r1_negative_tie_rounds_away_from_zero` | — | data |
| 10 §4 fields table (dp, nullability) | `fields_table_matches_spec` | `fields` | data |
| 10 Q1 at-or-below column scale (D08) | `q1_values_at_or_below_column_scale` | fixture job output | bin |
| 10 Q2 / 21 N1, N5 rendering (no exponent, no −0) | part of `q3_rows_round_half_away_from_zero`; `extra-*` vectors | — | data |
| 10 R14 avg entry single rounding from the exact rational | `r14_avg_entry_price_single_rounding` | `extra-avg-entry-*` | C2 |

### 1.7 Skip taxonomy — 21 §13, §1.1, §11, §14, §15, §17

| Clause | Test (`tests/skip_taxonomy.rs`) | Input | Status |
|---|---|---|---|
| 21 §13 rows 1–3 (engine-decided), zero-row shape (21 §11), denominators | `skip_reasons_are_in_the_closed_vocabularies`, `denominator_rule`, `zero_row_shape` (data); `sk01_*`, `sk02_*`, `sk02b_*`, `sk02c_*`, `sk02d_*`, `sk03_*` | never-placing strategy; input entirely before `start`; split+merge only; split only; input with no tick | data + C2/bin |
| 21 §13 rows 4–6 (TS shim; unreachable through the binary, 21 §5.1) | `sk04_06_shim_rows_unreachable` | crafted jobs without tokenIds / with null outcome → exit 2 | bin |
| 21 §13 row 7 incomplete_capture (V4) | `sk07_incomplete_capture` | V4 fixture packages | M7 outline |
| 21 §13 row 8 strategy_fault candidate; 12 §11; 20 §4.1 | `sk08_strategy_fault_candidate` | panicking test strategy in a group (needs a test-only strategy binary, cf. 60 CG-4 `panic-probe.rs`) | bin |
| 21 §15 eventsProcessed / eventsByType | `sk11_events_processed` | any session | C2 |

### 1.8 Contract vocabularies — 21 §17, 20 §4, §4.1, §4.4, 10 §10.2, 10 §9.2, 12 §5.3, 11 RS4

| Clause | Test (`tests/vocabularies.rs`) | Input | Status |
|---|---|---|---|
| 21 §17 every row (17 sets) | `closed_sets_have_unique_values`, `tick_causes` | `vocabularies.json` | data |
| 20 §4 classes, exit codes, retry policy; 20 §4.1 causes and pattern; 21 §14 failure_class | `error_classes_and_exit_codes`, `causes_match_pattern_and_classes`, `failure_class_set` | — | data |
| 20 §4.4 drift guard | `drift_guard_superseded_names_absent` (scans this crate's vectors) | — | data |
| 10 §10.2 TS strings of reasons; 10 §9.2 statuses | `reject_reason_ts_strings`, `settlement_status_ranks` | — | data (see A-15) |
| 21 §3 schema bundle enums = these sets; 20 §5.1 capabilities; unknown value → invalid_input | `schema_enums_equal_vectors`, `describe_capabilities_closed_sets`, `unknown_enum_value_is_invalid_input` | `schema`, `describe`, crafted jobs | bin |

### 1.9 ModelConfig hash — 21 §6, §6.1, §6.2, §6.3, 21 §3 CI item 6, 21 §1.1, §8 C4, 13 §7.3

| Clause | Test (`tests/model_config_hash.rs`) | Input | Status |
|---|---|---|---|
| 21 §6.1 canonical JSON and sha256 | `canonicalization_cases` | `canon-*` (4 vectors, hashes computed by two implementations) | data |
| 21 §6 layout, every pinned ts-compat value (13 §7.3, 12 §4.5, 14 §9, 12 §8, 12 §6.3, 11 §13.4) | `ts_compat_default_hash_under_stated_assumptions`, `ts_compat_default_jitter20_variant_hash` | `ts-compat-default-jitter0/20` | data (see A-01, A-02) |
| 21 §6.1 decimal-string grammar, 6 dp; value kinds; no floats/null | `decimal_string_grammar`, `representation_rejects_floats_and_null` | `valid-decimal-strings`, `invalid-values` | data (see A-03) |
| 21 §3 CI item 6 default fixtures and their sha | `ci_item6_default_fixture_hashes` | `native/contract/fixtures/model-config/*` (from the engine branch) | bin |
| 21 §1.1, §8 C4, §10 effective ModelConfig per candidate | `effective_model_config_per_candidate` | run-group with execution variant | bin (G3 variant) |
| 21 §6 no defaults applied; 13 §7.3 pins; 20 §3 | `invalid_model_configs_exit_2` | `invalid-values` documents as jobs | bin |

### 1.10 Seed vectors — 10 RNG-1…RNG-7, 14 F-51, 60 DET-13

| Clause | Test (`tests/seed_vectors.rs`) | Input | Status |
|---|---|---|---|
| RNG-7 all 15 rows (market seeds, stream seeds, draws, open unit, jitter, md_row, feed streams, Chainlink entity, PTB) | `splitmix64_reference_outputs`, `market_seeds`, `stream_seeds`, `feed_stream_seeds`, `per_market_draws`, `open_unit_interval`, `compat_jitter_mapping`, `feed_draws_and_chainlink_entity` | `seed_vectors.json` vs `src/rng.rs` | data |
| RNG-6 rejection bound | `uniform_below_respects_bound` | — | data |
| 60 DET-13, 21 §3 CI item 7 (`selftest`) | `det13_selftest_reports_seed_vectors_ok` | `selftest` | bin |
| 10 I1, 21 §8 C5, 60 DET-10 | `i1_streams_independent_of_candidate_index` | group vs standalone | bin (realistic latency draws, G3) |

### 1.11 ts-compat rule values — 11 §4, 11 §3, 13 §5.1–§5.2, 12 §7.4

| Clause | Test (`tests/ts_compat_rules.rs`) | Input | Status |
|---|---|---|---|
| 11 §3 ts-compat column (constants) | `rules_view_constants` | `rules_view` | data (see A-04) |
| 11 §4 row 1 fee (taker, 4 dp, floor, every date; PE-R3 tie) | `fee_behavior_numbers` (data); `tc_fee_*` (5) | `tc-fee-*` | data + C2 |
| 11 §4 row 2 reservation fee | `tc_reservation_fee`, `tc_reservation_post_only` | `tc-reservation-*` | C2 |
| 11 §4 row 3 no tick/bounds/min/precision; only positivity; 12 §7.4 | `tc_no_tick_validation`, `tc_only_positivity`, `tc_post_only_fok` | `tc-no-tick-validation`, `tc-only-positivity`, `tc-post-only-fok` (exerciser x18/x19/x20) | C2 |
| 11 §4 row 4 GTD decision offset, exact expiry | `tc_gtd_decision_offset`, `tc_gtd_exact_expiry` (+ `g3_gtd.rs::ts_compat_decision_offset` data) | `tc-gtd-*`, `gtd.json` ts-compat rows (exerciser x3/x15/x17) | data + C2 |
| 11 §4 row 5 no taker delay | `tc_no_taker_delay` | — | C2 |
| 11 §4 rows 6–7 caps (none / 3000) | `tc_no_batch_cap`, `tc_cancel_id_cap_3000` (+ `g3_caps.rs` data) | `caps.json` ts-compat rows (exerciser 370/380) | data + C2 (A-15) |
| 11 §4 row 8 post-only at execution, equality crosses, empty side accepts | `tc_post_only_equality_crosses`, `tc_post_only_empty_side_accepts`, `tc_post_only_checked_at_execution` | `tc-post-only-*` | C2 |
| 13 TC-C14, TC-C4, TC-C9, TC-C13, TC-E8, TC-E9 | `tc_no_self_cross_check`, `tc_naked_sell`, `tc_window_gate_inclusive`, `tc_no_action_at_end`, `tc_compat_status_events`, `tc_split_merge_sync` | corresponding vectors | C2 |
| 13 §7.3 pinned values; 21 §8 C4; 11 §13.8 outputs `rules: null` | `pinned_execution_values` (data); `tc_model_config_pinned`, `tc_outputs_rules_null` | — | data + bin |

## 2. G3 outline (realistic; from M3b, 60 §10.0 C4)

Data tables are already executable; sessions need the realistic profile.

| §10.2 G3 item | Vectors / tests today | Plan |
|---|---|---|
| Fee curves, eras, rounding (11 §5) | `fee_curves.json`, `fee_eras.json`; `g3_fee_curves.rs` (6 data tests: all 7 table rows × 4 columns, peaks, exact tie, era contiguity and epochs, lookups) | Sessions on the fixture markets of each era with the empty rules record (fallback) and with captured `feeSchedule`; assert `FillView.fee` per fill, `feesPaid = Σ fee`, maker 0, FT1 output fields, FE3 mapping incl. the two `invalid_input` cases, FT2 counter. |
| Taker delay (11 §6) | `taker_delay.json`; `g3_taker_delay.rs` (4 data tests: table, lookups by arrival time, TD7, gate-3 cutoff) | Marketable vs non-marketable vs post-only at arrival; release re-validation (tick change in flight); cancel in D2 vs D3–D5; `unverifiedRules` for D0–D3; `secondsDelay` override. |
| Tick, bounds, precision, minimum sizes (11 §7) | not yet (C4) | One reject per reason (`InvalidTick`, `PriceOutOfBounds`, `SizeBelowMinimum`, `NotionalBelowMinimum`, `SizePrecision`, `AmountPrecision`) at arrival; TT1 initial tick from a pre-start snapshot only; TT2/TT3 tick events and inference (`tick_inferred`), TT4 refinement keeps resting orders valid. |
| GTD (11 §8) | `gtd.json`; `g3_gtd.rs` (8 data tests) | GT2 at arrival with `xnow = now − skew`; GT3 expiry 60 s early; the three floor edge vectors as sessions. |
| Caps (11 §9) | `caps.json`; `g3_caps.rs` (3 data tests) | Batch 15 vs 16 (`BatchTooLarge` for every order, nothing dispatched); cancel 1000 vs 1001 (`TooManyIds`); no cap on cancel_market / cancel_all. |
| Post-only (11 §11) | ts-compat rows exist | Realistic: checked at arrival against the effective book incl. own orders (13 §6.11). |
| FOK/FAK incl. collateral sizing, share-sized conversion (10 §7, D42) | `capital.json` collateral vector | Sessions per 60 §5.10 FAK/FOK rows: partial over 3 levels, zero fill → Killed, collateral floor (R7), share-sized BUY converted at the limit receiving more shares when filled below it, FAK SELL in shares, reservation released after kill. |
| Self-cross block, one case per N6 condition (10 N6, 12 §7.4, D54) | not yet | Same-outcome opposite side (BUY ≥ own SELL, SELL ≤ own BUY), mint match (two BUYs summing ≥ 1), merge match (two SELLs ≤ 1), earlier entry of the same batch, in-flight own order; `self_cross` counter stays 0 (INV-15); ts-compat never rejects. |
| Settlement statuses and FAILED reversal (10 §9.2 F1–F3) | `vocabularies.json` ranks | `SettlementUpdate` progression with `latency.components`; `Failed` reverses position, cash, fee, realized exactly (INV-11); `sell_gate` (Matched/Mined/Confirmed) and `sellable`; `Retrying` keeps rank; `MATCHED_NOT_BROADCASTED` normalizes. |
| Window end (D23, 12 §5.4, 13 §6.6) | `cascades.json` cs-09 | `Control(WindowEnd)` → `CancelMarket{Market}` cause `WindowEnd` with cancel latency; `MarketClosed` for still-resting orders at the exchange-side close; arrival after close → `MarketClosed`; no callbacks after `end`; scheduler drained at end of stream. |
| Async split and merge (D25, 13 §6.10) | `capital.json` split/merge vectors | `PositionsSplit` after `chainSplit` latency; reservation held meanwhile; `SplitFailed(InsufficientCollateral)`, `MergeFailed(InsufficientPairs)`; failure rates > 0 → `TxFailed`. |

## 3. G4 outline (live; from M9)

- V2 order struct and signing vectors from the docs (11 §10 domains; the
  signature type chosen at G4): golden vectors per domain, throwaway keys.
- Heartbeat (D30), 425/503/cancel-only handling (50 §8.2.8): mock exchange
  scripts, one case per cause row.
- User-WS mapping incl. `FAILED` and maker identity (50 §8.2.4/§8.2.5): the
  transcribed live scenarios `cg-09`, `cg-10`, `cg-11`, `r20`, `r21`; fill
  aggregation per (own order, trade, price level) (10 I3).
- Real-order gate and `standard`-build refusals (20 §7, 20 §8 item 10, D44):
  `realOrders: false`, `live` exits 2, each gate condition missing → exit 2.
- Journal redaction (22 §6.7): scan test journals for fixture secrets.
- Calibration analysis harness (51 §11): Modes A, B, C on both input modes
  and the self-tests of 51 §11.4.

## 4. Ambiguities and contradictions for triage (60 §10.3 (c))

Each item names the exact clauses. The implementation lead records the
decision; the affected vectors cite the item id.

- **A-01 ts-compat default jitter: 0 or 20?** 13 §7.4 (defaults file:
  "ts-compat with the compat values of §7.3 and `compatLatency` 0/0") vs
  21 §6.3 (built-in default for `execution.compatLatency`: "`0` / `20`
  (jitter applies only when delay > 0, 13 §5.1)"). 21 §6.1 and 60 OR-6 say
  parity runs MUST use zero jitter. The two defaults hash differently
  (`model_config_hash.json`, both shas given). Also unclear whether the
  *binary* rejects a ts-compat job with `jitterMs ≠ 0` (13 §7.3 lists the
  pinned values and does not include `compatLatency`) or only the harness
  forbids it. Proposed: defaults file `jitterMs: 0`; the binary accepts any
  jitter (seeded, deterministic) and the harness pins 0.
- **A-02 Hash of the ts-compat default depends on unused fields.** The
  ts-compat default must contain `execution.latency.components`,
  `execution.makerQueue` (13 §7.3: "Fields a choice does not use MUST still
  be present and are ignored") whose values the spec shows only as examples
  and which the calibration set `uncalibrated-2026-10` fixes "at the start
  of M3b" (13 §7.4). The CI item 6 sha (21 §3) therefore cannot be derived
  from the spec; the vectors pin it only under the stated assumptions.
  Proposed: pin the ts-compat default's unused fields in 13 §7.4 (or state
  the exact M1 default file content in the spec).
- **A-03 `-0` as a decimal string.** 21 §6.1 regex
  `^-?(0|[1-9][0-9]*)(\.[0-9]*[1-9])?$` matches `-0`; 21 §18 N1 says "No
  NaN, Infinity or -0 anywhere". Proposed: reject `-0` (and `-0.…` that
  equals zero cannot occur because trailing zeros are forbidden).
- **A-04 `RulesView` in ts-compat.** 11 §3 gives ts-compat values
  "unbounded" (`max_place_batch: u8`), "none" (`min_size_resting: Qty`,
  `min_notional_market`, taker delay) and "not used" (`neg_risk`,
  `version`); 30 §5 exposes `rules().batch_cap()`, `min_order_size()`,
  `taker_delay()`, `price_bounds()`, `source()`. What do these return in
  ts-compat (None? 0? `u8::MAX`?), and what is `source()` when the rules
  record is validated but ignored (11 §4; 21 §10 says `market.rulesSource`
  is computed in both profiles)? Proposed: `Option` returns, `None` in
  ts-compat for caps/minimums/delay; `source()` = the RS4 classification.
- **A-05 Empty `place_batch`.** 10 §7.3 says `PlaceBatch` carries `1..=N`
  requests; 60 §5.10 tests 1, 15, 16 entries; 30 §7 `out.place_batch([...])`
  does not say whether an empty array is a structural error, a no-op or
  `InvalidSize`. Proposed: no-op with no event (consistent with "nothing
  accepted → no dispatch", 12 §7.3) — or make it unrepresentable.
- **A-06 Wording of 12 §7.6 last bullet.** "A strategy that re-places a cid
  from the fill callback of a fully filled order is therefore deduped until
  the fill is delivered" reads as if the re-place *inside* the Fill callback
  were deduped, but by 12 §6.2 the ledger and the OM (rule 3: delivered
  fills reach the order size) run before that callback, so the cid is
  already released there. The sentence seems to mean intents issued *before*
  the fill is delivered (realistic, between match and fill report). Vectors
  `dd-05` and `dd-15` encode that reading; please confirm.
- **A-07 Interests vs trace.** 30 §4.1 / 16 TF-3: with an event flag
  omitted, "traces and outputs are unaffected"; 22 §3.3: "Events that are
  never delivered to the strategy are not traced"; 12 §6.2 emits
  `trace(AccountEvent)` before the "strategy callback (if enabled,
  interested …)". Confirm that an event skipped by interests counts as
  delivered (applied, traced) and only its callback is skipped (`cs-05`).
- **A-08 Cascade budget threshold and what counts.** 12 §6.3 "bounds
  deliveries with callbacks in one drain … when exceeded": is the fault
  raised at the (N+1)-th delivery (strictly greater) and do deliveries whose
  callback is skipped by interests (A-07) count? `cs-06` uses N = 8 and
  expects the fault once more than 8 deliveries with callbacks occur.
- **A-09 `ctx.tick()` inside callbacks of tick N's execution step — RESOLVED
  D69, 60 §10.3 case (b): the test misread the clause.** My reading took
  "the last dispatched tick" (12 §6.5) to be N−1 because the execution step's
  events are drained before `run_strategy_tick()` of tick N (12 §5.2). The
  intended reading: `begin_tick` runs before the execution step (12 §5.3) and
  those events "belong to that tick", so inside their callbacks
  `tick().seq == N`, the ts-compat `now()` / decision stamp is tick N's ts
  (TC-C8; the execution clock of D67) and only `plugins()`/`feeds()` are
  tick N−1's snapshot (12 §6.4). Fixed in `cs-08` (now exercises a maker
  fill produced by tick N's execution step and a third GTD at
  `T0 + 60000` that is rejected because the stamp is `T1`, not `T0`) and in
  `cs-10` (expects `tick().seq == N`); the skeleton strings in
  `tests/cascades.rs` follow.
- **A-10 Order of validation and funding for a realistic order that fails
  precision/minimum at arrival.** 12 §7.2 funds at decision (step 5) and the
  simulator re-applies exchange checks at arrival (12 §7.4 last bullet;
  13 §6.2), but 12 §7.4 also lists tick/precision/minimum as decision-time
  checks in realistic ("yes"). For `c1-realistic-notional-ceil` (size
  0.000001): is the order rejected at decision (`SizePrecision`, no
  reservation) or reserved and rejected at arrival? The vector offers an
  alternative size.
- **A-11 Reservation of the outstanding quantity after a partial fill.**
  12 §9.4: "Reservation of 10 §9.4 C1 for the outstanding quantity". Is the
  fee part recomputed as the fee of the outstanding shares at the limit
  (`c3-release-partial-then-terminal` assumes this: 0.1046 for 6 shares) or
  scaled from the original? Both satisfy C1; they differ by rounding.
- **A-12 Second cancel of the same order (realistic).** 12 §7.3 resolves
  cancels in the OM ("known terminal → skipped silently"), but a target that
  is still non-terminal when the second cancel is emitted (first cancel in
  flight) reaches the exchange and gets `CancelFailed(ExchangeNotCanceled)`
  (13 §6.6). 60 §5.5 cites both for x6. Confirm: silent iff the OM sees the
  key terminal at emission; otherwise `ExchangeNotCanceled` (`dd-12`,
  `cg-04`, `cg-06`).
- **A-13 Release on full fill vs on `OrderDone(Filled)`.** 12 §7.6 rule 3
  releases the cid when delivered fills reach the size, i.e. in the Fill
  callback, before `OrderDone(Filled)` is delivered. Confirm that a re-place
  inside that Fill callback is accepted (`dd-15`); the OrderDone that follows
  then belongs to the old generation.
- **A-14 Observability of `OrderKey` / simulator exchange ids.** 10 §6 says
  the simulator renders exchange ids as `sim-{order_key}` at I/O; 10 §10.1
  marks `OrderAccepted.exchange_id` "(live)" and 30 §8 `Option<&ExchangeOrderId>`.
  Do backtest sessions expose `sim-N` to the strategy (then `cg-01` can
  assert key density from strategy code) or only in the ledger/trace?
- **A-15 Cancel-failure reason strings.** 10 §10.2 gives TS strings only for
  `UnknownClientOrder` and `MissingExchangeOrderId`; the cited
  `cancellation.ts:61-127` also emits `invalid_cancel_batch_size`,
  `invalid_order_reference` and `conflicting_order_reference`. 22 §3.4 says
  an unknown code on either side yields `reason_code_unmapped`, which CL-8
  calls a bug "until the code is mapped in 21 §17" — but 21 §17 lists reject
  reasons, not cancel-failure reasons. Proposed: map `TooManyIds` ↔
  `invalid_cancel_batch_size`, `ConflictingRefs` ↔
  `conflicting_order_reference`, and add an engine reason for
  `invalid_order_reference` (or state it is unreachable from typed intents).
- **A-16 10 §8.2 rows omit the ts-compat status updates.** Rows 4, 5, 17, 18
  list lifecycle events only; 13 §5.1 interleaves `SettlementUpdate{Matched,
  fill: None}` after `OrderAccepted` and `{Confirmed}` after a FOK's
  `OrderDone(Filled)`, delivered to the strategy and traced (22 §3.2). The
  vectors assert the 13 §5.1 sequence in ts-compat; please confirm 10 §8.2 is
  "lifecycle events only".
- **A-17 `marketId` when the first counted tick has no book.** 21 §11:
  "Condition id from the first **counted** tick's book event"; a market whose
  first counted tick is a `price_change` or a synthetic tick (15 §8 counts
  deltas before the first book) has none. TS takes `tick.snapshot.market`
  on any tick. Confirm the source (job `conditionId` / first book event of
  any outcome) for `sk-02b`/`sk-03`.
- **A-18 "700 bps" wording.** 11 §4 row 2 ("700 bps at the limit price") and
  10 R9 ("fee at limit, 700 bps") read as 7 % of notional; the cited
  `capital.ts:16-28` uses `computePolymarketTakerFee` =
  `0.07 × p × (1 − p) × size` at 4 dp. The vectors follow the cited code
  (`c1-ts-compat-reservation`: 5.3 + 0.1744). Please confirm and reword.
- **A-19 Compat jitter range (informational).** 13 §5.1 draws an integer in
  the closed range `[−j, j]`; TS `Math.trunc((Math.random() × 2 − 1) × j)`
  never yields `±j`. Irrelevant for parity (j = 0) and documented as not
  reproducible; noted so that nobody expects distributional parity.
- **A-20 `sellable` in ts-compat vs the merge clamp.** 30 §5.2 says
  `sellable(o)` "equals `qty` in ts-compat", while 12 §7.3 clamps ts-compat
  merges by "delivered quantity minus pending merges". Both can hold (the
  clamp does not use `sellable`), but the SDK doc should say which number a
  ts-compat port sees between a merge intent and its `PositionsMerged`.

## 4a. Triage decisions D58–D69 (native/spec/02-decisions.md on `native-engine`)

Binding for the C2 tests; the vectors below were updated to them.

| Decision | Resolves | Effect on this crate |
|---|---|---|
| D57 (via D58) | A-02 | CI item 6 pins the sha of the committed defaults file; `ts-compat-default-jitter0` stays the spec-shaped candidate and `ci_item6_default_fixture_hashes` compares against the committed file. |
| D58 | A-01, A-19 | Committed ts-compat default `compatLatency` 0/0; producer fallback 0/20 is producer-only; the binary accepts any `jitterMs ≥ 0` (removed from `invalid-values`); zero jitter enforced by the harness. A-19 needs no action. |
| D59 | A-04 | `min_order_size()`, `price_bounds()`, `taker_delay()`, `batch_cap()` return `Option`, `None` in ts-compat; `source()` is the RS4 classification in both profiles (`ts_compat_rules.json` note, `rules_view_constants`). |
| D60 | A-05 | `out.place_batch(&[])` writes no intent (no event, trace record or dispatch) and is not an error (`caps.json` `batch-0-entries`, `g3_caps.rs::batch_empty`). |
| D61 | A-14 | Backtests expose `Some("sim-{order_key}")` but it is opaque; `cg-01` key density is read from the ledger only (`cid_generations.json`). |
| D62 | A-15 | `TooManyIds` = `invalid_cancel_batch_size`, `ConflictingRefs` = `conflicting_order_reference`; `invalid_order_reference` unreachable from typed intents (`vocabularies.json`, `caps.json`, `ts_compat_rules.json`). |
| D67 | (context for A-09) | ts-compat `on_market_event` receives `tick.ts`; `cs-08` expects `now() == T1` in the execution-step callbacks. |
| D68 | (RNG-6 top of range) | `open_unit` maps the single 1.0 result to `1 − 2^-53`; `src/rng.rs` and `seed_vectors.rs::open_unit_top_of_range_stays_below_one` follow; RNG-7 row 7 unchanged. |
| D69 | A-03, A-06, A-07, A-08, A-09, A-10, A-11, A-12, A-13, A-16, A-17, A-18, A-20 | A-03: `-0` rejected (tightened regex; `decimal_string_grammar`). A-06/A-13: `dd-05`, `dd-15` correct. A-07: `cs-05` correct. A-08: fault at the (N+1)-th counted delivery, interest-skipped deliveries count; `cs-06` correct. A-09: `cs-08`, `cs-10` fixed (above). A-10: validation before funding; `c1-realistic-notional-ceil` now 5 @ 0.33 and a new `c1-realistic-precision-reject-no-reservation` vector. A-11: `c3-release-partial-then-terminal` correct. A-12: `dd-12`, `cg-04`, `cg-06` correct. A-16: vectors assert the 13 §5.1 sequence, correct. A-17: `marketId` from the first counted tick carrying one. A-18: vectors follow the cited code, correct; spec wording to be fixed. A-20: `sellable` = `qty` in ts-compat; pending merges do not reduce it. |
| D63–D66 | — | Harness, parity-input, cargo-deny and `selftest` matters; no vector affected. `det13_selftest_reports_seed_vectors_ok` must accept the D66 `serve_vs_run` skip detail before M5a. |

## 5. What C2 needs from the testkit (30 §15) to execute the skeletons

- Profile selection (`ts-compat` / `realistic`) and a `ModelConfig` override
  (`runner.maxEventsPerDrain`, `execution.compatLatency`, `risk`, `capital`).
- Scripted strategies: closures or a small trait impl per vector that can
  return intents from `on_tick` and `on_event` and record `ctx` views.
- Scripted inputs: book snapshots and price changes per outcome with explicit
  timestamps, feed updates (for `cs-10`, `cs-11`), and a resolution.
- Access to: the delivered account events per callback, the parity trace
  (22 §3), `MarketStats` and `EngineResult.diagnostics.anomalies`
  (`duplicate_active_cid`, `oversold_qty`, `reservation_dust`), and, for
  `cg-01`/`cg-08`, the ledger records (22 §4) or simulator exchange ids.
- Two sessions in one process (`dd-11`, `cg-12`, `cs-12`, per-market
  allowance).
- The canonical `artifact` and `parity-check` binaries (60 VP-7, §8.1) and
  the fixture jobs of 60 §12 for the `bin` tests.
