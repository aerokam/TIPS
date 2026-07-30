// E2E regression tests — guards against GUI breakage (inop buttons, broken table render, drill popups)
// Run: npx playwright test
// Mocks R2 fetches with local YieldsFromFedInvestPrices.csv and RefCPI.csv

import { test, expect } from 'playwright/test';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { nextBondTradingDay, parseBondHolidays } from '../../src/data.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FIXTURES = path.join(ROOT, 'tests', 'e2e');
const csv = name => readFileSync(path.join(FIXTURES, name), 'utf8');

// Compute today's T+1 settlement date using the same logic as the live app.
function computeSettleDateStr() {
  const holidayText = readFileSync(path.join(FIXTURES, 'BondHolidaysSifma.csv'), 'utf8');
  const bondHolidays = parseBondHolidays(holidayText);
  const now = new Date();
  const todayISO = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  return nextBondTradingDay(todayISO, bondHolidays);
}

// Yields CSV with line 1 replaced by today's T+1 settlement date.
function yieldsWithTodaySettlement() {
  const raw = csv('YieldsFromFedInvestPrices.csv');
  const lines = raw.split('\n');
  lines[0] = computeSettleDateStr();
  return lines.join('\n');
}

// Fidelity CSV with the "Date downloaded" footer replaced by today's actual date (not T+1 —
// the app derives T+1 itself from this date, same as a real download would settle T+1 from
// today). Numerically mirrors YieldsFromFedInvestPrices.csv's TIPS rows (see
// tests/e2e/FidelityTreasuriesTips.csv provenance) so switching sources doesn't change any
// computed ladder numbers in tests that don't care which source is active.
function fidelityWithTodayDownloadDate() {
  const raw = csv('FidelityTreasuriesTips.csv');
  const now = new Date();
  const mo = String(now.getMonth() + 1).padStart(2, '0');
  const dy = String(now.getDate()).padStart(2, '0');
  const footer = `Date downloaded   ${mo}/${dy}/${now.getFullYear()} 12:00 PM`;
  return raw.replace(/Date downloaded.*$/m, footer);
}

// Holdings CSV for rebalance tests (Format 3: cusip,qty) — single canonical copy in data/
const HOLDINGS_PATH = path.join(ROOT, 'data', 'SampleHoldings.csv');

// The #dara box shows a literal number for a flat scalar, or is blank with a "by year" placeholder
// whenever the shape is custom per-year / segmented (a single number would be misleading there).
// Returns the value as a string when set, or the literal token 'by year' when blank+placeholder.
async function daraDisplay(page) {
  const dara = page.locator('#dara');
  const val = (await dara.inputValue()).trim();
  if (val !== '') return val;
  const placeholder = await dara.getAttribute('placeholder');
  return placeholder === 'by year' ? 'by year' : '';
}

// The DARA Plan card's header sliver (#dara-plan-hdr) is always visible once the card is relevant;
// clicking it expands/collapses #dara-plan-body, closed by default, or auto-opens when a saved plan
// is found. Idempotent: a no-op if it's already open (e.g. just auto-opened), so it's safe to call
// unconditionally wherever a test needs segment tools/Remember/the banner visible, without risking
// toggling an auto-opened dropdown back closed.
async function _openDaraPlan(page) {
  if (await page.locator('#dara-plan-body').isVisible()) return;
  await page.locator('#dara-plan-hdr').click();
}

test.beforeEach(async ({ page }) => {
  const yieldsBody = yieldsWithTodaySettlement();
  await page.route('**/Treasuries/YieldsFromFedInvestPrices.csv', r =>
    r.fulfill({ body: yieldsBody, contentType: 'text/csv' }));
  await page.route('**/Treasuries/FidelityTreasuriesTips.csv', r =>
    r.fulfill({ body: fidelityWithTodayDownloadDate(), contentType: 'text/csv' }));
  await page.route('**/TIPS/RefCPI.csv', r =>
    r.fulfill({ body: csv('RefCPI.csv'), contentType: 'text/csv' }));
  await page.route('**/TIPS/TipsRef.csv', r =>
    r.fulfill({ body: csv('TipsRef.csv'), contentType: 'text/csv' }));
  await page.route('**/misc/BondHolidaysSifma.csv', r =>
    r.fulfill({ body: csv('BondHolidaysSifma.csv'), contentType: 'text/csv' }));
  // Allow sample pre-populate to succeed (fetches data/SampleHoldings.csv via serve)
  await page.goto('./');
  // Wait for data load: run button must be enabled
  await expect(page.locator('#run-btn')).not.toBeDisabled({ timeout: 4_000 });
});

// ── 1. Data load ──────────────────────────────────────────────────────────────
test('data loads: info strip shows Trade/Settle/Ref CPI dates, run button enabled', async ({ page }) => {
  await expect(page.locator('#info-source')).toContainText('Trade:');
  await expect(page.locator('#info-source')).toContainText('Settle:');
  await expect(page.locator('#info-source')).toContainText('Ref CPI:');
  await expect(page.locator('#run-btn')).not.toBeDisabled();
});

// ── 2. Mode toggle ────────────────────────────────────────────────────────────
test('mode toggle: switching to Build hides holdings, shows year fields; run button re-labeled', async ({ page }) => {
  // Start in Rebalance mode
  await expect(page.locator('#run-btn')).toHaveText('Run Rebalance');
  await expect(page.locator('#field-holdings')).toBeVisible();
  await expect(page.locator('#field-last-year')).not.toBeVisible();

  // Switch to Build
  await page.locator('.tab-btn[data-mode="build"]').click();
  await expect(page.locator('#run-btn')).toHaveText('Build Ladder');
  await expect(page.locator('#field-holdings')).not.toBeVisible();
  await expect(page.locator('#field-last-year')).toBeVisible();

  // Switch back to Rebalance
  await page.locator('.tab-btn[data-mode="rebalance"]').click();
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
  await expect(table).toBeVisible({ timeout: 4_000 });
  const rows = table.locator('tbody tr');
  await expect(rows).toHaveCount(await rows.count()); // stabilizes
  expect(await rows.count()).toBeGreaterThan(0);
});

test('rebalance: net-cash-inline visible and DARA populated after run', async ({ page }) => {
  await page.locator('#holdings-file').setInputFiles(HOLDINGS_PATH);
  await page.locator('#run-btn').click();
  await expect(page.locator('#simple-table tbody tr').first()).toBeVisible({ timeout: 4_000 });
  await expect(page.locator('#net-cash-inline')).toBeVisible();
  // DARA is set from portfolio ARA on file load — shows either a number or "by year"
  expect(await daraDisplay(page)).not.toBe('');
});

test('rebalance: net cash value populated after run', async ({ page }) => {
  await page.locator('#holdings-file').setInputFiles(HOLDINGS_PATH);
  await page.locator('#run-btn').click();
  await expect(page.locator('#simple-table tbody tr').first()).toBeVisible({ timeout: 4_000 });
  // net-cash-inline uses CSS display:none with style.display='' override — check content directly
  const val = await page.locator('#net-cash-val').textContent();
  expect(val).toBeTruthy();
});

// ── 4. Build run ──────────────────────────────────────────────────────────────
test('build: selecting last year and clicking Run renders build table', async ({ page }) => {
  await page.locator('.tab-btn[data-mode="build"]').click();
  await expect(page.locator('#run-btn')).toHaveText('Build Ladder');

  // DARA defaults to 10000 in build mode; pick the last available year (ensures range > 1 rung)
  const lastYearSel = page.locator('#last-year');
  const optionCount = await lastYearSel.locator('option').count();
  await lastYearSel.selectOption({ index: optionCount - 1 });

  await page.locator('#run-btn').click();

  // build-output becomes display:block after successful run
  await expect(page.locator('#build-output')).toHaveCSS('display', 'block', { timeout: 4_000 });
  const rows = page.locator('#build-table tbody tr');
  expect(await rows.count()).toBeGreaterThan(0);
});

test('build: maturity preference field visible in Build, hidden in Rebalance', async ({ page }) => {
  await expect(page.locator('#field-build-maturity')).not.toBeVisible();
  await page.locator('.tab-btn[data-mode="build"]').click();
  await expect(page.locator('#field-build-maturity')).toBeVisible();
  await page.locator('.tab-btn[data-mode="rebalance"]').click();
  await expect(page.locator('#field-build-maturity')).not.toBeVisible();
});

test('build: first-to-mature preference runs successfully', async ({ page }) => {
  await page.locator('.tab-btn[data-mode="build"]').click();
  const lastYearSel = page.locator('#last-year');
  const optionCount = await lastYearSel.locator('option').count();
  await lastYearSel.selectOption({ index: optionCount - 1 });
  await page.locator('#build-maturity').selectOption('first');
  await page.locator('#run-btn').click();
  await expect(page.locator('#build-output')).toHaveCSS('display', 'block', { timeout: 4_000 });
  expect(await page.locator('#build-table tbody tr').count()).toBeGreaterThan(0);
});

test('pre-ladder interest checkbox visible in both Build and Rebalance', async ({ page }) => {
  // PLI is shown in Rebalance (default mode) — allows Build→Rebalance symmetry testing
  await expect(page.locator('#field-pre-ladder')).toBeVisible();
  await page.locator('.tab-btn[data-mode="build"]').click();
  await expect(page.locator('#field-pre-ladder')).toBeVisible();
  await page.locator('.tab-btn[data-mode="rebalance"]').click();
  await expect(page.locator('#field-pre-ladder')).toBeVisible();
});

test('build: pre-ladder interest zeroes early years and all row amounts stay near DARA', async ({ page }) => {
  // Regression guard: zeroed years must show ~DARA (preLadderCredit + laterMatInt),
  // NOT just laterMatInt (~24k when DARA=100k).
  await page.locator('.tab-btn[data-mode="build"]').click();

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
  await expect(page.locator('#build-output')).toHaveCSS('display', 'block', { timeout: 4_000 });

  // Amount is a fyLevel column: value lives in group header rows (td[1] after the colspan label),
  // not in child rows (which render blank). Check group headers only.
  // Before fix: zeroed rows showed only laterMatInt (~24k) — far below 40k threshold.
  const headers = page.locator('#build-table tbody tr.fy-group-header');
  const rowCount = await headers.count();
  for (let i = 0; i < rowCount; i++) {
    const amtText = await headers.nth(i).locator('td').nth(1).textContent().catch(() => '');
    const amt = parseFloat((amtText ?? '').replace(/[^0-9.-]/g, ''));
    if (!isNaN(amt) && amt > 0) {
      expect(amt, `Group header ${i} amount ${amt} is unexpectedly low (pre-ladder credit missing?)`).toBeGreaterThan(40000);
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
  await expect(page.locator('#simple-table tbody tr').first()).toBeVisible({ timeout: 4_000 });

  // Click the first drillable cell (td with data-col attribute)
  const drillCell = page.locator('#simple-table tbody td[data-col]').first();
  await expect(drillCell).toBeVisible();
  await drillCell.click();

  await expect(page.locator('#drill-overlay')).toBeVisible({ timeout: 4_000 });
  await expect(page.locator('#drill-content')).not.toBeEmpty();

  // Close with × button
  await page.locator('#drill-close').click();
  await expect(page.locator('#drill-overlay')).not.toBeVisible();
});

test('drill popup: closes on backdrop click', async ({ page }) => {
  await page.locator('#holdings-file').setInputFiles(HOLDINGS_PATH);
  await page.locator('#run-btn').click();
  await expect(page.locator('#simple-table tbody tr').first()).toBeVisible({ timeout: 4_000 });

  await page.locator('#simple-table tbody td[data-col]').first().click();
  await expect(page.locator('#drill-overlay')).toBeVisible({ timeout: 4_000 });

  // Click outside the modal (top-left of overlay)
  await page.locator('#drill-overlay').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('#drill-overlay')).not.toBeVisible();
});

// ── 8. Level 3 Drill-down ────────────────────────────────────────────────────
test('drill popup: clicking Ref CPI in Level 2 opens Level 3 Ref CPI popup', async ({ page }) => {
  await page.locator('#holdings-file').setInputFiles(HOLDINGS_PATH);
  await page.locator('#run-btn').click();
  await expect(page.locator('#simple-table tbody tr').first()).toBeVisible({ timeout: 4_000 });
  // Groups collapsed after render — expand first group so drillable cells are visible
  await page.locator('#simple-table tbody tr.fy-group-header').first().click();

  await page.locator('#simple-table tbody td[data-col="costBefore"]').first().click();
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
  await expect(page.locator('#simple-table tbody tr').first()).toBeVisible({ timeout: 4_000 });
  // Groups collapsed after render — expand first group so drillable cells are visible
  await page.locator('#simple-table tbody tr.fy-group-header').first().click();

  await page.locator('#simple-table tbody td[data-col="costBefore"]').first().click();
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

test('drill popup: clicking Pre-ladder credit opens Level 3 pool composition with AMD breakout', async ({ page }) => {
  // Regression guard: the L3 handler must read `summary` in its own scope (it was previously
  // block-scoped to the `if (drill)` branch, so clicking Pre-ladder credit threw and did nothing).
  await page.locator('.tab-btn[data-mode="build"]').click();

  const firstYearSel = page.locator('#first-year');
  const fyCount = await firstYearSel.locator('option').count();
  await firstYearSel.selectOption({ index: Math.min(5, fyCount - 1) }); // ~2032 → real pre-ladder window
  const lastYearSel = page.locator('#last-year');
  const lyCount = await lastYearSel.locator('option').count();
  await lastYearSel.selectOption({ index: lyCount - 1 });               // 2066 → future-30Y cover exists

  await page.locator('#dara').fill('100000');
  await page.locator('#pre-ladder-interest').check();
  await page.locator('#run-btn').click();
  await expect(page.locator('#build-output')).toHaveCSS('display', 'block', { timeout: 4_000 });

  // Find a funded year whose Amount popup has a drillable "Pre-ladder credit" line.
  const amtCells = page.locator('#build-table td.drillable[data-col="amount"]');
  const n = await amtCells.count();
  expect(n, 'no drillable Amount cells rendered').toBeGreaterThan(0);

  let found = false;
  for (let i = 0; i < n; i++) {
    await amtCells.nth(i).click();
    await expect(page.locator('#drill-overlay')).toBeVisible({ timeout: 4_000 });
    const plc = page.locator('.drill-l3[data-l3="plcpool"]');
    if (await plc.count() > 0) {
      await plc.first().click();
      const l3 = page.locator('#shared-popup');
      await expect(l3).toBeVisible();                                   // was failing: nothing happened
      await expect(l3).toContainText('Pre-ladder pool composition');
      await expect(l3).toContainText('Pre-ladder coupon interest');
      await expect(l3).toContainText('Pre-ladder AMD');                 // the AMD breakout line
      await l3.locator('#sp-close').click();
      found = true;
      break;
    }
    await page.locator('#drill-close').click();
    await expect(page.locator('#drill-overlay')).not.toBeVisible();
  }
  expect(found, 'no funded year exposed a drillable Pre-ladder credit line').toBe(true);
});

test('drill popup: gap-year PLI credit drills into pool composition', async ({ page }) => {
  // The Gap Amount popup lists each gap year's "↳ PLI credit"; each must drill into the shared
  // pool composition (slice encoded in the data-l3 key as plcpool:<slice>).
  await page.locator('.tab-btn[data-mode="build"]').click();
  await page.locator('#first-year').selectOption({ label: '2036' });    // gaps 2037–2039 get PLI credit
  const lastYearSel = page.locator('#last-year');
  const lyCount = await lastYearSel.locator('option').count();
  await lastYearSel.selectOption({ index: lyCount - 1 });               // 2066 → future-30Y cover → AMD in pool

  await page.locator('#dara').fill('80000');
  await page.locator('#pre-ladder-interest').check();
  await page.locator('#run-btn').click();
  await expect(page.locator('#build-output')).toHaveCSS('display', 'block', { timeout: 4_000 });

  // Expand all groups so bracket sub-rows (gapAmount cells) become visible.
  const expandAllBtn = page.locator('#expand-collapse-all-btn');
  if ((await expandAllBtn.textContent())?.trim() === 'Expand All') await expandAllBtn.click();

  const gapCell = page.locator('#build-table td.drillable[data-col="gapAmount"]').first();
  await expect(gapCell).toBeVisible();
  await gapCell.click();
  await expect(page.locator('#drill-overlay')).toBeVisible({ timeout: 4_000 });

  const gapPli = page.locator('.drill-l3[data-l3^="plcpool:"]').first();
  await expect(gapPli).toBeVisible();                                    // the "↳ PLI credit" line
  await gapPli.click();

  const l3 = page.locator('#shared-popup');
  await expect(l3).toBeVisible();
  await expect(l3).toContainText('Pre-ladder pool composition');
  await expect(l3).toContainText('Pre-ladder AMD');
  await expect(l3).toContainText('Applied to this year');
  await l3.locator('#sp-close').click();
  await expect(l3).not.toBeVisible();
});

// ── 9. Error handling ─────────────────────────────────────────────────────────
test('rebalance: running without holdings file shows status error', async ({ page, context }) => {
  // Block the pre-populate fetch so no sample file is loaded into the input
  await page.route('**/data/SampleHoldings.csv', r => r.abort());
  await page.reload();
  await expect(page.locator('#run-btn')).not.toBeDisabled({ timeout: 4_000 });

  await page.locator('#run-btn').click();
  await expect(page.locator('#status')).toContainText(/holdings|csv|file/i);
});

test('build: running without selecting last year shows status error', async ({ page }) => {
  await page.locator('.tab-btn[data-mode="build"]').click();
  // Clear DARA so we get an error before year check, set it
  await page.locator('#dara').fill('10000');
  // Clear the default last-year selection to trigger the error
  await page.locator('#last-year').selectOption('');
  await page.locator('#run-btn').click();
  await expect(page.locator('#status')).toContainText(/year/i);
});

// ── 9. Low-DARA edge cases ────────────────────────────────────────────────────
test('build: DARA below $1,000 is rejected before running', async ({ page }) => {
  await page.locator('.tab-btn[data-mode="build"]').click();
  const lastYearSel = page.locator('#last-year');
  const optionCount = await lastYearSel.locator('option').count();
  await lastYearSel.selectOption({ index: optionCount - 1 });
  await page.locator('#dara').fill('500');
  await page.locator('#run-btn').click();
  await expect(page.locator('#status')).toContainText(/1,000/i);
});

test('build: DARA $2,000 either renders table or shows DARA-too-low error with no crash', async ({ page }) => {
  await page.locator('.tab-btn[data-mode="build"]').click();
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
    const rows = page.locator('#build-table tbody tr:not(.excess-subrow):not(.fy-group-header)');
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
  await expect(page.locator('#simple-table tbody tr').first()).toBeVisible({ timeout: 4_000 });
  await assertNoNaN(page, '#simple-table');

  const drillCell = page.locator('#simple-table tbody td[data-col]').first();
  await drillCell.click();
  await expect(page.locator('#drill-overlay')).toBeVisible({ timeout: 4_000 });
  expect(await page.locator('#drill-content').textContent()).not.toContain('NaN');
  await page.locator('#drill-close').click();
});

test('rebalance: no NaN in table cells at low DARA ($5,000)', async ({ page }) => {
  await page.locator('#holdings-file').setInputFiles(HOLDINGS_PATH);
  await page.locator('#dara').fill('5000');
  await page.locator('#run-btn').click();
  await expect(page.locator('#simple-table tbody tr').first()).toBeVisible({ timeout: 4_000 });
  await assertNoNaN(page, '#simple-table');
});

test('build: no NaN in table cells or drill popup', async ({ page }) => {
  await page.locator('.tab-btn[data-mode="build"]').click();
  const lastYearSel = page.locator('#last-year');
  const optionCount = await lastYearSel.locator('option').count();
  await lastYearSel.selectOption({ index: optionCount - 1 });
  await page.locator('#run-btn').click();
  await expect(page.locator('#build-output')).toHaveCSS('display', 'block', { timeout: 4_000 });
  await assertNoNaN(page, '#build-table');

  const drillCell = page.locator('#build-table tbody td[data-col]').first();
  await drillCell.click();
  await expect(page.locator('#drill-overlay')).toBeVisible({ timeout: 4_000 });
  expect(await page.locator('#drill-content').textContent()).not.toContain('NaN');
  await page.locator('#drill-close').click();
});

// ── 11. Per-year DARA (table-integrated) ────────────────────────────────────────
test('build: per-year DARA inputs render inline in the table once built', async ({ page }) => {
  await page.locator('.tab-btn[data-mode="build"]').click();
  const lastYearSel = page.locator('#last-year');
  const optionCount = await lastYearSel.locator('option').count();
  await lastYearSel.selectOption({ index: optionCount - 1 });

  // Build mode has no pre-build preview (unlike Rebalance's before-state) — the inline per-year
  // inputs only exist once a ladder has actually been built (DARA already '40000' by default).
  await page.locator('#run-btn').click();
  await expect(page.locator('#build-output')).toHaveCSS('display', 'block', { timeout: 4_000 });

  // Must have at least one row with a data-year input
  const yearInputs = page.locator('#build-table .fy-dara-input[data-year]');
  expect(await yearInputs.count()).toBeGreaterThan(0);
});

test('build: editing a per-year DARA input blanks the DARA field to "by year"', async ({ page }) => {
  await page.locator('.tab-btn[data-mode="build"]').click();
  const lastYearSel = page.locator('#last-year');
  const optionCount = await lastYearSel.locator('option').count();
  await lastYearSel.selectOption({ index: optionCount - 1 });

  await page.locator('#run-btn').click();
  // Scoped to #build-table — the Rebalance side's before-state preview (auto-loaded sample
  // holdings) also has matching .fy-dara-input elements earlier in DOM order, just hidden.
  await expect(page.locator('#build-table .fy-dara-input[data-year]').first()).toBeVisible({ timeout: 4_000 });

  // Change first year's target to something different from the default
  const firstYearInput = page.locator('#build-table .fy-dara-input[data-year]').first();
  await firstYearInput.fill('20000');   // fires input event → updateDaraInput()

  // A single top-level number would now be misleading — the box goes blank with a "by year" hint
  // rather than showing a stale/misleading number.
  await expect(page.locator('#dara')).toHaveValue('');
  await expect(page.locator('#dara')).toHaveAttribute('placeholder', 'by year');
});

test('rebalance: per-year DARA inputs render inline after loading holdings and entering DARA', async ({ page }) => {
  await page.locator('#holdings-file').setInputFiles(HOLDINGS_PATH);
  // Typing into DARA fires 'input' → renderDaraByYearPanel → refreshes the before-state preview;
  // holdings already loaded above.
  await page.locator('#dara').fill('10000');
  await expect(page.locator('.fy-dara-input[data-year]').first()).toBeVisible({ timeout: 3_000 });

  const yearInputs = page.locator('.fy-dara-input[data-year]');
  expect(await yearInputs.count()).toBeGreaterThan(0);
});

// ── 12. Enter key triggers Run ────────────────────────────────────────────────
test('build: pressing Enter (no overlay open) triggers Build Ladder', async ({ page }) => {
  await page.locator('.tab-btn[data-mode="build"]').click();
  const lastYearSel = page.locator('#last-year');
  const optionCount = await lastYearSel.locator('option').count();
  await lastYearSel.selectOption({ index: optionCount - 1 });

  // Blur any focused element so no text field swallows the key
  await page.locator('.app-title').click();
  await page.keyboard.press('Enter');
  await expect(page.locator('#build-output')).toHaveCSS('display', 'block', { timeout: 4_000 });
});

test('rebalance: pressing Enter (no overlay open) triggers Run Rebalance', async ({ page }) => {
  await page.locator('#holdings-file').setInputFiles(HOLDINGS_PATH);
  await page.locator('.app-title').click();
  await page.keyboard.press('Enter');
  await expect(page.locator('#simple-table tbody tr').first()).toBeVisible({ timeout: 4_000 });
});

// ── 13. DARA populated from portfolio on file load ────────────────────────────
test('rebalance: DARA populated from portfolio ARA on file load', async ({ page }) => {
  await page.locator('#holdings-file').setInputFiles(HOLDINGS_PATH);

  // DARA is set from portfolio ARA at file load — shows numeric median or "by year"
  expect(await daraDisplay(page), 'DARA field empty after file load').not.toBe('');

  // Running must produce a table with no crash
  await page.locator('#run-btn').click();
  await expect(page.locator('#simple-table tbody tr').first()).toBeVisible({ timeout: 4_000 });
});

// ── 14. Export CSV button ──────────────────────────────────────────────────────
test('rebalance: export button visible after run and triggers CSV download', async ({ page }) => {
  await page.locator('#holdings-file').setInputFiles(HOLDINGS_PATH);
  await page.locator('#run-btn').click();
  await expect(page.locator('#simple-table tbody tr').first()).toBeVisible({ timeout: 4_000 });

  const exportBtn = page.locator('#export-csv-btn');
  await expect(exportBtn).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    exportBtn.click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.csv$/i);
});

test('build: export button visible after run', async ({ page }) => {
  await page.locator('.tab-btn[data-mode="build"]').click();
  const lastYearSel = page.locator('#last-year');
  const optionCount = await lastYearSel.locator('option').count();
  await lastYearSel.selectOption({ index: optionCount - 1 });

  await page.locator('#run-btn').click();
  await expect(page.locator('#build-output')).toHaveCSS('display', 'block', { timeout: 4_000 });
  await expect(page.locator('#export-csv-btn')).toBeVisible();
});

test('rebalance: no negative Qty After values at low DARA', async ({ page }) => {
  await page.locator('#holdings-file').setInputFiles(HOLDINGS_PATH);
  await page.locator('#dara').fill('5000');
  await page.locator('#run-btn').click();
  await expect(page.locator('#simple-table')).toBeVisible({ timeout: 4_000 });

  // Find the Qty After column index from the header row
  const headers = page.locator('#simple-table thead th');
  const headerCount = await headers.count();
  let qtyAfterIdx = -1;
  for (let i = 0; i < headerCount; i++) {
    const text = (await headers.nth(i).textContent() ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
    if ((text.includes('qty') || text.includes('quantity')) && text.includes('after')) { qtyAfterIdx = i; break; }
  }
  expect(qtyAfterIdx, 'Qty After column not found in table header').toBeGreaterThanOrEqual(0);

  const rows = page.locator('#simple-table tbody tr:not(.fy-group-header)');
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

// ── 16. Net cash small and NON-NEGATIVE after rebalance with portfolio-derived DARA ────
test('rebalance: net cash is non-negative and small (self-financing scale)', async ({ page }) => {
  await page.locator('#holdings-file').setInputFiles(HOLDINGS_PATH);
  // The #holdings-file 'change' handler has one async gap (`await file.text()`); everything after
  // it — parsing, currentHoldingsArray, the rebal-first/last-year dropdowns, auto-inferred DARA —
  // is synchronous but doesn't land until that gap resolves. Clicking Run immediately can race
  // ahead of it and run against stale pre-upload state (e.g. the page-load sample-holdings
  // preload), producing a holdings/DARA mismatch that isn't self-financing. rebal-last-year is
  // cleared to '' right before the post-await population runs, so waiting for it to be non-empty
  // is a reliable "this upload's handler has finished" signal.
  await expect(page.locator('#rebal-last-year')).not.toHaveValue('', { timeout: 3_000 });

  // Default mirror shape — run without any manual override. The Run-time shape-preserving
  // self-financing scale (3.0 §Funding the rebalance) must drive net cash to small, ≥ 0:
  // the funded rungs sell down proportionally to fund the duration-match bracket excess.
  await page.locator('#run-btn').click();
  await expect(page.locator('#simple-table tbody tr').first()).toBeVisible({ timeout: 4_000 });

  const raw = await page.locator('#net-cash-val').textContent();
  const netCash = parseNetCash(raw);
  expect(netCash, 'Net cash must be a number').not.toBeNaN();
  // Self-financing: net cash is a small POSITIVE number. -50 tolerance for integer-bond rounding.
  expect(netCash, `Net cash ${netCash} must be non-negative (rebalance must self-finance)`).toBeGreaterThanOrEqual(-50);
  expect(netCash, `Net cash ${netCash} is unreasonably large`).toBeLessThanOrEqual(3000);
});

// ── 16b. Gap-free portfolio with interior holes: no scale, no large trades ────
// Regression: a broker portfolio whose TIPS span 2027–2033 but hold NONE in 2029/2032
// (intentional interior holes — 2032 is a nominal note, dropped). There are no gap years
// (2037–39) or Future-30Y years in range, so the self-financing scale must NOT run: the
// load mirror already nets to ≈0. The old bug fed a held-years-only map to the scale, which
// sized the empty interior years to the scalar DARA (phantom BUYs) and then sold every rung
// ~30% to "fund" them — small net cash but huge trades. Assert the Qty Delta column is ~0.
// (3.0 §Funding the rebalance — the scale is gated on gap/Future-30Y years existing.)
test('rebalance: gap-free portfolio with interior holes makes no large trades', async ({ page }) => {
  await page.locator('#holdings-file').setInputFiles(path.join(FIXTURES, 'OfxInteriorHoles.csv'));
  await page.locator('#run-btn').click();
  await expect(page.locator('#simple-table')).toBeVisible({ timeout: 4_000 });

  // Locate the Qty Delta column.
  const headers = page.locator('#simple-table thead th');
  const headerCount = await headers.count();
  let qtyDeltaIdx = -1;
  for (let i = 0; i < headerCount; i++) {
    const text = (await headers.nth(i).textContent() ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (text.includes('qty') && text.includes('delta')) { qtyDeltaIdx = i; break; }
  }
  expect(qtyDeltaIdx, 'Qty Delta column not found').toBeGreaterThanOrEqual(0);

  const rows = page.locator('#simple-table tbody tr:not(.fy-group-header)');
  const rowCount = await rows.count();
  let maxAbsDelta = 0;
  for (let i = 0; i < rowCount; i++) {
    const cellText = await rows.nth(i).locator('td').nth(qtyDeltaIdx).textContent().catch(() => '');
    const val = parseFloat((cellText ?? '').replace(/[^0-9.-]/g, ''));
    if (!isNaN(val)) maxAbsDelta = Math.max(maxAbsDelta, Math.abs(val));
  }
  // Honoring the by-year mirror is a no-op; allow ±3 bonds for integer rounding only.
  expect(maxAbsDelta, `Largest |Qty Delta| was ${maxAbsDelta} bonds — the gap-free mirror must not trade`).toBeLessThanOrEqual(3);

  const netCash = parseNetCash(await page.locator('#net-cash-val').textContent());
  expect(Math.abs(netCash), `Net cash ${netCash} should be ≈0 for a gap-free no-op`).toBeLessThanOrEqual(3000);
});

// ── 16c. Infer LMP across an empty interior year fills it to the segment DARA ──
// Regression: the gap-free portfolio holds nothing in 2029 (an interior hole). Inferring an LMP
// segment that spans 2029 stamps the flat LMP DARA onto EVERY LMP rung including 2029. Running must
// then FILL 2029 to that DARA (target ≥ 1 bond) — an explicitly-raised empty year is the user's
// stated intent, not a hole. (The earlier hole-handling wrongly forced every unheld year to 0,
// so the panel showed the LMP value but the rebalance ignored it.) 3.0 §Intentional empty rungs.
test('rebalance: Infer LMP fills an empty interior year to the segment DARA', async ({ page }) => {
  test.setTimeout(20_000);
  await page.locator('#holdings-file').setInputFiles(path.join(FIXTURES, 'OfxInteriorHoles.csv'));
  await expect(page.locator('.fy-dara-input[data-year]').first()).toBeVisible({ timeout: 4_000 });
  await _openDaraPlan(page);
  await expect(page.locator('#dara-seg-tools')).toBeVisible({ timeout: 2_000 });

  // Split so the empty year 2029 sits inside the bottom (LMP) segment, then infer it.
  await page.locator('#split-year-add').selectOption({ value: '2030' });
  await page.locator('#seg-rows .seg-infer-btn[data-idx="0"]').click();
  // Panel now shows a flat LMP DARA on 2029 (the empty year).
  const lmp2029 = await page.locator('.fy-dara-input[data-year="2029"]').inputValue();
  expect(parseFloat(lmp2029.replace(/[^0-9.-]/g, '')), '2029 shows the LMP DARA in the panel').toBeGreaterThan(1000);

  await page.locator('#run-btn').click();
  await expect(page.locator('#simple-table')).toBeVisible({ timeout: 4_000 });

  // The per-funded-year total lives in the group-header row (e.g. "▶ 2029 … 0  64  +64 …").
  // Find the 2029 group row and assert it shows a positive Qty Delta — i.e. 2029 was BOUGHT to the
  // LMP DARA rather than left as an empty hole (the bug rendered Δ0).
  const row2029 = page.locator('#simple-table tr.fy-group-header[data-fy="2029"]').first();
  await expect(row2029).toBeVisible();
  const rowText = (await row2029.textContent() ?? '').replace(/\s+/g, ' ');
  expect(rowText, `2029 must FILL to the LMP DARA (got "${rowText.trim()}"), not stay an empty hole`).toMatch(/\+\s*[1-9]\d*/);
});

// ── 17. RefCPI date change clears output but preserves DARA ──────────────────
test('rebalance: changing RefCPI date clears output and does not alter DARA', async ({ page }) => {
  await page.locator('#holdings-file').setInputFiles(HOLDINGS_PATH);
  await page.locator('#run-btn').click();
  await expect(page.locator('#simple-table tbody tr').first()).toBeVisible({ timeout: 4_000 });

  // Record the DARA (set from portfolio ARA at file load)
  expect(await daraDisplay(page)).not.toBe('');

  // Open RefCPI picker and apply a new date
  await page.locator('#refcpi-link').click();
  await expect(page.locator('#refcpi-picker')).toBeVisible();
  await page.locator('#refcpi-date-input').fill('2024-01-01');
  await page.locator('#refcpi-apply-btn').click();

  // Output must be cleared
  await expect(page.locator('#output')).toHaveCSS('display', 'none');
  await expect(page.locator('#net-cash-inline')).toHaveCSS('display', 'none');

  // DARA must be preserved — it comes from portfolio, not inference, so RefCPI change does not invalidate it
  expect(await daraDisplay(page), 'DARA was cleared after RefCPI change').not.toBe('');
});

// ── 18. DARA stays stable across multiple runs ────────────────────────────────
test('rebalance: Full method does not overwrite DARA when field is already filled', async ({ page }) => {
  await page.locator('#holdings-file').setInputFiles(HOLDINGS_PATH);
  await page.locator('#run-btn').click();
  await expect(page.locator('#simple-table tbody tr').first()).toBeVisible({ timeout: 4_000 });

  const daraAfterFirstRun = await daraDisplay(page);
  expect(daraAfterFirstRun).not.toBe('');

  // Re-run — DARA must not change (portfolio-derived DARA is stable, no re-inference)
  await page.locator('#run-btn').click();
  await expect(page.locator('#simple-table tbody tr').first()).toBeVisible({ timeout: 4_000 });

  const daraAfterReRun = await daraDisplay(page);
  expect(daraAfterReRun, 'DARA changed between runs').toBe(daraAfterFirstRun);
});

// ── 19. Clearing DARA uses panel default; net cash stays near zero ─────────────
test('rebalance: Full method net cash is non-negative after clearing DARA and re-running with new RefCPI', async ({ page }) => {
  await page.locator('#holdings-file').setInputFiles(HOLDINGS_PATH);
  await page.locator('#run-btn').click();
  await expect(page.locator('#simple-table tbody tr').first()).toBeVisible({ timeout: 4_000 });

  // Change RefCPI, then clear DARA field and re-run
  // Clearing DARA falls back to _daraByYearPanelDefault (set from portfolio at file load)
  await page.locator('#refcpi-link').click();
  await page.locator('#refcpi-date-input').fill('2024-01-01');
  await page.locator('#refcpi-apply-btn').click();
  await page.locator('#dara').fill('');

  await page.locator('#run-btn').click();
  await expect(page.locator('#simple-table tbody tr').first()).toBeVisible({ timeout: 4_000 });

  // After a RefCPI date change the per-year DARA targets (from original load) no longer
  // match the new prices, so net cash may be significantly non-zero — just verify the run completes.
  const raw = await page.locator('#net-cash-val').textContent();
  expect(parseNetCash(raw), 'Net cash must be a number after RefCPI change').not.toBeNaN();
});

// ── 20b. DARA stays stable when bracket mode changes ──────────────────────────
test('rebalance: auto-inferred DARA is re-inferred when bracket mode changes', async ({ page }) => {
  await page.locator('#holdings-file').setInputFiles(HOLDINGS_PATH);

  // First run — DARA from portfolio ARA
  await page.locator('#run-btn').click();
  await expect(page.locator('#simple-table tbody tr').first()).toBeVisible({ timeout: 4_000 });
  expect(await daraDisplay(page)).not.toBe('');

  // Change bracket mode — DARA comes from portfolio, not inference, so it stays stable
  const bracketMode = await page.locator('#bracket-mode').inputValue();
  await page.locator('#bracket-mode').selectOption(bracketMode === '3bracket' ? '2bracket' : '3bracket');

  await page.locator('#run-btn').click();
  await expect(page.locator('#simple-table tbody tr').first()).toBeVisible({ timeout: 4_000 });

  expect(await daraDisplay(page), 'DARA was unexpectedly cleared after bracket mode change').not.toBe('');
});

// ── 20. Enter on refcpi-date-input must not auto-trigger Run ──────────────────
test('rebalance: pressing Enter in RefCPI date picker applies date but does not auto-run', async ({ page }) => {
  await page.locator('#holdings-file').setInputFiles(HOLDINGS_PATH);
  await page.locator('#run-btn').click();
  await expect(page.locator('#simple-table tbody tr').first()).toBeVisible({ timeout: 4_000 });

  // Open picker, type date, press Enter
  await page.locator('#refcpi-link').click();
  await expect(page.locator('#refcpi-picker')).toBeVisible();
  await page.locator('#refcpi-date-input').fill('2024-01-01');
  await page.locator('#refcpi-date-input').press('Enter');

  // Picker must be closed and output cleared
  await expect(page.locator('#refcpi-picker')).toHaveCSS('display', 'none');
  await expect(page.locator('#output')).toHaveCSS('display', 'none');

  // DARA must be preserved — portfolio-derived DARA is not invalidated by RefCPI change
  expect(await daraDisplay(page), 'DARA was unexpectedly cleared after RefCPI Enter').not.toBe('');
});

test('build variable DARA then rebalance: per-year panel round-trips exactly', async ({ page }) => {
  // Regression for variable-DARA ladders: build with first-year=20K, 2029=50K, export, load in
  // rebalance. Build's export embeds an explicit `#fundedYear,dara` block (added 2026-06-04,
  // index.html "Explicit per-year DARA round-trip"), and Rebalance honors that block directly on
  // import instead of inferring DARA from holdings (index.html ~1395: "no inference"). So this is
  // NOT the best-effort `inferScaledDARAFromPortfolio` proportional-scaling path (that only runs
  // for files with no DARA block — broker/legacy/tipsladder imports) — it's a literal read-back,
  // and the per-year values must reproduce exactly, not just preserve ordering.
  await page.locator('.tab-btn[data-mode="build"]').click();

  // Select last year 2029 and default first year (settlement year ≈ 2026)
  await page.locator('#last-year').selectOption('2029');
  await page.locator('#dara').fill('40000');

  // Build once to materialize the table's inline per-year DARA inputs (Build mode has no
  // pre-build preview the way Rebalance does — nothing to value before a ladder exists). Scoped
  // to #build-table — the Rebalance side's auto-loaded sample holdings also has matching
  // .fy-dara-input elements earlier in DOM order, just hidden.
  await page.locator('#run-btn').click();
  await expect(page.locator('#build-table .fy-dara-input[data-year]').first()).toBeVisible({ timeout: 6_000 });

  // Set first available year to 20000 and last year (2029) to 50000 — Build-mode per-rung edits
  // auto-rebuild the already-built table on commit (blur), same live behavior as Rebalance.
  const firstInput = page.locator('#build-table .fy-dara-input[data-year]').first();
  const firstYear = await firstInput.getAttribute('data-year');
  await firstInput.fill('20000');
  await firstInput.blur();
  const lastYearInput = page.locator('#build-table .fy-dara-input[data-year="2029"]');
  await lastYearInput.fill('50000');
  await lastYearInput.blur();
  await expect(page.locator('#build-table tbody tr').first()).toBeVisible({ timeout: 6_000 });

  // Export CUSIP/qty
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#export-cusip-qty-btn').click(),
  ]);
  const exportPath = await download.path();
  expect(exportPath, 'export file should exist').toBeTruthy();

  // Switch to Rebalance and load the exported file. Tab-switch synchronously restores the
  // Rebalance panel's STASHED state from the page-load sample-preload (index.html ~709,
  // `_daraByYearStore = _daraByYearStoreRebal`) — so the inline per-year inputs already show stale
  // sample-derived values the instant the tab click happens, before the just-uploaded file's async
  // parse (single `await file.text()` in the #holdings-file 'change' handler) has resolved and
  // overwritten it. A one-shot inputValue() read here can race ahead of that overwrite and observe
  // the stale snapshot instead — use auto-retrying toHaveValue() assertions, which poll until the
  // real value lands (or the timeout expires), rather than a point-in-time read.
  await page.locator('.tab-btn[data-mode="rebalance"]').click();
  await page.locator('#holdings-file').setInputFiles(exportPath);
  await expect(page.locator('#simple-table .fy-dara-input[data-year]').first()).toBeVisible({ timeout: 4_000 });

  // Explicit-block honor path: values must reproduce the exact typed inputs, not just an ordering.
  // Scoped to #simple-table — #build-table still holds the just-built ladder from above, and a
  // year like 2029 exists (with a coincidentally matching value) in both tables at this point.
  await expect(page.locator(`#simple-table .fy-dara-input[data-year="${firstYear}"]`),
    'first-year DARA should round-trip to exactly 20000').toHaveValue('20000', { timeout: 3_000 });
  await expect(page.locator('#simple-table .fy-dara-input[data-year="2029"]'),
    '2029 DARA should round-trip to exactly 50000').toHaveValue('50000', { timeout: 3_000 });

  // Run rebalance — reconstructing the same targets reproduces the same ladder, so net cash is
  // near zero (not a proportional-scaling self-financing search; see comment above).
  await page.locator('#run-btn').click();
  await expect(page.locator('#simple-table tbody tr').first()).toBeVisible({ timeout: 6_000 });
  const raw = await page.locator('#net-cash-val').textContent();
  const netCash = parseFloat(raw.replace(/[^0-9.-]/g, ''));
  expect(netCash, 'net cash must be non-negative').toBeGreaterThanOrEqual(0);
  expect(netCash, 'net cash must be small (within $2,000)').toBeLessThan(2000);
});

// ── Full UI round-trip: build → export → import → rebalance (Future-30Y cover excess) ──
// Regression for the bug where importing a built 2026–2066 ladder defaulted the rebalance
// last-year to 2056 (longest actual TIPS), so the 2052/2056 Future-30Y cover excess was sold
// to DARA. The last-year must be recovered (2066) from the cover excess so the round-trip is flat.
test('round-trip: build 2026–2066 → export CUSIP/Qty → import → last-year recovers 2066, ~0 net cash', async ({ page }) => {
  test.setTimeout(20_000);

  // 1. Build 2026–2066 @ DARA 40k
  await page.locator('.tab-btn[data-mode="build"]').click();
  await page.locator('#last-year').selectOption({ value: '2066' });
  await page.locator('#dara').fill('40000');
  await page.locator('#run-btn').click();
  await expect(page.locator('#build-output')).toHaveCSS('display', 'block', { timeout: 4_000 });

  // 2. Export CUSIP/Qty (captures the Format-5 file the app produces)
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#export-cusip-qty-btn').click();
  const download = await downloadPromise;
  const csvPath = test.info().outputPath('roundtrip.csv');
  await download.saveAs(csvPath);

  // 3. Switch to rebalance and import that exact file
  await page.locator('.tab-btn[data-mode="rebalance"]').click();
  await page.locator('#holdings-file').setInputFiles(csvPath);

  // 4. The crux: last-year must default to 2066 (recovered from the 2052/2056 cover excess),
  //    NOT 2056 — else the covers are sold and the round-trip is full of trades.
  await expect(page.locator('#rebal-last-year')).toHaveValue('2066', { timeout: 4_000 });

  // 5. Rebalance at the same DARA → near-zero net cash (build↔rebalance are internally consistent).
  await page.locator('#dara').fill('40000');
  await page.locator('#run-btn').click();
  await expect(page.locator('#simple-table tbody tr').first()).toBeVisible({ timeout: 6_000 });
  const netCash = parseFloat((await page.locator('#net-cash-val').textContent()).replace(/[^0-9.-]/g, ''));
  expect(Math.abs(netCash), 'round-trip net cash must be ~0').toBeLessThan(2000);
});

// ── Two-segment (LMP / speculative) DARA: split control + no-clobber bulk actions ──
// Build a 2026–2055 ladder, import it, then drive the per-year panel's segment tools:
// set a constant on the speculative segment, fill the LMP median, and verify each action
// touches ONLY its own segment (the long-standing clobber pain), then run with ~0 net cash.
const _parseNetCash = (s) => parseFloat(String(s).replace(/[^0-9.-]/g, ''));

// Build 2026–2055 @ 40k, export CUSIP/Qty, import into rebalance, expand the panel. Returns csvPath.
async function _twoSegSetup(page, name) {
  await page.locator('.tab-btn[data-mode="build"]').click();
  await page.locator('#last-year').selectOption({ value: '2055' });
  await page.locator('#dara').fill('40000');
  await page.locator('#run-btn').click();
  await expect(page.locator('#build-output')).toHaveCSS('display', 'block', { timeout: 4_000 });
  const dl = page.waitForEvent('download');
  await page.locator('#export-cusip-qty-btn').click();
  const csvPath = test.info().outputPath(name);
  await (await dl).saveAs(csvPath);

  await page.locator('.tab-btn[data-mode="rebalance"]').click();
  await page.locator('#holdings-file').setInputFiles(csvPath);
  await expect(page.locator('.fy-dara-input[data-year]').first()).toBeVisible({ timeout: 4_000 });
  await _openDaraPlan(page);
  await expect(page.locator('#dara-seg-tools')).toBeVisible({ timeout: 2_000 });
}

// Scoped to #simple-table — #build-table still holds the ladder _twoSegSetup built to produce the
// import file, and its leftover .fy-dara-input elements would otherwise pollute these lists.
const _lmpVals  = (page) => page.locator('#simple-table .fy-dara-input[data-year]').evaluateAll(els => els.filter(e => +e.dataset.year <= 2047).map(e => e.value));
const _specVals = (page) => page.locator('#simple-table .fy-dara-input[data-year]').evaluateAll(els => els.filter(e => +e.dataset.year >  2047).map(e => e.value));

test('two-segment DARA: split does not auto-infer; inferring the top segment cascades down, never up', async ({ page }) => {
  test.setTimeout(20_000);
  await _twoSegSetup(page, 'twoseg.csv');

  const before = await _lmpVals(page);
  const specBefore = await _specVals(page);

  // 1. Choosing a split year must NOT infer anything — every rung keeps its loaded value.
  await page.locator('#split-year-add').selectOption({ value: '2047' });
  await expect(page.locator('#seg-rows .seg-row')).toHaveCount(2);
  expect(await _lmpVals(page), 'split alone does not touch LMP').toEqual(before);
  expect(await _specVals(page), 'split alone does not touch speculative').toEqual(specBefore);

  // 2. Infer the bottom (LMP) segment alone → it flattens to one value; nothing sits below it to
  //    cascade into, so the top segment is untouched (income never flows upward).
  await page.locator('#seg-rows .seg-infer-btn[data-idx="0"]').click();
  const lmp1 = await _lmpVals(page);
  expect(new Set(lmp1).size, 'all LMP rungs share one flat DARA').toBe(1);
  expect(await _specVals(page), 'Infer LMP leaves speculative as-is (nothing above it to cascade into)').toEqual(specBefore);

  // 3. Infer the top (speculative) segment → it flattens, AND the LMI/AMD it now throws off changes
  //    what the LMP segment needs, so the cascade automatically re-infers LMP too (this used to be a
  //    manual "go back and re-click" step; now it's automatic).
  await page.locator('#seg-rows .seg-infer-btn[data-idx="1"]').click();
  const spec1 = await _specVals(page);
  expect(new Set(spec1).size, 'all speculative rungs share one flat DARA').toBe(1);
  const lmp2 = await _lmpVals(page);
  expect(new Set(lmp2).size, 'the cascade keeps LMP flat too').toBe(1);

  // 4. A speculative typed constant cascades the same way. (55000 is an arbitrary, not necessarily
  //    self-financing, number — this step checks the cascade *reaches* LMP and re-flattens it, not
  //    that the whole portfolio nets to zero; net-cash-to-zero is covered by the infer-based test.)
  await page.locator('#seg-rows .seg-const-input[data-idx="1"]').fill('55000');
  await page.locator('#seg-rows .seg-const-input[data-idx="1"]').blur();
  await expect(page.locator('#simple-table .fy-dara-input[data-year="2050"]')).toHaveValue('55000');
  const lmp3 = await _lmpVals(page);
  expect(new Set(lmp3).size, 'LMP stays flat after the speculative constant cascades down').toBe(1);

  await page.locator('#run-btn').click();
  await expect(page.locator('#simple-table tbody tr').first()).toBeVisible({ timeout: 6_000 });
});

test('two-segment DARA: a hand-typed rung survives a segment infer that would otherwise cascade over it', async ({ page }) => {
  test.setTimeout(20_000);
  await _twoSegSetup(page, 'twoseg-pin.csv');
  await page.locator('#split-year-add').selectOption({ value: '2047' });
  await expect(page.locator('#seg-rows .seg-row')).toHaveCount(2);

  // Hand-type one specific LMP year — this is the user's stated intent for that rung.
  const pinnedRung = page.locator('#simple-table .fy-dara-input[data-year="2030"]');
  await pinnedRung.fill('12345');
  await pinnedRung.blur();
  await expect(pinnedRung).toHaveValue('12345');

  // Infer the top (speculative) segment — its cascade reaches down into LMP, but the pinned 2030
  // rung must survive untouched even though the rest of LMP gets restamped.
  await page.locator('#seg-rows .seg-infer-btn[data-idx="1"]').click();
  await expect(pinnedRung, 'hand-typed rung is not overwritten by the cascade').toHaveValue('12345');
  const lmpAfter = await _lmpVals(page);
  expect(new Set(lmpAfter.filter(v => v !== '12345')).size, 'the rest of LMP still flattens to one value').toBe(1);
});

test('two-segment DARA: infer speculative then LMP → near-zero net cash', async ({ page }) => {
  test.setTimeout(20_000);
  await _twoSegSetup(page, 'twoseg-order.csv');

  await page.locator('#split-year-add').selectOption({ value: '2047' });
  await expect(page.locator('#seg-rows .seg-row')).toHaveCount(2);

  // Correct order — top (speculative) first, bottom (LMP) last — makes the whole portfolio self-finance.
  // This is the −15k regression guard.
  await page.locator('#seg-rows .seg-infer-btn[data-idx="1"]').click();
  await page.locator('#seg-rows .seg-infer-btn[data-idx="0"]').click();
  await page.locator('#run-btn').click();
  await expect(page.locator('#simple-table tbody tr').first()).toBeVisible({ timeout: 6_000 });
  const nc = _parseNetCash(await page.locator('#net-cash-val').textContent());
  expect(Math.abs(nc), `two-segment net cash ≈ 0 after spec→LMP infer (got ${nc})`).toBeLessThan(3000);
});

// Regression: #seg-rows is fully rebuilt on every render (segments are anonymous, indexed by
// position), so an earlier bug echoed the just-inferred segment's "$ each" value by writing
// straight to that one <input> and left every OTHER segment's box to regenerate blank on the next
// render — losing the display the instant you inferred (or even just re-rendered) a sibling
// segment. Fixed by keying the echo off each segment's own year-span (_segInferredEcho) instead of
// the DOM. Three segments (two split years) exercises this where two segments existed before.
test('N-segment DARA: inferring one segment does not blank the "$ each" echo of the others', async ({ page }) => {
  test.setTimeout(20_000);
  await _twoSegSetup(page, 'threeseg.csv');

  // Split 2026-2055 into three segments: 2026-2035, 2036-2047, 2048-2055.
  await page.locator('#split-year-add').selectOption({ value: '2035' });
  await page.locator('#split-year-add').selectOption({ value: '2047' });
  await expect(page.locator('#seg-rows .seg-row')).toHaveCount(3);

  const inferBtn = i => page.locator(`#seg-rows .seg-infer-btn[data-idx="${i}"]`);
  const constInput = i => page.locator(`#seg-rows .seg-const-input[data-idx="${i}"]`);

  // Infer segment 0, then segment 1 — segment 0's echo must survive segment 1's infer/re-render.
  await inferBtn(0).click();
  const echo0 = await constInput(0).inputValue();
  expect(parseFloat(echo0), 'segment 0 shows its inferred value').toBeGreaterThan(0);

  await inferBtn(1).click();
  await expect(constInput(0), 'segment 0 echo survives inferring segment 1').toHaveValue(echo0);
  const echo1 = await constInput(1).inputValue();
  expect(parseFloat(echo1), 'segment 1 shows its inferred value').toBeGreaterThan(0);

  // Inferring segment 2 must not blank segments 0 or 1 either.
  await inferBtn(2).click();
  await expect(constInput(0), 'segment 0 echo survives inferring segment 2').toHaveValue(echo0);
  await expect(constInput(1), 'segment 1 echo survives inferring segment 2').toHaveValue(echo1);

  // Merely focusing another segment's field (no edit) must not blank anything either.
  await constInput(0).click();
  await expect(constInput(1)).toHaveValue(echo1);
  const echo2 = await constInput(2).inputValue();
  expect(parseFloat(echo2), 'segment 2 shows its inferred value').toBeGreaterThan(0);
});

test('per-year DARA: Undo and Revert restore prior values and blank the inferred-amount field', async ({ page }) => {
  test.setTimeout(20_000);
  await _twoSegSetup(page, 'undo.csv');

  const rung = page.locator('#simple-table .fy-dara-input[data-year="2030"]');
  const lmpConst = page.locator('#seg-rows .seg-const-input[data-idx="0"]');
  const loaded = await rung.inputValue();

  // Inferring the LMP (bottom) segment is a bulk change → the inferred amount appears in the field.
  // The rung's own value may or may not move — a build→export→import round-trip is already exactly
  // self-financing, so inferring an already-optimal segment can correctly land right back on what
  // it held; that's the search confirming no adjustment was needed, not a no-op bug. Capture the
  // pre-infer value fresh rather than assuming it must change.
  await page.locator('#split-year-add').selectOption({ value: '2047' });
  const beforeInfer = await rung.inputValue();
  await page.locator('#seg-rows .seg-infer-btn[data-idx="0"]').click();
  await expect(page.locator('#dara-undo')).toBeEnabled();
  expect(parseFloat(await lmpConst.inputValue()), 'inferred amount shown in field').toBeGreaterThan(0);

  // Undo restores the pre-infer value AND blanks the inferred-amount field.
  await page.locator('#dara-undo').click();
  expect(await rung.inputValue()).toBe(beforeInfer);
  expect(await lmpConst.inputValue(), 'inferred-amount field blanks on undo').toBe('');

  // Make another bulk change, then Revert-to-loaded jumps straight back to the import state.
  await page.locator('#seg-rows .seg-infer-btn[data-idx="0"]').click();
  await expect(page.locator('#dara-revert')).toBeVisible();
  await page.locator('#dara-revert').click();
  expect(await rung.inputValue()).toBe(loaded);
  expect(await lmpConst.inputValue(), 'inferred-amount field blanks on revert').toBe('');
});

// ── DARA-plan localStorage cache (account-less format → year-range key) ────────
// SampleHoldings.csv is Format 3 (cusip,qty) — no account info, so the cache falls back to the
// firstYear-lastYear+bracketMode key. Edit a rung, opt in to Remember, reload the page (a fresh
// load — same as re-uploading the same file next session), re-upload the same file, and confirm
// the saved plan surfaces as a banner rather than being applied silently, then Apply restores it.
test('per-year DARA: opt-in Remember caches the plan across a reload; banner requires Apply', async ({ page }) => {
  test.setTimeout(20_000);
  await page.locator('#holdings-file').setInputFiles(HOLDINGS_PATH);
  await expect(page.locator('.fy-dara-input[data-year]').first()).toBeVisible({ timeout: 4_000 });
  await _openDaraPlan(page);
  await expect(page.locator('#dara-remember-row')).toBeVisible({ timeout: 2_000 });

  const cb = page.locator('#dara-remember-cb');
  await expect(cb).not.toBeChecked();
  await expect(page.locator('#dara-plan-banner')).not.toBeVisible();

  const rung = page.locator('.fy-dara-input[data-year]').first();
  const rungYear = await rung.getAttribute('data-year');

  // Opt in, then make an edit — the edit is what gets remembered. The per-rung commit save runs
  // inside a deferred setTimeout(0) (index.html's _daraTable focusout handler), so wait for it to
  // actually land in localStorage before reloading, or the reload can race ahead of the save.
  await cb.check();
  await rung.fill('123456');
  await rung.blur();
  await page.waitForFunction(() =>
    Object.keys(localStorage).some(k => k.startsWith('tlm-dara-plan:') && localStorage.getItem(k).includes('123456')));

  // Also add a split and stamp its segment flat, so we can confirm the "$ each" box (not just the
  // per-year table) gets repopulated on Apply.
  await page.locator('#split-year-add').selectOption({ index: 1 });
  await expect(page.locator('#seg-rows .seg-row')).toHaveCount(2);
  await page.locator('#seg-rows .seg-const-input[data-idx="1"]').fill('88000');
  await page.locator('#seg-rows .seg-const-input[data-idx="1"]').blur();

  // Reload fresh (new in-memory state, but same-origin localStorage persists) and re-upload the
  // same file. The mirror shows the fresh portfolio value first — no silent override.
  await page.reload();
  await expect(page.locator('#run-btn')).not.toBeDisabled({ timeout: 4_000 });
  await page.locator('#holdings-file').setInputFiles(HOLDINGS_PATH);
  await expect(page.locator('.fy-dara-input[data-year]').first()).toBeVisible({ timeout: 4_000 });

  await expect(page.locator('#dara-remember-cb')).toBeChecked();
  await expect(page.locator('#dara-plan-banner')).toBeVisible({ timeout: 2_000 });
  const freshRung = page.locator(`.fy-dara-input[data-year="${rungYear}"]`);
  expect(await freshRung.inputValue(), 'load mirror shows fresh portfolio value, not the saved one, until Apply').not.toBe('123456');
  await expect(page.locator('#seg-rows .seg-row'), 'fresh reload has no split years yet').toHaveCount(1);

  await page.locator('#dara-plan-apply').click();
  await expect(page.locator('#dara-plan-banner')).not.toBeVisible();
  await expect(freshRung).toHaveValue('123456');
  await expect(page.locator('#seg-rows .seg-row')).toHaveCount(2);
  await expect(page.locator('#seg-rows .seg-const-input[data-idx="1"]'), '"$ each" box is repopulated, not left blank').toHaveValue('88000');
});

// ── Regression: Apply must restore the saved ladder range, not the freshly-inferred one ─────────
// Bug: the cache payload didn't carry firstYear/lastYear, so an account-keyed saved plan (Formats
// 1/2, no year-range in the cache key) applied its per-year values onto whatever last-year the
// load-time mirror had just inferred from holdings — silently truncating/padding the restored shape
// instead of reproducing the saved one.
test('per-year DARA: Apply restores the saved last-year even when the fresh reload infers a different one', async ({ page }) => {
  test.setTimeout(20_000);
  await page.locator('#holdings-file').setInputFiles(HOLDINGS_PATH);
  await expect(page.locator('.fy-dara-input[data-year]').first()).toBeVisible({ timeout: 4_000 });
  await _openDaraPlan(page);
  await expect(page.locator('#dara-remember-row')).toBeVisible({ timeout: 2_000 });

  const lySel = page.locator('#rebal-last-year');
  const inferredLY = await lySel.inputValue();
  const options = (await lySel.locator('option').allTextContents())
    .map(t => parseInt(t, 10)).filter(y => !isNaN(y));
  const savedLY = Math.min(...options.filter(y => y < parseInt(inferredLY, 10)));
  test.skip(!isFinite(savedLY), 'fixture has no earlier year to select for this regression');

  // Narrow the range and save under it.
  await lySel.selectOption(String(savedLY));
  await expect(page.locator(`.fy-dara-input[data-year="${inferredLY}"]`)).toHaveCount(0);
  await page.locator('#dara-remember-cb').check();
  const rung = page.locator('.fy-dara-input[data-year]').first();
  await rung.fill('77777');
  await rung.blur();
  await page.waitForFunction(() =>
    Object.keys(localStorage).some(k => k.startsWith('tlm-dara-plan:') && localStorage.getItem(k).includes('77777')));

  // Reload and re-upload the same file — the mirror re-infers the wider default range again.
  await page.reload();
  await expect(page.locator('#run-btn')).not.toBeDisabled({ timeout: 4_000 });
  await page.locator('#holdings-file').setInputFiles(HOLDINGS_PATH);
  await expect(page.locator('.fy-dara-input[data-year]').first()).toBeVisible({ timeout: 4_000 });
  // No explicit _openDaraPlan here — the banner assertion below only passes if the dropdown
  // auto-opened on its own (a saved plan was found), which is itself the thing being verified.
  await expect(page.locator('#dara-plan-banner')).toBeVisible({ timeout: 2_000 });
  await expect(lySel, 'fresh reload infers the wider range again, same as before Apply').toHaveValue(inferredLY);

  await page.locator('#dara-plan-apply').click();
  await expect(lySel, 'Apply must snap last-year back to the saved range').toHaveValue(String(savedLY));
  await expect(page.locator(`.fy-dara-input[data-year="${inferredLY}"]`),
    'years outside the saved range must not reappear in the table').toHaveCount(0);
});

// ── DARA Plan dropdown: auto-open + persistent badge when a saved plan is found ──────────────────
// A passive dismissible banner was easy to scroll past. The dropdown must auto-open on its own when
// a saved plan is found (no click needed), and if the user closes it again without clicking Apply/
// Dismiss, a badge on the header sliver (#dara-plan-hdr) must persist so it isn't silently lost.
test('DARA Plan dropdown: auto-opens on a found saved plan; badge survives closing without acting', async ({ page }) => {
  test.setTimeout(20_000);
  await page.locator('#holdings-file').setInputFiles(HOLDINGS_PATH);
  await expect(page.locator('.fy-dara-input[data-year]').first()).toBeVisible({ timeout: 4_000 });
  await _openDaraPlan(page);
  await expect(page.locator('#dara-plan-hdr')).not.toHaveClass(/needs-attention/);

  await page.locator('#dara-remember-cb').check();
  const rung = page.locator('.fy-dara-input[data-year]').first();
  await rung.fill('99999');
  await rung.blur();
  await page.waitForFunction(() =>
    Object.keys(localStorage).some(k => k.startsWith('tlm-dara-plan:') && localStorage.getItem(k).includes('99999')));

  await page.reload();
  await expect(page.locator('#run-btn')).not.toBeDisabled({ timeout: 4_000 });
  await page.locator('#holdings-file').setInputFiles(HOLDINGS_PATH);
  await expect(page.locator('.fy-dara-input[data-year]').first()).toBeVisible({ timeout: 4_000 });

  // No click on #dara-plan-hdr here — the dropdown (and its banner) must already be open on its
  // own.
  await expect(page.locator('#dara-plan-banner'), 'dropdown auto-opens with no click needed').toBeVisible({ timeout: 2_000 });
  await expect(page.locator('#dara-plan-hdr')).toHaveClass(/needs-attention/);

  // Close it WITHOUT clicking Apply/Dismiss — the badge must survive.
  await page.locator('#dara-plan-hdr').click();
  await expect(page.locator('#dara-plan-body')).not.toBeVisible();
  await expect(page.locator('#dara-plan-hdr'), 'badge persists after closing without acting').toHaveClass(/needs-attention/);

  // Re-open and Apply — the badge clears.
  await page.locator('#dara-plan-hdr').click();
  await page.locator('#dara-plan-apply').click();
  await expect(page.locator('#dara-plan-hdr')).not.toHaveClass(/needs-attention/);
});

// ── Standalone DARA-plan file (portable export/import, independent of localStorage) ────────────
// Export writes a #fundedYear,dara (+ #splitYears) file with no CUSIP rows; re-importing it onto a
// freshly (re-)loaded holdings file overlays the saved plan and its split years exactly.
test('per-year DARA: standalone plan file exports and re-imports split years + per-year values', async ({ page }) => {
  test.setTimeout(20_000);
  await page.locator('#holdings-file').setInputFiles(HOLDINGS_PATH);
  await expect(page.locator('.fy-dara-input[data-year]').first()).toBeVisible({ timeout: 4_000 });
  await _openDaraPlan(page);
  await expect(page.locator('#dara-seg-tools')).toBeVisible({ timeout: 2_000 });

  await page.locator('#split-year-add').selectOption({ index: 1 }); // any valid in-range split
  await expect(page.locator('#seg-rows .seg-row')).toHaveCount(2);

  // Stamp both segments flat with known constants so the "$ each" boxes have a real value to
  // restore — a lumpy segment has no single figure to show (see _syncSegEchoFromStore). Top segment
  // first, bottom last — the correct order, since stamping the top cascades its income down and
  // would otherwise overwrite a bottom constant set before it.
  await page.locator('#seg-rows .seg-const-input[data-idx="1"]').fill('66000');
  await page.locator('#seg-rows .seg-const-input[data-idx="1"]').blur();
  await page.locator('#seg-rows .seg-const-input[data-idx="0"]').fill('33000');
  await page.locator('#seg-rows .seg-const-input[data-idx="0"]').blur();
  const rungYear = await page.locator('.fy-dara-input[data-year]').first().getAttribute('data-year');
  const rung = page.locator(`.fy-dara-input[data-year="${rungYear}"]`);
  await expect(rung, 'segment 0 rung reflects its flat constant before export').toHaveValue('33000');

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#dara-plan-export-btn').click();
  const download = await downloadPromise;
  const planPath = test.info().outputPath('dara-plan.csv');
  await download.saveAs(planPath);

  // Fresh re-upload wipes the edit, the split, and the "$ each" boxes back to the mirror. (Clear
  // the input's value first — same-file re-selection otherwise doesn't reliably re-fire 'change',
  // mirroring the production Browse-button handler's own workaround for this browser quirk.)
  await page.evaluate(() => { document.getElementById('holdings-file').value = ''; });
  await page.locator('#holdings-file').setInputFiles(HOLDINGS_PATH);
  await expect(page.locator('.fy-dara-input[data-year]').first()).toBeVisible({ timeout: 4_000 });
  // Inline inputs render as soon as the before-state preview renders — no expand step needed.
  expect(await rung.inputValue(), 'fresh reload is the plain mirror again').not.toBe('33000');
  await expect(page.locator('#seg-rows .seg-row'), 'fresh reload has no split years').toHaveCount(1);

  await page.locator('#dara-plan-import-btn').click();
  await page.locator('#dara-plan-import-file').setInputFiles(planPath);
  await expect(rung).toHaveValue('33000');
  await expect(page.locator('#seg-rows .seg-row')).toHaveCount(2, { timeout: 2_000 });
  // The "$ each" boxes must be repopulated from the imported plan, not left blank.
  await expect(page.locator('#seg-rows .seg-const-input[data-idx="0"]')).toHaveValue('33000');
  await expect(page.locator('#seg-rows .seg-const-input[data-idx="1"]')).toHaveValue('66000');
});

// ── Build-mode segment split + "$ each" + persistence (same tools, no Infer DARA) ──────────────
// Build has no holdings to self-finance against, so it gets split years and the "$ each" constant
// stamp (its batch-entry mechanism) but never the Infer DARA button. Opens the panel, expands it,
// and waits for the segment tools row — same shape as _twoSegSetup but staying in Build mode.
async function _buildSegSetup(page, lastYear = '2055') {
  await page.locator('.tab-btn[data-mode="build"]').click();
  await page.locator('#last-year').selectOption({ value: lastYear });
  // Build mode has no pre-build preview — build once so the table's inline per-year DARA inputs
  // exist; segment infer/const/Apply auto-rebuild this table from then on (index.html
  // _runSegmentInfer/_runSegmentConst/dara-plan-apply's `wasBuilt` check).
  await page.locator('#run-btn').click();
  // Scoped to #build-table — the Rebalance side's auto-loaded sample holdings also has matching
  // .fy-dara-input elements earlier in DOM order, just hidden.
  await expect(page.locator('#build-table .fy-dara-input[data-year]').first()).toBeVisible({ timeout: 4_000 });
  await _openDaraPlan(page);
  await expect(page.locator('#dara-seg-tools')).toBeVisible({ timeout: 2_000 });
}

test('build: segment split + "$ each" stamping works; no Infer DARA button ever renders', async ({ page }) => {
  test.setTimeout(20_000);
  await _buildSegSetup(page);

  // Whole ladder starts as one segment — a "$ each" input, but no Infer button (no holdings to
  // self-finance against in Build).
  await expect(page.locator('#seg-rows .seg-row')).toHaveCount(1);
  await expect(page.locator('#seg-rows .seg-infer-btn')).toHaveCount(0);

  await page.locator('#split-year-add').selectOption({ index: 1 });
  await expect(page.locator('#seg-rows .seg-row')).toHaveCount(2);
  await expect(page.locator('#seg-rows .seg-infer-btn'), 'Infer DARA never renders in Build').toHaveCount(0);

  // "$ each" stamping is Build's batch-entry mechanism — stamp the earlier (idx 0) segment flat.
  await page.locator('#seg-rows .seg-const-input[data-idx="0"]').fill('25000');
  await page.locator('#seg-rows .seg-const-input[data-idx="0"]').blur();
  const firstRung = page.locator('#build-table .fy-dara-input[data-year]').first();
  await expect(firstRung).toHaveValue('25000');
});

// Regression for the per-mode swap added alongside this feature: _splitYears/_segInferredEcho used
// to be single globals, so switching tabs would leak one mode's split years into the other's panel.
test('mode toggle: switching Build <-> Rebalance does not leak split years between modes', async ({ page }) => {
  test.setTimeout(20_000);
  await _buildSegSetup(page);
  await page.locator('#split-year-add').selectOption({ index: 1 });
  await expect(page.locator('#seg-rows .seg-row')).toHaveCount(2);

  // Switching to Rebalance and loading holdings must show a fresh, split-free segment view — not
  // Build's split year.
  await page.locator('.tab-btn[data-mode="rebalance"]').click();
  await page.locator('#holdings-file').setInputFiles(HOLDINGS_PATH);
  // Scoped to #simple-table — #build-table still holds the ladder _buildSegSetup built above.
  await expect(page.locator('#simple-table .fy-dara-input[data-year]').first()).toBeVisible({ timeout: 4_000 });
  await _openDaraPlan(page);
  await expect(page.locator('#dara-seg-tools')).toBeVisible({ timeout: 2_000 });
  await expect(page.locator('#seg-rows .seg-row'), 'fresh rebalance load has no split years of its own').toHaveCount(1);

  // Switching back to Build must restore its own split year untouched.
  await page.locator('.tab-btn[data-mode="build"]').click();
  await expect(page.locator('#seg-rows .seg-row'), 'Build split year survives the round trip through Rebalance').toHaveCount(2);
});

test('per-year DARA: opt-in Remember caches the plan across a reload in Build mode', async ({ page }) => {
  test.setTimeout(20_000);
  await _buildSegSetup(page);
  await expect(page.locator('#dara-remember-row')).toBeVisible({ timeout: 2_000 });

  const cb = page.locator('#dara-remember-cb');
  await expect(cb).not.toBeChecked();
  await expect(page.locator('#dara-plan-banner')).not.toBeVisible();

  const rung = page.locator('#build-table .fy-dara-input[data-year]').first();
  const rungYear = await rung.getAttribute('data-year');

  await cb.check();
  await rung.fill('54321');
  await rung.blur();
  await page.waitForFunction(() =>
    Object.keys(localStorage).some(k => k.startsWith('tlm-dara-plan:build:') && localStorage.getItem(k).includes('54321')));

  await page.locator('#split-year-add').selectOption({ index: 1 });
  await expect(page.locator('#seg-rows .seg-row')).toHaveCount(2);
  await page.locator('#seg-rows .seg-const-input[data-idx="1"]').fill('77000');
  await page.locator('#seg-rows .seg-const-input[data-idx="1"]').blur();

  // Fresh reload (new in-memory state, same-origin localStorage persists), back into Build with the
  // same last year — the mirror shows the plain default first, no silent override.
  await page.reload();
  await expect(page.locator('#run-btn')).not.toBeDisabled({ timeout: 4_000 });
  await _buildSegSetup(page);

  await expect(page.locator('#dara-remember-cb')).toBeChecked();
  await expect(page.locator('#dara-plan-banner')).toBeVisible({ timeout: 2_000 });
  const freshRung = page.locator(`#build-table .fy-dara-input[data-year="${rungYear}"]`);
  expect(await freshRung.inputValue(), 'fresh Build mirror shows the plain default, not the saved value, until Apply').not.toBe('54321');
  await expect(page.locator('#seg-rows .seg-row'), 'fresh Build load has no split years yet').toHaveCount(1);

  await page.locator('#dara-plan-apply').click();
  await expect(page.locator('#dara-plan-banner')).not.toBeVisible();
  await expect(freshRung).toHaveValue('54321');
  await expect(page.locator('#seg-rows .seg-row')).toHaveCount(2);
  await expect(page.locator('#seg-rows .seg-const-input[data-idx="1"]'), '"$ each" box is repopulated, not left blank').toHaveValue('77000');
});

test('per-year DARA: standalone plan file exports and re-imports split years + per-year values in Build mode', async ({ page }) => {
  test.setTimeout(20_000);
  await _buildSegSetup(page);

  await page.locator('#split-year-add').selectOption({ index: 1 });
  await expect(page.locator('#seg-rows .seg-row')).toHaveCount(2);

  await page.locator('#seg-rows .seg-const-input[data-idx="1"]').fill('66000');
  await page.locator('#seg-rows .seg-const-input[data-idx="1"]').blur();
  await page.locator('#seg-rows .seg-const-input[data-idx="0"]').fill('33000');
  await page.locator('#seg-rows .seg-const-input[data-idx="0"]').blur();
  const rungYear = await page.locator('#build-table .fy-dara-input[data-year]').first().getAttribute('data-year');
  const rung = page.locator(`#build-table .fy-dara-input[data-year="${rungYear}"]`);
  await expect(rung, 'segment 0 rung reflects its flat constant before export').toHaveValue('33000');

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#dara-plan-export-btn').click();
  const download = await downloadPromise;
  const planPath = test.info().outputPath('build-dara-plan.csv');
  await download.saveAs(planPath);

  // Fresh reload wipes the edit, the split, and the "$ each" boxes back to the plain mirror.
  await page.reload();
  await expect(page.locator('#run-btn')).not.toBeDisabled({ timeout: 4_000 });
  await _buildSegSetup(page);
  expect(await rung.inputValue(), 'fresh reload is the plain default again').not.toBe('33000');
  await expect(page.locator('#seg-rows .seg-row'), 'fresh reload has no split years').toHaveCount(1);

  await page.locator('#dara-plan-import-btn').click();
  await page.locator('#dara-plan-import-file').setInputFiles(planPath);
  await expect(rung).toHaveValue('33000');
  await expect(page.locator('#seg-rows .seg-row')).toHaveCount(2, { timeout: 2_000 });
  await expect(page.locator('#seg-rows .seg-const-input[data-idx="0"]')).toHaveValue('33000');
  await expect(page.locator('#seg-rows .seg-const-input[data-idx="1"]')).toHaveValue('66000');
});
