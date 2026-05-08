import { defineConfig } from 'vitepress'

export default defineConfig({
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
      { text: 'CLI Reference', link: '/cli-reference' },
      { text: 'GitHub', link: 'https://github.com/ivanmijatovic89/polymarket-bot' },
    ],

    sidebar: [
      { text: 'Overview', link: '/' },
      { text: 'Quickstart', link: '/quickstart' },
      {
        text: 'Core Concepts',
        items: [
          { text: 'Architecture', link: '/architecture' },
          { text: 'Strategy System', link: '/strategy-system' },
          { text: 'Plugins + Feeds', link: '/plugins-feeds' },
        ],
      },
      {
        text: 'Runtime',
        items: [
          { text: 'Live Trading', link: '/live-runtime' },
          { text: 'Backtesting', link: '/backtest-runtime' },
          { text: 'Recording + Parquet', link: '/recording-parquet' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'CLI Reference', link: '/cli-reference' },
          { text: 'Environment Variables', link: '/env-reference' },
          { text: 'Database + Stats', link: '/database-stats' },
          { text: 'Web UI', link: '/webui' },
        ],
      },
      {
        text: 'Operations',
        items: [
          { text: 'Ops Runbook', link: '/ops-runbook' },
          { text: 'Source Inventory', link: '/source-inventory' },
        ],
      },
      {
        text: 'Contribution',
        items: [{ text: 'Code Quality Workflow', link: '/contribution/code-quality-workflow' }],
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
})
