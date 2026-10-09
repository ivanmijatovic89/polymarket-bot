import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import {
  DEFAULT_DATA_ROOT,
  ORACLE_ENV_KEYS,
  REPO_ROOT,
  buildOracleEnv,
  canonicalJson,
  cellStartingCapital,
  loadCell,
  modelConfigSha256,
  readMarketSet,
} from './cell.js'
import { PARITY_DIR } from './oracle.js'

const CELLS = path.join(PARITY_DIR, 'cells')

function tmpCell(name: string, mutate: (c: Record<string, unknown>) => void): string {
  const c = JSON.parse(readFileSync(path.join(CELLS, 'T15-on.json'), 'utf8')) as Record<
    string,
    unknown
  >
  c.cell = name
  mutate(c)
  const dir = mkdtempSync(path.join(tmpdir(), 'parity-cell-'))
  const f = path.join(dir, `${name}.json`)
  writeFileSync(f, JSON.stringify(c))
  return f
}

describe('parity cells (60 §4.1, HR-1)', () => {
  it('the committed T15 cells load and name both strategy identities', () => {
    // spec: 60 §4.1 T15 rows; HR-1
    for (const [name, tickOnUpdate] of [
      ['T15-on', true],
      ['T15-off', false],
    ] as const) {
      const c = loadCell(path.join(CELLS, `${name}.json`))
      assert.equal(c.set, 'S15-CL')
      assert.equal(c.traceLevel, 'feeds')
      assert.deepEqual(c.tsStrategy, { id: 'feed-exerciser' })
      assert.equal(c.rustStrategyId, 'feed-exerciser.rs')
      assert.deepEqual(c.params.values, { tickOnUpdate, trade: false, ta: false, chainlink: true })
      assert.equal(c.modelConfig.execution.compatLatency.delayMs, 0)
      assert.equal(cellStartingCapital(c), 500)
    }
  })

  it('the T15 cells use the committed ts-compat default ModelConfig (60 §4.1, 21 §6.3)', () => {
    const defaults = JSON.parse(
      readFileSync(
        path.join(REPO_ROOT, 'native', 'contract', 'model-configs', 'ts-compat-default.json'),
        'utf8',
      ),
    ) as unknown
    for (const name of ['T15-on', 'T15-off'])
      assert.deepEqual(
        loadCell(path.join(CELLS, `${name}.json`)).modelConfig,
        defaults,
        `${name}: re-derive the cell ModelConfig from the ts-compat default`,
      )
  })

  it('unknown fields, a non-zero jitter and a wrong file name are errors (R14, OR-6)', () => {
    assert.throws(() => loadCell(tmpCell('X1', (c) => (c.extra = 1))), /invalid cell/)
    assert.throws(
      () =>
        loadCell(
          tmpCell('X2', (c) => {
            ;(
              c.modelConfig as { execution: { compatLatency: { jitterMs: number } } }
            ).execution.compatLatency.jitterMs = 20
          }),
        ),
      /invalid cell/,
    )
    assert.throws(() => loadCell(tmpCell('X3', (c) => (c.cell = 'other'))), /expected X3/)
  })

  it('the oracle env is an allowlist plus explicit knobs from the ModelConfig, never BOT_ENV (OR-7)', () => {
    // spec: 60 OR-7, HR-3; 02 D63 (1) latency knobs equal the job, (3) data-root variables
    const c = loadCell(path.join(CELLS, 'T15-on.json'))
    const env = buildOracleEnv(c, '/data', {
      PATH: '/bin',
      HOME: '/h',
      BOT_ENV: 'x',
      STARTING_CAPITAL: '9',
      DATABASE_PASSWORD: 's',
      BACKTEST_LATENCY_DELAY: '999',
      BACKTEST_LATENCY_JITTER: '50',
      RECORDER_REPLAY_CACHE_DIR: '/elsewhere',
      BACKTEST_TECH_IND_TIMEOUT_MS: '1',
    })
    assert.deepEqual(env, {
      PATH: '/bin',
      HOME: '/h',
      TZ: 'UTC',
      BINANCE_DATA_BASE_DIR: '/data/binance',
      TELONEX_CRYPTO_PRICES_BASE_DIR: '/data/telonex/crypto_prices',
      RECORDER_REPLAY_CACHE_DIR: '/data/recorder-v4-cache',
      BACKTEST_LATENCY_DELAY: String(c.modelConfig.execution.compatLatency.delayMs),
      BACKTEST_LATENCY_JITTER: '0',
      BACKTEST_BINANCE_FEED_LATENCY_MS: '110',
      BACKTEST_BINANCE_FEED_LOOKBACK_MS: '300000',
      BACKTEST_RTDS_CHAINLINK_LATENCY_MS: '320',
      BACKTEST_RTDS_CHAINLINK_LOOKBACK_MS: '300000',
      BACKTEST_RTDS_CHAINLINK_MAX_GAP_MS: '300000',
      BACKTEST_PRICE_TO_BEAT_LATENCY_MS: '2700',
      MAX_EVENTS_PER_DRAIN: '4200',
      WEB_UI_ORDERBOOK_LEVELS: '10',
      BACKTEST_WAIT_FOR_TECHNICAL_INDICATORS: '0',
      BACKTEST_TECH_IND_TIMEOUT_MS: '3000',
      BACKTEST_TECH_IND_POLL_MS: '10',
    })
    for (const k of Object.keys(env)) assert.ok(ORACLE_ENV_KEYS.includes(k), k)
    // A delay-D cell's delay reaches the env (D63 (1)).
    const d = loadCell(
      tmpCell('X4', (x) => {
        const mc = x.modelConfig as { execution: { compatLatency: { delayMs: number } } }
        mc.execution.compatLatency.delayMs = 140
      }),
    )
    assert.equal(buildOracleEnv(d, '/data', {}).BACKTEST_LATENCY_DELAY, '140')
  })

  it('canonical JSON sorts keys bytewise with no whitespace; the ModelConfig hash is stable (21 §6.1)', () => {
    assert.equal(
      canonicalJson({ b: 1, a: [true, null, 'x'], A: { d: '1', c: 2 } }),
      '{"A":{"c":2,"d":"1"},"a":[true,null,"x"],"b":1}',
    )
    assert.throws(() => canonicalJson({ x: 0.5 }), /safe integers/)
    const c = loadCell(path.join(CELLS, 'T15-on.json'))
    const d = loadCell(path.join(CELLS, 'T15-off.json'))
    assert.equal(modelConfigSha256(c.modelConfig), modelConfigSha256(d.modelConfig))
    assert.match(modelConfigSha256(c.modelConfig), /^[0-9a-f]{64}$/)
  })

  it('the data root defaults to <repository root>/data (01 §6 M1)', () => {
    assert.equal(DEFAULT_DATA_ROOT, path.join(REPO_ROOT, 'data'))
  })
})

describe('market sets (60 §4.2)', () => {
  it('S15-CL is committed with a header and at least 200 BTC 15m markets from 2026-04-02 (MS-0, MS-1, MS-2)', () => {
    const file = path.join(PARITY_DIR, 'sets', 'S15-CL.txt')
    const slugs = readMarketSet(file)
    assert.ok(slugs.length >= 200, String(slugs.length))
    for (const s of slugs) {
      assert.match(s, /^btc-updown-15m-[0-9]{10}$/)
      assert.ok(Number(s.slice(-10)) * 1000 >= Date.parse('2026-04-02T00:00:00Z'), s)
    }
    const text = readFileSync(file, 'utf8')
    for (const h of [
      'Selection command:',
      'Seed:',
      'Eligibility (MS-2)',
      'Oracle pin:',
      'Date:',
      'MS-5 replaced',
    ])
      assert.ok(text.includes(h), h)
  })

  it('invalid and duplicate slugs are errors', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'parity-set-'))
    const f = path.join(dir, 's.txt')
    writeFileSync(f, '# h\nbtc-updown-15m-1775417400\nbtc-updown-15m-1775417400\n')
    assert.throws(() => readMarketSet(f), /duplicate/)
    writeFileSync(f, 'eth-updown-15m-1775417400\n')
    assert.throws(() => readMarketSet(f), /invalid slug/)
  })
})
