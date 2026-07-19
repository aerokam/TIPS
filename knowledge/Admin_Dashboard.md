# 0.1 Admin Dashboard

## Purpose

A personal, local-first monitoring and control panel for the full Treasuries ecosystem. Single page. Runs via a local Express server at `http://localhost:3737`. Designed for one user (repo owner).

---

## Design Philosophy: Pipeline-Row Model

Each app card is organized around **data pipelines**, not generic "Data" and "Jobs" sections. A pipeline row represents a single data chain:

```
[Job/Source]  →  [R2 file]  →  [UI feature]
```

Every row shows:
- **What the data is** — descriptive label using the app's own vocabulary
- **Which UI feature it feeds** — so staleness means something concrete
- **How fresh it is** — R2 file age as the canonical freshness signal
- **How to refresh it** — Run button(s) for GH workflows and/or local scripts, inline on the same row
- **Who else uses it** — "also used by" badge when the same R2 file is shared across apps

The dashboard should feel like it was written by someone who knows the system. Terms like "FedInvest daily prices", "Broker quotes — Treasuries", and "TIPS reference metadata" — not workflow file names.

---

## Architecture

### Local Server (`Dashboard/server.js`)

- **Runtime:** Node.js + Express, port `3737`
- **Role:** Serve `index.html`; expose REST API for status aggregation and job execution
- **REST API:** `GET /api/status` (aggregated R2 freshness + job history), `GET /api/jobs`, `GET /api/preview?source=r2&key=<key>&lines=<n>` → `{ lines[], total }` (lines capped at 500 chars so single-line JSON stays previewable), `GET /api/run/:jobId` → **SSE** stream of `{type,text}` events (`start`/`out`/`err`/`exit`); spawns the job's `cmd` with `shell:true` in its `cwd`, killed if the client disconnects, and records `lastRunAt`/`exitCode` in in-memory job history
- **Start command:** `npm run dashboard` from repo root
- **Manual launcher:** `Dashboard/start.cmd` — opens a browser tab and starts the server (unguarded; errors harmlessly with `EADDRINUSE` if 3737 is already up)
- **Auto-start (headless):** `scripts/run-dashboard.cmd` — guarded launcher used by the `DashboardServer` scheduled task. Starts the server only if nothing is LISTENING on 3737 (idempotent), runs it hidden via `Start-Process`, and never opens a browser. Logs to `logs/dashboard.log` (+ `dashboard.out/err.log`).
- **Keep-alive task:** `DashboardServer` (registered in `scripts/setup-windows-tasks.ps1`) fires weekday mornings at 6:00am PT and repeats every 30 min for 18h as a self-heal heartbeat — the guard makes repeats harmless. Chosen over a logon trigger because the machine stays logged in continuously.

### Portal entry point (local-only)

The top-level portal (`index.html`) shows a discreet **"Dashboard Monitor →"** link in the Mission box, but only on a local checkout. Gating: on load it `fetch()`es `local-admin.json` (a gitignored sentinel that carries `{ "dashboardUrl": "http://localhost:3737/" }`); if present, the link is revealed and a `mode:'no-cors'` probe of `/api/status` annotates it ("Dashboard Monitor →" when up, "… (start server) →" when down). On GitHub Pages the sentinel is absent (never deployed), so the link stays hidden.

### Dashboard Frontend (`Dashboard/index.html`)

- Vanilla JS, no build step
- Polls `/api/status` on load and every 60s
- UI conventions follow the rest of the repo

### Knowledge Map & Viewer (`knowledge/`)

The knowledge base is a set of static files served by `npx serve . -p 8080` (the same static server used for Playwright tests). There are two entry points:

- **`/knowledge/KNOWLEDGE_MAP`** — the visual DFD context diagram (`knowledge/KNOWLEDGE_MAP.html`). This is the top-level navigation hub; all app overviews and spec docs link out from here.
- **`/knowledge/viewer#/md/<path>`** — the markdown viewer (`knowledge/viewer.html`). Fetches any `.md` file in the repo and renders it with syntax highlighting, Mermaid diagrams, and CSV preview inline.

**Routing rules inside the viewer:**
- Only `.md` files should be targeted as viewer hash paths. The viewer guards against `.html` targets: if the hash ever resolves to a `.html` file, it immediately redirects to that file's direct URL instead of trying to render its HTML source as markdown.
- The `← KNOWLEDGE MAP` nav link uses the absolute path `/knowledge/KNOWLEDGE_MAP` (not a relative `.html` reference) to ensure it always navigates out of the viewer regardless of the current hash state.

**URL conventions:**
- `npx serve` strips `.html` extensions and serves clean URLs. Always reference these files by their clean URL (`/knowledge/KNOWLEDGE_MAP`, `/knowledge/viewer`), not by the `.html` filename. Source `href` attributes may still contain `.html` but the browser will be redirected to the clean URL.

---

## App Pipelines

Each app has a set of named pipelines. The server's `APP_CONFIGS` is the authoritative definition. Summary:

### YieldCurves

| Pipeline label | R2 file | Local job | Feeds |
|---|---|---|---|
| FedInvest daily prices | `YieldsFromFedInvestPrices.csv` | FedInvest Download | All yield curves |
| Broker quotes — Treasury + TIPS | `FidelityTreasuriesTips.csv` | Fidelity Download + Upload to R2 | Market tab (nominals + TIPS) |
| CPI seasonal adjustment factors | `RefCpiNsaSa.csv` | SA Factor Update | CPI overlay |
| SIFMA bond market holidays | `misc/BondHolidaysSifma.csv` | *(Manual Upload)* | Business-day calculations |

### YieldsMonitor

| Pipeline label | R2 file | Local job | Feeds |
|---|---|---|---|
| Daily yields-history snapshots | `yields-history/history.json` *(consolidated, all 14)* | Update Yields History | History charts — 14 symbols |
| Live Treasury yields | *(none — live browser fetch)* | — | Live yield display + intraday charts |

Note: YieldsMonitor does **not** read `YieldsFromFedInvestPrices.csv`. Its only R2 dependency is the single consolidated `yields-history/history.json` (nested by symbol, all 14). Live data comes from CNBC GraphQL fetched directly in the browser.

### TipsLadderManager

| Pipeline label | R2 file | Local job | Feeds |
|---|---|---|---|
| FedInvest daily prices | `YieldsFromFedInvestPrices.csv` | FedInvest Download | Ladder pricing — all TIPS |
| TIPS reference metadata | `TipsRef.csv` | TIPS Ref Refresh | Coupon + dated-date lookups |
| Reference CPI index | `RefCPI.csv` | Ref CPI Refresh | Index ratio calculations |

### TreasuryAuctions

| Pipeline label | R2 file | Local job | Feeds |
|---|---|---|---|
| Historical auction results | `Auctions.csv` | Auction Refresh | All, Bills, Notes/Bonds, TIPS tabs |
| Upcoming auctions | *(none — live fetch)* | — | Calendar view |

**Shared files:**
- `YieldsFromFedInvestPrices.csv` is shared by YieldCurves and TipsLadderManager. Both read the same R2 key (`Treasuries/YieldsFromFedInvestPrices.csv`) written by the local **FedInvest Download** task.
- `RefCPI.csv` is shared: written by the local **Ref CPI Refresh** task and used by TipsLadderManager and YieldCurves.

---

## Staleness

| App / Pipeline | Staleness threshold |
|---|---|
| YieldCurves, YieldsMonitor, TipsLadderManager — daily data | 24 hours |
| TreasuryAuctions — `Auctions.csv` | 12 hours |
| Monthly data (CPI files, TipsRef) | 720 hours (30 days) |

Card border: green = all r2 files within threshold · amber = any stale · red = any error.

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/status` | Returns full pipeline status for all apps |
| `GET` | `/api/preview` | Returns first N lines of a local file or R2 key |
| `POST` | `/api/run/:jobId` | Executes a registered local script; streams output via SSE |
| `GET` | `/api/health` | Returns `{ ok: true }` |

### `/api/status` response shape

```js
{
  fetchedAt: string,
  apps: [{
    id, label, description, url,
    overallStatus: 'fresh' | 'stale' | 'error',
    pipelines: [{
      id, label, feeds,
      r2Key: string | null,
      r2: { key, lastModified, status, shortName } | null,
      localJobs: [{ id, label, cmd, windowsTaskName?: string, nextRunAt?: string | null }],
      alsoUsedBy: string[],   // other app labels sharing this r2Key
      stalenessHours: number | null,
      liveNote: string | null,  // for pipelines with no R2 file (live fetches)
      r2Note: string | null,    // e.g. "14 symbol files; US10Y shown as representative"
    }]
  }]
}
```

R2 HEAD requests are deduplicated per status request — shared files are fetched once.

---

## Configuration

| Constant | Value |
|---|---|
| R2 public base URL | `https://pub-ba11062b177640459f72e0a88d0261ae.r2.dev` |
| Portal URL | `https://aerokam.github.io/Treasuries/` |

`Dashboard/jobs.json` — local script registry (committed, no secrets):
```json
[
  { "id": "fidelity-download", "label": "Fidelity Download", "cmd": "...", "apps": ["yieldcurves"], "windowsTaskName": "Fidelity Download" },
  { "id": "fedinvest-download", "label": "FedInvest Download", "cmd": "...", "apps": ["yieldcurves"] },
  { "id": "upload-fidelity", "label": "Upload to R2", "cmd": "...", "apps": ["yieldcurves"] }
]
```

`windowsTaskName` (optional) — if set, the server queries Windows Task Scheduler at status time to populate `nextRunAt`:
```
schtasks /query /fo csv /nh /tn "<windowsTaskName>"
```
The "Next Run Time" field from the CSV output is parsed and returned as an ISO string (or `null` if the task is disabled or not found).

- Only jobs with `windowsTaskName` get a `nextRunAt` in the response; others omit the field.
- The `schtasks` call is made per job entry; no deduplication needed (each task name is unique).

---

## Startup / Taskbar Shortcut

`Dashboard/start.cmd`:
1. `curl -s http://localhost:3737/api/health` — if 200, skip to step 3
2. `start /B node Dashboard/server.js` — start server detached
3. Wait up to 5s for health check to pass
4. `start http://localhost:3737` — open in default browser

---

## File Layout

```
Treasuries/
  Dashboard/
    server.js         # Express server + APP_CONFIGS
    index.html        # Single-page dashboard
    jobs.json         # Local script registry
    start.cmd         # Taskbar launcher
    .env              # Secrets (gitignored)
  knowledge/
    Admin_Dashboard.md   ← this file
```

---

## Deferred / Known Issues

- **`Yields.csv` rename** — completed. Renamed to `YieldsFromFedInvestPrices.csv` across all code, tests, knowledge docs, and Dashboard. R2 key updated; old `Treasuries/Yields.csv` object can be deleted from R2 after next pipeline run confirms the new key.
- **YieldsMonitor yield history** — 14 symbol files; dashboard checks US10Y as a representative sample for freshness. Could expand to check all 14 and show min/max age.
- **Deployment** — local-only; blocked by local script execution requirement.
