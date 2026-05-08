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
        { text: 'Guide', link: '/quickstart' },
        { text: 'Source Inventory', link: '/source-inventory' },
        { text: 'GitHub', link: 'https://github.com/ivanmijatovic89/polymarket-bot' },
      ],

      sidebar: [
        { text: 'Overview', link: '/' },
        { text: 'Quickstart', link: '/quickstart' },

        {
          text: 'Runtime',
          items: [
            { text: 'Record Live Events', link: '/other/architecture' },
            { text: 'Backtest', link: '/other/architecture' },
            { text: 'Live Trading', link: '/other/architecture' },
          ],
        },
        {
          text: 'Contribution',
          items: [{ text: 'Code Quality Workflow', link: '/contribution/code-quality-workflow' }],
        },
        {
          text: 'Other',
          items: [
            { text: 'ARCHITECTURE', link: '/other/architecture' },
            { text: 'ARCHITECTURE_DIAGRAMS', link: '/other/ARCHITECTURE_DIAGRAMS' },
            { text: 'AddNewBot', link: '/other/AddNewBot' },
            { text: 'Commands', link: '/other/Commands' },
            {
              text: 'DepositApproveWithdrawCheckBalance',
              link: '/other/DepositApproveWithdrawCheckBalance',
            },
            {
              text: 'GenerateJobsFromGridStrategyParams',
              link: '/other/GenerateJobsFromGridStrategyParams',
            },
            { text: 'MeasureLatency', link: '/other/MeasureLatency' },
            { text: 'MultipleBots', link: '/other/MultipleBots' },
            { text: 'ParallelBacktestRunner', link: '/other/ParallelBacktestRunner' },
            { text: 'Reference', link: '/other/Reference' },
            { text: 'chunked-batch-stats', link: '/other/chunked-batch-stats' },
            { text: 'rebuild-chunked-batch-stats', link: '/other/rebuild-chunked-batch-stats' },
            { text: 'research-gate-on-backtests', link: '/other/research-gate-on-backtests' },
            { text: 'save-intent-metrics', link: '/other/save-intent-metrics' },
            { text: 'scan-disconnect-events', link: '/other/scan-disconnect-events' },
            { text: 'trade-features-export', link: '/other/trade-features-export' },
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
