// E2E regression tests — guards against GUI breakage (inop buttons, broken table render, drill popups)
// Run: npx playwright test
// Mocks R2 fetches with local data/TipsYields.csv and data/RefCPI.csv

import { test, expect } from 'playwright/test';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FIXTURES = path.join(ROOT, 'tests', 'e2e');
const csv = name => readFileSync(path.join(FIXTURES, name), 'utf8');

// Holdings CSV for rebalance tests (simple 2-col format: cusip,qty)
const HOLDINGS_PATH = path.join(ROOT, 'tests', 'CusipQtyTestLumpy.csv');

test.beforeEach(async ({ page }) => {
  await page.route('**/TIPS/TipsYields.csv', r =>
    r.fulfill({ body: csv('TipsYields.csv'), contentType: 'text/csv' }));
  await page.route('**/TIPS/RefCPI.csv', r =>
    r.fulfill({ body: csv('RefCPI.csv'), contentType: 'text/csv' }));
  // Allow sample pre-populate to succeed (uses local data/CusipQtyTest.csv via serve)
  await page.goto('/');
  // Wait for data load: run button must be enabled
  await expect(page.locator('#run-btn')).not.toBeDisabled({ timeout: 15_000 });
});

// ── 1. Data load ──────────────────────────────────────────────────────────────
test('data loads: info-strip shows settlement date, run button enabled', async ({ page }) => {
  const strip = page.locator('#info-strip');
  await expect(strip).toContainText('Prices as of');
  await expect(strip).toContainText('RefCPI');
  await expect(page.locator('#run-btn')).not.toBeDisabled();
});

// ── 2. Mode toggle ────────────────────────────────────────────────────────────
test('mode toggle: switching to Build hides holdings, shows year fields; run button re-labeled', async ({ page }) => {
  // Start in Rebalance mode
  await expect(page.locator('#run-btn')).toHaveText('Run Rebalance');
  await expect(page.locator('#field-holdings')).toBeVisible();
  await expect(page.locator('#field-last-year')).not.toBeVisible();

  // Switch to Build
  await page.locator('.mode-btn[data-mode="build"]').click();
  await expect(page.locator('#run-btn')).toHaveText('Build Ladder');
  await expect(page.locator('#field-holdings')).not.toBeVisible();
  await expect(page.locator('#field-last-year')).toBeVisible();

  // Switch back to Rebalance
  await page.locator('.mode-btn[data-mode="rebalance"]').click();
  await expect(page.locator('#run-btn')).toHaveText('Run Rebalance');
  await expect(page.locator('#field-holdings')).toBeVisible();
  await expect(page.locator('#field-last-year')).not.toBeVisible();
});

// ── 3. Rebalance run ──────────────────────────────────────────────────────────
test('rebalance: uploading holdings and clicking Run renders table with rows', async ({ page }) => {
  await page.locator('#holdings-file').setInputFiles(HOLDINGS_PATH);
  await page.locator('#run-btn').click();

  // Table must appear with at least one data row (td, not th)
  const table = page.locator('#simple-table');
  await expect(table).toBeVisible({ timeout: 15_000 });
  const rows = table.locator('tbody tr');
  await expect(rows).toHaveCount(await rows.count()); // stabilizes
  expect(await rows.count()).toBeGreaterThan(0);
});

test('rebalance: info-strip shows DARA and rung range after run', async ({ page }) => {
  await page.locator('#holdings-file').setInputFiles(HOLDINGS_PATH);
  await page.locator('#run-btn').click();
  await expect(page.locator('#simple-table tbody tr').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#info-strip')).toContainText('DARA');
  await expect(page.locator('#info-strip')).toContainText('rungs');
});

test('rebalance: net cash value populated after run', async ({ page }) => {
  await page.locator('#holdings-file').setInputFiles(HOLDINGS_PATH);
  await page.locator('#run-btn').click();
  await expect(page.locator('#simple-table tbody tr').first()).toBeVisible({ timeout: 15_000 });
  // net-cash-inline uses CSS display:none with style.display='' override — check content directly
  const val = await page.locator('#net-cash-val').textContent();
  expect(val).toBeTruthy();
});

// ── 4. Build run ──────────────────────────────────────────────────────────────
test('build: selecting last year and clicking Run renders build table', async ({ page }) => {
  await page.locator('.mode-btn[data-mode="build"]').click();
  await expect(page.locator('#run-btn')).toHaveText('Build Ladder');

  // DARA defaults to 10000 in build mode; pick the last available year (ensures range > 1 rung)
  const lastYearSel = page.locator('#last-year');
  const optionCount = await lastYearSel.locator('option').count();
  await lastYearSel.selectOption({ index: optionCount - 1 });

  await page.locator('#run-btn').click();

  // build-output becomes display:block after successful run
  await expect(page.locator('#build-output')).toHaveCSS('display', 'block', { timeout: 15_000 });
  const rows = page.locator('#build-table tbody tr');
  expect(await rows.count()).toBeGreaterThan(0);
});

test('build: maturity preference field visible in Build, hidden in Rebalance', async ({ page }) => {
  await expect(page.locator('#field-build-maturity')).not.toBeVisible();
  await page.locator('.mode-btn[data-mode="build"]').click();
  await expect(page.locator('#field-build-maturity')).toBeVisible();
  await page.locator('.mode-btn[data-mode="rebalance"]').click();
  await expect(page.locator('#field-build-maturity')).not.toBeVisible();
});

test('build: first-to-mature preference runs successfully', async ({ page }) => {
  await page.locator('.mode-btn[data-mode="build"]').click();
  const lastYearSel = page.locator('#last-year');
  const optionCount = await lastYearSel.locator('option').count();
  await lastYearSel.selectOption({ index: optionCount - 1 });
  await page.locator('#build-maturity').selectOption('first');
  await page.locator('#run-btn').click();
  await expect(page.locator('#build-output')).toHaveCSS('display', 'block', { timeout: 15_000 });
  expect(await page.locator('#build-table tbody tr').count()).toBeGreaterThan(0);
});

test('build: pre-ladder interest checkbox visible in Build, hidden in Rebalance', async ({ page }) => {
  await expect(page.locator('#field-pre-ladder')).not.toBeVisible();
  await page.locator('.mode-btn[data-mode="build"]').click();
  await expect(page.locator('#field-pre-ladder')).toBeVisible();
  await page.locator('.mode-btn[data-mode="rebalance"]').click();
  await expect(page.locator('#field-pre-ladder')).not.toBeVisible();
});

test('build: pre-ladder interest zeroes early years and all row amounts stay near DARA', async ({ page }) => {
  // Regression guard: zeroed years must show ~DARA (preLadderCredit + laterMatInt),
  // NOT just laterMatInt (~24k when DARA=100k).
  await page.locator('.mode-btn[data-mode="build"]').click();

  // Pick a firstYear well into the future (~2030) so pool = preLadderYears × annualInt
  // is large enough to zero at least one funded year.
  const firstYearSel = page.locator('#first-year');
  const fyCount = await firstYearSel.locator('option').count();
  const fyIdx = Math.min(5, fyCount - 1); // option ~2030, or last if fewer options
  await firstYearSel.selectOption({ index: fyIdx });

  const lastYearSel = page.locator('#last-year');
  const optionCount = await lastYearSel.locator('option').count();
  await lastYearSel.selectOption({ index: optionCount - 1 });

  await page.locator('#dara').fill('100000');
  await page.locator('#pre-ladder-interest').check();
  await page.locator('#run-btn').click();
  await expect(page.locator('#build-output')).toHaveCSS('display', 'block', { timeout: 15_000 });

  // Info strip must mention zeroed years (confirms pre-ladder path ran with zeroing)
  await expect(page.locator('#info-strip')).toContainText(/zeroed/i);

  // All main-row Amount cells must be ≥ DARA×0.4.
  // Before fix: zeroed rows showed only laterMatInt (~24k) — far below 40k threshold.
  const rows = page.locator('#build-table tbody tr:not(.excess-subrow)');
  const rowCount = await rows.count();
  for (let i = 0; i < rowCount; i++) {
    const amtText = await rows.nth(i).locator('td').nth(3).textContent();
    const amt = parseFloat((amtText ?? '').replace(/[^0-9.-]/g, ''));
    if (!isNaN(amt) && amt > 0) {
      expect(amt, `Row ${i} amount ${amt} is unexpectedly low (pre-ladder credit missing?)`).toBeGreaterThan(40000);
    }
  }
});

// ── 5. Help modal ─────────────────────────────────────────────────────────────
test('help modal: opens on ? button, closes on × button', async ({ page }) => {
  const overlay = page.locator('#help-overlay');
  await expect(overlay).not.toBeVisible();

  await page.locator('#help-btn').click();
  await expect(overlay).toBeVisible();

  await page.locator('#help-close').click();
  await expect(overlay).not.toBeVisible();
});

test('help modal: closes on backdrop click', async ({ page }) => {
  await page.locator('#help-btn').click();
  await expect(page.locator('#help-overlay')).toBeVisible();

  // Click the overlay background (not the inner modal)
  await page.locator('#help-overlay').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('#help-overlay')).not.toBeVisible();
});

// ── 6. Drill popup ────────────────────────────────────────────────────────────
test('drill popup: clicking a drillable cell opens popup, × closes it', async ({ page }) => {
  // Run rebalance to get a table first
  await page.locator('#holdings-file').setInputFiles(HOLDINGS_PATH);
  await page.locator('#run-btn').click();
  await expect(page.locator('#simple-table tbody tr').first()).toBeVisible({ timeout: 15_000 });

  // Click the first drillable cell (td with data-col attribute)
  const drillCell = page.locator('#simple-table tbody td[data-col]').first();
  await expect(drillCell).toBeVisible();
  await drillCell.click();

  await expect(page.locator('#drill-overlay')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('#drill-content')).not.toBeEmpty();

  // Close with × button
  await page.locator('#drill-close').click();
  await expect(page.locator('#drill-overlay')).not.toBeVisible();
});

test('drill popup: closes on backdrop click', async ({ page }) => {
  await page.locator('#holdings-file').setInputFiles(HOLDINGS_PATH);
  await page.locator('#run-btn').click();
  await expect(page.locator('#simple-table tbody tr').first()).toBeVisible({ timeout: 15_000 });

  await page.locator('#simple-table tbody td[data-col]').first().click();
  await expect(page.locator('#drill-overlay')).toBeVisible({ timeout: 5_000 });

  // Click outside the modal (top-left of overlay)
  await page.locator('#drill-overlay').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('#drill-overlay')).not.toBeVisible();
});

// ── 7. Error handling ─────────────────────────────────────────────────────────
test('rebalance: running without holdings file shows status error', async ({ page, context }) => {
  // Block the pre-populate fetch so no sample file is loaded into the input
  await page.route('**/tests/CusipQtyTestLumpy.csv', r => r.abort());
  await page.reload();
  await expect(page.locator('#run-btn')).not.toBeDisabled({ timeout: 15_000 });

  await page.locator('#run-btn').click();
  await expect(page.locator('#status')).toContainText(/holdings|csv|file/i);
});

test('build: running without selecting last year shows status error', async ({ page }) => {
  await page.locator('.mode-btn[data-mode="build"]').click();
  // Clear DARA so we get an error before year check, set it
  await page.locator('#dara').fill('10000');
  // last-year still shows placeholder "Select year…"
  await page.locator('#run-btn').click();
  await expect(page.locator('#status')).toContainText(/year/i);
});
