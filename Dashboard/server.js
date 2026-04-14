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
        id: 'broker-nominals',
        label: 'Broker quotes — Treasuries',
        feeds: 'Market tab (nominals)',
        r2Key: 'Treasuries/FidelityTreasuries.csv',
        localJobIds: ['fidelity-download', 'upload-fidelity'],
        stalenessHours: 24,
        weekdayOnly: true,
      },
      {
        id: 'broker-tips',
        label: 'Broker quotes — TIPS',
        feeds: 'Market tab (TIPS)',
        r2Key: 'Treasuries/FidelityTips.csv',
        localJobIds: ['fidelity-download', 'upload-fidelity'],
        stalenessHours: 24,
        weekdayOnly: true,
      },
      {
        id: 'cpi-seasonal',
        label: 'CPI seasonal adjustment factors',
        feeds: 'CPI overlay',
        r2Key: 'Treasuries/RefCpiNsaSa.csv',
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
        id: 'yield-history',
        label: 'Daily yield history snapshots',
        feeds: 'History charts — 14 symbols',
        r2Key: 'Treasuries/yield-history/US10Y_history.json',
        localJobIds: ['yield-history-snap'],
        stalenessHours: 24,
        weekdayOnly: true,
        r2Note: 'US10Y shown as representative; 14 symbol files total',
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
