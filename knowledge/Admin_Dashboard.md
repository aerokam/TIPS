# 0.1 Admin Dashboard

## Purpose

A personal, local-first monitoring and control dashboard for the full Treasuries/Investing ecosystem. Single page. Runs via a local Express server. Accessible at `http://localhost:3737`. Designed for one user (repo owner).

---

## Architecture

### Local Server (`Dashboard/server.js`)

- **Runtime:** Node.js + Express, port `3737`
- **Role:** Two responsibilities:
  1. Serve the static dashboard `index.html`
  2. Expose a REST API for local script execution and status aggregation
- **Start command:** `npm run dashboard` from repo root
- **Startup script:** `Dashboard/start.cmd` — checks if port 3737 is in use; if not, starts the server in background, then opens `http://localhost:3737` in the default browser. Designed to be pinned to the Windows taskbar.

### Dashboard Frontend (`Dashboard/index.html`)

- Vanilla JS, no build step, no framework
- Polls the local server API on load and on a configurable refresh interval (default: 60s)
- Follows the existing UI conventions of the repo (same styling as YieldsMonitor tabs/cards)

---

## Panels

### 1. App Status

One card per app. Shows:

| Field | Source |
|---|---|
| Last local update | Timestamp of most-recently modified data file in the app's `data/` dir |
| Last R2 update | `Last-Modified` header from a HEAD request to the app's canonical R2 key, proxied through local server to avoid CORS |
| Last GH Actions run | GitHub API: most recent completed run for the app's associated workflow(s); shows status (success / failure / skipped) + timestamp |

Apps tracked:

| App | Local data dir | R2 keys to HEAD | GH workflows |
|---|---|---|---|
| YieldCurves | `YieldCurves/data/` (Yields.csv, RefCpiNsaSa.csv, FidelityTreasuries.csv, FidelityTips.csv) | same keys under `Treasuries/` | `get-yields-fedinvest.yml`, `fetch-ref-cpi.yml`, `update-ref-cpi-nsa-sa.yml` |
| YieldsMonitor | `YieldsMonitor/data/yield-history/` (per-symbol JSON, written by snapHistory.js) | `Treasuries/Yields.csv`, `Treasuries/yield-history/{sym}_history.json` | `get-yields-fedinvest.yml`, `update-yield-history.yml` |
| TipsLadderManager | none | `Treasuries/Yields.csv` | `fetch-tips-ref.yml` |
| TreasuryAuctions | none | `Treasuries/Auctions.csv` | `get-auctions.yml` |

Notes:
- `get-yields-fedinvest.yml` is shared by YieldCurves and YieldsMonitor (writes `Treasuries/Yields.csv`).
- `update-yield-history.yml` runs `YieldsMonitor/scripts/snapHistory.js` — writes per-symbol yield history JSON to R2 under a YieldsMonitor-specific prefix.
- Local file timestamps are only meaningful for YieldCurves and YieldsMonitor (which cache R2 data locally). For TipsLadderManager and TreasuryAuctions, the "local" column shows N/A.

Staleness indicator: card border turns amber if local or R2 data is older than a configurable threshold per app (defaults TBD per app during implementation).

### 2. Jobs

Two sub-sections:

**GitHub Actions (remote)**
- Trigger `workflow_dispatch` via GitHub API
- One button per workflow; shows spinner + last-run status after triggering
- Requires a GitHub PAT with `workflow` scope stored in a local `.env` file (gitignored)

**Local Scripts**
- One button per registered local script
- Server executes the script as a child process; streams stdout/stderr back to the UI in a log pane
- Script registry defined in `Dashboard/jobs.json` — array of `{ label, cmd, cwd }` entries
- Initial registry:
  - Fidelity Download (`YieldCurves/scripts/run-fidelity.cmd`)
  - FedInvest Download (`YieldCurves/scripts/run-fedinvest.cmd`)
  - Upload Fidelity (`node YieldCurves/scripts/uploadFidelityDownload.js`)

### 3. Market Quotes *(placeholder — deferred)*

Empty panel with "Coming soon" label. Slot reserved.

---

## API Endpoints (local server)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/status` | Returns status object for all apps (local file timestamps + R2 HEAD + GH Actions last run) |
| `POST` | `/api/run/:jobId` | Executes a registered local script; streams output via SSE |
| `POST` | `/api/gh/dispatch/:workflow` | Triggers a `workflow_dispatch` event via GitHub API |
| `GET` | `/api/health` | Returns `{ ok: true }` — used by start script to check if server is already running |

---

## Configuration

### Environment (hardcoded defaults, no `.env` needed for read-only ops)

| Constant | Value |
|---|---|
| GitHub owner | `aerokam` |
| GitHub repo | `Treasuries` |
| R2 public base URL | `https://pub-ba11062b177640459f72e0a88d0261ae.r2.dev` |
| Portal URL | `https://aerokam.github.io/Treasuries/` |

R2 keys follow the pattern `Treasuries/<filename>`. Full file list is in `YieldCurves/knowledge/0.0_Data_Pipeline.md` (gitignored). Canonical files:

| R2 Key | Owner app |
|---|---|
| `Treasuries/Yields.csv` | YieldsMonitor / YieldCurves |
| `Treasuries/RefCpiNsaSa.csv` | YieldCurves |
| `Treasuries/FidelityTreasuries.csv` | YieldCurves |
| `Treasuries/FidelityTips.csv` | YieldCurves |

`Dashboard/.env` (gitignored) — only needed for write operations (triggering GH Actions):
```
GH_TOKEN=<PAT with workflow scope>
```

`Dashboard/jobs.json` — local script registry (committed, no secrets).

---

## Startup / Taskbar Shortcut

`Dashboard/start.cmd`:
1. `curl -s http://localhost:3737/api/health` — if 200, skip to step 3
2. `start /B node Dashboard/server.js` — start server detached
3. Wait up to 5s for health check to pass
4. `start http://localhost:3737` — open in default browser

Pin `start.cmd` to taskbar via a shortcut with icon.

---

## File Layout

```
Treasuries/
  Dashboard/
    server.js         # Express server
    index.html        # Single-page dashboard
    jobs.json         # Local script registry
    start.cmd         # Taskbar launcher
    .env              # Secrets (gitignored)
  knowledge/
    Admin_Dashboard.md   ← this file
```

---

## Out of Scope (this version)

- Authentication (local-only, single user)
- Mobile layout
- Market Quotes panel (see memory: project_market_quotes_dashboard.md)
- Deployment to GitHub Pages (blocked by local script execution requirement)
