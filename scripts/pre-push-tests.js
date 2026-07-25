// pre-push gate: runs each pushed-to project's test suite(s) and blocks the push on any failure.
// Wired via .githooks/pre-push (core.hooksPath .githooks). See Treasuries/CLAUDE.md.
//
// Standing rule (2026-07-25, after the runFundedRebalance self-financing-scale regression shipped
// unnoticed for 9 days): a red test is never "probably non-critical" -- it gets fixed (the code, or
// the test's own expectation, with a reason) before anything leaves this machine. No allowlist, no
// env-var skip. The only override is git's native `--no-verify`, which is always available outside
// this script's control and requires deliberately typing it every push.
//
// Only runs a project's suite(s) if this push actually touches that project's directory, so a
// Primer-only push doesn't pay for TipsLadderManager/YieldCurves test time.

import { execFileSync, spawnSync } from 'child_process';
import { readFileSync } from 'fs';
import path from 'path';

const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel']).toString().trim();
const ZERO = '0000000000000000000000000000000000000000';

// Projects with a test suite this hook knows how to run, keyed by top-level directory name.
const PROJECTS = {
  TipsLadderManager: ['test', 'test:e2e'],
  YieldCurves: ['test:e2e'],
};

function changedTopLevelDirs(range) {
  const out = execFileSync('git', ['diff', '--name-only', ...range], { cwd: ROOT }).toString();
  const dirs = new Set();
  for (const line of out.split('\n')) {
    const top = line.split('/')[0];
    if (top) dirs.add(top);
  }
  return dirs;
}

function readStdin() {
  try { return readFileSync(0, 'utf8'); } catch { return ''; }
}

const stdinText = readStdin();
const lines = stdinText.split('\n').map(l => l.trim()).filter(Boolean);

let touchedDirs = new Set();
if (lines.length === 0) {
  // No refs on stdin (unusual) -- be conservative and check everything with tests.
  touchedDirs = new Set(Object.keys(PROJECTS));
} else {
  for (const line of lines) {
    const [, localSha, , remoteSha] = line.split(' ');
    if (!localSha || localSha === ZERO) continue; // deleting a ref -- nothing to test
    if (!remoteSha || remoteSha === ZERO) {
      // Brand-new remote ref (first push of a new branch) -- no prior remote state to diff
      // against, so there's no sound way to scope this to "what's touched". Be conservative
      // and just check every project with a test suite.
      for (const p of Object.keys(PROJECTS)) touchedDirs.add(p);
      continue;
    }
    try {
      for (const d of changedTopLevelDirs([remoteSha, localSha])) touchedDirs.add(d);
    } catch {
      // Couldn't diff (e.g. remoteSha unknown locally) -- be conservative.
      for (const p of Object.keys(PROJECTS)) touchedDirs.add(p);
    }
  }
}

const toRun = Object.entries(PROJECTS).filter(([dir]) => touchedDirs.has(dir));
if (toRun.length === 0) {
  console.log('pre-push: no test-covered project changed, skipping.');
  process.exit(0);
}

let failed = false;
for (const [dir, scripts] of toRun) {
  const cwd = path.join(ROOT, dir);
  for (const script of scripts) {
    console.log(`\npre-push: running ${dir} -> npm run ${script}`);
    const res = spawnSync('npm', ['run', script], { cwd, stdio: 'inherit', shell: true });
    if (res.status !== 0) {
      console.error(`pre-push: ${dir} "${script}" FAILED.`);
      failed = true;
    }
  }
}

if (failed) {
  console.error('\npre-push BLOCKED: fix the failing test (code or the test itself) before pushing.');
  console.error('Emergency override (use deliberately, not by default): git push --no-verify');
  process.exit(1);
}

console.log('\npre-push: all test-covered projects passed.');
process.exit(0);
