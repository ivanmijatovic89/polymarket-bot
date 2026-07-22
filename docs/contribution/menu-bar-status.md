---
title: Menu Bar Status
description: SwiftBar plugin that mirrors the backtest dashboard's live badge into the macOS menu bar.
---

# Menu Bar Status

A macOS menu bar version of the dashboard's `LiveStatusBadge` — worker fleet,
BullMQ queue depth, and active backtest batch progress, visible from any app.

![Menu bar title](/img/menu-bar/title.png)

machines · alive worker processes · jobs waiting on the markets queue · state
dot + batch progress. (The icons are SF Symbols — `server.rack`, `cpu`,
`tray.full` — which only render on macOS, hence the screenshot.)

The plugin lives in the repo at `ops/swiftbar/`:

| File | Role |
| --- | --- |
| `polybot.5s.sh` | Launcher. Resolves a Node 18+ binary (SwiftBar's PATH has no nvm) and its own symlink, then execs the body. |
| `polybot.mjs` | All the logic. Plain Node, zero dependencies, no build step. |

## Install

```bash
brew install --cask swiftbar
```

On first launch SwiftBar asks for a plugin folder — pick anything (e.g.
`~/.swiftbar-plugins`), then symlink the launcher into it:

```bash
mkdir -p ~/.swiftbar-plugins
ln -s ~/Sites/polymarket-bot/ops/swiftbar/polybot.5s.sh \
      ~/.swiftbar-plugins/polybot.5s.sh
```

The symlink means the file you edit in the repo _is_ the running plugin — no
copy step. The `5s` in the filename is the refresh interval; rename to
`polybot.10s.sh` to slow it down. Opening the menu also refreshes it
(`<swiftbar.refreshOnOpen>`), so the dropdown is never stale.

## Start at login

The badge only exists while SwiftBar.app is running. To avoid launching it by
hand after every reboot, enable **SwiftBar → Preferences → General → Launch at
login** (equivalently: System Settings → General → Login Items → add
SwiftBar). The plugin itself needs nothing — SwiftBar picks it up from the
plugin folder on start.

## Title states

Written here with emoji stand-ins for the SF Symbols (🖥 machines, ⚙️ worker
processes, 📥 queue):

| Title | Meaning |
| --- | --- |
| `🖥 1 ⚙️ 5 📥 163 🟢 17%` | Running. Green dot. |
| `🖥 1 ⚙️ 5 📥 0 ⚫ idle` | No active batches. |
| `🖥 1 ⚙️ 0 📥 163 🟠 17%` | Work outstanding, no live workers to pick it up. |
| `? —` | Dashboard on :3051 not reachable. |

Tone rules match `dashboard/src/components/LiveStatusBadge.tsx` — if the two
ever disagree, that component is the source of truth.

## The dropdown

- **active batches** — per batch: strategy, done/total, %; click opens the
  batch detail page. Batches with failures get a red failure count row.
  An eta row (`eta ~4m · 39 mkts/min`) appears once a throughput sample exists.
- **queues** — markets and aggregate: waiting (incl. delayed) and active
  counts straight from BullMQ; red failed row when non-zero. Click opens
  Bull Board.
- **workers** — machine count and alive processes, then one row per machine
  using the friendly names from `dashboard/src/data/machines.json` (the same
  file the Workers page reads).
- **actions** — open the dashboard, open Bull Board, refresh now.

## What it reads

Three existing dashboard endpoints, nothing new on the backend:

- `GET /api/workers` → machine count, alive worker processes
- `GET /api/batches/active` → batch progress
- `GET /api/queues` → BullMQ job counts (non-fatal: the badge still renders if
  this one fails)

Throughput and the eta are derived from the plugin's _own_ previous sample
(EWMA-smoothed), cached in `$TMPDIR/swiftbar-polybot-eta.json`. Nothing is
computed server-side, and a shrinking `done` count resets the rate so an eta
is never reported across two unrelated batch sets.

## Design constraints (do not undo these)

Two rules in `titleLine()` exist because breaking them makes the item vanish
or go illegible — both were hit in practice:

1. **The title's width must not change between idle and running.** macOS
   silently hides a status item that stops fitting (on a notched display only
   the strip right of the notch is usable), so a title that grows when a run
   starts disappears exactly when it becomes useful. Every slot is always
   present — the queue slot shows `0` rather than being dropped — and the
   eta, whose width is unbounded (`4m` → `2h10m`), stays in the dropdown.

2. **No `sfcolor`/`color` parameters on the title line.** SwiftBar tints the
   whole line rather than just the indexed symbol, which rendered the title
   grey at idle and green while running. State colour is carried by an emoji
   dot (🟢/🟠/⚫) instead; icons and text keep the native menu bar colour in
   both appearances.

## Config

| Env var | Default |
| --- | --- |
| `POLYBOT_MENUBAR_DASHBOARD_URL` | `http://localhost:3051` |
| `POLYBOT_MENUBAR_BULL_BOARD_URL` | `http://localhost:3052` |
| `POLYBOT_MENUBAR_TITLE` | `full` (`compact` drops the machine count, `minimal` keeps only the dot + %) |

SwiftBar passes its own environment to plugins; set these in SwiftBar's
settings if your dashboard runs elsewhere.

## Developing

Run it straight from the shell — the output is just text:

```bash
./ops/swiftbar/polybot.5s.sh
POLYBOT_MENUBAR_DASHBOARD_URL=http://127.0.0.1:9 ./ops/swiftbar/polybot.5s.sh   # offline path
POLYBOT_MENUBAR_TITLE=minimal ./ops/swiftbar/polybot.5s.sh                      # narrow title
```

Line format is `<title> | key=value ...`; see SwiftBar's plugin API. Dynamic
strings are escaped for `|` because SwiftBar splits on it.

## Troubleshooting

- **Item not in the menu bar at all** — macOS ran out of room and hid it.
  Free space (⌘-drag system icons off; quit third-party menu bar apps), or
  install [Ice](https://github.com/jordanbaird/Ice) for a real overflow
  section. `defaults read com.ameba.SwiftBar | grep Visible` shows the
  hidden/visible flags.
- **`?` icon** — the dashboard isn't running: `npm run dashboard`.
- **Everything works in the shell but not in SwiftBar** — SwiftBar's PATH has
  no nvm; the launcher handles that, so check it is the launcher (not
  `polybot.mjs`) that is symlinked.

## Deliberately not built yet

Health checks, live-trading / `DRY_RUN` state, data-pipeline status,
`swiftbar://notify` push notifications, and streamable mode (a long-lived
process instead of a 5s re-spawn).
