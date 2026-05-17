import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'

export default withMermaid(
  defineConfig({
    title: 'Polymarket Bot',
    description: 'Live trading bot + deterministic backtesting engine for Polymarket',
    base: '/polymarket-bot/',
    cleanUrls: true,
    head: [
      ['link', { rel: 'icon', href: '/polymarket-bot/img/logos/polymarket-twin-engine-mark.png', type: 'image/png' }],
    ],
    vite: {
      // Shared static assets for docs + webui
      publicDir: '../public',
    },

    themeConfig: {
      logo: {
        light: '/img/logos/polymarket-twin-engine-mark.png',
        dark: '/img/logos/polymarket-twin-engine-mark-dark.png',
        alt: 'Polymarket Twin Engine',
      },
      nav: [
        { text: 'Documentation', link: '/quickstart' },
        { text: 'GitHub', link: 'https://github.com/ivanmijatovic89/polymarket-bot' },
      ],

      sidebar: [
        { text: 'Overview', link: '/' },
        { text: 'Quickstart', link: '/quickstart-new' },
        { text: 'How It Works', link: '/how-it-works' },
        { text: 'Key Concepts', link: '/key-concepts' },

        {
          text: 'Datasets',
          items: [
            { text: 'Overview', link: '/datasets/index' },
            {
              text: 'Live Recording',
              collapsed: true,
              items: [
                { text: 'Overview', link: '/datasets/recording/overview' },
                { text: 'Recording Live Events', link: '/datasets/recording/recording-live-events' },
                { text: 'Scan Disconnect Events', link: '/datasets/recording/scan-disconnect-events' },
              ],
            },
            {
              text: 'Telonex',
              collapsed: true,
              items: [
                { text: 'Overview', link: '/datasets/telonex/overview' },
                { text: 'Sync Markets', link: '/datasets/telonex/sync-markets' },
                { text: 'Download Raw Files', link: '/datasets/telonex/download-raw-files' },
                { text: 'Convert', link: '/datasets/telonex/convert' },
                { text: 'Verify Conversions', link: '/datasets/telonex/verify' },
                { text: 'How Verify Works', link: '/datasets/telonex/how-verify-works' },
                { text: 'Run a Backtest', link: '/datasets/telonex/backtest' },
                { text: 'Diagnostics', link: '/datasets/telonex/diagnostics' },
              ],
            },
            {
              text: 'PMXT',
              collapsed: true,
              items: [
                { text: 'Overview', link: '/datasets/pmxt/overview' },
                { text: 'Sync Catalogue', link: '/datasets/pmxt/sync-catalog' },
                { text: 'Download & Convert v1', link: '/datasets/pmxt/download-and-convert-v1' },
                { text: 'Build Master v2', link: '/datasets/pmxt/build-master-v2' },
              ],
            },
            {
              text: 'Tools',
              collapsed: true,
              items: [
                { text: 'Verify Parquet File', link: '/datasets/tools/verify-parquet' },
                { text: 'List Backtest Files', link: '/datasets/recording/list-backtest-files' },
                { text: 'Seed Database from Parquet', link: '/datasets/recording/insert-parquet-to-db' },
              ],
            },
          ],
        },

        {
          text: 'Backtest',
          items: [
            { text: 'Running Backtests', link: '/other/running-backtests' },
            { text: 'Generate Backtest Jobs', link: '/other/generate-backtest-jobs' },
            { text: 'Parallel Backtest Runner', link: '/other/ParallelBacktestRunner' },
            { text: 'Market Statistics', link: '/other/market-stats' },
            { text: 'Batch Statistics', link: '/other/batch-stats' },
            { text: 'Chunked Batch Statistics', link: '/other/chunked-batch-stats-new' },
            { text: 'Walk-Forward Ranking', link: '/other/walk-forward-ranking' },
          ],
        },

        {
          text: 'Live Trading',
          items: [
            { text: 'Running the Live Trading Bot', link: '/other/live-trading-bot' },
            { text: 'Resolve UP/DOWN 15m Assets', link: '/other/resolve-updown-15m-assets' },
          ],
        },

        {
          text: 'Research',
          items: [
            { text: 'PnL Report', link: '/other/pnl-report' },
            { text: 'Redeem Watcher', link: '/other/redeem-watcher' },
            { text: 'Export Trade Features', link: '/other/export-trade-features' },
            { text: 'Research Gate Analysis', link: '/other/research-gate-new' },
            { text: 'Save Intent Metrics', link: '/other/save-intent-metrics' },
            { text: 'Rebuild Chunked Batch Stats', link: '/other/rebuild-chunked-batch-stats' },
          ],
        },

        {
          text: 'Blockchain',
          items: [
            { text: 'EOA vs Relayer Mode', link: '/other/eoa-vs-relayer' },
            { text: 'Check Balances & Approvals', link: '/other/check-balances' },
            { text: 'Create CLOB API Key', link: '/other/create-clob-api-key' },
            { text: 'SAFE Relayer CLI', link: '/other/relayer-cli' },
            { text: 'Conditional Tokens', link: '/other/conditional-tokens' },
            { text: 'Relayer Client', link: '/other/relayer-client' },
          ],
        },

        {
          text: 'Strategy',
          items: [
            { text: 'Write Your First Strategy', link: '/strategy/tutorial-first-strategy' },
            {
              text: 'Strategy Reference',
              collapsed: true,
              items: [
                { text: 'Strategy Interface', link: '/strategy/strategy-interface' },
                { text: 'Strategy Context', link: '/strategy/strategy-context' },
                { text: 'Strategy Definition', link: '/strategy/strategy-definition' },
                { text: 'Strategy Toolkit', link: '/strategy/strategy-toolkit' },
              ],
            },
            { text: 'Template Strategy', link: '/strategy/template-strategy' },
            { text: 'Template: Time Window Gate', link: '/strategy/template-time-window-gate' },
            { text: 'Template: Dwell Gate', link: '/strategy/template-dwell-gate' },
            { text: 'Split-Sell-Redeem Strategy', link: '/strategy/split-sell-redeem' },
            {
              text: 'Plugins',
              items: [
                { text: 'Technical Indicators', link: '/plugins/plugin-technical-indicators' },
                { text: 'Deribit Volatility Index', link: '/plugins/plugin-deribit-volatility' },
                { text: 'Time Window Volatility', link: '/plugins/plugin-time-window-volatility' },
                { text: 'Dwell Gate', link: '/plugins/plugin-dwell-gate' },
                { text: 'Time Window Gate', link: '/plugins/plugin-time-window-gate' },
                { text: 'External Feeds', link: '/plugins/plugin-external-feeds' },
              ],
            },
          ],
        },

        {
          text: 'Engine',
          items: [
            { text: 'Market Engine', link: '/engine/market-engine' },
            { text: 'Orderbook Engine', link: '/engine/orderbook-engine' },
            { text: 'Strategy Runner', link: '/engine/strategy-runner' },
            { text: 'Order Manager', link: '/engine/order-manager' },
            { text: 'Portfolio', link: '/engine/portfolio' },
            { text: 'Backtest Execution', link: '/engine/backtest-execution' },
            { text: 'Live Execution', link: '/engine/live-execution' },
            { text: 'Parquet Event Writer', link: '/engine/parquet-event-writer' },
            { text: 'Parquet Event Schema', link: '/engine/parquet-event-schema' },
          ],
        },

        {
          text: 'Contribution',
          items: [
            { text: 'Code Quality Workflow', link: '/contribution/code-quality-workflow' },
            { text: 'Build the Docs Site', link: '/other/build-docs-site' },
          ],
        },

        {
          text: 'Reference',
          items: [
            { text: 'Environment Variables', link: '/other/environment-variables' },
            { text: 'Database Schema', link: '/other/database-schema' },
            { text: 'Risk Limits', link: '/other/risk-limits' },
            { text: 'Fee Computation', link: '/other/fee-computation' },
            { text: 'Orderbook Metrics', link: '/other/orderbook-metrics' },
            { text: 'Gamma API Client', link: '/other/gamma-api-client' },
            { text: 'CLOB Client', link: '/other/clob-client' },
          ],
        },

        {
          text: 'Other',
          items: [
            { text: 'Architecture', link: '/other/architecture' },
            { text: 'Architecture Diagrams', link: '/other/ARCHITECTURE_DIAGRAMS' },
            { text: 'ADR: Telonex Verification', link: '/adr/telonex-verification-replay-parity' },
            { text: 'Commands', link: '/other/Commands' },
            { text: 'Add New Bot', link: '/other/AddNewBot' },
            { text: 'Multiple Bots', link: '/other/MultipleBots' },
            { text: 'Measure Latency', link: '/other/MeasureLatency' },
          ],
        },
      ],

      socialLinks: [{ icon: 'github', link: 'https://github.com/ivanmijatovic89/polymarket-bot' }],

      search: {
        provider: 'local',
      },

      footer: {
        message: 'Released under the MIT License.',
      },
    },
  }),
)
