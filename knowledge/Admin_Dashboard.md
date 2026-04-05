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
- **Start command:** `npm run dashboard` from repo root
- **Startup script:** `Dashboard/start.cmd` — checks if port 3737 is in use; if not, starts server; opens browser

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

| Pipeline label | R2 file | GH workflow | Local job | Feeds |
|---|---|---|---|---|
| FedInvest daily prices | `YieldsDerivedFromFedInvestPrices.csv` | `get-yields-fedinvest.yml` | FedInvest Download | All yield curves |
| Broker quotes — Treasuries | `FidelityTreasuries.csv` | — | Fidelity Download + Upload to R2 | Market tab (nominals) |
| Broker quotes — TIPS | `FidelityTips.csv` | — | Fidelity Download + Upload to R2 | Market tab (TIPS) |
| CPI seasonal adjustment factors | `RefCpiNsaSa.csv` | `fetch-ref-cpi.yml`, `update-ref-cpi-nsa-sa.yml` | — | CPI overlay |
| SIFMA bond market holidays | `misc/BondHolidaysSifma.csv` | — | — | Business-day calculations |

### YieldsMonitor

| Pipeline label | R2 file | GH workflow | Local job | Feeds |
|---|---|---|---|---|
| Daily yield history snapshots | `yield-history/US10Y_history.json` *(representative)* | `update-yield-history.yml` | — | History charts — 14 symbols |
| Live Treasury yields | *(none — live browser fetch)* | — | — | Live yield display + intraday charts |

Note: YieldsMonitor does **not** read `YieldsDerivedFromFedInvestPrices.csv`. Its only R2 dependency is the 14 `yield-history/*.json` files. Live data comes from CNBC GraphQL fetched directly in the browser.

### TipsLadderManager

| Pipeline label | R2 file | GH workflow | Local job | Feeds |
|---|---|---|---|---|
| FedInvest daily prices | `YieldsDerivedFromFedInvestPrices.csv` | `get-yields-fedinvest.yml` | — | Ladder pricing — all TIPS |
| TIPS reference metadata | `TipsRef.csv` | `fetch-tips-ref.yml` | — | Coupon + dated-date lookups |
| Reference CPI index | `RefCPI.csv` | `fetch-ref-cpi.yml` | — | Index ratio calculations |

### TreasuryAuctions

| Pipeline label | R2 file | GH workflow | Local job | Feeds |
|---|---|---|---|---|
| Historical auction results | `Auctions.csv` | `get-auctions.yml` | — | All, Bills, Notes/Bonds, TIPS tabs |
| Upcoming auctions | *(none — live fetch)* | — | — | Calendar view |

**Shared files:**
- `YieldsDerivedFromFedInvestPrices.csv` is shared by YieldCurves and TipsLadderManager. Both read the same R2 key (`Treasuries/YieldsDerivedFromFedInvestPrices.csv`) written by `get-yields-fedinvest.yml`. Running the workflow or the local FedInvest Download refreshes both.
- `fetch-ref-cpi.yml` is shared: used by YieldCurves (indirectly, triggers `update-ref-cpi-nsa-sa.yml` chain) and TipsLadderManager (writes `RefCPI.csv` directly).

---

## Staleness

| App / Pipeline | Staleness threshold |
|---|---|
| YieldCurves, YieldsMonitor, TipsLadderManager — daily data | 24 hours |
| TreasuryAuctions — `Auctions.csv` | 12 hours |
| Monthly data (CPI files, TipsRef) | 720 hours (30 days) |

Card border: green = all r2 files within threshold · amber = any stale · red = any error or failed workflow.

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/status` | Returns full pipeline status for all apps |
| `GET` | `/api/preview` | Returns first N lines of a local file or R2 key |
| `POST` | `/api/run/:jobId` | Executes a registered local script; streams output via SSE |
| `POST` | `/api/gh/dispatch/:workflow` | Triggers `workflow_dispatch` via GitHub API |
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
      ghWorkflows: [{ workflow, label, status, conclusion, runAt, htmlUrl, nextRunAt }],
      localJobs: [{ id, label, cmd, windowsTaskName?: string, nextRunAt?: string | null }],
      alsoUsedBy: string[],   // other app labels sharing this r2Key
      stalenessHours: number | null,
      liveNote: string | null,  // for pipelines with no R2 file (live fetches)
      r2Note: string | null,    // e.g. "14 symbol files; US10Y shown as representative"
    }]
  }]
}
```

R2 HEAD requests and GH API calls are deduplicated per status request — shared files/workflows are fetched once.

---

## Configuration

| Constant | Value |
|---|---|
| GitHub owner | `aerokam` |
| GitHub repo | `Treasuries` |
| R2 public base URL | `https://pub-ba11062b177640459f72e0a88d0261ae.r2.dev` |
| Portal URL | `https://aerokam.github.io/Treasuries/` |

`Dashboard/.env` (gitignored) — required for write operations:
```
GH_TOKEN=<PAT with workflow scope>
```

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

- **`Yields.csv` rename** — completed. Renamed to `YieldsDerivedFromFedInvestPrices.csv` across all code, tests, knowledge docs, and Dashboard. R2 key updated; old `Treasuries/Yields.csv` object can be deleted from R2 after next pipeline run confirms the new key.
- **YieldsMonitor yield history** — 14 symbol files; dashboard checks US10Y as a representative sample for freshness. Could expand to check all 14 and show min/max age.
- **Deployment** — local-only; blocked by local script execution requirement.
