# ToDo

## Docs sajt (VitePress → GitHub Pages)

Sajt je živ na: https://ivanmijatovic89.github.io/polymarket-bot/
Fajlovi su u: `docs/`

### 1. Ažurirati sadržaj stranica (prioritet)

Trenutni sadržaj je iz `docs-by-codex/` i može biti zastario.
Proći stranicu po stranicu i uskladiti sa stvarnim stanjem koda:

- [ ] `index.md` — homepage, hero sekcija
- [ ] `quickstart.md` — instalacija, prvi koraci, env setup
- [ ] `architecture.md` — data flow, tri moda (live/backtest/record)
- [ ] `strategy-system.md` — kako pisati strategiju, registracija, params
- [ ] `plugins-feeds.md` — plugins, external feeds
- [ ] `live-runtime.md` — trading bot, warmup, fill status
- [ ] `backtest-runtime.md` — replay, latency simulation, maker fills
- [ ] `recording-parquet.md` — parquet format, rotacija, disconnect markeri
- [ ] `cli-reference.md` — svi npm run komandi
- [ ] `env-reference.md` — sve env varijable
- [ ] `database-stats.md` — MySQL, Drizzle, backtest stats
- [ ] `webui.md` — web UI, portovi, multi-bot
- [ ] `ops-runbook.md` — troubleshooting, multi-bot, relayer/SAFE
- [ ] `source-inventory.md` — mapa source fajlova
- [ ] Dodati stranicu: `contributing.md` — kako dodati strategiju, kako pokrenuti lokalno

### 2. README.md

- [ ] Skratiti na ~30 linija
- [ ] Dodati link na docs sajt
- [ ] Ukloniti sve detalje koji su sada u docs-u

### 3. Auto-update mehanizam

- [ ] Dodati pravilo u `CLAUDE.md` da Claude uvek ažurira relevantne docs kad menja kod
- [ ] Opciono: Claude Code Stop hook koji proverava `git diff` i podseća
