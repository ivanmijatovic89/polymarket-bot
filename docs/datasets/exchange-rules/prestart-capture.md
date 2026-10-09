---
title: Capture pre-start exchange rules
description: Run and deploy the script that saves the Gamma and CLOB bodies of every BTC 5m and 15m market shortly before it starts.
---

# Capture pre-start exchange rules

This guide shows how to run the pre-start rules capture and deploy it as a service on worker-1. The script saves the public Gamma and CLOB bodies of every upcoming BTC 5m and 15m market. These bodies carry the market's rules, such as the fee and taker-delay flags. Nobody can fetch the pre-start version after the market starts, so the script must keep running.

The script is standalone. It uses public endpoints only. It reads no `.env`, holds no credentials and never writes a database. Each completed request goes to a local JSONL file. It imports only Node built-ins and `src/exchange-rules/`, so it cannot change backtest or live behaviour.

## What it fetches

For each market, it makes two requests:

| Origin  | Request                                                       |
| ------- | ------------------------------------------------------------- |
| `gamma` | `GET https://gamma-api.polymarket.com/markets/slug/{slug}`    |
| `clob`  | `GET https://clob.polymarket.com/clob-markets/{conditionId}` |

The `conditionId` comes from the Gamma body, so CLOB is fetched only after a Gamma 200. Slugs come from the epoch grid, `btc-updown-5m-{startSec}` and `btc-updown-15m-{startSec}`.

The script runs one tick per minute, at second 5. Each tick looks at markets that start between 15 seconds and 10 minutes from now:

- **`first` slot**: fetched at every tick until a 200 arrives, normally 595 s before the start.
- **`final` slot**: fetched once, at the tick between 90 s and 15 s before the start (normally 55 s before).

A request gets up to 3 attempts per tick, with a random 1–3 s pause between them. After a 429 or 5xx, the next attempt waits for `Retry-After` if that is 20 s or less. A longer or missing `Retry-After`, or a Gamma 404, moves the request to the next tick.

## Run it once

Use `--once` to run a single tick now and check that both endpoints respond:

```bash
npm run rules:capture-prestart -- --once --out-dir /tmp/pmb-rules-capture-proof
```

It prints one line per market in the window and a verdict. The exit code is `0` when every market in the window got a 200 from both origins in that tick. Otherwise it is `1`.

```text
btc-updown-5m-1791523500  starts in 120 s  gamma 200 (first)  clob 200 (first)
btc-updown-5m-1791523800  starts in 420 s  gamma 200 (first)  clob 200 (first)
btc-updown-15m-1791523800  starts in 420 s  gamma 200 (first)  clob 200 (first)
OK: all 3 markets starting in the next 10 minutes have a 200 from gamma and clob
```

::: tip
CLOB sometimes answers `500` with no `Retry-After` header. A single `--once` tick then shows `NO 200` for that market. In `--watch` mode, the same request is retried at the next tick. The market is only missed if every tick in its 10-minute window fails.
:::

## Check coverage

`--report` reads the files only. It does not make any network request:

```bash
npm run rules:capture-prestart -- --report --days 7 --out-dir /Users/worker-1/pmb-rules-capture/prestart
```

For each UTC day and timeframe, it prints:

- the number of grid markets that have already started;
- how many have a `pre_start` 200 from `gamma`, from `clob` and from both;
- the coverage based on both origins;
- the missed slugs, where consecutive misses are grouped;
- per file: the record count by HTTP status, plus `torn_tail` and `malformed` counts.

A `pre_start` 200 is a 200 with a stored body received before the market start. The report skips a torn last line, such as a line that is still being written. The aim is at least 99% coverage per day and timeframe from both origins.

`<out-dir>/status.json` shows the same information for the last 24 hours. The script replaces it atomically after every tick. Check its `lastTickAtMs`: if it is more than 10 minutes old, the service has stopped.

## Output format

The script writes one JSON object per line to `<out-dir>/<yyyy-mm-dd>.jsonl`. The file is named after the UTC date of `fetchedAtMs`. Every completed attempt gets a line, including errors:

| Field                          | Meaning                                                                                                     |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `v`                            | `1`                                                                                                         |
| `origin`, `slot`               | `gamma` \| `clob`; `first` \| `final`                                                                       |
| `slug`, `timeframe`, `marketStartMs` | From the grid                                                                                         |
| `conditionId`                  | `clob`: the requested id; `gamma`: the body's `conditionId` on a 200, else `null`                           |
| `url`                          | Request URL                                                                                                 |
| `requestedAtMs`, `fetchedAtMs` | Host wall clock when the request was sent, and when the last body byte or the error arrived                 |
| `httpStatus`                   | `0` for a transport error or timeout (5 s)                                                                  |
| `error`                        | Transport error text, `invalid_utf8` or `body_too_large`, else `null`                                       |
| `rawSha256`                    | sha256 of the received bytes                                                                                |
| `rawBody`                      | The body, decoded as UTF-8 with any BOM kept, so re-encoding returns the same bytes. `null` above 1 MiB or on a decode error |
| `host`, `captureCommit`        | `os.hostname()` and `git rev-parse HEAD` of the checkout at start (`unknown` if git fails)                  |

Expect about 5 MB per day. If a crash leaves a torn last line, the next append moves it to `<file>.torn`, and the `.jsonl` file stays valid.

## Deploy on worker-1

The service runs from a pinned checkout. This keeps it separate from the fleet copy (`/Users/worker-1/Sites/polymarket-bot`), which fleet commands update and restart. It also stays apart from any development checkout. The service keeps running during benchmarks and fleet pauses, because a missed market cannot be recovered.

| Purpose          | Location                                      |
| ---------------- | --------------------------------------------- |
| Pinned checkout  | `/Users/worker-1/pmb-rules-capture/app`       |
| Output           | `/Users/worker-1/pmb-rules-capture/prestart`  |
| Logs             | `/Users/worker-1/pmb-rules-capture/logs`      |
| LaunchAgent      | `com.pmb.rules-capture` (user agent)          |
| Plist template   | `ops/macos/rules-capture/com.pmb.rules-capture.plist.template` |

1. Pin a checkout of the merged main commit and install its dependencies:

   ```bash
   mkdir -p /Users/worker-1/pmb-rules-capture/{prestart,logs}
   git clone https://github.com/ivanmijatovic89/polymarket-bot.git /Users/worker-1/pmb-rules-capture/app
   cd /Users/worker-1/pmb-rules-capture/app
   git checkout --detach <merged-main-sha>
   npm ci
   ```

   Never point the service at the fleet copy itself.

2. Find the absolute path of a Node 20 binary:

   ```bash
   NODE20="$(ls -d /Users/worker-1/.nvm/versions/node/v20.*/bin/node | tail -1)"
   "$NODE20" --version   # must print v20.x
   ```

3. Render the plist template into `~/Library/LaunchAgents`:

   ```bash
   APP=/Users/worker-1/pmb-rules-capture/app
   sed -e "s|__NODE20__|$NODE20|g" \
       -e "s|__APP__|$APP|g" \
       -e "s|__OUT_DIR__|/Users/worker-1/pmb-rules-capture/prestart|g" \
       -e "s|__LOG_DIR__|/Users/worker-1/pmb-rules-capture/logs|g" \
       "$APP/ops/macos/rules-capture/com.pmb.rules-capture.plist.template" \
       > ~/Library/LaunchAgents/com.pmb.rules-capture.plist
   plutil -lint ~/Library/LaunchAgents/com.pmb.rules-capture.plist
   ```

   The agent runs `--watch --market btc:5m,btc:15m --out-dir /Users/worker-1/pmb-rules-capture/prestart` with `RunAtLoad` and `KeepAlive`. It runs through the repo's bounded-log wrapper (`scripts/recorder-service.mjs`), which writes `logs/rules-capture.log` and keeps three rotated 8 MiB archives.

4. Load and start the agent:

   ```bash
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.pmb.rules-capture.plist
   launchctl print gui/$(id -u)/com.pmb.rules-capture | grep -E 'state|pid'
   ```

5. After two minutes, confirm that it is writing:

   ```bash
   tail -n 5 /Users/worker-1/pmb-rules-capture/logs/rules-capture.log
   cat /Users/worker-1/pmb-rules-capture/prestart/status.json | head -20
   ```

6. After 24 hours, run the report and check that coverage is at least 99% per timeframe:

   ```bash
   cd /Users/worker-1/pmb-rules-capture/app
   npm run rules:capture-prestart -- --report --days 1 --out-dir /Users/worker-1/pmb-rules-capture/prestart
   ```

### Restart or re-pin

Only re-pin the checkout on purpose. To restart without changes, run:

```bash
launchctl kickstart -k gui/$(id -u)/com.pmb.rules-capture
```

To move to a new commit, run `git checkout --detach <sha> && npm ci` in the pinned checkout, then restart with the command above. Restarts are safe: the script keeps its schedule state in memory only, so it repeats a few fetches, and the later import removes the duplicates.

::: warning
Use a single writer per output directory. Do not point a manual `--once` or `--watch` at `/Users/worker-1/pmb-rules-capture/prestart` while the agent is running. Use a temporary directory instead.
:::

## Related

- [Recorder v4 on worker-2](/datasets/recording/recorder-v4-worker-2): another isolated, pinned service with the same bounded-log wrapper.
- [Machine Roles & Sync](/datasets/sync)
