# TELONEX SYNCER

## 1. SYNC CATALOGUE: Teloenx catalogue to database

```bash
npm run telonex:sync -- --slug-pattern 'btc-updown-15m-%,eth-updown-15m-%,sol-updown-15m-%,xrp-updown-15m-%,btc-updown-5m-%,eth-updown-5m-%,sol-updown-5m-%,xrp-updown-5m-%'
```

## 2. DOWNALOD and UPLOAD to R2: raw files for a specific symbol and timeframe

```bash
npm run telonex:download -- --slug-pattern btc-updown-5m-% --limit 5
## One command, 10 worker processes
npm run telonex:download:fanout -- 10 --slug-pattern 'btc-updown-15m-%' --limit 10
```

## 3. CONVERT: raw files to delta-typed

```bash
npm run telonex:convert:fanout -- 4 --converter delta-typed --slug-pattern 'btc-updown-15m-%' --output both
```

# WORKERS

## 1. DOWNLOAD CONVERTED FILES TO LOCAL DISK: (delta-typed) ( for workers )

```bash
npm run telonex:download-converted-r2-to-local -- --converter delta-typed --symbol btc --timeframe 15m --dry-run
## One command, 12 worker processes
npm run telonex:download-converted-r2-to-local -- --converter delta-typed --symbol btc --timeframe 15m --concurrency 12 --limit 100
```

## 2. RUN WORKER with AUTO-UPDATE

```bash
./scripts/run-worker.sh --queues markets --market-concurrency 5
```
