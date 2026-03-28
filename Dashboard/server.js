import express from 'express';
import { spawn } from 'child_process';
import { statSync, readdirSync, existsSync, readFileSync } from 'fs';
import { resolve, dirname, join, relative, isAbsolute } from 'path';
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

const PORT = 3737;
const GH_OWNER = 'aerokam';
const GH_REPO = 'Treasuries';
const R2_BASE = 'https://pub-ba11062b177640459f72e0a88d0261ae.r2.dev';

// Human-readable labels for R2 keys
const R2_KEY_LABELS = {
  'Treasuries/Yields.csv':                        'Yields (FedInvest)',  // TODO: confirm display name
  'Treasuries/RefCpiNsaSa.csv':                   'CPI NSA/SA Reference',
  'Treasuries/FidelityTreasuries.csv':            'Fidelity Treasuries',
  'Treasuries/FidelityTips.csv':                  'Fidelity TIPS',
  'Treasuries/Auctions.csv':                      'Treasury Auctions',
  'Treasuries/yield-history/US10Y_history.json':  'Yield History — US10Y (sample)',
};

const APP_CONFIGS = [
  {
    id: 'yieldcurves',
    label: 'YieldCurves',
    description: 'Plots nominal and real yield curves across maturities using FedInvest pricing and Fidelity bond data. Supports CPI overlay and historical range comparisons.',
    url: 'https://aerokam.github.io/Treasuries/YieldCurves/',
    localDataDir: 'YieldCurves/data',
    localFiles: ['Yields.csv', 'RefCpiNsaSa.csv', 'FidelityTreasuries.csv', 'FidelityTips.csv'],
    r2Keys: [
      'Treasuries/Yields.csv',
      'Treasuries/RefCpiNsaSa.csv',
      'Treasuries/FidelityTreasuries.csv',
      'Treasuries/FidelityTips.csv',
    ],
    workflows: ['get-yields-fedinvest.yml', 'fetch-ref-cpi.yml', 'update-ref-cpi-nsa-sa.yml'],
    stalenessHours: 24,
  },
  {
    id: 'yieldsmonitor',
    label: 'YieldsMonitor',
    description: 'Monitors live Treasury yields with snapshot history tracking. Shows current rates and trends across maturities sourced from CNBC.',
    url: 'https://aerokam.github.io/Treasuries/YieldsMonitor/',
    localDataDir: 'YieldsMonitor/data/yield-history',
    r2Keys: [
      'Treasuries/Yields.csv',
      'Treasuries/yield-history/US10Y_history.json',
    ],
    workflows: ['get-yields-fedinvest.yml', 'update-yield-history.yml'],
    stalenessHours: 24,
  },
  {
    id: 'tipsladder',
    label: 'TipsLadderManager',
    description: 'Builds and manages a TIPS bond ladder using current real yields and Fidelity inventory data.',
    url: 'https://aerokam.github.io/Treasuries/TipsLadderManager/',
    localDataDir: null,
    r2Keys: ['Treasuries/Yields.csv'],
    workflows: ['fetch-tips-ref.yml'],
    stalenessHours: 24,
  },
  {
    id: 'auctions',
    label: 'TreasuryAuctions',
    description: 'Tracks upcoming and recent Treasury auction announcements, results, and bid statistics.',
    url: 'https://aerokam.github.io/Treasuries/TreasuryAuctions/',
    localDataDir: null,
    r2Keys: ['Treasuries/Auctions.csv'],
    workflows: ['get-auctions.yml'],
    stalenessHours: 12,
  },
];

const WORKFLOW_LABELS = {
  'get-yields-fedinvest.yml':   'Get Yields (FedInvest)',
  'fetch-ref-cpi.yml':          'Fetch Ref CPI',
  'update-ref-cpi-nsa-sa.yml':  'Update CPI NSA/SA',
  'get-auctions.yml':           'Get Auctions',
  'fetch-tips-ref.yml':         'Fetch TIPS Ref',
  'update-yield-history.yml':   'Update Yield History',
};

// Precompute which apps each workflow belongs to (for "shared" detection)
const workflowAppMap = {};
APP_CONFIGS.forEach(cfg => {
  cfg.workflows.forEach(wf => {
    if (!workflowAppMap[wf]) workflowAppMap[wf] = [];
    workflowAppMap[wf].push({ id: cfg.id, label: cfg.label });
  });
});

// ── Jobs registry ──────────────────────────────────────────────────────────────
const jobsPath = join(__dirname, 'jobs.json');
let jobs = existsSync(jobsPath) ? JSON.parse(readFileSync(jobsPath, 'utf8')) : [];

// ── Status helpers ─────────────────────────────────────────────────────────────
function getLocalStatus(app) {
  if (!app.localDataDir) return null;
  const dir = join(REPO_ROOT, app.localDataDir);
  if (!existsSync(dir)) return { error: 'dir not found' };
  try {
    const names = app.localFiles
      ? app.localFiles
      : readdirSync(dir).filter(f => f.endsWith('.csv') || f.endsWith('.json'));
    const files = names
      .map(f => {
        try {
          const { mtime } = statSync(join(dir, f));
          return {
            name: f,
            label: R2_KEY_LABELS['Treasuries/' + f] || f,
            path: (app.localDataDir + '/' + f).replace(/\\/g, '/'),
            mtime: mtime.toISOString(),
          };
        } catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => b.mtime.localeCompare(a.mtime));
    return { files, latestMtime: files[0]?.mtime ?? null };
  } catch (e) {
    return { error: e.message };
  }
}

async function getR2Status(r2Keys) {
  return Promise.all(r2Keys.map(async key => {
    try {
      const res = await fetch(`${R2_BASE}/${key}`, { method: 'HEAD' });
      const lastModified = res.headers.get('last-modified');
      return {
        key,
        label: R2_KEY_LABELS[key] || key.split('/').pop(),
        shortName: key.split('/').pop(),
        lastModified: lastModified ? new Date(lastModified).toISOString() : null,
        status: res.ok ? 'ok' : 'error',
      };
    } catch (e) {
      return {
        key,
        label: R2_KEY_LABELS[key] || key.split('/').pop(),
        shortName: key.split('/').pop(),
        lastModified: null,
        status: 'error',
        error: e.message,
      };
    }
  }));
}

async function getWorkflowStatus(workflows, currentAppId) {
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (process.env.GH_TOKEN) headers['Authorization'] = `Bearer ${process.env.GH_TOKEN}`;
  return Promise.all(workflows.map(async workflow => {
    const sharedWith = (workflowAppMap[workflow] || [])
      .filter(a => a.id !== currentAppId)
      .map(a => a.label);
    try {
      const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/actions/workflows/${workflow}/runs?per_page=1`;
      const res = await fetch(url, { headers });
      if (!res.ok) return { workflow, label: WORKFLOW_LABELS[workflow] || workflow, status: 'error', httpStatus: res.status, sharedWith };
      const { workflow_runs } = await res.json();
      const run = workflow_runs?.[0];
      if (!run) return { workflow, label: WORKFLOW_LABELS[workflow] || workflow, status: 'never', sharedWith };
      return {
        workflow,
        label: WORKFLOW_LABELS[workflow] || workflow,
        status: run.status,
        conclusion: run.conclusion,
        runAt: run.updated_at,
        runId: run.id,
        htmlUrl: run.html_url,
        sharedWith,
      };
    } catch (e) {
      return { workflow, label: WORKFLOW_LABELS[workflow] || workflow, status: 'error', error: e.message, sharedWith };
    }
  }));
}

// ── Express ────────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());

app.get('/', (req, res) => res.sendFile(join(__dirname, 'index.html')));
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/api/jobs', (_req, res) => res.json(jobs));

app.get('/api/status', async (_req, res) => {
  const apps = await Promise.all(APP_CONFIGS.map(async cfg => ({
    id: cfg.id,
    label: cfg.label,
    description: cfg.description,
    url: cfg.url,
    stalenessHours: cfg.stalenessHours,
    local: getLocalStatus(cfg),
    r2: await getR2Status(cfg.r2Keys),
    workflows: await getWorkflowStatus(cfg.workflows, cfg.id),
    localJobs: jobs.filter(j => j.apps && j.apps.includes(cfg.id)),
  })));
  res.json({ apps, fetchedAt: new Date().toISOString() });
});

// Preview: first N lines from a local file or R2 key
app.get('/api/preview', async (req, res) => {
  const lines = Math.min(parseInt(req.query.lines) || 10, 50);
  const { source, path: filePath, key } = req.query;

  if (source === 'local') {
    if (!filePath) return res.status(400).json({ error: 'path required' });
    const absPath = resolve(REPO_ROOT, filePath);
    const rel = relative(REPO_ROOT, absPath);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      return res.status(403).json({ error: 'Invalid path' });
    }
    if (!existsSync(absPath)) return res.status(404).json({ error: 'File not found' });
    try {
      const content = readFileSync(absPath, 'utf8');
      const allLines = content.split('\n');
      return res.json({
        lines: allLines.slice(0, lines),
        total: allLines.length,
        type: absPath.endsWith('.json') ? 'json' : 'csv',
      });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (source === 'r2') {
    if (!key) return res.status(400).json({ error: 'key required' });
    try {
      const r2Res = await fetch(`${R2_BASE}/${key}`, {
        headers: { Range: 'bytes=0-8191' }, // first 8 KB
      });
      if (!r2Res.ok) return res.status(r2Res.status).json({ error: `R2 returned ${r2Res.status}` });
      const text = await r2Res.text();
      const allLines = text.split('\n');
      return res.json({
        lines: allLines.slice(0, lines),
        total: null,
        type: key.endsWith('.json') ? 'json' : 'csv',
      });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  res.status(400).json({ error: 'source must be local or r2' });
});

// Run local job via SSE
app.post('/api/run/:jobId', (req, res) => {
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

app.listen(PORT, () => console.log(`Dashboard → http://localhost:${PORT}`));
