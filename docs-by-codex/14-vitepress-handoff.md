# VitePress Handoff Guide

This project documentation can be directly migrated to a VitePress site.

## Suggested VitePress Structure

```txt
docs/
  index.md
  quickstart.md
  architecture.md
  live-runtime.md
  backtest-runtime.md
  recording-parquet.md
  strategy-system.md
  plugins-feeds.md
  cli-reference.md
  env-reference.md
  database-stats.md
  webui.md
  ops-runbook.md
  source-inventory.md
```

## Mapping from `docs-by-codex`

- `README.md` -> `index.md`
- `01-quickstart.md` -> `quickstart.md`
- `02-architecture.md` -> `architecture.md`
- `03-runtime-live.md` -> `live-runtime.md`
- `04-runtime-backtest.md` -> `backtest-runtime.md`
- `05-data-recording-parquet.md` -> `recording-parquet.md`
- `06-strategy-system.md` -> `strategy-system.md`
- `07-plugins-and-feeds.md` -> `plugins-feeds.md`
- `08-cli-reference.md` -> `cli-reference.md`
- `09-env-reference.md` -> `env-reference.md`
- `10-database-and-stats.md` -> `database-stats.md`
- `11-webui.md` -> `webui.md`
- `12-ops-runbook.md` -> `ops-runbook.md`
- `13-source-inventory.md` -> `source-inventory.md`

## Suggested Sidebar

```ts
export default {
  themeConfig: {
    sidebar: [
      { text: 'Overview', link: '/' },
      { text: 'Quickstart', link: '/quickstart' },
      { text: 'Architecture', link: '/architecture' },
      { text: 'Live Runtime', link: '/live-runtime' },
      { text: 'Backtest Runtime', link: '/backtest-runtime' },
      { text: 'Recording + Parquet', link: '/recording-parquet' },
      { text: 'Strategy System', link: '/strategy-system' },
      { text: 'Plugins + Feeds', link: '/plugins-feeds' },
      { text: 'CLI Reference', link: '/cli-reference' },
      { text: 'Env Reference', link: '/env-reference' },
      { text: 'Database + Stats', link: '/database-stats' },
      { text: 'Web UI', link: '/webui' },
      { text: 'Ops Runbook', link: '/ops-runbook' },
      { text: 'Source Inventory', link: '/source-inventory' }
    ]
  }
}
```

## Authoring Tips

- Keep one concept per page.
- Prefer architecture page + deep reference pages over one giant document.
- Keep source inventory page machine-generated from `git ls-files` to avoid drift.
