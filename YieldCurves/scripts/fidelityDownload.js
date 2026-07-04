import { chromium } from 'playwright';
import { spawn, spawnSync } from 'child_process';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

// Skip runs on weekends and bond market holidays
const todayET = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const dayET = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'America/New_York' }).format(new Date());
if (dayET === 'Sat' || dayET === 'Sun') {
  console.log(`Skipping run: Weekend (${dayET}) in ET.`);
  process.exit(0);
}

try {
  const holidayRes = await fetch('https://pub-ba11062b177640459f72e0a88d0261ae.r2.dev/misc/BondHolidaysSifma.csv');
  if (holidayRes.ok) {
    const holidayText = await holidayRes.text();
    const holidays = new Set(
      holidayText.trim().split('\n')
        .map(line => {
          const m = line.match(/"[^,]+,\s+(\w+ \d+, \d{4})"/);
          if (!m) return null;
          const d = new Date(m[1]);
          return isNaN(d) ? null : d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
        })
        .filter(Boolean)
    );
    if (holidays.has(todayET)) {
      console.log(`Skipping run: Bond market holiday (${todayET}).`);
      process.exit(0);
    }
  }
} catch (e) {
  console.error('Failed to fetch holiday calendar, proceeding with run:', e.message);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const jitter = (min, max) => sleep(min + Math.random() * (max - min));

const CHROME_EXE = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CHROME_PROFILE = path.join(__dirname, '../.chrome-profile');
const DOWNLOADS_DIR = path.join(os.homedir(), 'Downloads');
const LOGIN_URL = 'https://digital.fidelity.com/prgw/digital/signin/retail';
const SEARCH_URL = 'https://digital.fidelity.com/ftgw/digital/finewexp/secondaries';
const DEBUG_PORT = 9222;
const DOWNLOAD_FILENAME = 'FidelityTreasuriesTips.csv';
const PHONE_LINK_OTP_SCRIPT = path.join(__dirname, 'readPhoneLinkOtp.ps1');
const PHONE_LINK_OTP_TIMEOUT_SEC = 90;

function getPhoneLinkOtpBaseline() {
  const res = spawnSync('powershell', ['-NoProfile', '-File', PHONE_LINK_OTP_SCRIPT, '-Mode', 'baseline'], { encoding: 'utf8' });
  return (res.stdout || '').trim();
}

function waitForPhoneLinkOtp(baseline) {
  const res = spawnSync(
    'powershell',
    ['-NoProfile', '-File', PHONE_LINK_OTP_SCRIPT, '-Mode', 'wait', '-Baseline', baseline, '-TimeoutSec', String(PHONE_LINK_OTP_TIMEOUT_SEC)],
    { encoding: 'utf8', timeout: (PHONE_LINK_OTP_TIMEOUT_SEC + 15) * 1000 }
  );
  const code = (res.stdout || '').trim();
  if (res.status !== 0 || !/^\d{6}$/.test(code)) {
    throw new Error(`Phone Link OTP read failed: ${res.stderr || 'no code received within timeout'}`);
  }
  return code;
}

// Fidelity's Okta-style verify flow defaults to a push notification to the mobile
// app, which nobody is around to approve on the unattended 5 AM run. Switch to SMS
// and read the code from Phone Link (paired to the account owner's phone) via
// Windows UI Automation — see readPhoneLinkOtp.ps1.
async function completeSmsChallenge(page) {
  const tryAnotherWay = page.getByText('Try another way', { exact: true });
  await tryAnotherWay.waitFor({ timeout: 20_000 });
  await tryAnotherWay.click();

  const textMeButton = page.getByText('Text me the code', { exact: true });
  await textMeButton.waitFor({ timeout: 15_000 });

  const baseline = getPhoneLinkOtpBaseline();
  await textMeButton.click();
  console.log('Requested SMS code, reading Phone Link...');
  const code = waitForPhoneLinkOtp(baseline);
  console.log('Got OTP from Phone Link.');

  const codeInput = page.getByLabel('Security code');
  await codeInput.fill(code);

  const rememberCheckbox = page.getByRole('checkbox', { name: 'Remember this device' });
  if (await rememberCheckbox.isVisible().catch(() => false) && !(await rememberCheckbox.isChecked())) {
    await rememberCheckbox.check();
  }

  await page.getByText('Submit', { exact: true }).click();

  await page.waitForFunction(
    () => !location.href.includes('/signin/') && !location.href.includes('/login/'),
    null,
    { timeout: 30_000 }
  );
}

// Safety net if the automated click-through above doesn't match what's on screen
// (Fidelity changed the flow, Phone Link unreachable, etc.) — wait for a human to
// finish it manually, dumping page state so the new flow can be inspected after.
async function waitForManualLogin(page) {
  const debugDir = path.join(__dirname, '../logs/mfa-debug');
  const deadline = Date.now() + 300_000;
  let dumped = false;
  while (Date.now() < deadline) {
    const url = page.url();
    if (!url.includes('/signin/') && !url.includes('/login/')) return;
    if (!dumped) {
      console.log('Waiting for manual login completion. Dumping page state to logs/mfa-debug/...');
      dumped = true;
    }
    try {
      await fs.mkdir(debugDir, { recursive: true });
      await fs.writeFile(path.join(debugDir, 'latest.html'), await page.content());
      await page.screenshot({ path: path.join(debugDir, 'latest.png'), fullPage: true });
      await fs.writeFile(path.join(debugDir, 'latest-url.txt'), `${new Date().toISOString()}\n${url}\n`);
    } catch (e) {
      console.error('Debug dump failed:', e.message);
    }
    await sleep(5000);
  }
  throw new Error('Timed out waiting for login to complete (MFA challenge?)');
}

async function ensureLoggedIn(page) {
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });

  if (!page.url().includes('/signin/') && !page.url().includes('/login/')) {
    console.log('Session active.');
    return;
  }

  console.log('Logging in...');
  await page.waitForSelector('#dom-username-input', { timeout: 15_000 });
  await page.fill('#dom-username-input', process.env.FIDELITY_USERNAME);
  await page.waitForSelector('#dom-pswd-input:not([disabled])', { timeout: 10_000 });
  await page.fill('#dom-pswd-input', process.env.FIDELITY_PASSWORD);
  await page.click('#dom-login-button');

  try {
    await completeSmsChallenge(page);
    console.log('Logged in.');
    return;
  } catch (e) {
    console.error('Automated MFA handling failed, falling back to manual wait:', e.message);
  }

  await waitForManualLogin(page);
  console.log('Logged in.');
}

async function downloadCombined(page) {
  console.log('Navigating to Fixed Income secondary market page...');
  await page.goto(SEARCH_URL, { waitUntil: 'domcontentloaded' });

  // Click the Product type filter button
  console.log('Selecting product types (Treasury + TIPS)...');
  await page.getByRole('button', { name: /product type/i }).click();
  await jitter(500, 1000);

  // Click checkbox labels via evaluate(). The pvd-checkbox web component updates its
  // pvd-checked attribute when label.click() fires (confirmed: Treasury/TIPS become "true").
  await page.evaluate(() => {
    document.querySelectorAll('label').forEach(lbl => {
      const text = lbl.textContent.trim().toLowerCase();
      if (text === 'treasury' || text === 'tips') {
        const inputId = lbl.getAttribute('for');
        const input = inputId ? document.getElementById(inputId) : lbl.querySelector('input');
        if (input && !input.checked) lbl.click();
      }
    });
  });
  await jitter(600, 900);

  // Product type filter Apply button id = "secondary-product-apply-filter".
  // It starts visibility:hidden; forcing visible lets page.mouse.click() reach it.
  const applyCoords = await page.evaluate(() => {
    const btn = document.getElementById('secondary-product-apply-filter');
    if (!btn) return null;
    btn.style.visibility = 'visible';
    const r = btn.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width };
  });
  if (applyCoords && applyCoords.w > 0) {
    await page.mouse.click(applyCoords.x, applyCoords.y);
  } else {
    await page.evaluate(() => document.getElementById('secondary-product-apply-filter').click());
  }

  await page.waitForSelector('#secondary-product-type-filter-modal', { state: 'hidden', timeout: 15_000 });

  // Wait for "Product type (2)" on the filter button — this confirms the filter was
  // accepted by Angular (not just the modal closing for an unrelated reason).
  await page.waitForFunction(() => {
    const btn = document.getElementById('product-type-filter-web-view');
    return btn && btn.textContent.includes('(2)');
  }, null, { timeout: 30_000 });
  console.log('Filter applied, waiting for results...');

  // Fixed wait for results to render — pagination means row-count checks aren't reliable.
  await jitter(4000, 6000);

  // Set up download intercept before the click that triggers it
  const downloadPromise = page.waitForEvent('download', { timeout: 45_000 });

  // Click the three-dot "Menu" button. Its ID matches menu-*-trigger.
  // Use evaluate() + page.mouse.click() — same pattern that worked for Apply.
  console.log('Opening download menu...');
  const menuCoords = await page.evaluate(() => {
    const btn = document.querySelector('button[aria-haspopup="true"][id*="-trigger"]');
    if (!btn) return null;
    btn.scrollIntoView({ block: 'center' });
    const r = btn.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width };
  });
  if (menuCoords && menuCoords.w > 0) {
    await page.mouse.click(menuCoords.x, menuCoords.y);
  } else {
    await page.locator('button[aria-haspopup="true"][id*="-trigger"]').click({ timeout: 10_000 });
  }
  await jitter(400, 800);

  // Click Download Offerings menuitem
  await page.locator('[role="menuitem"]').filter({ hasText: /download offerings/i }).click({ timeout: 10_000 });

  const download = await downloadPromise;
  const savePath = path.join(DOWNLOADS_DIR, DOWNLOAD_FILENAME);
  await download.saveAs(savePath);
  console.log(`Saved: ${savePath}`);
}

async function runUpload() {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.join(__dirname, 'uploadFidelityDownload.js')],
      { stdio: 'inherit' }
    );
    child.on('close', code =>
      code === 0 ? resolve() : reject(new Error(`Upload script exited with code ${code}`))
    );
  });
}

// Patch Chrome's Preferences to mark the last exit as clean.
const profileDefault = path.join(CHROME_PROFILE, 'Default');
const prefsPath = path.join(profileDefault, 'Preferences');
try {
  const prefsRaw = await fs.readFile(prefsPath, 'utf8');
  const prefs = JSON.parse(prefsRaw);
  if (!prefs.profile) prefs.profile = {};
  prefs.profile.exit_type = 'Normal';
  prefs.profile.exited_cleanly = true;
  await fs.writeFile(prefsPath, JSON.stringify(prefs));
} catch { /* profile not yet created — fine */ }

// Launch real Chrome and connect via CDP
const chrome = spawn(CHROME_EXE, [
  `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${CHROME_PROFILE}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-save-password-bubble',
  '--disable-session-crashed-bubble',
], { detached: false });

chrome.on('error', err => { console.error('Chrome spawn error:', err); process.exit(1); });
console.log('Chrome launched, pid:', chrome.pid);
await sleep(2000);

const browser = await chromium.connectOverCDP(`http://localhost:${DEBUG_PORT}`);
const context = browser.contexts()[0];
const page = context.pages()[0] ?? await context.newPage();

try {
  await ensureLoggedIn(page);
  await downloadCombined(page);

  console.log('\nUploading to R2...');
  await runUpload();
  console.log('Done.');
} finally {
  await browser.close();
  let chromeClosed = false;
  await Promise.race([
    new Promise(resolve => chrome.on('close', () => { chromeClosed = true; resolve(); })),
    sleep(4000),
  ]);
  if (!chromeClosed) chrome.kill();
}
