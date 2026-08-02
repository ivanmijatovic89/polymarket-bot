---
title: LLM Usage
description: Check subscription rate-limit usage for Claude Code and Codex accounts from one command.
---

# LLM Usage

`llm-usage` is a small CLI that shows how much of each subscription rate-limit
window is used, for every configured account, in one run. It supports
**Claude Code** (Anthropic) and **Codex CLI** (OpenAI) accounts.

```bash
npm run llm-usage   # from the repo root
```

The same data is available as a dashboard page: **More → LLM Usage**
(auto-refreshes every 60 s while open). Use the view buttons beside the refresh
controls to switch between the original cards and a compact dense view. The
selection is remembered in the browser.

```
── Minjon ────────────────────────────
  5h window               2% used   resets 05:50 (in 4h 45m)
  weekly (all models)     7% used   resets 13:00 (in 11h 55m)
  weekly (Fable/Opus)    13% used   resets 13:00 (in 11h 55m)

── Codex (plus) ──────────────────────
  5h window               1% used   resets 06:04 (in 4h 59m)
  weekly (all models)     0% used   resets Fri 01:04 (in 6d 23h)
```

Claude accounts report three windows (5h, weekly, weekly Fable/Opus); Codex
accounts report two (5h, weekly).

::: tip Checking usage is free
The tool only reads rate-limit state — it runs no model inference. It consumes
no subscription usage and no money, no matter how often you run it.
:::

## Configuration: `accounts.json`

Accounts are defined in `src/llm-usage/accounts.json`. The file is
**gitignored** because its values are, or point to, credentials.

```json [src/llm-usage/accounts.json]
{
  "Minjon": "~/.claude-main",
  "Baklavica": "keychain",
  "Codex": "codex"
}
```

Each key is a display label (anything you like); each value tells the tool
where that account's credentials live:

| Value | Provider | Meaning |
| --- | --- | --- |
| `"keychain"` | Claude | Whichever account is currently logged in to the Claude Code CLI on this Mac (the default `~/.claude` slot). |
| `"~/.claude-<name>"` | Claude | A dedicated config dir holding an extra Claude login. See [Add another Claude account](#add-another-claude-account). |
| `"codex"` | Codex | The Codex CLI login on this Mac (`~/.codex/auth.json`). |
| `"codex:<dir>"` | Codex | A Codex login in a non-default `CODEX_HOME` directory. |
| `"sk-ant-oat01-…"` | Claude | A raw Anthropic OAuth access token. Rarely useful — see the warning below. |

If `accounts.json` does not exist, the tool falls back to showing the
`keychain` account only.

::: warning `claude setup-token` tokens do not work
A raw pasted token must carry the `user:profile` OAuth scope. Tokens minted by
`claude setup-token` are inference-only (`user:inference`) and the usage
endpoint rejects them with HTTP 403. Use a config-dir login instead.
:::

## Add another Claude account

Each tracked Claude account needs a login the tool can read. To add one
without disturbing the default CLI login:

1. Log in once into a dedicated config dir (browser flow — make sure the
   browser is on the account you want to add):

   ```bash
   CLAUDE_CONFIG_DIR=~/.claude-<name> claude
   ```

2. Exit Claude Code after the login completes (`Ctrl+C`).

3. Add the entry to `accounts.json`:

   ```json
   { "My label": "~/.claude-<name>" }
   ```

The login is stored independently of `~/.claude` — the default CLI, its
skills, and its settings are untouched. After this single login the tool
refreshes the token automatically forever, so the config dir must stay for as
long as you want to track that account.

::: details Where the credentials actually live on macOS
For custom config dirs, Claude Code stores credentials in the macOS Keychain,
not in the folder itself. The entry's service name is
`Claude Code-credentials-<suffix>` where `<suffix>` is the first 8 hex
characters of `sha256(<absolute config dir path>)`. The provider derives this
name itself — you never need it — but it explains why the folder looks almost
empty.
:::

## Add another Codex account

The default `"codex"` entry reads the standard Codex CLI login. For a second
OpenAI account, create a separate Codex home and log in once:

```bash
CODEX_HOME=~/.codex-<name> codex login
```

Then add `"My label": "codex:~/.codex-<name>"` to `accounts.json`.

## How it works

- **Endpoints.** Both providers call the same internal endpoints their CLIs
  use for `/usage` and `/status`: `api.anthropic.com/api/oauth/usage`
  (Anthropic) and `chatgpt.com/backend-api/wham/usage` (OpenAI). These are
  undocumented — if the output suddenly breaks, the endpoint shape probably
  changed.
- **Token refresh.** Expired access tokens are refreshed with the stored
  refresh token and written back to where they came from (credentials file or
  Keychain), so a one-time login keeps working indefinitely.
- **Per-account limits.** Windows are counted per *account*, not per app.
  For example, Claude Desktop usage drains the same windows as Claude Code
  for that account.
- **Dashboard cache.** The dashboard keeps results in a process-local cache for
  30 seconds. Requests from the dashboard, SwiftBar, and future overview widgets
  share that cache, and simultaneous misses share one provider request. HTTP
  responses remain `no-store`, so browsers and proxies do not retain this
  credentials-derived data. The dashboard labels each response as `fresh` or
  `cached`, including the cached value's age, and always shows the configured
  `cache: 30s` duration. When a provider refresh fails, the server keeps the
  last successful value for that account and marks it as stale instead of
  replacing it with an empty error result.

### Source files

| File | Role |
| --- | --- |
| `src/llm-usage/usage.ts` | Entry point — loads `accounts.json`, dispatches to providers. Exported as the `@polymarket-bot/llm-usage` workspace package. |
| `src/llm-usage/claudeUsage.ts` | Anthropic provider — Keychain/config-dir token lookup, refresh, usage endpoint. |
| `src/llm-usage/codexUsage.ts` | OpenAI provider — Codex CLI login, refresh, usage endpoint. |
| `src/llm-usage/types.ts` | Shared `AccountUsage` / `RateLimitWindow` shapes. |
| `src/llm-usage/cli.ts` | Terminal formatting only. |
| `dashboard/src/app/api/llm-usage/route.ts` | Dashboard API route — calls `getUsage()` server-side; tokens never reach the browser. |
| `dashboard/src/lib/server/ttlCache.ts` | Reusable process-local TTL cache with concurrent-request deduplication. |
| `dashboard/src/app/llm-usage/page.tsx` + `dashboard/src/components/LlmUsageView.tsx` | The dashboard page (More → LLM Usage). |

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `token expired or revoked — log in again` | The refresh token is no longer valid. Repeat the login the same way the account was added (default slot: `claude` + `/login`; config dir: the `CLAUDE_CONFIG_DIR=… claude` command). |
| `token lacks the user:profile scope` | The entry is a pasted `claude setup-token` token. Replace it with a config-dir login. |
| `no credentials for ~/.claude-<name>` | The one-time login for that config dir was never completed, or the folder was deleted. Run the login command from [Add another Claude account](#add-another-claude-account). |
| `request failed: HTTP 5xx` | Provider-side hiccup — retry later. |
| A window shows `0% used` with a reset time in the past | Normal right after a window resets: the API reports the old timestamp until new usage starts a fresh window. |

## Uninstall

::: danger Complete removal
Delete all of these:

1. the `src/llm-usage/` folder,
2. in the root `package.json`: the `llm-usage` script and the
   `src/llm-usage` workspaces entry,
3. the `/src/llm-usage/accounts.json` line in the root `.gitignore` and the
   `src/llm-usage` exclude in the root `tsconfig.json`,
4. in the dashboard: `src/app/llm-usage/`, `src/app/api/llm-usage/`,
   `src/components/LlmUsageView.tsx`, the nav entry in
   `src/components/MainNav.tsx`, the `@polymarket-bot/llm-usage` dependency,
   and its `transpilePackages` entry in `next.config.ts`,
5. any `~/.claude-<name>` / `~/.codex-<name>` login folders created for it
   (these live in your home directory, outside the repo).
:::
