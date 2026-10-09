# 20 — Native binary protocol

This document defines how TypeScript talks to a native strategy artifact: the
subcommands, the streaming worker mode, versions, capabilities, exit codes and
process rules. It replaces `native/BINARY-PROTOCOL.md` (protocol v1, written
for the abandoned WIP). It does not define the payloads. Jobs and results are
in [21-job-and-output-contract.md](21-job-and-output-contract.md), and
trace, ledger and journal formats are in
[22-trace-ledger-journal.md](22-trace-ledger-journal.md). The fleet process
model (how many processes and threads, P-core vs E-core placement) is chosen
in [16-performance-and-parallelism.md](16-performance-and-parallelism.md).
That document selects the `serve` mode below for the fleet, and this document
defines its wire protocol.

This document is the single owner (00 §3.1) of: the error-class vocabulary
and the retry policy keyed by class (§4), the executor process contract
(framing, frame cap, environment allowlist, parent death, drain, supervision
timers; §2, §6) and the native producer flag matrix (§5.6). Other documents
reference these and do not restate them.

## 1. The artifact

- A native artifact is one executable: the engine plus exactly one strategy,
  built as described in [31-artifacts-build-publish.md](31-artifacts-build-publish.md).
  v1 targets `aarch64-apple-darwin` only (D12). Identity = sha256 of the
  binary bytes (`src/strategy/artifacts/native.ts:16-32`).
- **Two variants from one source** (D44; 31 §5.5, 50 §17). The `standard` variant (fleet, every agent build, backtest, paper)
  is built without the `real-orders` feature: it has no `live` subcommand and
  no code path to an authenticated trading endpoint, and `describe` reports
  `realOrders: false`. A strategy moves from backtest to paper on the same
  sha without a rebuild (requirement `live-subcommand-and-trust`). The
  `real-orders` variant adds `live` and reports `realOrders: true`. Only the
  user builds it, on the live host, from the tree whose reproducible rebuild
  matched the standard sha; both share one `source_hash` (31 §10). Workers
  and the producer refuse a binary with `realOrders: true`. Replaying a
  journal with the standard artifact proves that both variants decide
  identically (50 §13.3).
- Protocol version defined here: **`protocolVersion = 2`**. Version 1 (the WIP
  `describe`/`run`/`run-group`, `native.ts:23`) is not supported by the new
  engine. TS MUST refuse a binary that reports another version.

| Subcommand | Lifetime | Used by |
|---|---|---|
| `describe` | one-shot | producer (param validation, feed eligibility, capabilities) |
| `schema` | one-shot | CI, worker verification, debugging |
| `selftest` | one-shot | worker after download, fleet canary |
| `run` | one-shot | sequential CLI path (process-per-job mode), parity tooling, debugging |
| `run-group` | one-shot | debugging and parity of candidate groups |
| `serve` | long-lived | **fleet workers and `--sequential`** (the selected process model, 16 §5) |
| `paper` | long-running | live runtime without real orders (D28) |
| `live` | long-running | live runtime with real orders; `real-orders` variant only, launched only by the user (D05) |

## 2. Global rules (every subcommand)

| # | Rule |
|---|---|
| G1 | stdout carries only protocol JSON. One-shot commands print exactly one JSON document, on success and on failure. Streaming commands print NDJSON (one compact JSON object per line). Logs go to stderr as NDJSON `{level, tsMs, jobId?, msg}`. |
| G2 | The binary MUST NOT read environment variables for behavior. Only `PMB_LOG` (stderr verbosity) and `RUST_BACKTRACE` are read. Every result-affecting setting comes from the job ([21](21-job-and-output-contract.md) §6). This removes today's env knobs: `native/crates/pmb-replay/src/feeds/mod.rs:60-89`, `src/backtest/feeds/wireBacktestExternalFeeds.ts:39-99`, `src/trading/runnerConfig.ts:5`, `src/trading/StrategyRunner.ts:404-417`. |
| G3 | `describe`, `schema`, `selftest`, `run`, `run-group` and `serve` do no network I/O and hold no credentials. Inputs are local absolute paths resolved by TS. An `r2://` or relative path is `invalid_input` (requirement `inputs-resolved-locally-by-ts`; today `runSingleMarket.ts:386-415` downloads inside the engine). |
| G4 | The binary reads only the files the job names (market input, feed day files, own-activity ledger) plus validated derived tapes under `--tape-dir` (16 §7.5 NT-5), and writes only the output paths the job or flags name (trace, ledger, simulator trace). `paper` and `live` read their config file and `--state-dir` and write only under `--journal-dir` and `--state-dir` (§7). Job output files are written atomically (temp file in the same directory, then rename); journals are appended (22 §6.4). Path rules per subcommand are in [21](21-job-and-output-contract.md) §5.1. |
| G5 | **Determinism.** The deterministic section of a result ([21](21-job-and-output-contract.md) §10) is a pure function of (binary bytes, job semantic sections). It MUST be byte-identical across machines, thread counts, `run` vs `serve`, co-scheduled jobs, cache state, wall clock and environment. Non-semantic inputs (`outputs`, `budget` including the per-job thread allowance `budget.threads`, every process flag) MUST NOT change it. |
| G6 | TS spawns the binary with exactly this environment: `TZ=UTC`, `LANG=C`, `RUST_BACKTRACE=1`, and optionally `PMB_LOG`. Nothing else is inherited: in particular no `REDIS_URL`, `R2_*`, `DATABASE_*`, `PRIVATE_KEY`, `POLYMARKET_*`, `BOT_ENV`, `BACKTEST_*`, `MAX_EVENTS_PER_DRAIN` or `DRY_RUN`. Today `native.ts:95` inherits the full `process.env` on a machine that holds live keys. cwd is a per-process temp directory (`serve`: the `--work-dir`). The deny-network sandbox profile is specified in [40-fleet-integration.md](40-fleet-integration.md) §6.2; the producer runs `describe` under an equally strict one (31 §8 step 4). |
| G7 | Built with `panic = "unwind"` (D18). Panics are caught per candidate per strategy callback and per job ([12-engine-core.md](12-engine-core.md) §11 owns fault semantics). A panic never takes down other jobs or candidates. |
| G8 | **Parent death and stdin EOF.** One-shot commands exit when stdout is closed (EPIPE). `serve`: stdin EOF **after** a `drain` message is the normal shutdown path (finish in-flight jobs, §6.2); stdin EOF **without** a prior `drain` means "parent gone": exit within 1 s without finishing in-flight work (their results could not be delivered). `paper`/`live`: stdin EOF without a prior `stop` is treated as SIGTERM (graceful stop, §7), because open orders must be canceled. Every long-lived command also exits when `getppid()` becomes 1, checked at least once per second (macOS has no PDEATHSIG). |
| G9 | One stdout document or NDJSON line, and one stdin NDJSON line, is at most **64 MiB**. TS enforces the cap on stdout and kills on overflow (S5 applies; a job that reproduces it alone fails `invalid_output: line_too_large`); the binary rejects an oversize stdin line as a fatal protocol error. Today stdout is buffered without limit (`native.ts:96-99`). |
| G10 | JSON is UTF-8, camelCase, compact. Number rules are in [21](21-job-and-output-contract.md) §18: no NaN or Infinity, no integer outside ±(2⁵³−1) in any payload (the run seed is bounded, 10 §6.1 RNG-1), money and sizes in jobs as decimal strings. |
| G11 | **Stack.** Every engine job runs on a thread whose stack size is the value of 16 EX-6 (default 8 MiB; `--stack-mb` overrides it for measurement), in every subcommand. `run` therefore executes the job on a spawned thread, not on the main thread, so a strategy that runs under `run` also runs under `serve`. A stack overflow aborts the process (§6.3 S5). |

## 3. Versions and capabilities

| Field | Meaning | Who checks |
|---|---|---|
| `protocolVersion` (int, 2) | CLI and IPC shape in this document | TS before any use |
| `jobSchemaVersions` (int[]) | `EngineJob` versions the binary accepts | producer picks one; worker gate (D12, 40 §4) |
| `outputSchemaVersions` (int[]) | `EngineResult` versions the binary can emit | worker shim validator |
| `modelConfigVersions` (int[]) | `ModelConfig` versions accepted | producer |
| `rulesTables` (object[]) | the rule-table versions compiled into the engine, each with its dated tables, fallback constants, RS4 required-field set and verification statuses ([11](11-exchange-rules.md) §13.5 VR2) | producer (VR3); the binary refuses any other `modelConfig.rules.rulesTableVersion` (`invalid_input`, cause `rules_table_version`) |
| `contractSha256` | sha256 of the JSON Schema bundle compiled into the binary | TS asserts it equals the checked-in bundle for that version ([21](21-job-and-output-contract.md) §3) |
| `engineVersion` (semver), `engineCommit`, `engineDirty` | engine crate version, source commit, dirty flag | stored per run (D09); live refuses `engineDirty=true` |
| `sdkVersion` (semver) | `pmb-sdk` version the strategy was built against | provenance |
| `rustc`, `target`, `buildProfile` | toolchain, triple, profile name | worker refuses a foreign target (D12) |
| `traceFormat`, `ledgerFormat`, `journalFormat` | format ids from [22](22-trace-ledger-journal.md) | parity tooling, uploaders |
| `features` (closed string list) | optional engine features: `parity_trace`, `parity_trace_feeds`, `ledger`, `candidate_groups`, `execution_variants`, `own_activity`, `sim_trace` (M3c) | producer, against §5.6 |
| `realOrders` (bool) | `true` only in the `real-orders` variant (§1) | worker gate and producer refuse `true`; the live launcher requires it |

Compatibility rules:

- Schemas are strict: unknown fields are rejected in both directions. Any
  change to a schema bumps its integer version. There are no silent minor
  versions.
- The producer emits exactly one `jobSchemaVersion` per submission: the highest
  version in both the binary's list and TS's list. Old artifacts keep working
  as long as TS keeps support for their versions, because every binary embeds
  its own engine (requirement `engine-in-binary-versioning`).
- Native market jobs are gated on `protocolVersion`, `jobSchemaVersion`,
  `target` and the shim version, never on the producer git SHA (D12; the gate
  algorithm is 40 §4; the job fields are `jobSchemaVersion`, `native` and
  `strategyArtifact.target`, 21 §4). The producer SHA and
  dirty flag are provenance only.

## 4. Exit codes and error classes

One closed vocabulary of error classes is shared by exit codes, `EngineResult`
error objects ([21](21-job-and-output-contract.md) §10), shim-side failures,
failure-row reasons and the `failure_class` column (21 §14). There is no other
class list. [40-fleet-integration.md](40-fleet-integration.md) implements the
BullMQ actions of §4.3 (today: 3 attempts with exponential 5 s backoff,
`src/backtest/queue.ts:86-91`; exit 2 becomes `UnrecoverableError`,
`native.ts:121-124`, `marketProcessor.ts:57-61`).

| Exit | Class | Raised by | Meaning |
|---|---|---|---|
| 0 | — | — | success (a `run-group` with some failed candidates is still 0) |
| 1 | `runtime` | engine, shim | transient I/O or resource error; decode failure of a file whose sha256 is unknown (another host may hold a good copy); R2 download failure in the shim |
| 2 | `invalid_input` | engine, shim, producer | bad CLI args, schema violation, unsupported version, profile, input mode, rules table or market, invalid params, `r2://` or relative path, strategy id mismatch, target mismatch, artifact incompatible with this fleet, blocklisted engine |
| 3 | `data_missing` | engine, shim | the correct bytes of a required file are not on this host: the file is absent, a pre-existing local copy fails the job's `bytes`/`sha256` check and this host may not re-download it (`--read-from local`), or a feed day file's size changed after the shim's check (day files carry no sha256, 14 §4.1). Another host or a sync can succeed. The message names the fix command. |
| 4 | `data_defect` | engine, shim | deterministic data problem, identical on every host: an integrity mismatch of a freshly downloaded canonical copy (the R2 object itself does not match the catalog; the shim re-downloads once first, 40 §6.1) or one the binary detects after the shim's check (15 I-8); decode failure of a file whose sha256 was verified; unknown converter format version; file does not match the job (foreign asset, condition id, manifest); Chainlink gap ≥ `maxGapMs`; pre-coverage market; price-to-beat pipeline gap ([14](14-feeds-and-plugins.md) §10, [15](15-inputs.md)) |
| 5 | `timeout` | engine | the job's `budget.wallMs` expired (§6.3 S4) |
| 6 | `invalid_output` | engine, shim | a contract violation in the output: the engine's egress self-check ([21](21-job-and-output-contract.md) §19), a shim schema or echo failure, an oversize frame |
| 7 | `strategy_fault` | engine, shim (`result_too_large`) | strategy panic, overflow or contract breach in strategy code (exit code only for single-candidate `run`; in groups and `serve` it is per candidate) |
| 8 | `engine_fault` | engine | caught engine panic or invariant violation (for example the PnL identity, 12 §9.6) |
| 101 | `engine_fault` | engine | panic escaped every catch boundary (Rust default code) |
| — | `canceled` | engine | job canceled by a `cancel` message (`serve` only); shim-internal, never persisted (40 §8.1, §8.4) |
| signal | `killed` | shim | the executor died (signal, abort, oversize line) or was killed by the shim (memory budget, missing `pong`, deadline backstop), and the job then also killed its isolated re-run (§6.3 S5). Today `code ?? 1` hides the signal (`native.ts:114`) |

- On any non-zero exit, the last stderr line MUST be a one-line human reason
  (at most 1,000 characters). It is a fallback only: the structured error
  document on stdout is authoritative.
- A class is a property of the cause, not of the subcommand. `data_missing` vs
  `data_defect` matters because a missing or damaged local copy can succeed on
  another worker, while a Chainlink hole cannot. The retryable data case of
  requirement `failure-classes-and-timeout` is therefore only `data_missing`;
  the gap and pre-coverage cases are deterministic and never retried
  (14 §10 agrees).

### 4.1 Causes

Every error carries a `cause` (called "detail" in 40 §8.1 and the
`failure_detail` column of 42 §3.6): a snake_case label
(`^[a-z][a-z0-9_]{0,47}$`, at most 64 characters with the column) that
refines the class. Causes are diagnostic only: they appear in the reason text
(§4.2), in `ErrorInfo.cause` and in `failure_detail`, never in an enum column,
so an engine release MAY add a cause without a schema bump. Known causes:

| Class | Causes |
|---|---|
| `runtime` | `io`, `decode_unverified`, `r2_download`, `resource` |
| `invalid_input` | `args`, `schema`, `version`, `profile`, `input_mode`, `rules_table_version`, `rules`, `market`, `params`, `path`, `strategy_id`, `model_config`, `feed_availability`, `window`, `symbol`, `unsupported_feed`, `context_missing`, `target_mismatch`, `artifact_incompatible`, `engine_blocklisted`, `flag` |
| `data_missing` | `day_file_missing`, `input_missing`, `integrity_mismatch` |
| `data_defect` | `corrupt`, `integrity_mismatch`, `format_version`, `foreign_file`, `pre_coverage`, `upstream_hole`, `pipeline_incomplete` |
| `timeout` | `deadline` |
| `invalid_output` | `self_check`, `schema`, `echo_mismatch`, `line_too_large` |
| `strategy_fault` | `panic`, `error`, `cascade_limit`, `intent_meta_limit`, `result_too_large` (41 §6.2; fails the whole job) |
| `engine_fault` | `panic`, `invariant` |
| `killed` | `signal` (the message names it), `oom_budget`, `pong_missing`, `backstop_timeout` |

### 4.2 Reason text

The one-line reason stored in `backtest_run_failures.reason`
(`aggregateProcessor.ts:120-136`) for a native error is
`<class>: <cause>: <message>`, for example
`data_defect: upstream_hole: Chainlink hole 2026-06-01T10:00:00Z for 412 s (set maxGapMs 0 to replay stale)`.
The class goes to `failure_class` ([21](21-job-and-output-contract.md) §14,
42 §3.6) and the cause to `failure_detail`. Native errors always carry a
cause; legacy TS reasons are unchanged and leave both columns NULL.

### 4.3 Retry policy (BullMQ actions)

| Class | Action on a single-candidate job | In a candidate group |
|---|---|---|
| `runtime`, `data_missing` | throw: today's attempt ladder (3 attempts, exponential 5 s backoff); the retry may run on another host | the whole market job retries |
| `timeout` | first time: throw, and the retry gets 2× the budget; second time: `UnrecoverableError` | per 40 §8.2 and 41 §8: a candidate stuck in a callback (named by `progress.inCallback`) is removed and failed alone; otherwise the whole job |
| `invalid_input`, `data_defect`, `invalid_output`, `strategy_fault`, `engine_fault`, `killed` | `UnrecoverableError` (never burns retries; requirement `native-error-classification`). `invalid_output` and `engine_fault` also raise a loud log and alert. | group-level: every candidate fails; a candidate-level `strategy_fault` fails only that candidate (21 §14), except `result_too_large`, which fails the job |
| `canceled` | not an outcome: the job is released per 40 §8.4 | — |

`killed` is never retried by BullMQ because the isolated re-run of §6.3 S5
already is the retry, inside the same attempt.

### 4.4 Drift guard

The class names above are the only ones. CI (60 §14, CI-1 and CI-2) MUST fail
when a spec document, Rust source or TS source contains one of these
superseded class names: `input_invalid`, `data_unavailable`, `runtime_error`,
`strategy_panic`, `executor_crash`, `output_invalid`; the only allowlisted
uses are this paragraph and the live alert kind `strategy_panic` (50). `oom_budget` and
`echo_mismatch` are causes (§4.1), not classes. The same check fails on
references to spec files that do not exist (for example the short name
`16-performance`).

## 5. One-shot subcommands

### 5.1 `describe`

```
<bin> describe [--params '<json object>'] [--params-file <path to JSON array>]
```

Validates params and prints the binary's identity and capabilities.
`--params-file` takes an array of param objects and returns one entry per
element, so a 100-candidate group needs one spawn instead of 100.

```jsonc
{
  "type": "describe",
  "protocolVersion": 2,
  "binary": {
    "engineVersion": "1.0.0", "engineCommit": "<40 hex>", "engineDirty": false,
    "sdkVersion": "1.0.0", "rustc": "1.89.0", "target": "aarch64-apple-darwin",
    "buildProfile": "artifact", "contractSha256": "<64 hex>"
  },
  "capabilities": {
    "subcommands": ["describe","schema","selftest","run","run-group","serve","paper"],
    "inputModes": ["telonex-delta","recorder-v4","journal"],
    "profiles": ["ts-compat","realistic"],
    "jobSchemaVersions": [1], "outputSchemaVersions": [1], "modelConfigVersions": [1],
    "rulesTables": [ { "version": "rules-table-v1", "...": "dated fee and delay rows, fallback constants, RS4 required fields, verification statuses (11 VR2)" } ],
    "features": ["parity_trace","parity_trace_feeds","ledger","candidate_groups","execution_variants"],
    "traceFormat": "pmb-parity-trace/2", "ledgerFormat": "pmb-ledger/1", "journalFormat": "pmb-live-journal/1",
    "maxCandidates": 1024, "realOrders": false
  },
  "engineConstants": { "...": "feed lookbacks, tails, Chainlink coverage floor, TA candle lookback (14 F-47)" },
  "strategy": {
    "id": "overnight-opus55-lagsnipe.v15.rs",
    "paramsSchema": { "...": "JSON Schema 2020-12 exported from the params derive, with doc comments" },
    "results": [
      { "ok": true, "params": { "...": "normalized, key-sorted, defaults applied" },
        "requiredFeeds": { "binanceWsSpotPrice": {}, "polymarketPriceToBeat": { "enabled": true } } },
      { "ok": false, "errors": [ { "path": "/size", "message": "expected a number >= 1" } ] }
    ]
  }
}
```

Rules:

- `describe` is pure: no file reads, no network, target under 100 ms.
- Params accept CLI strings (`{"size":"2"}`) and typed JSON (from the DB on
  `--extend`, the simulator and candidate files). Normalization is idempotent:
  `describe(describe(p).params).params == describe(p).params` (requirement
  `params-normalization-idempotent`). Unknown keys are errors. The params
  derive is specified in [30-strategy-sdk.md](30-strategy-sdk.md).
- `requiredFeeds` keeps the TS `ExternalFeedsRequestConfig` shape
  (`src/strategy/plugins/ExternalFeedsRequestPlugin.ts:5`), or `null`, so the
  producer's feed eligibility code works unchanged
  (`src/cli/helpers/strategyArgs.ts:279-316`). It MUST be computable from
  params alone.
- With `--params`, an invalid param set exits 2 with an error document. With
  `--params-file`, per-element errors are reported in `results` and the exit
  code is 0 unless the file itself is invalid.
- The producer MUST check every flag of the submission against the flag
  matrix (§5.6) and the capabilities above before enqueueing any job
  (requirement `native-flag-matrix`). An unsupported input mode, profile,
  feature or rules table is refused at submit time (exit 2), not discovered
  as N failure rows.

### 5.2 `schema`

```
<bin> schema
```

Prints `{type:"schema", contractSha256, schemas:{engineJob, engineResult, modelConfig, liveConfig, params, traceRecord, ledgerRecord, serveIn, serveOut}}`,
the JSON Schemas compiled into the binary (`serveIn`/`serveOut` are the
§6.2 message unions). CI and the worker use it to prove that the binary's
contract matches the checked-in contract ([21](21-job-and-output-contract.md) §3).

### 5.3 `selftest`

```
<bin> selftest
```

Runs fixtures embedded at build time. It runs one embedded job twice, once
through the `run` path and once through the `serve` path with 2 threads, and
checks that the deterministic sections are byte-identical. It also checks
golden values for fixed-point rounding, the fee curves and the seed
derivation vectors (10 §6.1 RNG-7). Prints
`{type:"selftest", ok, checks:[{name, ok, detail?}]}`. Exit 0 if all pass,
otherwise 8. The worker runs it once per sha per machine after the hash check.
The fleet canary in [60-verification.md](60-verification.md) runs it on every Mac.

### 5.4 `run`

```
<bin> run --job <path | -> [--trace <path>] [--trace-level decisions|feeds] [--ledger <path>] [--sim-trace <dir>] [--stack-mb N] [--tape-dir <dir>]
```

- Input: one `EngineJob` with exactly one candidate.
- Output: one `EngineResult` document ([21](21-job-and-output-contract.md) §10).
- `--trace`, `--trace-level` and `--ledger` override `job.outputs`. Any
  absolute path is accepted (21 §5.1). They exist for parity tooling (today
  `src/cli/parity/run-parity.ts:44-48` invokes `<rust-bin> --job <job> --trace <out>`;
  this becomes `run --job ... --trace ...`).
- `--sim-trace <dir>` (from M3c, `features: sim_trace`) writes the dashboard
  simulator trace of [22](22-trace-ledger-journal.md) §5 into `<dir>`. Like
  every output flag it is not result-affecting (G5).
- The profile, seed and every model setting come from the job. There is no
  `--profile` flag.
- Exit code: 0 when the result `status` is `ok` and the candidate is `ok`.
  Otherwise it is the exit code of the error class (§4), and the error document
  is still printed.
- `run` executes the job on one engine thread (G11).

### 5.5 `run-group`

```
<bin> run-group --job <path | -> [--trace-dir <dir>] [--trace-level ...] [--threads N] [--stack-mb N] [--tape-dir <dir>]
```

- Input: one `EngineJob` with N >= 1 candidates. Compatibility rules are in
  [21](21-job-and-output-contract.md) §8 and [41-candidate-groups.md](41-candidate-groups.md).
- The market input and feed files are decoded once. Each candidate is
  isolated: its own strategy, plugins, portfolio, order manager, simulator and
  RNG streams from the shared per-market seed (D14, 10 §6.1; requirement
  `group-isolation-and-proof`). Only immutable decoded data is shared.
- Candidates MAY run on up to N threads. Results are always in input order.
- A candidate's result section MUST be byte-identical to `run` of a job that
  contains only that candidate (D13: standalone `--extend` reproduces the
  group result).
- Exit 0 when the group-level status is `ok`, even if some candidates are
  `strategy_fault`. A group-level failure (input, data, I/O) uses that class's
  exit code.
- Per-candidate trace files go to `--trace-dir/<candidateKey>.jsonl.gz`.

### 5.6 Native flag matrix

Every `npm run backtest` flag, for a run whose strategy is a native artifact.
"Producer" means the flag is consumed by TS (selection, labels, process
control) and never reaches the binary. The producer path lands in M3a (01
§6); before that, native jobs are built only by the parity harness
(`src/native/buildEngineJob`, 60 HR-2). A flag not listed here MUST be rejected
for native runs (exit 2, cause `flag`). Today the parser silently skips any
unknown token that starts with `-` (`src/cli/helpers/backtestArgs.ts`, default
branch); that leniency stays for TS runs only (R14). The ModelConfig defaults
and resolution order behind the "Maps to" column are in
[21](21-job-and-output-contract.md) §6.3.

**Strategy and params**

| Flag | Native v1 | Maps to | Capability | Milestone |
|---|---|---|---|---|
| `--strategy-artifact <sha>` | supported | `MarketJobData.strategyArtifact` (`kind: 'native'`, `target`), `jobSchemaVersion` and `native.*` (21 §4) | `protocolVersion`, `jobSchemaVersions`, `target`, `realOrders = false` | M3a |
| `--strategy-file <path>` | supported for Rust packages (auto-publish, 31 §7.2) | as above, after publish | same | M3a |
| `--local-only` (with `--strategy-file`) | supported as 31 §7.5 defines (binary only in the local cache); it always builds the `artifact` profile, the only one the producer accepts (31 §8 step 3) | as above; workers never receive a local-only binary, so these runs need `--sequential` | same | M3a |
| `--strategy <id>` | not native: the registry is TS-only; native ports are artifacts with distinct ids (D20) | — | — | — |
| `--param key=value` | supported | `run.candidates[0].params` after `describe` normalization | `strategy.paramsSchema` | M3a |
| `--params-from-run <runId>` (new) | supported; exclusive with `--param` and `--candidates` | the row's typed params, re-normalized by `describe` (MUST equal them) | same | M3a |

**Input mode and order**

| Flag | Native v1 | Maps to | Capability | Milestone |
|---|---|---|---|---|
| `--input-mode telonex-delta` | supported; MUST be explicit (the TS default `recorded` is rejected for native) | `run.inputMode` | `inputModes` | M3a |
| `--input-mode recorder-v4` | supported | `run.inputMode`, `market.recorderV4` | `inputModes` | M7 |
| `--input-mode recorded`, `--input-mode telonex-paired` | **rejected** | — | — | — |
| `--read-from local` | supported | shim input resolution (21 §9) → `market.input.path` | — (producer, shim) | M3a |
| `--read-from local-or-download-from-r2-to-local` | supported | shim downloads if missing, then local (21 §9) | — | M3a |
| `--read-from r2` | supported; the shim downloads into the job's temp dir and deletes it afterwards; the binary never reads R2 | 21 §9 | — | M3a |
| `--order recorded` | accepted, no effect (the only native order) | — | — | M3a |
| `--order exchange_time`, `--time-driven`, `--realtime`, `--mode <x>` | **rejected** | — | — | — |

**Selection** (producer only; unchanged semantics, `listEligibleTelonexMarkets`)

| Flag | Native v1 | Notes | Milestone |
|---|---|---|---|
| `--symbol`, `--timeframe` | supported for `btc` and `5m`/`15m` only (D06); anything else exit 2 | — | M3a |
| `--slug a,b`, `--dir <d>`, positional paths | supported | telonex-delta files; V4 package directories and manifests from M7 | M3a / M7 |
| `--limit`, `--latest`, `--random`, `--from-ms`, `--to-ms` | supported | — | M3a |
| `--random-seed <int>` (new) | supported | seeds `--random` sampling (60 MS-2); recorded in `cmd`; NOT the engine seed (`--seed`) and not part of ModelConfig | M3a |
| `--allow-capture-gaps` | supported with `recorder-v4` | → `market.recorderV4.allowGaps` | M7 |
| `--capture-prefix`, `--list-eligible` | supported with `recorder-v4` | producer only (`--list-eligible` enqueues nothing) | M7 |

**Model** (result-affecting; every value lands in `modelConfig`, 21 §6)

| Flag | Native v1 | Maps to | Capability | Milestone |
|---|---|---|---|---|
| `--native-profile ts-compat\|realistic` | supported; **rejected on non-native strategies** (today silently ignored) | `modelConfig.profile` and the profile's default `execution` object (13 §7.3, §7.4) | `profiles` | M3a (ts-compat), M3b (realistic) |
| `--seed <int>` (new) | supported; integer in [0, 2⁵³−1] | `modelConfig.seed` (10 §6.1 RNG-1, default 0) | — | M3a |
| `--starting-capital <usdc>` | supported | `modelConfig.capital.startingCapitalUsdc`, plus legacy `startingCapital` (asserted equal) | — | M3a |
| `--latency-delay-ms`, `--latency-jitter-ms` | supported iff the resolved `execution.models.latency` is `compat` (always in ts-compat; a realistic A/B arm with that axis value); **rejected** otherwise, because those latencies come from `execution.latency` (13 §7.3) | `modelConfig.execution.compatLatency.{delayMs, jitterMs}`, plus legacy `latency` (asserted equal) | — | M3a |
| `--model-config-override '<json>'` (new, internal) | supported | JSON merge patch on the resolved ModelConfig (21 §6.3) | `modelConfigVersions` | M3b |

There is no fee-era flag: a realistic selection that spans fee eras is
allowed by default and reported per era (`fee_era` segments and the mixed-era
badge, 42 §3.5; D51). `--allow-mixed-fee-eras` of earlier drafts does not
exist and is rejected like any unknown flag.

**Outputs and groups**

| Flag | Native v1 | Maps to | Capability | Milestone |
|---|---|---|---|---|
| `--ledger` (new) | supported | `MarketJobData.ledger = true` → the shim sets `outputs.ledgerPath` (22 §4.1, transport 42 §7.5); not result-affecting | `features: ledger` | M3b |
| `--max-ledger-markets <n>` (new) | supported with `--ledger` | producer bound on markets × candidates with ledgers (42 §7.5, default 10,000) | — | M3b |
| `--candidates <file>` | native only (41 §3.5) | `run.candidates[]` (21 §8) | `features: candidate_groups`, `maxCandidates` | M4 |
| `--candidates-out <file>`, `--max-candidates`, `--max-candidate-markets` | supported | producer only (41 §3, §4) | — | M4 |
| `--allow-model-variants` (internal) | required for per-candidate ModelConfig overrides | candidate `execution` (21 §8) | `features: execution_variants` | M4 |

**Run control and labels** (producer only)

| Flag | Native v1 | Notes | Milestone |
|---|---|---|---|
| `--sequential` | supported | the producer runs the shim logic in-process with the same persistence path: `run` per market in M3a; from M5a a local `serve` executor with `T` threads (`run` per market stays available under `NATIVE_EXECUTOR_MODE=process-per-job`) | M3a |
| `--detach`, Ctrl+C-detach (`src/cli/backtest.ts:1618-1630`) | supported | queue path only | M6 |
| `--extend <runId>` with `--limit`, `--latest`, `--random`, `--from-ms`, `--to-ms` | supported | builds jobs from the row's `engine`, `model_config`, `seed`, artifact and params (42 §5). Forbidden with `--extend`: today's list (`backtestArgs.ts` extend block) plus `--native-profile`, `--seed`, `--model-config-override`, `--params-from-run`, `--candidates`, `--ledger`. Ledgers are written iff the parent has `ledger_uri` (22 §4.1). | M3a (a candidate's run: M4) |
| `--batchUid`, `--baselineId`, `--comment`, `--protocol`, `--model` (and `BACKTEST_PROTOCOL`/`BACKTEST_MODEL` where a launcher sets them; not read in `src/` at `9463830d`) | supported, unchanged | `AggregateJobData.insertMeta` only | M3a |

**Producer-side behaviors and environment**

| Item | Native v1 | Milestone |
|---|---|---|
| Feed preflights for missing Binance/Chainlink day files (`src/cli/backtest.ts:989-1098`) | unchanged, driven by `describe.requiredFeeds` | M3a |
| `gammaPriceToBeat` and `feedAvailability` | resolved by the producer (14 §6.2) into `market.gammaPriceToBeat`, `market.feedAvailability`, `asOfMs` | M3a |
| `BACKTEST_LATENCY_DELAY`, `BACKTEST_LATENCY_JITTER` (producer env) | fallback for `compatLatency` exactly as for TS runs (`src/cli/backtest.ts:745-757`); the resolved value is recorded in ModelConfig | M3a |
| Every other `BACKTEST_*` knob, `MAX_EVENTS_PER_DRAIN` | ignored for native runs; the producer prints one warning line naming each such variable that is set | M3a |
| `BACKTEST_ALLOW_DIRTY` | not needed: native runs record `producerDirty` instead of blocking (40 §4) | M3a |

## 6. `serve` — the long-lived streaming worker (fleet mode)

[16-performance-and-parallelism.md](16-performance-and-parallelism.md) §5
selects `serve` as the fleet process model. The reasons: at the expected ~6x
speedup, TS's 1.2-2.6 s per market becomes ~0.2-0.4 s, which is the same
order as per-job overhead (process spawn, per-process sha256 at
`native.ts:46-84`, Redis round trips; requirement
`cpu-slots-and-job-granularity`). One process can also keep decoded feed day
files in memory across markets and spread jobs over many threads, which
Node's one-process-per-slot model cannot do (`scripts/run-worker.sh:29-50`,
`src/cli/backtestWorker.ts:136-176`).

### 6.1 Invocation

```
<bin> serve --threads N --work-dir <abs dir> [--max-inflight M] [--cache-mb C] [--max-rss-mb R]
            [--idle-exit-secs S] [--drain-timeout-secs D] [--qos <class>] [--stack-mb K] [--tape-dir <dir>]
```

| Flag | Default | Meaning |
|---|---|---|
| `--threads` | 1 | Size of the engine's job thread pool (16 §5.3). |
| `--work-dir` | required | The executor's private temp directory (also its cwd). In `serve`, every job output path MUST be inside it (21 §5.1); the sandbox allows writes only there (40 §6.2). |
| `--max-inflight` | `threads` | Most jobs accepted at once. TS never sends more. |
| `--cache-mb` | 1024 | Byte budget for shared immutable caches (§6.3 S3, 16 §6). |
| `--max-rss-mb` | none | Above this, the binary emits `busy` and accepts no new job until it drops back below. |
| `--idle-exit-secs` | 300 | Exit 0 after this long with no job in flight, so processes of unused artifacts disappear. The fleet shim passes 60 (§6.5) and treats an idle exit that races a dispatch as a re-dispatch, not a crash (40 §8.3.3). |
| `--drain-timeout-secs` | 120 | Longest wait for in-flight jobs after `drain` or SIGTERM. The fleet shim passes the job budget cap (1,800, §6.5). |
| `--qos` | `default` | Thread scheduling class of every pool thread, set once at thread start. Values and mechanism: 16 §10.2. QoS is process configuration chosen by the shim from host configuration; jobs carry no QoS. |
| `--stack-mb` | 16 EX-6 (8) | Pool-thread stack size (G11). |
| `--tape-dir` | none | Root of derived input tapes (16 §7.5). The executor uses a tape only when it validates against the job's input (NT-5), otherwise it reads the canonical file; a bad or stale tape is never an error. Process configuration, never result-affecting (G5); the input path taken is reported in `diagnostics` only. Also accepted by `run` and `run-group`. |

### 6.2 Framing and messages

NDJSON in both directions, one message per line, each with a `type` field
(schemas `serveIn`/`serveOut`, §5.2). A malformed line, an unknown `type`, an
oversize line (G9) or a protocol violation (for example more than
`max-inflight` jobs) is fatal: the binary emits `fatal` and exits 2.

The binary speaks first:

```jsonc
{"type":"ready","protocolVersion":2,"contractSha256":"…","engineVersion":"1.0.0",
 "strategyId":"…","pid":4242,"threads":8,"maxInflight":8,"jobSchemaVersions":[1],
 "stackBytes":8388608,"qos":{"requested":"default","effective":"default"},"processRole":"default",
 "perfLevels":[{"name":"Performance","physicalCpu":4},{"name":"Efficiency","physicalCpu":6}]}
```

`qos.effective` and `processRole` are read back after the class is set, so a
clamped process (for example launchd `ProcessType Background`) is visible
(16 §10.2). `perfLevels` comes from `hw.perflevelN.*` (16 §10.1).

TS to binary:

| `type` | Fields | Semantics |
|---|---|---|
| `context` | `contextId`, `run` | Caches the run-level section of `EngineJob` ([21](21-job-and-output-contract.md) §5). `contextId` is an opaque key chosen by TS (the sha256 of its serialization of `run`); the binary never recomputes it. Idempotent. At least the 64 most recently used contexts are kept. |
| `job` | `jobId`, `job` | Starts a job. `job.run` is either inline or replaced by `job.runRef = contextId`. `job.budget.threads` is the most pool threads this job may use for candidate fan-out (the token weight `w` of 40 §7.2; [21](21-job-and-output-contract.md) §5); it never changes the result (G5). An unknown `runRef` yields a result with class `invalid_input`, cause `context_missing`, so TS can resend the context and the job. |
| `cancel` | `jobId` | Cooperative abort. The job returns a result with class `canceled`. |
| `ping` | `id` | Liveness probe. |
| `drain` | — | Accept no new jobs, finish in-flight jobs (at most `--drain-timeout-secs`), emit `drained`, exit 0. TS MAY close stdin right after sending it (G8). |

Binary to TS:

| `type` | Fields | Semantics |
|---|---|---|
| `ready` | see above | First line, exactly once. |
| `result` | `jobId`, `result` (`EngineResult`) | Exactly one per accepted job, including canceled and failed jobs. |
| `progress` | `jobId`, `eventsProcessed`, `elapsedMs`, `inCallback` | At most once per second per job. `inCallback` is `null` or `{candidateIndex, candidateKey, callback, sinceMs}` for a candidate currently inside strategy code longer than 1 s, so the shim can remove one stuck candidate from a group (40 §8.2.3, 41 §8). |
| `pong` | `id`, `inflight:[{jobId, eventsProcessed, elapsedMs, inCallback}]`, `rssBytes`, `cacheBytes` | Reply to `ping`. |
| `busy` / `idle` | `reason` | Back-pressure from the RSS limit. |
| `drained` | `completed` | Then exit 0. |
| `fatal` | `class`, `cause`, `message` | Last line before a non-zero exit. |

### 6.3 Execution rules

| # | Rule |
|---|---|
| S1 | Results may arrive in any order and are matched by `jobId`. The deterministic section of each result MUST be byte-identical to `run` of the same job (G5). |
| S2 | Concurrency is controlled by TS through the number of in-flight jobs. The binary sizes its pool at start and MUST NOT run more than `max-inflight` jobs. TS moves capacity between serve processes of different artifacts by changing in-flight counts, with no restart. |
| S3 | Shared state between jobs is limited to immutable, content-addressed data: decoded feed day files keyed by (path, bytes, mtime, sha256 when given), dated rule tables, validated derived tapes (16 §7.5), and decoded market events inside one group. Strategy, plugin, portfolio, order manager, simulator and RNG state never crosses a job or candidate boundary. A cache entry is inserted only after it is fully built, so a panic while building never poisons the cache. Eviction is LRU by bytes within `--cache-mb`. |
| S4 | **Deadlines.** `job.budget.wallMs` is checked cooperatively, at least every 4,096 engine events and between feed-file loads; at expiry the job returns class `timeout`, cause `deadline`, and the process keeps serving. A strategy stuck inside one callback cannot reach that check, so TS keeps a backstop (§6.5): it pings every executor every 5 s and kills the process group when a job exceeds 2× its budget plus 30 s, or when `pong` is missing for 30 s. The kill puts every in-flight job through S5; a job whose isolated re-run hits the backstop again fails `killed: backstop_timeout`. Today a hung binary holds a fleet slot forever because the BullMQ lock keeps renewing (`src/backtest/queue.ts:116-120`). |
| S5 | **Crash attribution (isolated re-run).** When an executor dies unexpectedly (a signal, an abort such as a stack overflow, a non-zero exit without `fatal`, stdout EOF, an oversize line) or the shim kills it (`oom_budget`, `pong_missing`, the S4 backstop), every job in flight on it becomes **suspect**. The shim re-runs each suspect job alone, sequentially, in a fresh process-per-job executor (`run`, or `run-group` for a group job; 40 §8.3.2), inside the same BullMQ attempt (the lock keeps renewing; no attempt is consumed). A suspect that completes is a normal result: results are deterministic, so the isolated result is valid. A suspect that also kills its isolated process fails with class `killed` and the cause observed there (or `invalid_output: line_too_large` when it reproduces an oversize line). Bystanders therefore never fail because of a co-scheduled poison job, whatever the number of poison jobs per artifact. An idle exit that races a dispatch is not a crash (40 §8.3.3). Crash-loop guard: more than 3 unexpected deaths of one sha within 60 s stop dispatch of that sha for 10 min (jobs wait, nothing fails) and are reported in the heartbeat. This is the only crash rule; [40](40-fleet-integration.md) §8.3 implements it. |
| S6 | `progress` and `pong` let TS tell a slow job (events still advancing) from a stuck one. |
| S7 | Each job writes its own trace and ledger files from its own thread, buffered, to the paths in `job.outputs`. With no outputs requested, tracing costs nothing ([22](22-trace-ledger-journal.md) §2). |
| S8 | Strategy logs are off unless the job enables them ([30-strategy-sdk.md](30-strategy-sdk.md)). Engine logs carry `jobId`. stderr volume is rate-limited, and the binary emits a `log_dropped` counter when it drops lines. |
| S9 | One serve process hosts exactly one artifact, because one binary contains one strategy. A machine runs at most `maxExecutors` serve processes, one per active artifact sha (40 §5.1). 16 sets the thread and in-flight policy per machine (Apple M4: 4P+6E; M1 Pro: 8P+2E). |
| S10 | SIGTERM or SIGINT means `drain`. A second signal means exit 130 immediately. |

### 6.4 What TS must do differently

- One Node supervisor per machine runs the native queue and talks to serve
  processes. There is no `tsx` child per slot (requirement `cpu-slots-and-job-granularity`; [40](40-fleet-integration.md) §5).
- The binary hash is verified once per machine and memoized per process
  (`native.ts:46-56` already memoizes per process). `selftest` runs once per sha.
- The worker shim builds `EngineJob` from `MarketJobData`, validates the
  `EngineResult` and stamps execution metadata ([21](21-job-and-output-contract.md) §12).
- `--sequential` uses the same shim code with a local executor (§5.6), so the
  local and fleet paths cannot drift.

### 6.5 Supervision constants

One table; [40](40-fleet-integration.md) and
[16](16-performance-and-parallelism.md) reference these values and change
them only here. Values marked "measured" MAY be retuned from the M5a, M5b
and M6 benchmarks with a note in this table.

| Item | Value | Owner of the mechanism |
|---|---|---|
| Framing | NDJSON, both directions | this document |
| Line cap (stdin and stdout) | 64 MiB | G9 |
| stderr retained by the shim | ring of 64 KiB per job, prefixed with `jobId` | 40 §8.3 |
| Environment | G6 list exactly | this document |
| Pool and `run` thread stack | 8 MiB (measured option `--stack-mb`) | 16 EX-6 |
| QoS | per process via `--qos`, never per job | 16 §10.2 |
| Executor idle exit | `--idle-exit-secs 60` in the fleet (measured); binary default 300 | §6.1, 40 §5.1 |
| Most executors per host | `maxExecutors` = 3; the least recently used executor with no job in flight gets `drain` | 40 §5.1 |
| `drain` timeout | `--drain-timeout-secs 1800` in the fleet (the job budget cap); binary default 120; then the shim kills the process group | §6.1, 40 §8.4 |
| `ping` interval / missing `pong` | 5 s / 30 s → kill (S5, cause `pong_missing`) | S4, S6 |
| Deadline | cooperative at `budget.wallMs` (`timeout: deadline`); backstop kill at 2× budget + 30 s (S5, cause `backstop_timeout`) | S4 |
| Timeout retry | once with 2× budget, then `UnrecoverableError` | §4.3 |
| RSS | stop admitting at 80 % of `native_memory_mb`; kill at 100 % (S5, cause `oom_budget`) | 40 §7.4 |
| Crash-loop guard | > 3 unexpected deaths of one sha in 60 s → pause that sha 10 min | S5 |
| Kill | `SIGKILL` to the process group (`-pgid`); the signal is recorded | 40 §8.3 |

## 7. `paper` and `live` — the long-running runtime

Runtime behavior (discovery, rotation, reconciliation, risk guards, alerts) is
in [50-live-runtime.md](50-live-runtime.md). This section fixes only the
process contract, so that one launcher works for both modes.

```
<bin> paper --config <path> --journal-dir <dir> --state-dir <dir> [--feed-secrets-fd <n>] [--state-port <n>] [--decisions-only]
<bin> live  --config <path> --journal-dir <dir> --state-dir <dir> --secrets-fd <n> --real-orders [--state-port <n>]
```

`live` exists only in the `real-orders` variant (§1); a `standard` binary
exits 2 (cause `args`).

| Channel | Contract |
|---|---|
| config file | `LiveConfig` JSON, strict schema in the contract bundle; field semantics in [50](50-live-runtime.md). It holds normalized strategy params (same normalization as `describe`), the full `ModelConfig` (paper simulates fills with the realistic profile, D28), the market set (BTC 5m and 15m, D06), allocation and session guards (D31), heartbeat (D30), alert routing (D33), journal bounds (22 §6.4), `liveMinEngineVersion` (copied by the launcher from `native/live/policy.json`, 50 §17) and the state bind address. No secrets. |
| secrets | `live` only, via `--secrets-fd <n>`: one JSON object read to EOF at startup, then the fd is closed. Never via argv (visible in `ps`) or env (inherited by children). Secret values are never logged, journaled or streamed. `paper` reads no trading secret. Its only optional channel is `--feed-secrets-fd <n>` (from M8): the PolyBolt key triple for the Chainlink feed, read like `--secrets-fd`, used only for the PolyBolt auth frame and redacted per 22 §6.7; the `standard` variant still has no trading-endpoint code. Only user-launched sessions pass it until the gate-4 answer below (50 §8.1). |
| state dir | `--state-dir`: the runtime's private directory: key lockfiles (`locks/`, 50 §4.1), the `KILL` file (50 §10.4), `session.json` (50 §10.5), `results/` (50 §14), `status.json` and logs (50 §15). |
| stdin (NDJSON from the TS launcher) | `chain_response {requestId, ok, txHash?, error?}` for split, merge and redeem transactions sent by the TS sidecar (D25), and `stop`. EOF without `stop` = graceful stop (G8). |
| stdout (NDJSON to the launcher) | `started {instanceId, sessionId, engine, configSha256}`, `market_started {slug, conditionId}`, `market_result {slug, result}` (an `EngineResult` per finished window, [21](21-job-and-output-contract.md) §10; persisted as a run row with `input_mode` `paper` or `live`, D11), `chain_request {requestId, kind: split\|merge\|redeem, conditionId, size}`, `alert {severity, kind, message}`, `stopped {reason}`. |
| state and commands | WebSocket on `127.0.0.1` only; a non-loopback bind is refused (today the WebUI defaults to `0.0.0.0` with an unauthenticated `cancel_all`, `src/cli/trading-bot.ts:1099`). It speaks the existing WebUI protocol (`webui/src/types.ts:66-89`: `snapshot`, `command`, `command_ack`), so the WebUI and the redeem watcher's `refresh_balance` (`src/cli/redeem-watcher.ts:57-104`) keep working. The command vocabulary is closed: `cancel_order`, `cancel_all`, `refresh_balance` (the WebUI's three), plus `kill`, `pause`, `resume` and `heartbeat_pause`; modes and effects are in 50 §16. An unknown command gets a `command_ack` error (R14). Commands enter the serial event loop and are journaled ([22](22-trace-ledger-journal.md) §6.3). |
| journal | Written under `--journal-dir` in the format of [22](22-trace-ledger-journal.md) §6. |

Real-order gate. `live` refuses to start, with exit 2, unless all of these hold:

1. The binary is the `real-orders` variant (`capabilities.realOrders = true`, §1).
2. The `--real-orders` flag is present and `config.realOrders` is `true`.
3. `engineDirty` is false, `config.liveMinEngineVersion` is not null, and the compiled `engineVersion` is at or above it (50 §17).
4. The per-API-key lockfile under `--state-dir` was acquired (D30, 50 §4.1).

Before it starts the binary, the TS launcher runs the trust check of
[31](31-artifacts-build-publish.md) §10 (reproducible rebuild of the standard
artifact, D17) and the config checks of 50 §17. Real-order mode is never
inferred from `DRY_RUN` or any other environment variable
(`src/cli/trading-bot.ts:166-168`; m1-ivan, today's TS live Mac, has
`DRY_RUN=false` in its env files). The AI agent never builds the `real-orders` variant and
never runs `live` (R10).

Signals: SIGTERM or SIGINT means graceful stop: no new intents, cancel this
instance's open orders (real mode), flush the journal, emit `stopped`, exit 0.
A second signal makes the binary exit 130 right after a best-effort journal flush.

| Exit | Meaning |
|---|---|
| 0 | graceful stop |
| 2 | invalid config or arguments, the real-order gate refused, or a requested feed this session cannot serve (`feed_unavailable`, 50 §8.1) |
| 10 | kill switch or session guard stop (D31) |
| 11 | exchange unreachable, or heartbeat failures beyond tolerance (D30) |
| 12 | API-key lock held by another process (D30) |
| 101 | panic escaped (engine bug); alert |

Binary upgrades happen only at market boundaries with no open orders ([50](50-live-runtime.md)).

## 8. Conformance tests

Each item below is a test in [60-verification.md](60-verification.md).

1. `run` vs `serve --threads 1` vs `serve --threads 8` with 16 jobs interleaved: identical deterministic bytes per job.
2. `run-group` candidate section == `run` of the same candidate alone.
3. The same job on every fleet Mac (D55) gives an identical `resultDigest`.
4. A run with junk `BACKTEST_*`, `MAX_EVENTS_PER_DRAIN` and `DRY_RUN` env vars gives identical bytes (G2).
5. `r2://` path → exit 2. Unknown job field → exit 2. Foreign `jobSchemaVersion` or `rulesTableVersion` → exit 2.
6. Parent death: stdin EOF without `drain` → exit within 1 s; `getppid() == 1` → exit within 1 s; `drain` then EOF → in-flight jobs finish, then exit 0.
7. Deadline → `timeout: deadline`. `cancel` → `canceled`. A stuck callback co-scheduled with 7 jobs → backstop kill; after the isolated re-runs only the stuck job fails (`killed: backstop_timeout`). A poison job (test strategy that aborts on a chosen slug) co-scheduled with 7 others: only it fails, as `killed: signal`; the 7 results equal their standalone runs (S5). A group with one stuck candidate reports it in `progress.inCallback`.
8. `describe` idempotence on string and typed params. `describe --params-file` equals N single calls.
9. `schema` `contractSha256` equals the checked-in bundle.
10. `paper` refuses non-loopback binds and unknown commands. A `standard` binary reports `realOrders: false` and refuses `live` (exit 2). `live` refuses without each gate condition.
11. Flag matrix: every "rejected" row of §5.6 and an unknown flag exit 2 at submit time, before any job is enqueued; `--native-profile` on a TS strategy exits 2.
12. A deep-recursion fixture strategy behaves identically under `run` and `serve` (same stack, G11).

## 9. Statements superseded in other documents

None open: every item was applied in the gate-1 consolidation. Should an
older statement elsewhere still disagree with §2, §4, §5.6 or §6, this
document wins (00 §3.1).

## Open questions

None. The real-order capability question of earlier drafts is settled by
§1 (D44).

## Gate-4 questions

Listed with the other gate-4 questions in 01 §12.1.

1. **Agent use of `--feed-secrets-fd`** (01 §12.1 item 2, 50 q1). May the
   agent pass the channel of §7 to its own paper sessions with the API key
   of an empty wallet? Until then only user-launched sessions pass it, and
   agent-run sessions request no Chainlink feed (50 §8.1).
