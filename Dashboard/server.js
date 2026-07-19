import express from 'express';
import { spawn, execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { resolve, dirname, join, relative, isAbsolute } from 'path';
import { marked } from 'marked';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

function loadEnv(filePath) {
  if (!existsSync(filePath)) return;
  readFileSync(filePath, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^\s*([^#\s][^=]*?)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
}
loadEnv(join(__dirname, '.env'));
loadEnv(join(REPO_ROOT, '.env'));

const PORT = process.env.PORT || 3737;
const R2_BASE = 'https://pub-ba11062b177640459f72e0a88d0261ae.r2.dev';

function getWindowsTaskNextRun(taskNames) {
  const names = Array.isArray(taskNames) ? taskNames : [taskNames];
  const now = Date.now();
  let earliest = null;
  for (const name of names) {
    try {
      const out = execSync(`schtasks /query /fo csv /nh /tn "${name}" 2>nul`, { encoding: 'utf8', timeout: 5000 });
      const cols = out.trim().split('\n')[0].match(/"([^"]*)"/g)?.map(s => s.slice(1, -1));
      if (!cols || cols.length < 2) continue;
      const next = cols[1];
      if (!next || next === 'N/A' || next === 'Disabled') continue;
      const d = new Date(next);
      if (isNaN(d) || d.getTime() <= now) continue;
      if (!earliest || d < earliest) earliest = d;
    } catch { /* task not found */ }
  }
  return earliest ? earliest.toISOString() : null;
}

// ── Pipeline-centric app configs ───────────────────────────────────────────────
// Each pipeline: { id, label, feeds, r2Key, localJobIds[], stalenessHours, liveNote, r2Note }
// r2Key is the canonical R2 file that signals freshness for this pipeline.
// liveNote: set when there is no R2 file (browser fetches live on page load).
const APP_CONFIGS = [
  {
    id: 'yieldcurves',
    label: 'YieldCurves',
    description: 'Plots nominal and TIPS yield curves across all maturities using FedInvest prices and broker quotes.',
    url: 'https://aerokam.github.io/Treasuries/YieldCurves/',
    pipelines: [
      {
        id: 'fedinvest-prices',
        label: 'FedInvest daily prices',
        feeds: 'All yield curves',
        r2Key: 'Treasuries/YieldsFromFedInvestPrices.csv',
        localJobIds: ['fedinvest-download'],
        stalenessHours: 24,
        weekdayOnly: true,
      },
      {
        id: 'broker-quotes',
        label: 'Broker quotes — Treasury + TIPS',
        feeds: 'Market tab (nominals + TIPS)',
        r2Key: 'Treasuries/FidelityTreasuriesTips.csv',
        localJobIds: ['fidelity-download', 'upload-fidelity'],
        stalenessHours: 24,
        weekdayOnly: true,
        r2Note: 'Combined file — Treasury and TIPS rows distinguished by the Product column',
      },
      {
        id: 'cpi-seasonal',
        label: 'CPI seasonal adjustment factors',
        feeds: 'CPI overlay',
        r2Key: 'TIPS/RefCpiNsaSa.csv',
        localJobIds: ['update-ref-cpi-nsa-sa'],
        stalenessHours: 720,
        weekdayOnly: true,
      },
      {
        id: 'bond-holidays',
        label: 'SIFMA bond market holidays',
        feeds: 'Business-day calculations',
        r2Key: 'misc/BondHolidaysSifma.csv',
        localJobIds: [],
        stalenessHours: 8760, // annual — only changes once a year
        weekdayOnly: true,
        r2Note: 'Manually maintained — no automated update',
      },
    ],
  },
  {
    id: 'yieldsmonitor',
    label: 'YieldsMonitor',
    description: 'Live intraday Treasury yields with snapshot history across 14 maturities sourced from CNBC.',
    url: 'https://aerokam.github.io/Treasuries/YieldsMonitor/',
    pipelines: [
      {
        id: 'yields-history',
        label: 'Daily yields-history snapshots',
        feeds: 'History charts — 14 symbols',
        r2Key: 'Treasuries/yields-history/history.json',
        localJobIds: ['update-yields-history'],
        stalenessHours: 24,
        weekdayOnly: true,
        r2Note: 'Single consolidated nested-by-symbol file (all 14 symbols)',
      },
      {
        id: 'live-yields',
        label: 'Live Treasury yields',
        feeds: 'Live yield display + intraday charts',
        r2Key: null,
        localJobIds: [],
        stalenessHours: null,
        liveNote: 'Browser fetches CNBC GraphQL directly on page load — no job to run',
      },
      {
        id: 'feed-inspector',
        label: 'Feed inspector (diagnostic)',
        feeds: 'On-demand: per-range resolution, current-day status, 3PM vs 17:05 vs live',
        r2Key: null,
        localJobIds: ['inspect-feeds'],
        stalenessHours: null,
        liveNote: 'Click Run for an annotated snapshot of every CNBC feed — self-documenting. See knowledge/Close_Price_Investigation.md',
      },
    ],
  },
  {
    id: 'tipsladder',
    label: 'TipsLadderManager',
    description: 'Builds and rebalances TIPS bond ladders using real yields, CPI data, and auction metadata.',
    url: 'https://aerokam.github.io/Treasuries/TipsLadderManager/',
    pipelines: [
      {
        id: 'fedinvest-prices',
        label: 'FedInvest daily prices',
        feeds: 'Ladder pricing — all TIPS',
        r2Key: 'Treasuries/YieldsFromFedInvestPrices.csv',
        localJobIds: ['fedinvest-download'],
        stalenessHours: 24,
        weekdayOnly: true,
      },
      {
        id: 'tips-reference',
        label: 'TIPS reference metadata',
        feeds: 'Coupon + dated-date lookups',
        r2Key: 'Treasuries/TipsRef.csv',
        localJobIds: ['fetch-tips-ref'],
        stalenessHours: 720,
      },
      {
        id: 'cpi-index',
        label: 'Reference CPI index',
        feeds: 'Index ratio calculations',
        r2Key: 'TIPS/RefCPI.csv',
        localJobIds: ['fetch-ref-cpi'],
        stalenessHours: 720,
      },
    ],
  },
  {
    id: 'auctions',
    label: 'TreasuryAuctions',
    description: 'Historical and upcoming Treasury auction results with bid statistics across all security types.',
    url: 'https://aerokam.github.io/Treasuries/TreasuryAuctions/',
    pipelines: [
      {
        id: 'auction-results',
        label: 'Historical auction results',
        feeds: 'All, Bills, Notes/Bonds, TIPS tabs',
        r2Key: 'Treasuries/Auctions.csv',
        localJobIds: ['get-auctions'],
        stalenessHours: 12,
      },
      {
        id: 'upcoming-auctions',
        label: 'Upcoming auctions',
        feeds: 'Calendar view',
        r2Key: null,
        localJobIds: [],
        stalenessHours: null,
        liveNote: 'Live fetch from FiscalData API on page load — no job to run',
      },
    ],
  },
];

// Precompute: r2Key → [app labels that use it] for "also used by"
const r2KeyAppMap = {};
APP_CONFIGS.forEach(cfg => {
  cfg.pipelines.forEach(p => {
    if (!p.r2Key) return;
    if (!r2KeyAppMap[p.r2Key]) r2KeyAppMap[p.r2Key] = [];
    if (!r2KeyAppMap[p.r2Key].includes(cfg.label)) {
      r2KeyAppMap[p.r2Key].push(cfg.label);
    }
  });
});

// ── Jobs registry ──────────────────────────────────────────────────────────────
const jobsPath = join(__dirname, 'jobs.json');
let jobs = existsSync(jobsPath) ? JSON.parse(readFileSync(jobsPath, 'utf8')) : [];

// In-memory run history: { [jobId]: { lastRunAt: ISO, exitCode: number } }
const jobHistory = {};

// ── Data fetchers (deduplicated per request) ───────────────────────────────────
async function fetchR2StatusBatch(keys) {
  const out = {};
  await Promise.all(keys.map(async key => {
    try {
      const res = await fetch(`${R2_BASE}/${key}`, { method: 'HEAD' });
      const lastModified = res.headers.get('last-modified');
      out[key] = {
        key,
        shortName: key.split('/').pop(),
        lastModified: lastModified ? new Date(lastModified).toISOString() : null,
        status: res.ok ? 'ok' : 'error',
      };
    } catch (e) {
      out[key] = { key, shortName: key.split('/').pop(), lastModified: null, status: 'error', error: e.message };
    }
  }));
  return out;
}

// ── Express ────────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());

app.get('/', (req, res) => res.sendFile(join(__dirname, 'index.html')));
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/api/jobs', (_req, res) => res.json(jobs));

app.get('/api/status', async (_req, res) => {
  // Collect unique keys across all apps to deduplicate fetches
  const allR2Keys = [...new Set(APP_CONFIGS.flatMap(c => c.pipelines.map(p => p.r2Key).filter(Boolean)))];

  const r2Cache = await fetchR2StatusBatch(allR2Keys);

  const appsOut = APP_CONFIGS.map(cfg => {
    const pipelines = cfg.pipelines.map(p => {
      const r2 = p.r2Key ? r2Cache[p.r2Key] : null;
      const localJobs = (p.localJobIds || []).map(id => jobs.find(j => j.id === id)).filter(Boolean)
        .map(j => ({
          id: j.id, label: j.label, cmd: j.cmd,
          ...(j.windowsTaskNames ? { nextRunAt: getWindowsTaskNextRun(j.windowsTaskNames) } : {}),
          ...(jobHistory[j.id] ? { lastRunAt: jobHistory[j.id].lastRunAt, lastExitCode: jobHistory[j.id].exitCode } : {}),
        }));
      const alsoUsedBy = p.r2Key
        ? (r2KeyAppMap[p.r2Key] || []).filter(l => l !== cfg.label)
        : [];
      return {
        id: p.id,
        label: p.label,
        feeds: p.feeds,
        r2Key: p.r2Key,
        r2,
        localJobs,
        alsoUsedBy,
        stalenessHours: p.stalenessHours ?? null,
        weekdayOnly: p.weekdayOnly ?? false,
        liveNote: p.liveNote ?? null,
        r2Note: p.r2Note ?? null,
      };
    });

    // Overall card status
    function weekendHoursElapsed(iso) {
      if (!iso) return 0;
      let extra = 0;
      const d = new Date(iso);
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() + 1);
      const now = new Date();
      while (d <= now) {
        const day = d.getDay();
        if (day === 0 || day === 6) extra += 24;
        d.setDate(d.getDate() + 1);
      }
      return extra;
    }

    let overallStatus = 'fresh';
    for (const p of pipelines) {
      if (!p.r2 || !p.stalenessHours) continue;
      if (p.r2.status === 'error') { overallStatus = 'error'; break; }
      if (!p.r2.lastModified) continue; // file exists but no timestamp — skip staleness check
      const hrs = (Date.now() - new Date(p.r2.lastModified)) / 3600000;
      const threshold = p.stalenessHours + (p.weekdayOnly ? weekendHoursElapsed(p.r2.lastModified) : 0);
      if (hrs > threshold && overallStatus !== 'error') overallStatus = 'stale';
    }

    return { id: cfg.id, label: cfg.label, description: cfg.description, url: cfg.url, overallStatus, pipelines };
  });

  res.json({ apps: appsOut, fetchedAt: new Date().toISOString() });
});

// ── Preview: first N lines of an R2 file ───────────────────────────────────────
app.get('/api/preview', async (req, res) => {
  try {
    const { source, key } = req.query;
    const n = Math.max(1, Math.min(parseInt(req.query.lines, 10) || 12, 200));
    if (source !== 'r2' || !key) return res.status(400).json({ error: 'bad request: need source=r2&key=' });
    const r = await fetch(`${R2_BASE}/${key}`);
    if (!r.ok) return res.status(502).json({ error: `R2 HTTP ${r.status}` });
    const text = await r.text();
    const all = text.split(/\r?\n/);
    if (all.length && all[all.length - 1] === '') all.pop(); // drop trailing newline
    // Cap line length so single-line JSON blobs (e.g. history.json) stay previewable.
    const lines = all.slice(0, n).map(l => (l.length > 500 ? l.slice(0, 500) + '…' : l));
    res.json({ lines, total: all.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Run a local job, streaming output over SSE ─────────────────────────────────
app.get('/api/run/:jobId', (req, res) => {
  const job = jobs.find(j => j.id === req.params.jobId);
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  const send = obj => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  if (!job) { send({ type: 'exit', text: `\n[no such job: ${req.params.jobId}]\n` }); return res.end(); }
  if (!job.cmd) { send({ type: 'exit', text: `\n[job ${job.id} has no cmd]\n` }); return res.end(); }

  const cwd = resolve(REPO_ROOT, job.cwd || '.');
  send({ type: 'start', text: `$ ${job.cmd}\n` });

  let child;
  try {
    child = spawn(job.cmd, { cwd, shell: true });
  } catch (e) {
    send({ type: 'exit', text: `\n[spawn failed: ${e.message}]\n` });
    return res.end();
  }

  child.stdout.on('data', d => send({ type: 'out', text: d.toString() }));
  child.stderr.on('data', d => send({ type: 'err', text: d.toString() }));
  child.on('error', e => send({ type: 'err', text: `\n[error: ${e.message}]\n` }));
  child.on('close', code => {
    jobHistory[job.id] = { lastRunAt: new Date().toISOString(), exitCode: code };
    send({ type: 'exit', text: `\n[exit ${code}]\n` });
    res.end();
  });

  req.on('close', () => { if (child && !child.killed) child.kill(); });
});

app.listen(PORT, () => console.log(`Dashboard running at http://localhost:${PORT}`));
