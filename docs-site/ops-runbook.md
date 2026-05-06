# Ops Runbook + Troubleshooting

## Pre-Live Checklist

1. `DRY_RUN=true` first.
2. Verify balances + approvals (`npm run check:balances`).
3. Validate strategy params and symbol.
4. Confirm user WS connected and receiving account events.
5. Enable file logging if needed (`LOG_TO_FILE=true`).

## Live Troubleshooting

### No fills or stale account state

- check user WS status logs
- verify `USER_WS_FILL_AT_STATUS`
- verify REST poll fallback status

### Strategy not placing intents

- confirm strategy ID is registered and selected
- inspect parsed params (`--param`)
- verify market/plugin gates (time window, dwell, indicators)

### Orders rejected

- inspect risk limits (`src/trading/riskLimits.ts`)
- inspect API errors from `LiveExecution`
- verify approvals/allowances and relayer mode configuration

### Rotation issues (wrong 15m market)

- inspect slug guard logs
- verify system clock and Gamma responses
- verify symbol env (`TRADING_SYMBOL`/`RECORD_SYMBOL`)

## Backtest Troubleshooting

### Unexpected no-trade runs

- verify input files have `book` and `price_change`
- verify strategy gates and param values
- inspect plugin readiness in backtest mode

### Divergence vs live

- compare env settings affecting simulation (latency, fees)
- verify same strategy ID/params
- verify event ordering mode (`--order`)

## Queue Runner Ops

- approve -> pending -> running -> done/failed flow
- use `queue/logs/parallel.log` for outcome and exit code diagnostics

## Safety Rules

- never switch to real trading with unverified credentials/config
- keep per-bot env split for multi-instance operation
- preserve deterministic code paths when changing shared runtime components
