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
const GH_OWNER = 'aerokam';
const GH_REPO = 'Treasuries';
const R2_BASE = 'https://pub-ba11062b177640459f72e0a88d0261ae.r2.dev';

const WORKFLOW_LABELS = {
  'get-yields-fedinvest.yml':   'FedInvest yield fetch',
  'fetch-ref-cpi.yml':          'CPI reference fetch',
  'update-ref-cpi-nsa-sa.yml':  'CPI seasonal adjustment update',
  'get-auctions.yml':           'Auction results fetch',
  'fetch-tips-ref.yml':         'TIPS reference metadata fetch',
  'update-yield-history.yml':   'Yield history snapshot',
};

// Cron schedules per workflow (UTC). Multiple entries = multiple triggers; nextRunAt = earliest next.
const WORKFLOW_SCHEDULES = {
  'get-yields-fedinvest.yml':  ['5 18 * * 1-5'],
  'fetch-tips-ref.yml':        ['0 18 * * 1-5'],
  'get-auctions.yml':          ['5 15 * * 1-5', '35 17 * * 1-5'],
  'update-yield-history.yml':  ['0 14 * * 1'],
  'update-ref-cpi-nsa-sa.yml': ['35 13 * * *'],
  'fetch-ref-cpi.yml': [
    '35 13 13 1 *', '35 13 13 2 *', '35 12 11 3 *', '35 12 10 4 *',
    '35 12 12 5 *', '35 12 10 6 *', '35 12 14 7 *', '35 12 12 8 *',
    '35 12 11 9 *', '35 12 14 10 *', '35 13 10 11 *', '35 13 10 12 *',
  ],
};

// Handles patterns used in this repo: fixed minute/hour, optional dom/month/dow filters.
// dow range: n-m; * means any.
function nextCronRun(cronExpr) {
  const [minS, hrS, domS, monS, dowS] = cronExpr.trim().split(/\s+/);
  const minute = parseInt(minS);
  const hour   = parseInt(hrS);
  const months = monS === '*' ? null : new Set(monS.split(',').map(Number));
  const doms   = domS === '*' ? null : new Set(domS.split(',').map(Number));
  let dows = null;
  if (dowS !== '*') {
    dows = new Set();
    dowS.split(',').forEach(part => {
      if (part.includes('-')) {
        const [a, b] = part.split('-').map(Number);
        for (let i = a; i <= b; i++) dows.add(i);
      } else dows.add(parseInt(part));
    });
  }
  const now = new Date();
  for (let offset = 0; offset <= 400; offset++) {
    const d = new Date(Date.UTC(
      now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset,
      hour, minute, 0
    ));
    if (d <= now) continue;
    if (months && !months.has(d.getUTCMonth() + 1)) continue;
    if (doms   && !doms.has(d.getUTCDate()))         continue;
    if (dows   && !dows.has(d.getUTCDay()))          continue;
    return d;
  }
  return null;
}

function nextWorkflowRun(workflow) {
  const schedules = WORKFLOW_SCHEDULES[workflow];
  if (!schedules?.length) return null;
  const runs = schedules.map(s => nextCronRun(s)).filter(Boolean);
  if (!runs.length) return null;
  return runs.reduce((a, b) => (a < b ? a : b)).toISOString();
}

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
// Each pipeline: { id, label, feeds, r2Key, ghWorkflows[], localJobIds[], stalenessHours, liveNote, r2Note }
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
        r2Key: 'Treasuries/YieldsDerivedFromFedInvestPrices.csv',
        ghWorkflows: ['get-yields-fedinvest.yml'],
        localJobIds: ['fedinvest-download'],
        stalenessHours: 24,
        weekdayOnly: true,
      },
      {
        id: 'broker-nominals',
        label: 'Broker quotes — Treasuries',
        feeds: 'Market tab (nominals)',
        r2Key: 'Treasuries/FidelityTreasuries.csv',
        ghWorkflows: [],
        localJobIds: ['fidelity-download', 'upload-fidelity'],
        stalenessHours: 24,
        weekdayOnly: true,
      },
      {
        id: 'broker-tips',
        label: 'Broker quotes — TIPS',
        feeds: 'Market tab (TIPS)',
        r2Key: 'Treasuries/FidelityTips.csv',
        ghWorkflows: [],
        localJobIds: ['fidelity-download', 'upload-fidelity'],
        stalenessHours: 24,
        weekdayOnly: true,
      },
      {
        id: 'cpi-seasonal',
        label: 'CPI seasonal adjustment factors',
        feeds: 'CPI overlay',
        r2Key: 'Treasuries/RefCpiNsaSa.csv',
        ghWorkflows: ['fetch-ref-cpi.yml', 'update-ref-cpi-nsa-sa.yml'],
        localJobIds: [],
        stalenessHours: 720,
        weekdayOnly: true,
      },
      {
        id: 'bond-holidays',
        label: 'SIFMA bond market holidays',
        feeds: 'Business-day calculations',
        r2Key: 'misc/BondHolidaysSifma.csv',
        ghWorkflows: [],
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
        id: 'yield-history',
        label: 'Daily yield history snapshots',
        feeds: 'History charts — 14 symbols',
        r2Key: 'Treasuries/yield-history/US10Y_history.json',
        ghWorkflows: ['update-yield-history.yml'],
        localJobIds: [],
        stalenessHours: 24,
        weekdayOnly: true,
        r2Note: 'US10Y shown as representative; 14 symbol files total',
      },
      {
        id: 'live-yields',
        label: 'Live Treasury yields',
        feeds: 'Live yield display + intraday charts',
        r2Key: null,
        ghWorkflows: [],
        localJobIds: [],
        stalenessHours: null,
        liveNote: 'Browser fetches CNBC GraphQL directly on page load — no job to run',
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
        r2Key: 'Treasuries/YieldsDerivedFromFedInvestPrices.csv',
        ghWorkflows: ['get-yields-fedinvest.yml'],
        localJobIds: [],
        stalenessHours: 24,
        weekdayOnly: true,
      },
      {
        id: 'tips-reference',
        label: 'TIPS reference metadata',
        feeds: 'Coupon + dated-date lookups',
        r2Key: 'Treasuries/TipsRef.csv',
        ghWorkflows: ['fetch-tips-ref.yml'],
        localJobIds: [],
        stalenessHours: 720,
      },
      {
        id: 'cpi-index',
        label: 'Reference CPI index',
        feeds: 'Index ratio calculations',
        r2Key: 'Treasuries/RefCPI.csv',
        ghWorkflows: ['fetch-ref-cpi.yml'],
        localJobIds: [],
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
        ghWorkflows: ['get-auctions.yml'],
        localJobIds: [],
        stalenessHours: 12,
      },
      {
        id: 'upcoming-auctions',
        label: 'Upcoming auctions',
        feeds: 'Calendar view',
        r2Key: null,
        ghWorkflows: [],
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

async function fetchWorkflowStatusBatch(workflows) {
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (process.env.GH_TOKEN) headers['Authorization'] = `Bearer ${process.env.GH_TOKEN}`;
  const out = {};
  await Promise.all(workflows.map(async wf => {
    try {
      const base = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/actions/workflows/${wf}/runs`;
      const [recentRes, successRes] = await Promise.all([
        fetch(`${base}?per_page=1`, { headers }),
        fetch(`${base}?per_page=1&status=success`, { headers }),
      ]);
      if (!recentRes.ok) {
        out[wf] = { workflow: wf, label: WORKFLOW_LABELS[wf] || wf, status: 'error', httpStatus: recentRes.status, nextRunAt: nextWorkflowRun(wf) };
        return;
      }
      const { workflow_runs } = await recentRes.json();
      const run = workflow_runs?.[0];
      if (!run) { out[wf] = { workflow: wf, label: WORKFLOW_LABELS[wf] || wf, status: 'never', nextRunAt: nextWorkflowRun(wf) }; return; }
      let lastSuccessAt = null;
      if (successRes.ok) {
        const { workflow_runs: successRuns } = await successRes.json();
        lastSuccessAt = successRuns?.[0]?.updated_at ?? null;
      }
      out[wf] = {
        workflow: wf,
        label: WORKFLOW_LABELS[wf] || wf,
        status: run.status,
        conclusion: run.conclusion,
        runAt: run.updated_at,
        lastSuccessAt,
        htmlUrl: run.html_url,
        nextRunAt: nextWorkflowRun(wf),
      };
    } catch (e) {
      out[wf] = { workflow: wf, label: WORKFLOW_LABELS[wf] || wf, status: 'error', error: e.message };
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
  // Collect unique keys/workflows across all apps to deduplicate fetches
  const allR2Keys = [...new Set(APP_CONFIGS.flatMap(c => c.pipelines.map(p => p.r2Key).filter(Boolean)))];
  const allWorkflows = [...new Set(APP_CONFIGS.flatMap(c => c.pipelines.flatMap(p => p.ghWorkflows)))];

  const [r2Cache, wfCache] = await Promise.all([
    fetchR2StatusBatch(allR2Keys),
    fetchWorkflowStatusBatch(allWorkflows),
  ]);

  const appsOut = APP_CONFIGS.map(cfg => {
    const pipelines = cfg.pipelines.map(p => {
      const r2 = p.r2Key ? r2Cache[p.r2Key] : null;
      const ghWorkflows = p.ghWorkflows.map(wf => wfCache[wf]).filter(Boolean);
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
        ghWorkflows,
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
      // Error only if no successful run since the last R2 update (same logic as chip display)
      const wfError = p.ghWorkflows.some(wf => {
        if (!p.r2?.lastModified) return wf.conclusion === 'failure';
        return !wf.lastSuccessAt || new Date(wf.lastSuccessAt) < new Date(p.r2.lastModified);
      });
      if (wfError) { overallStatus = 'error'; break; }
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

// Preview: first N lines from a local file or R2 key
app.get('/api/preview', async (req, res) => {
  const lines = Math.min(parseInt(req.query.lines) || 10, 50);
  const { source, path: filePath, key } = req.query;

  if (source === 'local') {
    if (!filePath) return res.status(400).json({ error: 'path required' });
    const absPath = resolve(REPO_ROOT, filePath);
    const rel = relative(REPO_ROOT, absPath);
    if (rel.startsWith('..') || isAbsolute(rel)) return res.status(403).json({ error: 'Invalid path' });
    if (!existsSync(absPath)) return res.status(404).json({ error: 'File not found' });
    try {
      const content = readFileSync(absPath, 'utf8');
      const allLines = content.split('\n');
      return res.json({ lines: allLines.slice(0, lines), total: allLines.length });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (source === 'r2') {
    if (!key) return res.status(400).json({ error: 'key required' });
    try {
      // JSON files: fetch full content, return first array item (or first object prop array item)
      if (key.endsWith('.json')) {
        const r2Res = await fetch(`${R2_BASE}/${key}`);
        if (!r2Res.ok) return res.status(r2Res.status).json({ error: `R2 returned ${r2Res.status}` });
        const parsed = await r2Res.json();
        let preview;
        if (Array.isArray(parsed)) {
          preview = [...parsed.slice(0, 5), ...(parsed.length > 5 ? [`… ${parsed.length - 5} more`] : [])];
        } else if (parsed && typeof parsed === 'object') {
          preview = { ...parsed };
          for (const k of Object.keys(preview)) {
            if (Array.isArray(preview[k]) && preview[k].length > 5) {
              preview[k] = [...preview[k].slice(0, 5), `… ${preview[k].length - 5} more`];
            }
          }
        } else {
          preview = parsed;
        }
        const formatted = JSON.stringify(preview, null, 2);
        return res.json({ lines: formatted.split('\n'), total: null });
      }
      const r2Res = await fetch(`${R2_BASE}/${key}`, { headers: { Range: 'bytes=0-8191' } });
      if (!r2Res.ok) return res.status(r2Res.status).json({ error: `R2 returned ${r2Res.status}` });
      const text = await r2Res.text();
      const allLines = text.split('\n');
      return res.json({ lines: allLines.slice(0, lines), total: null });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  res.status(400).json({ error: 'source must be local or r2' });
});

// Run local job via SSE (GET so EventSource works)
app.get('/api/run/:jobId', (req, res) => {
  const job = jobs.find(j => j.id === req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (type, text) => res.write(`data: ${JSON.stringify({ type, text })}\n\n`);
  send('start', `▶ ${job.label}\n`);

  const cwd = job.cwd ? resolve(REPO_ROOT, job.cwd) : REPO_ROOT;
  const child = spawn(job.cmd, [], { shell: true, cwd });
  child.stdout.on('data', d => send('stdout', d.toString()));
  child.stderr.on('data', d => send('stderr', d.toString()));
  child.on('error', e => send('error', `Error: ${e.message}\n`));
  child.on('close', code => {
    jobHistory[job.id] = { lastRunAt: new Date().toISOString(), exitCode: code };
    send('exit', `\n● Exited with code ${code}\n`);
    res.end();
  });
  req.on('close', () => child.kill());
});

// Trigger GH workflow dispatch
app.post('/api/gh/dispatch/:workflow', async (req, res) => {
  const token = process.env.GH_TOKEN;
  if (!token) return res.status(401).json({ error: 'GH_TOKEN not configured in Dashboard/.env' });
  try {
    const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/actions/workflows/${req.params.workflow}/dispatches`;
    const ghRes = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ ref: 'main' }),
    });
    if (!ghRes.ok) return res.status(ghRes.status).json({ error: await ghRes.text() });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Markdown viewer ────────────────────────────────────────────────────────────
app.get('/knowledge-map', (_req, res) => res.sendFile(join(REPO_ROOT, 'knowledge/KNOWLEDGE_MAP.html')));

app.get('/md/*', (req, res) => {
  const filePath = req.params[0];
  const absPath = resolve(REPO_ROOT, filePath);
  const rel = relative(REPO_ROOT, absPath);
  if (rel.startsWith('..') || isAbsolute(rel) || !filePath.endsWith('.md')) {
    return res.status(403).send('Forbidden');
  }
  if (!existsSync(absPath)) return res.status(404).send('Not found');

  const title = filePath.split('/').pop();
  const body = marked(readFileSync(absPath, 'utf8'));
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0d0d1a;color:#c0c8e0;font-family:'Segoe UI',sans-serif;font-size:14px;line-height:1.7;padding:32px 48px;max-width:900px}
nav{margin-bottom:24px}
nav a{color:#5577cc;text-decoration:none;font-size:12px;letter-spacing:.5px}
nav a:hover{color:#aabbff}
h1,h2,h3,h4{color:#9090ee;margin:1.6em 0 .5em;font-weight:500}
h1{font-size:1.5em;border-bottom:1px solid #1e1e3a;padding-bottom:.4em}
h2{font-size:1.2em}
h3{font-size:1em;color:#7788cc}
p{margin:.7em 0}
a{color:#5577cc}
a:hover{color:#aabbff}
code{background:#141428;color:#aaddaa;padding:1px 5px;border-radius:3px;font-size:.9em}
pre{background:#0a0a1a;border:1px solid #1e1e3a;border-radius:6px;padding:14px 18px;overflow-x:auto;margin:1em 0}
pre code{background:none;padding:0;font-size:.85em;color:#b0c4b0}
table{border-collapse:collapse;width:100%;margin:1em 0;font-size:.9em}
th{background:#141428;color:#8888cc;font-weight:500;text-align:left;padding:8px 12px;border:1px solid #222244}
td{padding:7px 12px;border:1px solid #1a1a32;vertical-align:top}
tr:nth-child(even) td{background:#0f0f22}
blockquote{border-left:3px solid #334;margin:1em 0;padding:.5em 1em;color:#8899aa}
hr{border:none;border-top:1px solid #1e1e3a;margin:2em 0}
ul,ol{padding-left:1.4em;margin:.5em 0}
li{margin:.2em 0}
</style>
</head>
<body>
<nav><a href="/knowledge-map">← Knowledge Map</a></nav>
<main>${body}</main>
<script src="https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js" onerror="void 0"></script>
<script>if(window.mermaid)mermaid.initialize({startOnLoad:true,theme:'dark'})</script>
</body>
</html>`);
});

app.listen(PORT, () => console.log(`Dashboard → http://localhost:${PORT}`));
