import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'

export default withMermaid(
  defineConfig({
    title: 'Polymarket Bot',
    description: 'Live trading bot + deterministic backtesting engine for Polymarket',
    base: '/polymarket-bot/',
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

        {
          text: 'Record Live Events',
          items: [{ text: 'Scan Disconnect Events', link: '/other/scan-disconnect-events' }],
        },
        {
          text: 'Backtest',
          items: [
            { text: 'Parallel Backtest Runner', link: '/other/ParallelBacktestRunner' },
            {
              text: 'Generate Jobs From Grid Strategy Params',
              link: '/other/GenerateJobsFromGridStrategyParams',
            },
          ],
        },
        {
          text: 'Live Trading',
          items: [],
        },
        {
          text: 'Research',
          items: [
            { text: 'Save Intent Metrics', link: '/other/save-intent-metrics' },
            { text: 'Chunked Batch Stats', link: '/other/chunked-batch-stats' },
            { text: 'Rebuild Chunked Batch Stats', link: '/other/rebuild-chunked-batch-stats' },
            { text: 'Research Gate On Backtests', link: '/other/research-gate-on-backtests' },
            { text: 'Trade Features Export', link: '/other/trade-features-export' },
          ],
        },
        {
          text: 'Blockchain',
          items: [
            {
              text: 'Deposit Approve Withdraw Check Balance',
              link: '/other/DepositApproveWithdrawCheckBalance',
            },
          ],
        },
        {
          text: 'Plugins',
          items: [
            {
              text: 'Plugin 1 Name',
              link: '/other/Plugin1Name',
            },
            {
              text: 'Plugin 2 Name',
              link: '/other/Plugin2Name',
            },
            {
              text: 'Plugin 3 Name',
              link: '/other/Plugin3Name',
            },
            {
              text: 'Plugin 4 Name',
              link: '/other/Plugin4Name',
            },
            {
              text: 'Plugin 5 Name',
              link: '/other/Plugin5Name',
            },
          ],
        },
        {
          text: 'Contribution',
          items: [{ text: 'Code Quality Workflow', link: '/contribution/code-quality-workflow' }],
        },
        {
          text: 'Reference',
          items: [{ text: 'Reference', link: '/other/Reference' }],
        },
        {
          text: 'Other',
          items: [
            { text: 'Architecture', link: '/other/architecture' },
            { text: 'Architecture Diagrams', link: '/other/ARCHITECTURE_DIAGRAMS' },
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
