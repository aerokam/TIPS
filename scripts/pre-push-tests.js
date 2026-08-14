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

import { execFileSync, spawn } from 'child_process';
import { readFileSync, appendFileSync } from 'fs';
import path from 'path';

const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel']).toString().trim();
const ZERO = '0000000000000000000000000000000000000000';

// A real test failure (a red assertion) exits with a small code, almost always 1. Two other cases
// get a single retry instead of an immediate block, because neither is the kind of "probably
// non-critical" regression the no-override rule (2026-07-25) exists to stop -- both are caused by
// the machine, not the code:
//   - a process-level crash: Playwright's Chromium dying under Windows with an OS exception code
//     like 3221226505 (0xC0000409) before any test even ran. Exit code is huge (>255) instead of 1.
//   - a load-induced timeout: the automated Fidelity-download pipeline (Sheets write, git commit,
//     fixture regen, this very test run) runs several CPU-heavy steps back to back, and a test can
//     occasionally race its own timeout budget under that contention even though it's correct --
//     confirmed 2026-08-13 when a "failed" e2e test passed standalone in 474ms against a 4000ms
//     budget. Exit code is a normal 1, but Playwright's own output names it as a timeout.
// A genuine assertion failure (wrong value, wrong element state) is never retried or overridden.
// Both retry cases are logged so a recurring pattern is visible even though Windows isn't producing
// a crash dump for the crash case.
const CRASH_EXIT_THRESHOLD = 255;
const TIMEOUT_PATTERN = /(test timeout of \d+ms exceeded|timeout \d+ms exceeded)/i;
const CRASH_LOG = path.join(ROOT, '.git', 'pre-push-crash-log.txt');

function logRetry(dir, script, status, reason) {
  try { appendFileSync(CRASH_LOG, `${new Date().toISOString()} ${dir} "${script}" exit=${status} reason=${reason}\n`); } catch {}
}

// spawn (not spawnSync) so output can be mirrored live to the console AND captured for the
// timeout-signature check above -- spawnSync with stdio:'inherit' streams live but can't be
// inspected; with stdio:'pipe' it can be inspected but only prints after the process exits.
function runNpmScript(cwd, script) {
  return new Promise((resolve) => {
    const child = spawn('npm', ['run', script], { cwd, shell: true });
    let output = '';
    child.stdout.on('data', (d) => { process.stdout.write(d); output += d; });
    child.stderr.on('data', (d) => { process.stderr.write(d); output += d; });
    child.on('close', (status) => resolve({ status, output }));
  });
}

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
    let res = await runNpmScript(cwd, script);

    if (res.status !== 0) {
      const isCrash = res.status > CRASH_EXIT_THRESHOLD;
      const isTimeout = !isCrash && TIMEOUT_PATTERN.test(res.output);

      if (isCrash || isTimeout) {
        const reason = isCrash ? 'crash' : 'timeout';
        console.error(`pre-push: ${dir} "${script}" ${isCrash ? 'crashed' : 'timed out'} (exit ${res.status}, not an assertion failure) -- retrying once.`);
        logRetry(dir, script, res.status, reason);
        res = await runNpmScript(cwd, script);
        if (res.status !== 0) logRetry(dir, script, res.status, `${reason}-retry-failed`);
      }
    }

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
