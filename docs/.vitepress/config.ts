import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'

export default withMermaid(
  defineConfig({
    title: 'Polymarket Bot',
    description: 'Live trading bot + deterministic backtesting engine for Polymarket',
    base: '/polymarket-bot/',
    cleanUrls: true,
    // Anthropic doc pages copied verbatim keep their original /docs/en/... links
    ignoreDeadLinks: [/^\/docs\/en\//],
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
        { text: 'Quickstart', link: '/quickstart' },
        { text: 'How It Works', link: '/how-it-works' },
        { text: 'Key Concepts', link: '/key-concepts' },

        {
          text: 'Polymarket',
          items: [{ text: 'Practical Guide', link: '/polymarket/' }],
        },

        {
          text: 'Datasets',
          items: [
            { text: 'Overview', link: '/datasets/index' },
            { text: 'Machine Roles & Sync', link: '/datasets/sync' },
            { text: 'Data Coverage (epochs)', link: '/datasets/data-coverage' },
            {
              text: 'Live Recording',
              collapsed: true,
              items: [
                { text: 'Overview', link: '/datasets/recording/overview' },
                { text: 'Recording Live Events', link: '/datasets/recording/recording-live-events' },
                { text: 'Parquet Event Writer', link: '/engine/parquet-event-writer' },
                { text: 'Parquet Event Schema', link: '/engine/parquet-event-schema' },
                { text: 'List Backtest Files', link: '/datasets/recording/list-backtest-files' },
                { text: 'Seed Database from Parquet', link: '/datasets/recording/insert-parquet-to-db' },
                { text: 'Scan Disconnect Events', link: '/datasets/recording/scan-disconnect-events' },
              ],
            },
            {
              text: 'Telonex',
              collapsed: true,
              items: [
                { text: 'Overview', link: '/datasets/telonex/overview' },
                { text: 'Sync Design', link: '/datasets/telonex/sync-design' },
                { text: 'Sync Markets', link: '/datasets/telonex/sync-markets' },
                {
                  text: 'ADR: Publication-Lag Guard',
                  link: '/datasets/telonex/adr-publication-lag-guard',
                },
                { text: 'Download Raw Files', link: '/datasets/telonex/download-raw-files' },
                { text: 'Convert', link: '/datasets/telonex/convert' },
                {
                  text: 'Download Converted Files',
                  link: '/datasets/telonex/download-converted-r2-to-local',
                },
                { text: 'ADR: Verification & Replay Parity', link: '/adr/telonex-verification-replay-parity' },
                { text: 'How Verify Works', link: '/datasets/telonex/how-verify-works' },
                { text: 'Verify Conversions', link: '/datasets/telonex/verify' },
                { text: 'Run a Backtest', link: '/datasets/telonex/backtest' },
                { text: 'Diagnostics', link: '/datasets/telonex/diagnostics' },
              ],
            },
            {
              text: 'Price Feeds',
              collapsed: true,
              items: [
                { text: 'Overview & Source Decision', link: '/datasets/price-feeds/overview' },
                {
                  text: 'Binance aggTrades',
                  collapsed: true,
                  items: [
                    { text: 'Feed', link: '/datasets/price-feeds/binance/feed' },
                    { text: 'Operations', link: '/datasets/price-feeds/binance/operations' },
                    {
                      text: 'Proposal: Series Cache',
                      link: '/datasets/price-feeds/binance/series-cache-proposal',
                    },
                  ],
                },
                {
                  text: 'Chainlink crypto_prices (via Telonex)',
                  collapsed: true,
                  items: [
                    { text: 'Feed', link: '/datasets/price-feeds/chainlink/feed' },
                    { text: 'Operations', link: '/datasets/price-feeds/chainlink/operations' },
                  ],
                },
                { text: 'Price to Beat (Gamma)', link: '/datasets/price-feeds/price-to-beat' },
                { text: 'Parity Harness (Calibration)', link: '/datasets/price-feeds/parity-harness' },
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
              ],
            },
          ],
        },

        {
          text: 'Backtest',
          items: [
            { text: 'Running Backtests', link: '/backtest/running-backtests' },
            { text: 'Extending a Run', link: '/backtest/extending-a-run' },
            { text: 'Parallelization (BullMQ)', link: '/backtest/parallelization' },
            { text: 'Generate Backtest Jobs', link: '/backtest/generate-backtest-jobs' },
            { text: 'ADR: Binance-Driven Ticks', link: '/backtest/adr-binance-driven-ticks' },
            {
              text: 'Fleet',
              collapsed: false,
              items: [
                { text: 'Overview', link: '/backtest/fleet/overview' },
                {
                  text: 'Provision a Worker',
                  collapsed: false,
                  items: [
                    { text: 'Install a Worker', link: '/backtest/fleet/install' },
                    { text: 'Self-Update', link: '/backtest/fleet/self-update' },
                  ],
                },
                {
                  text: 'Fleet Operations',
                  collapsed: false,
                  items: [
                    { text: 'Fleet Status', link: '/backtest/fleet/status' },
                    { text: 'Pull Code', link: '/backtest/fleet/pull' },
                    { text: 'Update Fleet', link: '/backtest/fleet/update' },
                    { text: 'Sync Fleet Data', link: '/backtest/fleet/data-sync' },
                    { text: 'Start the Fleet', link: '/backtest/fleet/start' },
                    { text: 'Stop the Fleet', link: '/backtest/fleet/stop' },
                  ],
                },
                { text: 'Planning & Costs', link: '/backtest/fleet/cloud-and-costs' },
              ],
            },
            {
              text: 'Statistics',
              collapsed: false,
              items: [
                { text: 'Result Storage', link: '/backtest/statistics/result-storage' },
                { text: 'Run Statistics', link: '/backtest/statistics/run-statistics' },
                { text: 'Run Markets', link: '/backtest/statistics/run-markets' },
                {
                  text: 'Backtest Segments',
                  link: '/backtest/statistics/backtest-segments',
                },
              ],
            },
          ],
        },

        {
          text: 'Live Trading',
          items: [
            { text: 'Running the Live Trading Bot', link: '/live-trading/live-trading-bot' },
            { text: 'Add a New Bot', link: '/live-trading/add-new-bot' },
            { text: 'Multiple Bots', link: '/live-trading/multiple-bots' },
            { text: 'Redeem Watcher', link: '/live-trading/redeem-watcher' },
            { text: 'Resolve UP/DOWN 15m Assets', link: '/live-trading/resolve-updown-15m-assets' },
          ],
        },

        {
          text: 'Research',
          items: [
            { text: 'PnL Report', link: '/research/pnl-report' },
            { text: 'Export Trade Features', link: '/research/export-trade-features' },
            { text: 'Research Gate Analysis', link: '/research/research-gate' },
            { text: 'Save Intent Metrics', link: '/research/save-intent-metrics' },
            { text: 'Rebuild Backtest Segments', link: '/research/rebuild-backtest-segments' },
          ],
        },

        {
          text: 'Blockchain',
          items: [
            { text: 'EOA vs Relayer Mode', link: '/blockchain/eoa-vs-relayer' },
            { text: 'Check Balances & Approvals', link: '/blockchain/check-balances' },
            { text: 'Create CLOB API Key', link: '/blockchain/create-clob-api-key' },
            { text: 'SAFE Relayer CLI', link: '/blockchain/relayer-cli' },
            { text: 'Conditional Tokens', link: '/blockchain/conditional-tokens' },
            { text: 'Relayer Client', link: '/blockchain/relayer-client' },
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
          text: 'Strategy Research',
          items: [
            { text: 'Overview', link: '/strategy-research/index' },
            { text: 'Champion / Challenger Versioning', link: '/strategy-research/champion-challenger-versioning' },
            { text: 'Protocol Token Count', link: '/strategy-research/protocol-token-count' },
          ],
        },

        {
          text: 'Scripts',
          items: [
            { text: 'Gabagool Knowledge Shift', link: '/scripts/gabagool-knowledge-shift' },
            { text: 'Gabagool Lab', link: '/scripts/gabagool-lab-shift' },
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
          ],
        },

        {
          text: 'Contribution',
          items: [
            { text: 'Code Quality Workflow', link: '/contribution/code-quality-workflow' },
            { text: 'Build the Docs Site', link: '/contribution/build-docs-site' },
            { text: 'Tmuxinator Workspace', link: '/contribution/tmuxinator-workspace' },
            { text: 'Menu Bar Status', link: '/contribution/menu-bar-status' },
            {
              text: 'Ideas & Research',
              collapsed: false,
              items: [
                { text: 'Backtest Speed Test: Top-of-Book-Only Mode', link: '/contribution/ideas-and-research/backtest-speed-test-top-of-book' },
              ],
            },
          ],
        },

        {
          text: 'Reference',
          items: [
            { text: 'Environment Variables', link: '/reference/environment-variables' },
            { text: 'Database Schema', link: '/reference/database-schema' },
            { text: 'Risk Limits', link: '/reference/risk-limits' },
            { text: 'Fee Computation', link: '/reference/fee-computation' },
            { text: 'Orderbook Metrics', link: '/reference/orderbook-metrics' },
            { text: 'Gamma API Client', link: '/reference/gamma-api-client' },
            { text: 'CLOB Client', link: '/reference/clob-client' },
            { text: 'Prompting Claude Fable 5', link: '/reference/prompting-claude-fable-5' },
            { text: 'Prompting Claude Opus 4.8', link: '/reference/prompting-claude-opus-4-8' },
          ],
        },

        {
          text: 'Other',
          items: [
            { text: 'Architecture', link: '/other/architecture' },
            { text: 'Architecture Diagrams', link: '/other/ARCHITECTURE_DIAGRAMS' },
            { text: 'Measure Latency', link: '/other/MeasureLatency' },
            { text: 'LLM Usage', link: '/other/llm-usage' },
            { text: 'Claude Code Log Viewers', link: '/other/claude-code-log-viewers' },
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
