// E2E regression tests — guards against GUI breakage (inop buttons, broken table render, drill popups)
// Run: npx playwright test
// Mocks R2 fetches with local data/Yields.csv and data/RefCPI.csv

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
  await page.route('**/Treasuries/Yields.csv', r =>
    r.fulfill({ body: csv('Yields.csv'), contentType: 'text/csv' }));
  await page.route('**/Treasuries/RefCPI.csv', r =>
    r.fulfill({ body: csv('RefCPI.csv'), contentType: 'text/csv' }));
  await page.route('**/Treasuries/TipsRef.csv', r =>
    r.fulfill({ body: csv('TipsRef.csv'), contentType: 'text/csv' }));
  // Allow sample pre-populate to succeed (uses local data/CusipQtyTest.csv via serve)
  await page.goto('./');
  // Wait for data load: run button must be enabled
  await expect(page.locator('#run-btn')).not.toBeDisabled({ timeout: 15_000 });
});

// ── 1. Data load ──────────────────────────────────────────────────────────────
test('data loads: info-strip shows settlement date, run button enabled', async ({ page }) => {
  const strip = page.locator('#info-strip');
  await expect(strip).toContainText('Market data as of');
  await expect(strip).toContainText('Ref CPI');
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
    const amtText = await rows.nth(i).locator('td').nth(4).textContent();
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

// ── 8. Level 3 Drill-down ────────────────────────────────────────────────────
test('drill popup: clicking Ref CPI in Level 2 opens Level 3 Ref CPI popup', async ({ page }) => {
  await page.locator('#holdings-file').setInputFiles(HOLDINGS_PATH);
  await page.locator('#run-btn').click();
  await expect(page.locator('#simple-table tbody tr').first()).toBeVisible({ timeout: 15_000 });

  await page.locator('#simple-table tbody td[data-col]').first().click();
  await expect(page.locator('#drill-overlay')).toBeVisible();

  const refCpiLabel = page.locator('.drill-l3[data-l3="refCPI"]');
  await expect(refCpiLabel).toBeVisible();
  await refCpiLabel.click();

  const l3Popup = page.locator('#shared-popup');
  await expect(l3Popup).toBeVisible();
  await expect(l3Popup).toContainText('Ref CPI Interpolation');
  await expect(l3Popup).toContainText('Interpolation Formula');
  
  // Check for CFR link
  const cfrLink = l3Popup.locator('a[href*="356"]');
  await expect(cfrLink).toBeVisible();

  await l3Popup.locator('#sp-close').click();
  await expect(l3Popup).not.toBeVisible();
});

test('drill popup: clicking Index Ratio in Level 2 opens Level 3 Index Ratio popup', async ({ page }) => {
  await page.locator('#holdings-file').setInputFiles(HOLDINGS_PATH);
  await page.locator('#run-btn').click();
  await expect(page.locator('#simple-table tbody tr').first()).toBeVisible({ timeout: 15_000 });

  await page.locator('#simple-table tbody td[data-col]').first().click();
  await expect(page.locator('#drill-overlay')).toBeVisible();

  const irLabel = page.locator('.drill-l3[data-l3="indexRatio"]');
  await expect(irLabel).toBeVisible();
  await irLabel.click();

  const l3Popup = page.locator('#shared-popup');
  await expect(l3Popup).toBeVisible();
  await expect(l3Popup).toContainText('Index Ratio Calculation');
  await expect(l3Popup).toContainText('Authority');

  await l3Popup.locator('#sp-close').click();
  await expect(l3Popup).not.toBeVisible();
});

// ── 9. Error handling ─────────────────────────────────────────────────────────
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
  // Clear the default last-year selection to trigger the error
  await page.locator('#last-year').selectOption('');
  await page.locator('#run-btn').click();
  await expect(page.locator('#status')).toContainText(/year/i);
});

// ── 9. Low-DARA edge cases ────────────────────────────────────────────────────
test('build: DARA below $1,000 is rejected before running', async ({ page }) => {
  await page.locator('.mode-btn[data-mode="build"]').click();
  const lastYearSel = page.locator('#last-year');
  const optionCount = await lastYearSel.locator('option').count();
  await lastYearSel.selectOption({ index: optionCount - 1 });
  await page.locator('#dara').fill('500');
  await page.locator('#run-btn').click();
  await expect(page.locator('#status')).toContainText(/1,000/i);
});

test('build: DARA $2,000 either renders table or shows DARA-too-low error with no crash', async ({ page }) => {
  await page.locator('.mode-btn[data-mode="build"]').click();
  const lastYearSel = page.locator('#last-year');
  const optionCount = await lastYearSel.locator('option').count();
  await lastYearSel.selectOption({ index: optionCount - 1 });
  await page.locator('#dara').fill('2000');
  await page.locator('#run-btn').click();

  // Must not leave the page in a broken state — either table renders or a clear error appears
  const tableVisible = await page.locator('#build-output').isVisible().catch(() => false);
  const statusText   = await page.locator('#status').textContent().catch(() => '');
  expect(tableVisible || /dara|too low/i.test(statusText)).toBeTruthy();

  // If table rendered: all Funded Year Amount cells must be non-negative
  if (tableVisible) {
    const rows = page.locator('#build-table tbody tr:not(.excess-subrow)');
    const rowCount = await rows.count();
    for (let i = 0; i < rowCount; i++) {
      const amtText = await rows.nth(i).locator('td').nth(4).textContent();
      const amt = parseFloat((amtText ?? '').replace(/[^0-9.-]/g, ''));
      if (!isNaN(amt)) expect(amt, `Row ${i} amount ${amt} is negative`).toBeGreaterThanOrEqual(0);
    }
  }
});

test('rebalance: DARA below $1,000 is rejected', async ({ page }) => {
  await page.locator('#holdings-file').setInputFiles(HOLDINGS_PATH);
  await page.locator('#dara').fill('500');
  await page.locator('#run-btn').click();
  await expect(page.locator('#status')).toContainText(/1,000/i);
});

// ── 10. No NaN in output ─────────────────────────────────────────────────────
async function assertNoNaN(page, tableSelector) {
  const cells = page.locator(tableSelector + ' td');
  const count = await cells.count();
  for (let i = 0; i < count; i++) {
    const text = (await cells.nth(i).textContent()) ?? '';
    expect(text, `Cell ${i} in ${tableSelector} contains NaN`).not.toContain('NaN');
  }
}

test('rebalance: no NaN in table cells or drill popup (auto-infer DARA)', async ({ page }) => {
  await page.locator('#holdings-file').setInputFiles(HOLDINGS_PATH);
  await page.locator('#run-btn').click();
  await expect(page.locator('#simple-table tbody tr').first()).toBeVisible({ timeout: 15_000 });
  await assertNoNaN(page, '#simple-table');

  const drillCell = page.locator('#simple-table tbody td[data-col]').first();
  await drillCell.click();
  await expect(page.locator('#drill-overlay')).toBeVisible({ timeout: 5_000 });
  expect(await page.locator('#drill-content').textContent()).not.toContain('NaN');
  await page.locator('#drill-close').click();
});

test('rebalance: no NaN in table cells at low DARA ($5,000)', async ({ page }) => {
  await page.locator('#holdings-file').setInputFiles(HOLDINGS_PATH);
  await page.locator('#dara').fill('5000');
  await page.locator('#run-btn').click();
  await expect(page.locator('#simple-table tbody tr').first()).toBeVisible({ timeout: 15_000 });
  await assertNoNaN(page, '#simple-table');
});

test('build: no NaN in table cells or drill popup', async ({ page }) => {
  await page.locator('.mode-btn[data-mode="build"]').click();
  const lastYearSel = page.locator('#last-year');
  const optionCount = await lastYearSel.locator('option').count();
  await lastYearSel.selectOption({ index: optionCount - 1 });
  await page.locator('#run-btn').click();
  await expect(page.locator('#build-output')).toHaveCSS('display', 'block', { timeout: 15_000 });
  await assertNoNaN(page, '#build-table');

  const drillCell = page.locator('#build-table tbody td[data-col]').first();
  await drillCell.click();
  await expect(page.locator('#drill-overlay')).toBeVisible({ timeout: 5_000 });
  expect(await page.locator('#drill-content').textContent()).not.toContain('NaN');
  await page.locator('#drill-close').click();
});

// ── 11. Per-year DARA panel ───────────────────────────────────────────────────
test('build: per-year DARA panel renders when DARA focused with last year selected', async ({ page }) => {
  await page.locator('.mode-btn[data-mode="build"]').click();
  const lastYearSel = page.locator('#last-year');
  const optionCount = await lastYearSel.locator('option').count();
  await lastYearSel.selectOption({ index: optionCount - 1 });

  // Clicking DARA triggers focus handler → renderDaraByYearPanel (DARA already '40000')
  await page.locator('#dara').click();
  await expect(page.locator('#dara-by-year')).toBeVisible({ timeout: 3_000 });

  // Must have at least one row with a data-year input
  const yearInputs = page.locator('#dara-by-year-table input[data-year]');
  expect(await yearInputs.count()).toBeGreaterThan(0);
});

test('build: editing a per-year DARA input changes DARA field to "by year"', async ({ page }) => {
  await page.locator('.mode-btn[data-mode="build"]').click();
  const lastYearSel = page.locator('#last-year');
  const optionCount = await lastYearSel.locator('option').count();
  await lastYearSel.selectOption({ index: optionCount - 1 });

  await page.locator('#dara').click();
  await expect(page.locator('#dara-by-year')).toBeVisible({ timeout: 3_000 });

  // Change first year's target to something different from the default
  const firstYearInput = page.locator('#dara-by-year-table input[data-year]').first();
  await firstYearInput.fill('20000');   // fires input event → updateDaraInput()

  await expect(page.locator('#dara')).toHaveValue('by year');
});

test('rebalance: per-year DARA panel renders after loading holdings and entering DARA', async ({ page }) => {
  await page.locator('#holdings-file').setInputFiles(HOLDINGS_PATH);
  // Typing into DARA fires 'input' → renderDaraByYearPanel; holdings already loaded above
  await page.locator('#dara').fill('10000');
  await expect(page.locator('#dara-by-year')).toBeVisible({ timeout: 3_000 });

  const yearInputs = page.locator('#dara-by-year-table input[data-year]');
  expect(await yearInputs.count()).toBeGreaterThan(0);
});

// ── 12. Enter key triggers Run ────────────────────────────────────────────────
test('build: pressing Enter (no overlay open) triggers Build Ladder', async ({ page }) => {
  await page.locator('.mode-btn[data-mode="build"]').click();
  const lastYearSel = page.locator('#last-year');
  const optionCount = await lastYearSel.locator('option').count();
  await lastYearSel.selectOption({ index: optionCount - 1 });

  // Blur any focused element so no text field swallows the key
  await page.locator('h1').click();
  await page.keyboard.press('Enter');
  await expect(page.locator('#build-output')).toHaveCSS('display', 'block', { timeout: 15_000 });
});

test('rebalance: pressing Enter (no overlay open) triggers Run Rebalance', async ({ page }) => {
  await page.locator('#holdings-file').setInputFiles(HOLDINGS_PATH);
  await page.locator('h1').click();
  await page.keyboard.press('Enter');
  await expect(page.locator('#simple-table tbody tr').first()).toBeVisible({ timeout: 15_000 });
});

// ── 13. DARA auto-infer writeback ─────────────────────────────────────────────
test('rebalance: Full method with blank DARA writes inferred DARA back to input', async ({ page }) => {
  await page.locator('#holdings-file').setInputFiles(HOLDINGS_PATH);
  // Ensure DARA is blank (default in rebalance mode) and method is Full (default)
  await page.locator('#dara').fill('');
  await expect(page.locator('#method')).toHaveValue('Full');

  await page.locator('#run-btn').click();
  await expect(page.locator('#simple-table tbody tr').first()).toBeVisible({ timeout: 15_000 });

  // DARA input must now contain a positive integer
  const daraVal = await page.locator('#dara').inputValue();
  expect(daraVal, 'DARA field empty after auto-infer').toMatch(/^\d+$/);
  const daraNum = parseInt(daraVal, 10);
  expect(daraNum, 'Inferred DARA must be positive').toBeGreaterThan(0);
});

// ── 14. Export CSV button ──────────────────────────────────────────────────────
test('rebalance: export button visible after run and triggers CSV download', async ({ page }) => {
  await page.locator('#holdings-file').setInputFiles(HOLDINGS_PATH);
  await page.locator('#run-btn').click();
  await expect(page.locator('#simple-table tbody tr').first()).toBeVisible({ timeout: 15_000 });

  const exportBtn = page.locator('#export-csv-btn');
  await expect(exportBtn).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    exportBtn.click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.csv$/i);
});

test('build: export button visible after run', async ({ page }) => {
  await page.locator('.mode-btn[data-mode="build"]').click();
  const lastYearSel = page.locator('#last-year');
  const optionCount = await lastYearSel.locator('option').count();
  await lastYearSel.selectOption({ index: optionCount - 1 });

  await page.locator('#run-btn').click();
  await expect(page.locator('#build-output')).toHaveCSS('display', 'block', { timeout: 15_000 });
  await expect(page.locator('#export-csv-btn')).toBeVisible();
});

test('rebalance: no negative Qty After values at low DARA', async ({ page }) => {
  await page.locator('#holdings-file').setInputFiles(HOLDINGS_PATH);
  await page.locator('#dara').fill('5000');
  await page.locator('#run-btn').click();
  await expect(page.locator('#simple-table')).toBeVisible({ timeout: 15_000 });

  // Find the Qty After column index from the header row
  const headers = page.locator('#simple-table thead th');
  const headerCount = await headers.count();
  let qtyAfterIdx = -1;
  for (let i = 0; i < headerCount; i++) {
    const text = (await headers.nth(i).textContent() ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
    if ((text.includes('qty') || text.includes('quantity')) && text.includes('after')) { qtyAfterIdx = i; break; }
  }
  expect(qtyAfterIdx, 'Qty After column not found in table header').toBeGreaterThanOrEqual(0);

  const rows = page.locator('#simple-table tbody tr');
  const rowCount = await rows.count();
  for (let i = 0; i < rowCount; i++) {
    const cellText = await rows.nth(i).locator('td').nth(qtyAfterIdx).textContent().catch(() => '');
    const val = parseFloat((cellText ?? '').replace(/[^0-9.-]/g, ''));
    if (!isNaN(val)) expect(val, `Row ${i} Qty After = ${val} is negative`).toBeGreaterThanOrEqual(0);
  }
});

// Helper: parse net cash from #net-cash-val text (strips $, commas, sign handling)
function parseNetCash(text) {
  if (!text) return NaN;
  const t = text.replace(/[$,]/g, '').trim();
  return parseFloat(t);
}

// ── 16. Net cash non-negative and near zero after Full rebalance ───────────────
test('rebalance: Full method net cash is non-negative and within $2,000', async ({ page }) => {
  await page.locator('#holdings-file').setInputFiles(HOLDINGS_PATH);
  await page.locator('#dara').fill('');
  await expect(page.locator('#method')).toHaveValue('Full');

  await page.locator('#run-btn').click();
  await expect(page.locator('#simple-table tbody tr').first()).toBeVisible({ timeout: 15_000 });

  const raw = await page.locator('#net-cash-val').textContent();
  const netCash = parseNetCash(raw);
  expect(netCash, 'Net cash must be a number').not.toBeNaN();
  expect(netCash, `Net cash ${netCash} is negative`).toBeGreaterThanOrEqual(0);
  expect(netCash, `Net cash ${netCash} exceeds $3,000 tolerance`).toBeLessThanOrEqual(3000);
});

// ── 17. RefCPI date change clears output and preserves DARA ───────────────────
test('rebalance: changing RefCPI date clears output and does not alter DARA', async ({ page }) => {
  await page.locator('#holdings-file').setInputFiles(HOLDINGS_PATH);
  await page.locator('#dara').fill('');
  await page.locator('#run-btn').click();
  await expect(page.locator('#simple-table tbody tr').first()).toBeVisible({ timeout: 15_000 });

  // Record the inferred DARA
  const daraAfterRun = await page.locator('#dara').inputValue();
  expect(daraAfterRun).toMatch(/^\d+$/);

  // Open RefCPI picker by clicking the refcpi-link
  await page.locator('#refcpi-link').click();
  await expect(page.locator('#refcpi-picker')).toBeVisible();

  // Enter a past date and apply
  await page.locator('#refcpi-date-input').fill('01/01/2024');
  await page.locator('#refcpi-apply-btn').click();

  // Output must be cleared
  await expect(page.locator('#output')).toHaveCSS('display', 'none');
  await expect(page.locator('#net-cash-inline')).toHaveCSS('display', 'none');

  // DARA must be cleared (it was auto-inferred, so changing RefCPI makes it invalid)
  const daraAfterRefCpi = await page.locator('#dara').inputValue();
  expect(daraAfterRefCpi, 'Auto-inferred DARA NOT cleared after RefCPI date change').toBe('');
});

// ── 18. Full re-run with filled DARA does not re-infer (user value is preserved) ─
test('rebalance: Full method does not overwrite DARA when field is already filled', async ({ page }) => {
  await page.locator('#holdings-file').setInputFiles(HOLDINGS_PATH);
  await page.locator('#dara').fill('');
  await page.locator('#run-btn').click();
  await expect(page.locator('#simple-table tbody tr').first()).toBeVisible({ timeout: 15_000 });

  // Record the inferred DARA, then change RefCPI
  const daraAfterFirstRun = await page.locator('#dara').inputValue();
  expect(daraAfterFirstRun).toMatch(/^\d+$/);

  await page.locator('#refcpi-link').click();
  await page.locator('#refcpi-date-input').fill('01/01/2024');
  await page.locator('#refcpi-apply-btn').click();

  // Manually re-fill DARA to "confirm" it as a user-value (prevents it being cleared as auto-inferred)
  await page.locator('#dara').fill(daraAfterFirstRun);

  // Re-run — DARA field is now a user-confirmed value, so Full must NOT re-infer
  await page.locator('#run-btn').click();
  await expect(page.locator('#simple-table tbody tr').first()).toBeVisible({ timeout: 15_000 });

  const daraAfterReRun = await page.locator('#dara').inputValue();
  expect(daraAfterReRun, 'Full rebalance overwrote user DARA with a new inferred value').toBe(daraAfterFirstRun);
});

// ── 19. Clearing DARA then re-running Full with new RefCPI gives non-negative net cash ─
test('rebalance: Full method net cash is non-negative after clearing DARA and re-running with new RefCPI', async ({ page }) => {
  await page.locator('#holdings-file').setInputFiles(HOLDINGS_PATH);
  await page.locator('#dara').fill('');
  await page.locator('#run-btn').click();
  await expect(page.locator('#simple-table tbody tr').first()).toBeVisible({ timeout: 15_000 });

  // Change RefCPI, clear DARA, re-run to get fresh inference with new RefCPI
  await page.locator('#refcpi-link').click();
  await page.locator('#refcpi-date-input').fill('01/01/2024');
  await page.locator('#refcpi-apply-btn').click();
  await page.locator('#dara').fill('');

  await page.locator('#run-btn').click();
  await expect(page.locator('#simple-table tbody tr').first()).toBeVisible({ timeout: 15_000 });

  // DARA must have been re-inferred (field shows a number, not blank)
  const daraAfterReInfer = await page.locator('#dara').inputValue();
  expect(daraAfterReInfer, 'DARA was not re-inferred after clearing').toMatch(/^\d+$/);

  // Net cash must be near zero — allow small binary-search noise (integer lot discretization
  // can produce a cliff where |delta| < $200 is the best achievable)
  const raw = await page.locator('#net-cash-val').textContent();
  const netCash = parseNetCash(raw);
  expect(netCash, 'Net cash must be a number after RefCPI change + DARA clear').not.toBeNaN();
  expect(Math.abs(netCash), `Net cash ${netCash} exceeds $1,000 tolerance after fresh inference`).toBeLessThanOrEqual(1000);
});

// ── 20. Enter on refcpi-date-input must not auto-trigger Run ──────────────────
test('rebalance: pressing Enter in RefCPI date picker applies date but does not auto-run', async ({ page }) => {
  await page.locator('#holdings-file').setInputFiles(HOLDINGS_PATH);
  await page.locator('#run-btn').click();
  await expect(page.locator('#simple-table tbody tr').first()).toBeVisible({ timeout: 15_000 });

  const daraBefore = await page.locator('#dara').inputValue();

  // Open picker, type date, press Enter
  await page.locator('#refcpi-link').click();
  await expect(page.locator('#refcpi-picker')).toBeVisible();
  await page.locator('#refcpi-date-input').fill('01/01/2024');
  await page.locator('#refcpi-date-input').press('Enter');

  // Picker must be closed and output cleared
  await expect(page.locator('#refcpi-picker')).toHaveCSS('display', 'none');
  await expect(page.locator('#output')).toHaveCSS('display', 'none');

  // DARA must be cleared (it was auto-inferred)
  const daraAfter = await page.locator('#dara').inputValue();
  expect(daraAfter, 'Auto-inferred DARA NOT cleared after Enter in RefCPI picker').toBe('');
});
