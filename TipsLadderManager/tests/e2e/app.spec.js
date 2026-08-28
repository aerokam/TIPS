// E2E regression tests — guards against GUI breakage (inop buttons, broken table render, drill popups)
// Run: npx playwright test
// Mocks EVERY R2 fetch with a local fixture (YieldsFromFedInvestPrices.csv, FidelityTreasuriesTips.csv,
// RefCPI.csv, TipsRef.csv, YieldsSaSao.csv, BondHolidaysSifma.csv) via page.route() in beforeEach below —
// the test browser has no live network egress in a sandboxed session, so an unmocked R2 URL fails with
// "Failed to fetch" (this is by design, not flakiness; well-known, see 3.1_Data_Pipeline.md §Testing).
// Any new required R2 fetch added to shared/src/market-data.js MUST get a matching fixture file + route() mock here, or
// every test hangs/fails at the beforeEach's data-load wait, not just tests that touch the new field.

import { test, expect } from 'playwright/test';
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { nextBondTradingDay } from '../../../shared/src/market-data.js';
import { parseHolidaySet } from '../../../shared/src/settlement.js';
import { parseCsv as parseCsvRows } from '../../../shared/src/csv.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FIXTURES = path.join(ROOT, 'tests', 'e2e');
const csv = name => readFileSync(path.join(FIXTURES, name), 'utf8');

// Compute today's T+1 settlement date using the same logic as the live app.
function computeSettleDateStr() {
  const holidayText = readFileSync(path.join(FIXTURES, 'BondHolidaysSifma.csv'), 'utf8');
  const bondHolidays = parseHolidaySet(parseCsvRows(holidayText, false));
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
// Built on real market data from a year ago with every maturity month held, so its 2026 rungs for
// January, April and July have since matured (tests/fixtures/yearago/build-fixtures.mjs).
const YEARAGO_ALL_PATH = path.join(ROOT, 'tests', 'fixtures', 'yearago', 'ladder-2026-2040-dara40k-all.csv');

// The #dara box shows a literal number for a flat scalar, or is blank with a "by year" placeholder
// whenever the shape is custom per-year (a single number would be misleading there).
// Returns the value as a string when set, or the literal token 'by year' when blank+placeholder.
async function daraDisplay(page) {
  const dara = page.locator('#dara');
  const val = (await dara.inputValue()).trim();
  if (val !== '') return val;
  const placeholder = await dara.getAttribute('placeholder');
  return placeholder === 'by year' ? 'by year' : '';
}

// Import/Export are a button+popup, not a native <select> (2.1 §Import/Export Menus — WebKit doesn't
// carry a strong enough user gesture through a <select>'s 'change' event to open a file picker/save).
// `menu` is 'import-menu' or 'export-menu'; `choice` is the target item's data-choice value.
async function chooseMenu(page, menu, choice) {
  await page.locator(`#${menu}-btn`).click();
  await page.locator(`#${menu}-list .menu-dropdown-item[data-choice="${choice}"]`).click();
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
  await page.route('**/TIPS/YieldsSaSao.csv', r =>
    r.fulfill({ body: csv('YieldsSaSao.csv'), contentType: 'text/csv' }));
  await page.route('**/misc/BondHolidaysSifma.csv', r =>
    r.fulfill({ body: csv('BondHolidaysSifma.csv'), contentType: 'text/csv' }));
  // Allow sample pre-populate to succeed (fetches data/SampleHoldings.csv via serve)
  await page.goto('./');
  // Wait for data load: run button must be enabled
  await expect(page.locator('#run-btn')).not.toBeDisabled({ timeout: 4_000 });
});

// ── 1. Data load ──────────────────────────────────────────────────────────────
test('data loads: info strip shows Trade/Settle, no Ref CPI control in either mode, run button enabled', async ({ page }) => {
  await expect(page.locator('#info-source')).toContainText('Trade:');
  await expect(page.locator('#info-source')).toContainText('Settle:');
  await expect(page.locator('#run-btn')).not.toBeDisabled();

  // Both modes price at the settlement date, so neither offers a Ref CPI date to change
  // (3.0 §RefCPI Date Override). A ladder stated at an older date arrives as a file that records
  // one, not as a control the user sets.
  for (const mode of ['rebalance', 'build']) {
    if (mode === 'build') await page.locator('.tab-btn[data-mode="build"]').click();
    await expect(page.locator('#info-source')).not.toContainText('Ref CPI:');
    await expect(page.locator('#refcpi-link')).toHaveCount(0);
    await expect(page.locator('#refcpi-picker')).toHaveCount(0);
  }
});

// ── 2. Mode toggle ────────────────────────────────────────────────────────────
test('mode toggle: switching to Build narrows the Import menu to DARA Plan, shows year fields; run button re-labeled', async ({ page }) => {
  // Start in Rebalance mode
  await expect(page.locator('#run-btn')).toHaveText('Rebalance Ladder');
  await expect(page.locator('#import-menu-btn')).toBeVisible();
  await expect(page.locator('#import-opt-cusip-qty')).toBeEnabled();
  await expect(page.locator('#field-last-year')).not.toBeVisible();

  // Switch to Build — Import menu stays visible (DARA Plan still importable there) but loses the
  // CUSIP/Qty option, since Build has no holdings to browse for.
  await page.locator('.tab-btn[data-mode="build"]').click();
  await expect(page.locator('#run-btn')).toHaveText('Build Ladder');
  await expect(page.locator('#import-menu-btn')).toBeVisible();
  await expect(page.locator('#import-opt-cusip-qty')).toBeHidden();
  await expect(page.locator('#field-last-year')).toBeVisible();

  // Switch back to Rebalance
  await page.locator('.tab-btn[data-mode="rebalance"]').click();
  await expect(page.locator('#run-btn')).toHaveText('Rebalance Ladder');
  await expect(page.locator('#import-menu-btn')).toBeVisible();
  await expect(page.locator('#import-opt-cusip-qty')).toBeEnabled();
  await expect(page.locator('#field-last-year')).not.toBeVisible();
});

// ── 2b. Import/Export popup open/close ─────────────────────────────────────────
// Regression test for a real bug this exact setup produced: `.menu-dropdown`/`.menu-dropdown-item`
// both set `display` explicitly, which silently overrides the `[hidden]` attribute's default
// `display:none` at equal CSS specificity — the popup rendered open at all times regardless of the
// `hidden` attribute the toggle logic was setting. Playwright's .click() doesn't care whether an
// element was already visually open, so every earlier test still passed even with this bug present;
// this test asserts the actual visual open/closed state, not just that a click has an effect.
test('Import menu popup is closed by default, opens on button click, closes on outside click', async ({ page }) => {
  await expect(page.locator('#import-menu-list')).toBeHidden();
  await page.locator('#import-menu-btn').click();
  await expect(page.locator('#import-menu-list')).toBeVisible();
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('#import-menu-list')).toBeHidden();
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

// Maturity preference (2.0 §Maturity Selection Within a Funded Year) is shared UI, visible in
// both modes since Rebalance's target side reads it too (rebalance-lib.js allocationPolicy B) --
// previously Build-only. Each mode keeps its own independent selection (see the next test).
test('maturity preference field visible in both Rebalance and Build', async ({ page }) => {
  await expect(page.locator('#field-build-maturity')).toBeVisible();
  await page.locator('.tab-btn[data-mode="build"]').click();
  await expect(page.locator('#field-build-maturity')).toBeVisible();
  await page.locator('.tab-btn[data-mode="rebalance"]').click();
  await expect(page.locator('#field-build-maturity')).toBeVisible();
});

// Maturity preference / Allocation policy live directly in the main form card, not gated behind
// a DARA existing. Asserted with NO holdings loaded and no DARA entered (freshest possible state).
test('Maturity preference and Allocation policy are visible before any DARA exists', async ({ page }) => {
  await expect(page.locator('#field-build-maturity')).toBeVisible();
  await expect(page.locator('#field-alloc-policy')).toBeVisible();
});

// Maturity preference 'last'/'first' already commits every year to one fixed direction, which is
// exactly what allocation policy 'maturity' expresses -- letting 'equal'/'saYield' apply on top of
// a fixed direction is what caused priority order to look wrong regardless of which was picked.
// The dropdown locks to 'Maturity order' (disabled) under 'last'/'first' and unlocks for
// 'all'/'semiannual'/'select', which have no single fixed direction of their own.
test('allocation policy locks to Maturity order under a fixed maturity preference, unlocks otherwise', async ({ page }) => {
  await expect(page.locator('#build-maturity')).toHaveValue('last'); // default
  await expect(page.locator('#rebal-alloc-policy')).toBeDisabled();
  await expect(page.locator('#rebal-alloc-policy')).toHaveValue('maturity');

  await page.locator('#build-maturity').selectOption('all');
  await expect(page.locator('#rebal-alloc-policy')).toBeEnabled();

  await page.locator('#build-maturity').selectOption('first');
  await expect(page.locator('#rebal-alloc-policy')).toBeDisabled();
  await expect(page.locator('#rebal-alloc-policy')).toHaveValue('maturity');

  await page.locator('#build-maturity').selectOption('semiannual');
  await expect(page.locator('#rebal-alloc-policy')).toBeEnabled();
});

test('maturity preference: Rebalance and Build keep independent selections across a mode switch', async ({ page }) => {
  await page.locator('#build-maturity').selectOption('first');
  await page.locator('.tab-btn[data-mode="build"]').click();
  await expect(page.locator('#build-maturity')).toHaveValue('last'); // Build's own untouched default
  await page.locator('#build-maturity').selectOption('all');
  await page.locator('.tab-btn[data-mode="rebalance"]').click();
  await expect(page.locator('#build-maturity')).toHaveValue('first'); // Rebalance's own selection survives
  await page.locator('.tab-btn[data-mode="build"]').click();
  await expect(page.locator('#build-maturity')).toHaveValue('all'); // Build's own selection survives too
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

// Regression: the help modal is supposed to be draggable/resizable like every other modal
// (src/modal.js makeDraggableResizable), but the wiring (id, resize handles, position:fixed,
// the makeDraggableResizable() call itself) went missing at some point. Drag the title bar and
// confirm the modal actually moves.
test('help modal: draggable via its title bar', async ({ page }) => {
  await page.locator('#help-btn').click();
  const modal = page.locator('#help-modal');
  await expect(modal).toBeVisible();

  const before = await modal.boundingBox();
  const title = page.locator('#help-title');
  const titleBox = await title.boundingBox();

  await page.mouse.move(titleBox.x + titleBox.width / 2, titleBox.y + 10);
  await page.mouse.down();
  await page.mouse.move(titleBox.x + titleBox.width / 2 + 80, titleBox.y + 60, { steps: 5 });
  await page.mouse.up();

  const after = await modal.boundingBox();
  expect(after.x, 'modal moved horizontally after dragging its title bar').not.toBe(before.x);
  expect(after.y, 'modal moved vertically after dragging its title bar').not.toBe(before.y);
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
  // The Bracket Amount popup lists each gap year's "↳ PLI credit"; each must drill into the shared
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

  // Expand all groups so bracket sub-rows (bracketAmount cells) become visible.
  const expandAllBtn = page.locator('#expand-collapse-all-btn');
  if ((await expandAllBtn.textContent())?.trim() === 'Expand All') await expandAllBtn.click();

  const gapCell = page.locator('#build-table td.drillable[data-col="bracketAmount"]').first();
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

// ── Select maturities determines the ladder's real range, not the stale First/Last Year fields ──
// Regression: picking only October maturities (which run out well before 2056) left the panel
// still using the untouched Last Year field's value. Clearing every column then picking one
// column's "All" reproduces "select just one maturity month" without depending on which exact
// years that column happens to cover in the fixture data.
async function _pickOnlyColumn(page, monthLabel) {
  for (const btn of await page.locator('.mp-col-none').all()) await btn.click();
  const col = await page.locator('.mp-col-hdr', { hasText: monthLabel }).locator('.mp-col-all').getAttribute('data-col');
  await page.locator(`.mp-col-all[data-col="${col}"]`).click();
}

test('build: Select maturities picks determine the ladder range, not the stale Last Year field', async ({ page }) => {
  test.setTimeout(20_000);
  await page.locator('.tab-btn[data-mode="build"]').click();
  await page.locator('#last-year').selectOption({ value: '2056' });
  await page.locator('#build-maturity').selectOption({ value: 'select' });
  await expect(page.locator('#maturity-picker-overlay')).toBeVisible({ timeout: 2_000 });

  await _pickOnlyColumn(page, 'Oct');
  await page.locator('#maturity-picker-apply').click();
  await expect(page.locator('#build-output')).toHaveCSS('display', 'block', { timeout: 4_000 });

  const rangeText = await page.locator('#val-range').textContent();
  expect(rangeText, `Range should reflect the October-only picks, not the untouched 2056 field (got "${rangeText}")`).not.toContain('2056');

  // Last Year stays visible (not hidden) but disabled, and mirrors what the picks actually produced.
  await expect(page.locator('#last-year')).toBeDisabled();
  const lastYearShown = await page.locator('#last-year').inputValue();
  expect(lastYearShown).not.toBe('2056');
  expect(rangeText).toContain(lastYearShown);
});

// Regression: deselecting every maturity in the year the ladder started at, and picking the NEXT
// year instead, must move the ladder's real first year forward — it previously stayed pinned to
// the original (now fully-deselected) first year with a forced $0 there.
test('build: deselecting the first year entirely moves the ladder\'s real first year forward', async ({ page }) => {
  test.setTimeout(20_000);
  await page.locator('.tab-btn[data-mode="build"]').click();
  await page.locator('#last-year').selectOption({ value: '2030' });
  await page.locator('#build-maturity').selectOption({ value: 'select' });
  await expect(page.locator('#maturity-picker-overlay')).toBeVisible({ timeout: 2_000 });

  for (const btn of await page.locator('.mp-col-none').all()) await btn.click();
  await page.locator('input[type=checkbox][data-year="2027"]').first().check();
  await page.locator('#maturity-picker-apply').click();
  await expect(page.locator('#build-output')).toHaveCSS('display', 'block', { timeout: 4_000 });

  const rangeText = await page.locator('#val-range').textContent();
  expect(rangeText, `Range should start at 2027 (the earliest actual pick), not 2026 (got "${rangeText}")`).toContain('2027');
  expect(rangeText).not.toContain('2026');
  await expect(page.locator('#first-year')).toBeDisabled();
  await expect(page.locator('#first-year')).toHaveValue('2027');
});

// Regression: switching the Maturity preference away from "Select maturities" used to wipe every
// pick, forcing the whole picker to be redone from scratch just to adjust the range via a named
// policy and come back. Picks must now survive that round trip.
test('build: Select maturities picks survive switching to a named policy and back', async ({ page }) => {
  test.setTimeout(20_000);
  await page.locator('.tab-btn[data-mode="build"]').click();
  await page.locator('#last-year').selectOption({ value: '2030' });
  await page.locator('#build-maturity').selectOption({ value: 'select' });
  await expect(page.locator('#maturity-picker-overlay')).toBeVisible({ timeout: 2_000 });

  for (const btn of await page.locator('.mp-col-none').all()) await btn.click();
  await page.locator('input[type=checkbox][data-year="2027"]').first().check();
  await page.locator('#maturity-picker-apply').click();
  await expect(page.locator('#build-output')).toHaveCSS('display', 'block', { timeout: 4_000 });

  await page.locator('#build-maturity').selectOption({ value: 'last' });
  await page.locator('#build-maturity').selectOption({ value: 'select' });
  await expect(page.locator('#maturity-picker-overlay')).toBeVisible({ timeout: 2_000 });
  await expect(page.locator('input[type=checkbox][data-year="2027"]').first()).toBeChecked();
});

// Same rule applies in Rebalance — not just Build. Loads real holdings, then narrows via Select
// maturities to a single year; First/Last Year must go disabled-but-visible and mirror that year,
// same as Build.
test('rebalance: Select maturities picks determine the effective range there too', async ({ page }) => {
  test.setTimeout(20_000);
  await page.locator('#holdings-file').setInputFiles(HOLDINGS_PATH);
  await expect(page.locator('.fy-dara-input[data-year]').first()).toBeVisible({ timeout: 4_000 });

  await page.locator('#build-maturity').selectOption({ value: 'select' });
  await expect(page.locator('#maturity-picker-overlay')).toBeVisible({ timeout: 2_000 });
  for (const btn of await page.locator('.mp-col-none').all()) await btn.click();
  await page.locator('input[type=checkbox][data-year="2027"]').first().check();
  await page.locator('#maturity-picker-apply').click();
  await expect(page.locator('#maturity-picker-overlay')).toBeHidden();

  await expect(page.locator('#rebal-first-year')).toBeDisabled();
  await expect(page.locator('#rebal-last-year')).toBeDisabled();
  await expect(page.locator('#rebal-first-year')).toHaveValue('2027');
  await expect(page.locator('#rebal-last-year')).toHaveValue('2027');
});

// Rebuilding #simple-table on every Rebalance Ladder run wipes every fy-group-header's
// data-expanded attribute -- _captureExpandedState/_restoreOrDefaultGroupsExpanded carry the prior
// expand/collapse state across the rebuild so re-running after a Maturity preference/Allocation
// policy change doesn't collapse whatever the user had open.
test('rebalance: expanded/collapsed funded years survive re-running Rebalance Ladder', async ({ page }) => {
  await page.locator('#holdings-file').setInputFiles(HOLDINGS_PATH);
  await page.locator('#run-btn').click();
  await expect(page.locator('#simple-table tbody tr').first()).toBeVisible({ timeout: 4_000 });

  const headers = page.locator('#simple-table tbody tr.fy-group-header');
  const first = headers.first();
  const second = headers.nth(1);
  // Ordinary (non-bracket) groups start collapsed by default -- confirm before changing anything.
  await expect(first).toHaveAttribute('data-expanded', 'false');
  await expect(second).toHaveAttribute('data-expanded', 'false');

  await first.click(); // expand only the first group
  await expect(first).toHaveAttribute('data-expanded', 'true');

  await page.locator('#run-btn').click();
  await expect(page.locator('#simple-table tbody tr').first()).toBeVisible({ timeout: 4_000 });
  await expect(headers.first()).toHaveAttribute('data-expanded', 'true');
  await expect(headers.nth(1)).toHaveAttribute('data-expanded', 'false');
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

test('rebalance: priority-order modal reorders chips with left/right buttons, not up/down', async ({ page }) => {
  await page.locator('#holdings-file').setInputFiles(HOLDINGS_PATH);
  await page.locator('#dara').fill('10000');
  await expect(page.locator('.fy-dara-input[data-year]').first()).toBeVisible({ timeout: 3_000 });

  // Allocation policy is locked to 'Maturity order' (and the dropdown disabled) whenever Maturity
  // preference is 'last'/'first' -- switch to 'all' to unlock it before opening the picker.
  await page.locator('#build-maturity').selectOption('all');
  await page.locator('#rebal-alloc-policy').selectOption('select');
  await expect(page.locator('#rank-picker-overlay')).toBeVisible();
  await expect(page.locator('.rp-chip .rp-left').first()).toBeVisible();
  await expect(page.locator('.rp-chip .rp-right').first()).toBeVisible();
  expect(await page.locator('.rp-up, .rp-down').count()).toBe(0);
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

test('rebalance: pressing Enter (no overlay open) triggers Rebalance Ladder', async ({ page }) => {
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
test('rebalance: export menu Ladder CSV/CUSIP-Qty options stay disabled until a run completes, DARA Plan does not', async ({ page }) => {
  await page.locator('#holdings-file').setInputFiles(HOLDINGS_PATH);
  await expect(page.locator('.fy-dara-input[data-year]').first()).toBeVisible({ timeout: 4_000 });
  await expect(page.locator('#export-opt-ladder-csv')).toBeDisabled();
  await expect(page.locator('#export-opt-cusip-qty')).toBeDisabled();
  await expect(page.locator('#export-menu-list .menu-dropdown-item[data-choice="dara-plan"]')).toBeEnabled();
});

test('rebalance: export button visible after run and triggers CSV download', async ({ page }) => {
  await page.locator('#holdings-file').setInputFiles(HOLDINGS_PATH);
  await page.locator('#run-btn').click();
  await expect(page.locator('#simple-table tbody tr').first()).toBeVisible({ timeout: 4_000 });

  await expect(page.locator('#export-opt-ladder-csv')).toBeEnabled();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    chooseMenu(page, 'export-menu', 'ladder-csv'),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.csv$/i);
});

test('build: export menu Ladder CSV option enabled after run', async ({ page }) => {
  await page.locator('.tab-btn[data-mode="build"]').click();
  const lastYearSel = page.locator('#last-year');
  const optionCount = await lastYearSel.locator('option').count();
  await lastYearSel.selectOption({ index: optionCount - 1 });

  await page.locator('#run-btn').click();
  await expect(page.locator('#build-output')).toHaveCSS('display', 'block', { timeout: 4_000 });
  await expect(page.locator('#export-opt-ladder-csv')).toBeEnabled();
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

// ── 16c. Infer DARA over a selected range fills an empty interior year ────────
// Regression (pre-selection-model): the gap-free portfolio holds nothing in 2029 (an interior
// hole). Inferring a self-financing DARA over a range that spans 2029 must FILL 2029 to that value
// (target ≥ 1 bond) — an explicitly-raised empty year is the user's stated intent, not a hole
// (3.0 §Intentional empty rungs). Selects 2029 (empty) through 2031 (held) directly on the ladder
// table, then Infer DARA (3.0 §Per-Rung DARA Selection).
test('rebalance: Infer DARA over a selected range fills an empty interior year', async ({ page }) => {
  test.setTimeout(20_000);
  await page.locator('#holdings-file').setInputFiles(path.join(FIXTURES, 'OfxInteriorHoles.csv'));
  await expect(page.locator('.fy-dara-input[data-year]').first()).toBeVisible({ timeout: 4_000 });

  await page.locator('#simple-table tr.fy-group-header[data-fy="2029"]').click({ delay: 650 });
  await page.locator('#simple-table tr.fy-group-header[data-fy="2031"]').click({ modifiers: ['Shift'] });
  await expect(page.locator('#selection-toolbar')).toBeVisible();
  await page.locator('#selection-infer-btn').click();

  // Panel now shows a flat inferred DARA on 2029 (the empty year) — visible in the rung itself,
  // which is why Infer needs no separate Apply step and closes its own selection once done.
  const val2029 = await page.locator('.fy-dara-input[data-year="2029"]').inputValue();
  expect(parseFloat(val2029.replace(/[^0-9.-]/g, '')), '2029 shows the inferred DARA in the panel').toBeGreaterThan(1000);
  await expect(page.locator('#selection-toolbar'), 'Infer DARA applies immediately and closes the selection, same as Set DARA').not.toBeVisible();

  await page.locator('#run-btn').click();
  await expect(page.locator('#simple-table')).toBeVisible({ timeout: 4_000 });

  // The per-funded-year total lives in the group-header row (e.g. "▶ 2029 … 0  64  +64 …").
  // Find the 2029 group row and assert it shows a positive Qty Delta — i.e. 2029 was BOUGHT to the
  // inferred DARA rather than left as an empty hole.
  const row2029 = page.locator('#simple-table tr.fy-group-header[data-fy="2029"]').first();
  await expect(row2029).toBeVisible();
  const rowText = (await row2029.textContent() ?? '').replace(/\s+/g, ' ');
  expect(rowText, `2029 must FILL to the inferred DARA (got "${rowText.trim()}"), not stay an empty hole`).toMatch(/\+\s*[1-9]\d*/);
});

// A click-drag across rows (3.0 §Per-Rung DARA Selection §Selecting rungs) must show the row under
// the cursor as selected (yellow) WHILE the mouse is still over it, mid-drag, not only after the
// mouse leaves — a same-specificity `:hover` CSS rule used to win over `.selected` and mask the
// yellow until the cursor moved off the row (6.0 §Selection Toolbar).
test('rebalance: click-drag selection highlights the row under the cursor immediately, before mouseup', async ({ page }) => {
  await page.locator('#holdings-file').setInputFiles(HOLDINGS_PATH);
  await expect(page.locator('.fy-dara-input[data-year]').first()).toBeVisible({ timeout: 4_000 });

  const rows = page.locator('#simple-table tr.fy-group-header');

  // Real dragging sweeps the cursor continuously through the rows as they're actually laid out on
  // screen (re-reading each row's position right before moving to it), not to stale precomputed
  // coordinates — the selection toolbar appearing mid-drag grows #top-row and shifts every row down,
  // so a naive one-shot jump to a coordinate captured before the drag started can under- or
  // over-shoot once that reflow happens.
  const startBox = await rows.nth(0).boundingBox();
  await page.mouse.move(startBox.x + 10, startBox.y + startBox.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 2; i++) {
    const box = await rows.nth(i).boundingBox();
    await page.mouse.move(box.x + 10, box.y + box.height / 2);
  }

  // Still holding the mouse over the last row (row index 2) — assert it's visibly yellow now, not
  // masked by the hover teal.
  const lastRow = rows.nth(2);
  await expect(lastRow).toHaveClass(/selected/);
  const bg = await lastRow.locator('td').first().evaluate(td => getComputedStyle(td).backgroundColor);
  expect(bg, 'row under the cursor mid-drag must already show the yellow selected background').toBe('rgb(255, 233, 168)');

  await page.mouse.up();
});

// A quick click and a selecting click are different gestures now (3.0 §Selecting rungs) — a quick
// click (press+release, no hold) only toggles expand/collapse and never highlights the row yellow;
// a press-and-hold past the ~600ms threshold only selects and never toggles.
test('rebalance: quick click toggles expand/collapse only, press-and-hold selects only', async ({ page }) => {
  await page.locator('#holdings-file').setInputFiles(HOLDINGS_PATH);
  await expect(page.locator('.fy-dara-input[data-year]').first()).toBeVisible({ timeout: 4_000 });

  const row = page.locator('#simple-table tr.fy-group-header').first();
  const expandedBefore = await row.getAttribute('data-expanded');

  await row.click();
  await expect(row, 'quick click toggles expand/collapse').not.toHaveAttribute('data-expanded', expandedBefore);
  await expect(row, 'quick click must not select the row').not.toHaveClass(/selected/);

  const expandedAfterClick = await row.getAttribute('data-expanded');
  await row.click({ delay: 650 });
  await expect(row, 'press-and-hold selects the row').toHaveClass(/selected/);
  await expect(row, 'press-and-hold must not toggle expand/collapse').toHaveAttribute('data-expanded', expandedAfterClick);
});

// The selection toolbar's display:none/flex flip grows #top-row and shifts the table below it down
// (6.0 §Selection Toolbar). Revealing it the instant a hold fires, while the button is still down,
// pushes the just-selected row out from under a stationary cursor — the row above ends up under the
// cursor instead, reading as if the wrong row got selected even though it didn't. The reveal must
// stay deferred until mouseup.
test('rebalance: press-and-hold does not reveal the selection toolbar (and shift the table) before mouseup', async ({ page }) => {
  await page.locator('#holdings-file').setInputFiles(HOLDINGS_PATH);
  await expect(page.locator('.fy-dara-input[data-year]').first()).toBeVisible({ timeout: 4_000 });

  const row = page.locator('#simple-table tr.fy-group-header').first();
  const box = await row.boundingBox();
  await page.mouse.move(box.x + 10, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(700); // past the 600ms hold threshold, button still held down

  await expect(row, 'row selects while still held').toHaveClass(/selected/);
  await expect(page.locator('#selection-toolbar'), 'toolbar reveal stays deferred while the button is down').not.toBeVisible();

  await page.mouse.up();
  await expect(page.locator('#selection-toolbar'), 'toolbar appears once the gesture ends').toBeVisible();
});

// A completed cross-row drag never fires a native 'click' event at all (mousedown and mouseup land
// on different rows; browsers only fire click when both share a target), so `_dragSelecting` used to
// stay stuck `true` — a plain click's own mousedown reset it, but a Shift-click's mousedown returned
// early before reaching that reset, so the stale flag silently swallowed the Shift-click instead of
// extending the range (3.0 §Selecting rungs). Regression guard, also covers the anchor: the extension
// must run from the drag's START row, matching standard drag-then-Shift-click convention elsewhere.
test('rebalance: Shift-click after a click-and-drag extends the selection from the drag start', async ({ page }) => {
  await page.locator('#holdings-file').setInputFiles(HOLDINGS_PATH);
  await expect(page.locator('.fy-dara-input[data-year]').first()).toBeVisible({ timeout: 4_000 });

  const rows = page.locator('#simple-table tr.fy-group-header');
  const startBox = await rows.nth(0).boundingBox();
  await page.mouse.move(startBox.x + 10, startBox.y + startBox.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 2; i++) {
    const box = await rows.nth(i).boundingBox();
    await page.mouse.move(box.x + 10, box.y + box.height / 2);
  }
  await page.mouse.up();
  const dragYears = await page.locator('#simple-table tr.fy-group-header.selected').evaluateAll(els => els.map(e => e.dataset.fy));
  expect(dragYears.length, 'drag selects rows 0-2').toBe(3);

  const laterYear = await rows.nth(6).getAttribute('data-fy');
  await rows.nth(6).click({ modifiers: ['Shift'] });
  const afterYears = await page.locator('#simple-table tr.fy-group-header.selected').evaluateAll(els => els.map(e => e.dataset.fy));
  expect(afterYears.length, 'Shift-click after a drag must extend the range, not no-op').toBe(7);
  expect(afterYears[0], 'range still starts at the drag START row').toBe(dragYears[0]);
  expect(afterYears[afterYears.length - 1], 'range reaches the Shift-clicked row').toBe(laterYear);
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
    chooseMenu(page, 'export-menu', 'cusip-qty'),
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
  await chooseMenu(page, 'export-menu', 'cusip-qty');
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

// ── Per-rung DARA selection: select a range on the ladder table, then Set DARA / Infer DARA ──
// (3.0 §Per-Rung DARA Selection, replacing the old split-year/segment system.) Build a 2026–2055
// ladder, import it, then select ranges directly on the table and drive the selection toolbar.

// Build 2026–2055 @ 40k, export CUSIP/Qty, import into rebalance. Returns nothing; leaves the
// Rebalance table showing the imported ladder.
async function _selRebalSetup(page, name) {
  await page.locator('.tab-btn[data-mode="build"]').click();
  await page.locator('#last-year').selectOption({ value: '2055' });
  await page.locator('#dara').fill('40000');
  await page.locator('#run-btn').click();
  await expect(page.locator('#build-output')).toHaveCSS('display', 'block', { timeout: 4_000 });
  const dl = page.waitForEvent('download');
  await chooseMenu(page, 'export-menu', 'cusip-qty');
  const csvPath = test.info().outputPath(name);
  await (await dl).saveAs(csvPath);

  await page.locator('.tab-btn[data-mode="rebalance"]').click();
  await page.locator('#holdings-file').setInputFiles(csvPath);
  await expect(page.locator('.fy-dara-input[data-year]').first()).toBeVisible({ timeout: 4_000 });
}

// Press-and-hold the fromYear row (past the 600ms select threshold, 3.0 §Selecting rungs — a quick
// click only toggles expand/collapse now, it no longer selects) to anchor it, then Shift-click the
// toYear row to select the whole range between them.
async function _selectRange(page, tableSel, fromYear, toYear) {
  await page.locator(`${tableSel} tr.fy-group-header[data-fy="${fromYear}"]`).click({ delay: 650 });
  await page.locator(`${tableSel} tr.fy-group-header[data-fy="${toYear}"]`).click({ modifiers: ['Shift'] });
}

// Scoped to #simple-table — #build-table still holds the ladder _selRebalSetup built to produce the
// import file, and its leftover .fy-dara-input elements would otherwise pollute these lists.
const _lmpVals  = (page) => page.locator('#simple-table .fy-dara-input[data-year]').evaluateAll(els => els.filter(e => +e.dataset.year <= 2047).map(e => e.value));
const _specVals = (page) => page.locator('#simple-table .fy-dara-input[data-year]').evaluateAll(els => els.filter(e => +e.dataset.year >  2047).map(e => e.value));

test('Set/Infer DARA touch only the selected rungs, never any other rung', async ({ page }) => {
  test.setTimeout(20_000);
  await _selRebalSetup(page, 'seltest.csv');

  const specBefore = await _specVals(page);

  // 1. Infer the bottom range alone (2026-2047) → it flattens to one value; the top range, which was
  //    never selected, is untouched.
  await _selectRange(page, '#simple-table', 2026, 2047);
  await page.locator('#selection-infer-btn').click();
  const lmp1 = await _lmpVals(page);
  expect(new Set(lmp1).size, 'all rungs in the selection share one flat DARA').toBe(1);
  expect(await _specVals(page), 'inferring the bottom range leaves the top exactly as-is').toEqual(specBefore);

  // 2. Infer the top range (2048-2055) → it flattens to its own value; the bottom range, set in step
  //    1 and not reselected here, stays exactly as step 1 left it (no downstream restamping).
  await _selectRange(page, '#simple-table', 2048, 2055);
  await page.locator('#selection-infer-btn').click();
  const spec1 = await _specVals(page);
  expect(new Set(spec1).size, 'all top-range rungs share one flat DARA').toBe(1);
  expect(await _lmpVals(page), 'inferring the top range leaves the bottom exactly as step 1 left it').toEqual(lmp1);

  // 3. A typed Set DARA stamp behaves the same way — it only ever touches the rungs selected right
  //    now. (55000 is an arbitrary, not necessarily self-financing, number.)
  await _selectRange(page, '#simple-table', 2048, 2055);
  await page.locator('#selection-dara-input').fill('55000');
  await page.locator('#selection-set-btn').click();
  await expect(page.locator('#simple-table .fy-dara-input[data-year="2050"]')).toHaveValue('55000');
  expect(await _lmpVals(page), 'the bottom range is untouched by a Set DARA stamp on the top range').toEqual(lmp1);
  // Set DARA has nothing left to show once applied — the selection (and its toolbar) closes.
  await expect(page.locator('#selection-toolbar'), 'Set DARA clears the selection on Apply').not.toBeVisible();

  await page.locator('#run-btn').click();
  await expect(page.locator('#simple-table tbody tr').first()).toBeVisible({ timeout: 6_000 });
});

test('a hand-typed rung survives an Infer over a selection that includes it', async ({ page }) => {
  test.setTimeout(20_000);
  await _selRebalSetup(page, 'selpin.csv');

  // Hand-type one specific bottom-range year — this is the user's stated intent for that rung.
  const pinnedRung = page.locator('#simple-table .fy-dara-input[data-year="2030"]');
  await pinnedRung.fill('12345');
  await pinnedRung.blur();
  await expect(pinnedRung).toHaveValue('12345');

  const specBefore = await _specVals(page);

  // Infer the bottom range, which includes the pinned 2030 rung — it must survive untouched even
  // though the rest of the bottom range (its own selection) gets restamped around it. The top range,
  // never selected, is untouched.
  await _selectRange(page, '#simple-table', 2026, 2047);
  await page.locator('#selection-infer-btn').click();
  await expect(pinnedRung, 'hand-typed rung is not overwritten by its own selection\'s Infer').toHaveValue('12345');
  const lmpAfter = await _lmpVals(page);
  expect(new Set(lmpAfter.filter(v => v !== '12345')).size, 'the rest of the bottom range still flattens to one value').toBe(1);
  expect(await _specVals(page), 'the top range, never selected, is untouched').toEqual(specBefore);
});

test('inferring every segment of the ladder drives whole-portfolio net cash toward zero', async ({ page }) => {
  test.setTimeout(20_000);
  await _selRebalSetup(page, 'selorder.csv');

  // A single scoped Infer only guarantees ITS OWN segment nets to ~0 — inferring the top range alone
  // says nothing about the untouched bottom range. Only inferring every segment (their scopes union
  // to the whole ladder) drives whole-portfolio net cash toward zero.
  await _selectRange(page, '#simple-table', 2048, 2055);
  await page.locator('#selection-infer-btn').click();
  await _selectRange(page, '#simple-table', 2026, 2047);
  await page.locator('#selection-infer-btn').click();
  await page.locator('#run-btn').click();
  await expect(page.locator('#simple-table tbody tr').first()).toBeVisible({ timeout: 6_000 });
  const nc = parseNetCash(await page.locator('#net-cash-val').textContent());
  expect(Math.abs(nc), `net cash ≈ 0 after inferring every segment (got ${nc})`).toBeLessThan(3000);
});

// ── Standalone DARA-plan file (portable export/import) ────────────────────────
// Export writes a #fundedYear,dara file with no CUSIP rows; re-importing it onto a freshly
// (re-)loaded holdings file overlays the saved per-year values exactly.
test('per-year DARA: standalone plan file exports and re-imports per-year values', async ({ page }) => {
  test.setTimeout(20_000);
  await page.locator('#holdings-file').setInputFiles(HOLDINGS_PATH);
  await expect(page.locator('.fy-dara-input[data-year]').first()).toBeVisible({ timeout: 4_000 });

  const rungYear = await page.locator('.fy-dara-input[data-year]').first().getAttribute('data-year');
  const rung = page.locator(`.fy-dara-input[data-year="${rungYear}"]`);
  await rung.fill('33000');
  await rung.blur();
  await expect(rung, 'rung reflects the typed value before export').toHaveValue('33000');

  const downloadPromise = page.waitForEvent('download');
  await chooseMenu(page, 'export-menu', 'dara-plan');
  const download = await downloadPromise;
  const planPath = test.info().outputPath('dara-plan.csv');
  await download.saveAs(planPath);

  // Fresh re-upload wipes the edit back to the plain mirror. (Clear the input's value first —
  // same-file re-selection otherwise doesn't reliably re-fire 'change', mirroring the production
  // Browse-button handler's own workaround for this browser quirk.)
  await page.evaluate(() => { document.getElementById('holdings-file').value = ''; });
  await page.locator('#holdings-file').setInputFiles(HOLDINGS_PATH);
  await expect(page.locator('.fy-dara-input[data-year]').first()).toBeVisible({ timeout: 4_000 });
  expect(await rung.inputValue(), 'fresh reload is the plain mirror again').not.toBe('33000');

  await chooseMenu(page, 'import-menu', 'dara-plan');
  await page.locator('#dara-plan-import-file').setInputFiles(planPath);
  await expect(rung).toHaveValue('33000');
});

// A DARA plan that records no Ref CPI date of its own (every export written before the date was
// recorded, and any hand-written plan). The app cannot know the date and does not guess: the values
// are used as written, and the status strip offers to supply one. Supplying an earlier date scales
// the values from it to the settlement date (3.0 §DARA Basis Date).
// A broker file records no date, so the whole settlement year is counted. That is the right default
// for a position held all along, but it is an assumption the holder cannot otherwise see, and it
// moves trades, so the strip says so and offers the alternatives.
//
// The window is chosen from the coupon payment dates this portfolio was actually paid on, exclusive
// of the date named. Cash arrives only on those dates, so a free calendar offered a year of days of
// which at most six differed, and could not say whether the date picked was itself counted.
test("the received-cash window is chosen from this portfolio's own payment dates, exclusive of the one named", async ({ page }) => {
  test.setTimeout(20_000);
  const cash = page.locator('#available-cash');
  const pop = page.locator('#available-cash-popover');
  await expect(page.locator('#simple-table tbody tr').first()).toBeVisible({ timeout: 4_000 });

  // Auto-loaded sample holdings: broker-style, no #params line, so no date of its own.
  const wholeYear = Number(await cash.inputValue());
  expect(wholeYear).toBeGreaterThan(0);
  await expect(page.locator('#status')).toContainText('the settlement-year coupons this file carries');
  await expect(page.locator('#cash-set-since')).toBeVisible();

  // The choices live in a popup the Available Cash field itself opens, alongside a plain amount.
  await page.locator('#cash-set-since').click();
  await expect(pop).toBeVisible();

  const opts = await pop.locator('input[name="available-cash-choice"]').evaluateAll(
    els => els.map(e => ({ value: e.value, label: e.closest('label').textContent }))
  );
  expect(opts.length, 'every settlement-year payment, each later starting point, and an amount').toBeGreaterThan(2);
  expect(opts[0].value, 'every settlement-year payment is the first choice').toBe('');
  expect(opts[0].label).toContain('Every settlement-year payment');
  expect(opts[opts.length - 1].value, 'a stated amount is the last').toBe('manual');
  const settleYear = new Date().getFullYear();
  for (const o of opts.slice(1, -1)) {
    expect(o.label, 'every other choice names a payment date').toContain('After');
    expect(o.value, 'and is a settlement-year date').toContain(String(settleYear) + '-');
  }

  // Counting after the first payment date drops that payment, so less is on hand.
  await pop.locator(`input[value="${opts[1].value}"]`).check();
  await page.locator('#available-cash-apply').click();
  const afterFirst = Number(await cash.inputValue() || 0);
  expect(afterFirst, 'excluding a payment leaves less').toBeLessThan(wholeYear);

  // Nothing is received after the last payment date already made.
  await cash.click();
  await expect(pop.locator(`input[value="${opts[1].value}"]`)).toBeChecked();
  await pop.locator(`input[value="${opts[opts.length - 2].value}"]`).check();
  await page.locator('#available-cash-apply').click();
  expect(Number(await cash.inputValue() || 0)).toBe(0);

  // Back to every payment, and the figure returns.
  await cash.click();
  await pop.locator('input[value=""]').check();
  await page.locator('#available-cash-apply').click();
  expect(Number(await cash.inputValue() || 0)).toBeCloseTo(wholeYear, 2);

  // The offer is still the app's, so it still follows the Coupons control.
  await expect(page.locator('#available-cash-auto')).toBeVisible();
});

// Changing a control on the top card is the reason to be looking at an expanded year: the point is to
// see what the change did to that year. Collapsing the table on the way to showing the effect hides
// the effect, so expansion state survives every re-render (6.0 §Expand/Collapse State).
test('the ladder table keeps its expansion state when a top-card control changes', async ({ page }) => {
  test.setTimeout(20_000);
  await expect(page.locator('#simple-table tbody tr').first()).toBeVisible({ timeout: 4_000 });

  // Allocation policy is locked to maturity order under the default Last to mature preference
  // (2.0 §Within-Year Allocation Policy), so unlock it first. Its change handler is the one that
  // rebuilds the Before-state preview from scratch.
  await page.locator('#build-maturity').selectOption({ value: 'all' });
  await expect(page.locator('#rebal-alloc-policy')).toBeEnabled();

  await page.locator('#expand-collapse-all-btn').click();
  const headers = page.locator('#simple-table tr.fy-group-header');
  const before = await headers.evaluateAll(els => els.map(e => e.dataset.expanded));
  expect(before.length).toBeGreaterThan(1);
  expect(before.every(v => v === 'true'), 'Expand All expanded every group').toBe(true);

  await page.locator('#rebal-alloc-policy').selectOption({ value: 'saYield' });
  await expect(page.locator('#simple-table tbody tr').first()).toBeVisible();
  const after = await headers.evaluateAll(els => els.map(e => e.dataset.expanded));
  expect(after.length, 'the table was rebuilt, not left alone').toBe(before.length);
  expect(after.every(v => v === 'true'), 'still expanded after the change').toBe(true);

  // And a collapsed table stays collapsed: the state is carried, not forced open.
  await page.locator('#expand-collapse-all-btn').click();
  await page.locator('#rebal-alloc-policy').selectOption({ value: 'equal' });
  await expect(page.locator('#simple-table tbody tr').first()).toBeVisible();
  const collapsed = await headers.evaluateAll(els => els.map(e => e.dataset.expanded));
  expect(collapsed.every(v => v === 'false'), 'still collapsed after the change').toBe(true);
});

// The figure is either one the app counts from the payments already received or one the holder
// states outright, and both are chosen in the popup the field opens (2.0 §Available Cash). Clicking
// the field does not put a cursor in it: the chooser is where the figure is set.
test('Available Cash takes either a set of received payments or a stated amount', async ({ page }) => {
  test.setTimeout(20_000);
  const cash = page.locator('#available-cash');
  const pop = page.locator('#available-cash-popover');
  await expect(page.locator('#simple-table tbody tr').first()).toBeVisible({ timeout: 4_000 });

  const wholeYear = Number(await cash.inputValue());
  expect(wholeYear).toBeGreaterThan(0);
  await expect(page.locator('#available-cash-auto')).toBeVisible();

  // A stated amount stands, and the amber mark clears: the figure is no longer the app's.
  await cash.click();
  await expect(pop).toBeVisible();
  await pop.locator('input[value="manual"]').check();
  await page.locator('#available-cash-manual').fill('1234');
  await page.locator('#available-cash-apply').click();
  await expect(pop).toBeHidden();
  await expect(cash).toHaveValue('1234');
  await expect(page.locator('#available-cash-auto')).toBeHidden();

  // Reopening shows the stated amount, and choosing payments again asks for the app's figure back.
  await cash.click();
  await expect(pop.locator('input[value="manual"]')).toBeChecked();
  await expect(page.locator('#available-cash-manual')).toHaveValue('1234');
  await pop.locator('input[value=""]').check();
  await page.locator('#available-cash-apply').click();
  expect(Number(await cash.inputValue() || 0)).toBeCloseTo(wholeYear, 2);
  await expect(page.locator('#available-cash-auto')).toBeVisible();

  // Cancel leaves the figure alone.
  await cash.click();
  await pop.locator('input[value="manual"]').check();
  await page.locator('#available-cash-manual').fill('99');
  await page.locator('#available-cash-cancel').click();
  await expect(pop).toBeHidden();
  expect(Number(await cash.inputValue() || 0)).toBeCloseTo(wholeYear, 2);
});

// Whether this year's coupons were kept toward this year or reinvested is one decision, asked on the
// settlement year's Coupons control. The offered Available Cash follows it live. Maturity proceeds do
// not: returned principal is not coupon income. And once the holder types a figure of their own, the
// app stops touching the box, including when the Coupons setting changes afterwards.
test('Available Cash follows the Coupons setting, and stops once the holder sets it', async ({ page }) => {
  test.setTimeout(20_000);
  const cash = page.locator('#available-cash');
  const mark = page.locator('#available-cash-auto');
  await expect(page.locator('#simple-table tbody tr').first()).toBeVisible({ timeout: 4_000 });

  // Sample holdings: a broker-style file, so the offer is coupons only (a broker never lists a
  // matured bond). That makes it the clean case for watching the coupon half switch off.
  const withAll = Number(await cash.inputValue());
  expect(withAll, 'coupons received this year are offered by default').toBeGreaterThan(0);
  await expect(mark).toBeVisible();

  const firstYear = await page.locator('#simple-table .fy-dara-input[data-year]').first().getAttribute('data-year');
  const link = page.locator(`#simple-table tr.fy-group-header[data-fy="${firstYear}"] .fy-rmd-link`);
  const pop = page.locator('#rmd-options-popover');

  // None: every coupon is reinvested, so none of the ones already paid are counted either.
  await link.click();
  await pop.locator('input[name="rmd-coupon-mode"][value="none"]').check();
  await page.locator('#rmd-options-close').click();
  await expect(cash).toHaveValue('');

  // Only last: same reasoning — every already-paid coupon is earlier than the last still to arrive.
  await link.click();
  await pop.locator('input[name="rmd-coupon-mode"][value="last"]').check();
  await page.locator('#rmd-options-close').click();
  await expect(cash).toHaveValue('');

  // Back to All remaining and the offer returns, unchanged.
  await link.click();
  await pop.locator('input[name="rmd-coupon-mode"][value="all"]').check();
  await page.locator('#rmd-options-close').click();
  await expect(cash).toHaveValue(String(withAll));
  await expect(mark).toBeVisible();

  // A figure the holder states is theirs: the Coupons control must not overwrite it afterwards.
  await cash.click();
  await page.locator('#available-cash-popover input[value="manual"]').check();
  await page.locator('#available-cash-manual').fill('7500');
  await page.locator('#available-cash-apply').click();
  await expect(mark).toBeHidden();
  await link.click();
  await pop.locator('input[name="rmd-coupon-mode"][value="none"]').check();
  await page.locator('#rmd-options-close').click();
  await expect(cash).toHaveValue('7500');
});

// A rung that has matured paid out its principal along with its final coupon, and that money is the
// year's Amount arriving. The bond is no longer quoted, so it is absent from tipsMap and the rung
// would otherwise read as unfunded -- the app would buy principal to replace cash already spent.
// The fixture holds every 2026 maturity month, three of which have matured by late August.
test('Available Cash counts maturity proceeds from rungs that have already matured', async ({ page }) => {
  test.setTimeout(20_000);
  const cash = page.locator('#available-cash');
  await expect(page.locator('#simple-table tbody tr').first()).toBeVisible({ timeout: 4_000 });

  await page.locator('#holdings-file').setInputFiles(YEARAGO_ALL_PATH);
  await expect(page.locator('#available-cash-auto')).toBeVisible({ timeout: 4_000 });
  const offered = Number(await cash.inputValue());

  // The help popup leads with what arrived on each payment date, and names the rungs that matured.
  await page.locator('#available-cash-help').click();
  const text = await page.locator('body').innerText();
  // The table header is uppercased by CSS, and innerText reflects that.
  expect(text).toMatch(/coupons/i);
  expect(text).toMatch(/principal/i);
  expect(text).toMatch(/rungs that have matured/i);

  // Maturity proceeds dwarf the coupons here: three whole rungs against half a year of coupons.
  const matured = text.match(/matured \d{2}\/\d{2}\/\d{4}/g) ?? [];
  expect(matured.length, 'three 2026 rungs have matured by late August').toBe(3);
  expect(offered, 'three matured rungs plus coupons is a large figure').toBeGreaterThan(20000);
});

// Coupons a held ladder has already collected this year are money in hand (2.0 §Available Cash),
// so the app offers that total in Available Cash, marked amber. The window starts at the date the
// loaded ladder was stated at: a plan stated as of today has collected nothing since, which is what
// keeps a same-day build → export → import round trip at zero trades.
test('Available Cash is offered from coupons already received, and only for a ladder stated in the past', async ({ page }) => {
  test.setTimeout(20_000);
  const cash = page.locator('#available-cash');
  const mark = page.locator('#available-cash-auto');

  // The auto-loaded sample holdings state no date at all — a real position, held all year.
  await expect(page.locator('.fy-dara-input[data-year]').first()).toBeVisible({ timeout: 4_000 });
  const offered = Number(await cash.inputValue());
  expect(offered, 'a held portfolio has received some of this year’s coupons').toBeGreaterThan(0);
  await expect(mark).toBeVisible();
  await expect(cash).toHaveClass(/auto-filled/);

  // Typing over it hands the figure back to the user.
  await cash.click();
  await page.locator('#available-cash-popover input[value="manual"]').check();
  await page.locator('#available-cash-manual').fill('1234');
  await page.locator('#available-cash-apply').click();
  await expect(mark).toBeHidden();
  await expect(cash).not.toHaveClass(/auto-filled/);

  // A plan stated as of today: nothing has been paid since, so nothing is offered.
  const years = await page.locator('.fy-dara-input[data-year]').evaluateAll(
    els => els.slice(0, 4).map(e => e.dataset.year)
  );
  // The trade date the app is actually running against, off the info strip, so the test is not
  // guessing at "today" from its own clock.
  const strip = (await page.locator('#info-source').textContent()) ?? '';
  const md = strip.match(/Trade:\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  expect(md, 'info strip names the trade date').not.toBeNull();
  const todayIso = md[3] + '-' + md[1].padStart(2, '0') + '-' + md[2].padStart(2, '0');
  const planToday = test.info().outputPath('plan-stated-today.csv');
  writeFileSync(planToday, ['#params,refCpiDate=' + todayIso,
    '#fundedYear,dara', ...years.map(y => y + ',40000')].join('\n') + '\n');
  await chooseMenu(page, 'import-menu', 'dara-plan');
  await page.locator('#dara-plan-import-file').setInputFiles(planToday);
  await expect(cash).toHaveValue('');
  await expect(mark).toBeHidden();

  // The same plan stated a year ago: every coupon paid since counts, and the offer returns.
  // availableCash=0 is written here on purpose: the CUSIP/Qty export always emits the key, so every
  // ladder that never had cash entered carries a zero. Reading that as "the file stated its cash"
  // would suppress the offer on precisely the aged exports it exists for.
  const planAged = test.info().outputPath('plan-stated-a-year-ago.csv');
  const lastYear = new Date(); lastYear.setFullYear(lastYear.getFullYear() - 1);
  writeFileSync(planAged, ['#params,availableCash=0,refCpiDate=' + lastYear.toISOString().slice(0, 10),
    '#fundedYear,dara', ...years.map(y => y + ',40000')].join('\n') + '\n');
  await chooseMenu(page, 'import-menu', 'dara-plan');
  await page.locator('#dara-plan-import-file').setInputFiles(planAged);
  await expect(mark).toBeVisible();
  expect(Number(await cash.inputValue())).toBeGreaterThan(0);
});

test('DARA plan with no Ref CPI date: used as written, then scaled once a date is supplied', async ({ page }) => {
  test.setTimeout(20_000);
  await page.locator('#holdings-file').setInputFiles(HOLDINGS_PATH);
  await expect(page.locator('.fy-dara-input[data-year]').first()).toBeVisible({ timeout: 4_000 });

  // Hand-written plan: a #fundedYear,dara block and nothing else. No #params line at all, so no
  // recorded Ref CPI date.
  const years = await page.locator('.fy-dara-input[data-year]').evaluateAll(
    els => els.slice(0, 4).map(e => e.dataset.year)
  );
  const planPath = test.info().outputPath('plan-no-refcpi-date.csv');
  writeFileSync(planPath, ['#fundedYear,dara', ...years.map(y => y + ',40000')].join('\n') + '\n');

  await chooseMenu(page, 'import-menu', 'dara-plan');
  await page.locator('#dara-plan-import-file').setInputFiles(planPath);

  // Used as written, and said so.
  for (const y of years) {
    await expect(page.locator(`.fy-dara-input[data-year="${y}"]`)).toHaveValue('40000');
  }
  await expect(page.locator('#status')).toContainText('records no Ref CPI date');
  await expect(page.locator('#dara-set-basis')).toBeVisible();

  // Supply an earlier date.
  await page.locator('#dara-set-basis').click();
  await expect(page.locator('#dara-basis-popover')).toBeVisible();
  await page.locator('#dara-basis-date').fill('2025-08-27');
  await page.locator('#dara-basis-apply').click();
  await expect(page.locator('#dara-basis-popover')).toBeHidden();

  // The status strip reports the date scaled from and the factor; the values move by that factor.
  const status = await page.locator('#status').textContent();
  expect(status, 'status names the supplied date').toContain('08/27/2025');
  const factor = parseFloat((status.match(/×([0-9.]+)/) || [])[1]);
  expect(factor, 'a factor was reported').toBeGreaterThan(1);

  for (const y of years) {
    const v = parseFloat(await page.locator(`.fy-dara-input[data-year="${y}"]`).inputValue());
    // The reported factor is rounded to 4 dp, so allow a few dollars on a 40,000 target.
    expect(Math.abs(v - 40000 * factor), 'every year scaled by the reported factor').toBeLessThanOrEqual(5);
  }

  // The offer stays available so a wrong date can be corrected, and reopens on the date supplied.
  await expect(page.locator('#dara-set-basis')).toBeVisible();
  await page.locator('#dara-set-basis').click();
  await expect(page.locator('#dara-basis-date')).toHaveValue('2025-08-27');
});

// Regression: runFundedRebalance only applies its self-financing scale (3.0 §Funding the rebalance)
// when the DARA plan is unedited -- index.html's _daraPlanUnedited() decides that from whether
// currentImportedDaraByYear is set, NOT from how the store was actually populated. The DARA Plan
// card's file-Import handler set _daraByYearStore AND _daraLoadedSnapshot to the imported values but
// never set currentImportedDaraByYear, so an imported plan on a ladder with a gap/Future-30Y block to
// fund (SampleHoldings has the structural 2037-39 gap) was silently discarded at Run and replaced
// with a freshly self-financing-scaled map derived from the portfolio's own natural ARA shape --
// Amt After tracked the untouched mirror, not the imported target, with no error or indication.
test('per-year DARA: an imported plan is honored exactly at Run on a ladder with a gap block, not silently overwritten by the self-financing scale', async ({ page }) => {
  test.setTimeout(20_000);
  await page.locator('#holdings-file').setInputFiles(HOLDINGS_PATH);
  await expect(page.locator('.fy-dara-input[data-year]').first()).toBeVisible({ timeout: 4_000 });

  // Re-export the as-loaded natural mirror as a #fundedYear,dara plan file, with ONE year spiked to
  // a value clearly different from its natural ARA.
  const rungs = await page.locator('.fy-dara-input[data-year]').evaluateAll(
    els => els.map(el => [el.dataset.year, el.value])
  );
  const spikeYear = rungs[0][0];
  const naturalVal = parseFloat(rungs[0][1]);
  const spikedVal = Math.round(naturalVal * 4 + 20000);
  const lines = ['#fundedYear,dara', ...rungs.map(([y, v]) => (y === spikeYear ? `${y},${spikedVal}` : `${y},${v}`))];
  const planPath = test.info().outputPath('spiked-dara-plan.csv');
  writeFileSync(planPath, lines.join('\n'));

  await chooseMenu(page, 'import-menu', 'dara-plan');
  await page.locator('#dara-plan-import-file').setInputFiles(planPath);
  await expect(page.locator(`.fy-dara-input[data-year="${spikeYear}"]`)).toHaveValue(String(spikedVal));

  await page.locator('#run-btn').click();
  await expect(page.locator('#simple-table')).toBeVisible({ timeout: 4_000 });

  const amtAfterCell = page.locator(`#simple-table tr.fy-group-header[data-fy="${spikeYear}"] td[data-col="amtAfter"]`);
  await expect(amtAfterCell).toBeVisible();
  const amtAfter = parseFloat((await amtAfterCell.textContent() ?? '').replace(/[^0-9.-]/g, ''));
  expect(amtAfter, `Amt After (${amtAfter}) for the imported spike year must track the imported DARA (${spikedVal}), not fall back near the natural portfolio mirror (${naturalVal})`)
    .toBeGreaterThan((naturalVal + spikedVal) / 2);
});

// Build once so the table's inline per-year DARA inputs exist.
async function _buildSetup(page, lastYear = '2055') {
  await page.locator('.tab-btn[data-mode="build"]').click();
  await page.locator('#last-year').selectOption({ value: lastYear });
  await page.locator('#run-btn').click();
  // Scoped to #build-table — the Rebalance side's auto-loaded sample holdings also has matching
  // .fy-dara-input elements earlier in DOM order, just hidden.
  await expect(page.locator('#build-table .fy-dara-input[data-year]').first()).toBeVisible({ timeout: 4_000 });
}

// Build has no holdings to self-finance against, so its selection toolbar shows Set DARA but never
// Infer DARA (Rebalance only — 3.0 §Per-Rung DARA Selection).
test('build: Set DARA over a selected range works; Infer DARA never renders in Build', async ({ page }) => {
  test.setTimeout(20_000);
  await _buildSetup(page);

  const years = await page.locator('#build-table .fy-dara-input[data-year]').evaluateAll(
    els => els.slice(0, 3).map(e => e.dataset.year)
  );
  // Left-edge position: years[0] is the settlement year, whose row also carries the RMD Options
  // link (5.0 §RMD Options) — a default-centroid click can land on it instead of selecting the row.
  // delay: 650 holds past the 600ms select threshold (3.0 §Selecting rungs) — a quick click now
  // only toggles expand/collapse, it no longer selects.
  await page.locator(`#build-table tr.fy-group-header[data-fy="${years[0]}"]`).click({ position: { x: 10, y: 8 }, delay: 650 });
  await page.locator(`#build-table tr.fy-group-header[data-fy="${years[2]}"]`).click({ modifiers: ['Shift'] });
  await expect(page.locator('#selection-toolbar')).toBeVisible();
  await expect(page.locator('#selection-infer-btn'), 'Infer DARA never renders in Build').not.toBeVisible();

  await page.locator('#selection-dara-input').fill('25000');
  await page.locator('#selection-set-btn').click();
  for (const y of years) {
    await expect(page.locator(`#build-table .fy-dara-input[data-year="${y}"]`)).toHaveValue('25000');
  }
  await expect(page.locator('#selection-toolbar'), 'Set DARA clears the selection on Apply').not.toBeVisible();
});

// Regression guard for the selection state added alongside this feature: switching modes must not
// leave a stale selection (and its toolbar) showing against the newly-active table.
test('mode toggle: switching Build <-> Rebalance clears the active selection', async ({ page }) => {
  test.setTimeout(20_000);
  await _buildSetup(page);
  const year = await page.locator('#build-table .fy-dara-input[data-year]').first().getAttribute('data-year');
  // Click near the row's left edge (the expand triangle/year label), not its default centroid —
  // the settlement year's row also carries the DARA input and (when it's the settlement year, as
  // it is here since `year` is the FIRST funded year) the "RMD Options" link (5.0 §RMD Options),
  // either of which would swallow a click landing on them via their own stopPropagation.
  // delay: 650 holds past the 600ms select threshold (3.0 §Selecting rungs) — a quick click now
  // only toggles expand/collapse, it no longer selects.
  await page.locator(`#build-table tr.fy-group-header[data-fy="${year}"]`).click({ position: { x: 10, y: 8 }, delay: 650 });
  await expect(page.locator('#selection-toolbar')).toBeVisible();

  await page.locator('.tab-btn[data-mode="rebalance"]').click();
  await expect(page.locator('#selection-toolbar')).not.toBeVisible();
});

test('per-year DARA: standalone plan file exports and re-imports per-year values in Build mode', async ({ page }) => {
  test.setTimeout(20_000);
  await _buildSetup(page);

  const rungYear = await page.locator('#build-table .fy-dara-input[data-year]').first().getAttribute('data-year');
  const rung = page.locator(`#build-table .fy-dara-input[data-year="${rungYear}"]`);
  await rung.fill('33000');
  await rung.blur();
  await expect(rung, 'rung reflects the typed value before export').toHaveValue('33000');

  const downloadPromise = page.waitForEvent('download');
  await chooseMenu(page, 'export-menu', 'dara-plan');
  const download = await downloadPromise;
  const planPath = test.info().outputPath('build-dara-plan.csv');
  await download.saveAs(planPath);

  // Fresh reload wipes the edit back to the plain default.
  await page.reload();
  await expect(page.locator('#run-btn')).not.toBeDisabled({ timeout: 4_000 });
  await _buildSetup(page);
  expect(await rung.inputValue(), 'fresh reload is the plain default again').not.toBe('33000');

  await chooseMenu(page, 'import-menu', 'dara-plan');
  await page.locator('#dara-plan-import-file').setInputFiles(planPath);
  await expect(rung).toHaveValue('33000');
});

// Regression: clearing a rung's DARA field to blank must build that rung at 0, not silently fall
// back to the scalar default. Fixed 2026-08-23 — getDaraByYear() was dropping a blank (NaN) entry
// from the map it hands to runBuild instead of passing it through as 0, so a cleared field looked
// blank in the UI but the engine still funded that year at the scalar DARA underneath it.
test('build: a blanked per-year DARA field builds that rung at 0, not the scalar default', async ({ page }) => {
  test.setTimeout(20_000);
  await _buildSetup(page);

  const rungYear = await page.locator('#build-table .fy-dara-input[data-year]').first().getAttribute('data-year');
  const rung = page.locator(`#build-table .fy-dara-input[data-year="${rungYear}"]`);
  await rung.fill('');
  await rung.blur();
  await expect(rung, 'field stays blank after the auto-rebuild it triggers').toHaveValue('');

  await expect.poll(() => page.evaluate((year) => {
    const table = document.querySelector('#build-table');
    const headers = [...table.querySelectorAll('thead th')];
    const colIdx = headers.findIndex(th => th.dataset.col === 'qty');
    const row = table.querySelector(`tbody tr[data-fy="${year}"]:not([data-sub]):not(.fy-group-header)`);
    return row?.children[colIdx]?.textContent.trim();
  }, rungYear), { timeout: 4_000 }).toBe('0');
});

// Coupon Counting (2.0 §Settlement-Year Coupon Treatment; 5.0 §Funded Year Group Header Row): the
// settlement year's group header row — and only that row — carries a "Coupons" link opening a small
// popover for the settlement-year coupon-count mode.
//
// Rebalance only. The choice divides the settlement year into coupons already received and coupons
// still to arrive, and a Build has no first half: every coupon from the build date forward is the
// ladder's own income, so Build sizes at 'all' with nothing to choose.
test('Coupon Counting: link appears only on the settlement year row, in Rebalance only, and round-trips values', async ({ page }) => {
  test.setTimeout(20_000);
  await expect(page.locator('#simple-table tbody tr').first()).toBeVisible({ timeout: 4_000 });

  const firstYear = await page.locator('#simple-table .fy-dara-input[data-year]').first().getAttribute('data-year');
  const otherYear = await page.locator('#simple-table .fy-dara-input[data-year]').nth(1).getAttribute('data-year');
  await expect(page.locator(`#simple-table tr.fy-group-header[data-fy="${firstYear}"] .fy-rmd-link`)).toBeVisible();
  await expect(page.locator(`#simple-table tr.fy-group-header[data-fy="${otherYear}"] .fy-rmd-link`)).toHaveCount(0);

  const link = page.locator(`#simple-table tr.fy-group-header[data-fy="${firstYear}"] .fy-rmd-link`);
  await expect(link).toHaveText('Coupons');
  await link.click();
  const pop = page.locator('#rmd-options-popover');
  await expect(pop).toBeVisible();
  await expect(pop.locator('input[name="rmd-coupon-mode"]:checked')).toHaveValue('all');
  // Available Cash is ladder-wide, so it lives in Row 1 rather than in this per-year popover.
  await expect(pop.locator('#rmd-cash-override')).toHaveCount(0);

  // The two controls are the two halves of one settlement year, and each says what the other does.
  await expect(page.locator('#rmd-linkage-note')).toContainText('Available Cash');
  await expect(page.locator('#rmd-linkage-note')).toContainText('payment');

  await pop.locator('input[name="rmd-coupon-mode"][value="last"]').check();
  await page.locator('#rmd-options-close').click();
  await expect(pop).toBeHidden();

  // Non-default choice shows on the link itself, and the popover reopens with the values held.
  await expect(link).toHaveText('Coupons*');
  await link.click();
  await expect(pop.locator('input[name="rmd-coupon-mode"]:checked')).toHaveValue('last');
  await page.locator('#rmd-options-close').click();

  // Build offers no such choice, and the Rebalance side's 'last' must not follow it there.
  await _buildSetup(page);
  await expect(page.locator('#build-table .fy-rmd-link')).toHaveCount(0);
  await expect(page.locator('#field-available-cash')).toBeHidden();
});

// The hover explainer reuses the funded-year bracket label's existing [data-tip-html]/
// #bracket-tooltip mechanism (5.0 §Funded Year Group Header Row §RMD Options link), applied
// directly to the link itself (no separate icon) — hovering shows the explainer, clicking still
// opens the popover, the same way any link can carry a tooltip without it competing with its click.
test('Coupon Counting: hovering the link shows an explainer without opening the popover', async ({ page }) => {
  test.setTimeout(20_000);
  await expect(page.locator('#simple-table tbody tr').first()).toBeVisible({ timeout: 4_000 });

  const firstYear = await page.locator('#simple-table .fy-dara-input[data-year]').first().getAttribute('data-year');
  const link = page.locator(`#simple-table tr.fy-group-header[data-fy="${firstYear}"] .fy-rmd-link`);
  const tooltip = page.locator('#bracket-tooltip');
  await expect(tooltip).toBeHidden();

  await link.hover();
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText('Count remaining coupons');
  await expect(page.locator('#rmd-options-popover')).toBeHidden();

  // Hovering off hides it again.
  await page.locator('#simple-table').hover({ position: { x: 5, y: 5 } });
  await expect(tooltip).toBeHidden();

  // Clicking the link (still hovered, since a click starts with the cursor already over it) opens
  // the popover AND dismisses the hover explainer -- it must not linger behind the open popover.
  await link.hover();
  await expect(tooltip).toBeVisible();
  await link.click();
  await expect(page.locator('#rmd-options-popover')).toBeVisible();
  await expect(tooltip).toBeHidden();
  await page.locator('#rmd-options-close').click();
});

// RMD Options persist through the same standalone DARA-plan file the DARA-by-year shape already
// uses (2.1 §Standalone DARA-plan file `#params` line) — no separate file/mechanism.
// Rebalance mode: Available Cash lives there alone, so a plan carrying it has to be written and
// read back there.
test('Available Cash and coupon mode round-trip through the DARA-plan file', async ({ page }) => {
  test.setTimeout(20_000);
  await expect(page.locator('#simple-table tbody tr').first()).toBeVisible({ timeout: 4_000 });

  const firstYear = await page.locator('#simple-table .fy-dara-input[data-year]').first().getAttribute('data-year');
  const link = page.locator(`#simple-table tr.fy-group-header[data-fy="${firstYear}"] .fy-rmd-link`);
  await expect(page.locator('#field-available-cash')).toBeVisible();
  await page.locator('#available-cash').click();
  await page.locator('#available-cash-popover input[value="manual"]').check();
  await page.locator('#available-cash-manual').fill('4200');
  await page.locator('#available-cash-apply').click();
  await link.click();
  const pop = page.locator('#rmd-options-popover');
  await pop.locator('input[name="rmd-coupon-mode"][value="none"]').check();
  await page.locator('#rmd-options-close').click();

  const downloadPromise = page.waitForEvent('download');
  await chooseMenu(page, 'export-menu', 'dara-plan');
  const download = await downloadPromise;
  const planPath = test.info().outputPath('rmd-options-dara-plan.csv');
  await download.saveAs(planPath);
  const planText = readFileSync(planPath, 'utf8');
  expect(planText).toContain('availableCash=4200');
  // A saved plan always records the Ref CPI basis its DARA values are stated at, so reloading it
  // later restates rather than silently re-denominating them (3.0 §DARA Basis Date).
  expect(planText).toMatch(/refCpiDate=\d{4}-\d{2}-\d{2}/);
  expect(planText).toContain('rmdCouponMode=none');

  await page.reload();
  await expect(page.locator('#simple-table tbody tr').first()).toBeVisible({ timeout: 4_000 });
  await expect(link).toHaveText('Coupons'); // fresh reload is the plain default again
  // Not empty on a fresh load: the sample holdings are a held position, so the app offers the
  // coupons already received. What matters is that 4,200 is gone.
  await expect(page.locator('#available-cash')).not.toHaveValue('4200');

  await chooseMenu(page, 'import-menu', 'dara-plan');
  await page.locator('#dara-plan-import-file').setInputFiles(planPath);
  await expect(link).toHaveText('Coupons*');
  await expect(page.locator('#available-cash')).toHaveValue('4200');
  await link.click();
  await expect(pop.locator('input[name="rmd-coupon-mode"]:checked')).toHaveValue('none');
});

// Cash Flow Calendar amounts are penny-precise (unlike the rest of the app's whole-dollar
// formatting) — the calendar exists specifically to compare against real brokerage transactions.
test('Cash Flow Calendar: amounts show to the penny, for exact comparison against broker values', async ({ page }) => {
  test.setTimeout(20_000);
  await page.locator('#holdings-file').setInputFiles(HOLDINGS_PATH);
  await expect(page.locator('#cash-flow-btn')).toBeVisible({ timeout: 4_000 });
  await page.locator('#cash-flow-btn').click();
  await expect(page.locator('#cash-flow-overlay')).toBeVisible();

  const amountCells = page.locator('#cash-flow-content td:nth-child(n+2)');
  const count = await amountCells.count();
  expect(count).toBeGreaterThan(0);
  for (const t of await amountCells.allTextContents()) expect(t).toMatch(/^\$[\d,]+\.\d{2}$/);

  // Level-3 (date) drill popup matches the same penny precision.
  await page.locator('#cash-flow-content td.cf-date-cell:visible').first().click();
  const popupAmounts = page.locator('#shared-popup td:last-child');
  const popupCount = await popupAmounts.count();
  if (popupCount > 0) {
    for (const t of await popupAmounts.allTextContents()) {
      if (t.trim().startsWith('$')) expect(t).toMatch(/^\$[\d,]+\.\d{2}$/);
    }
  }

  // CSV export also carries cents, not rounded whole dollars.
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#cash-flow-export').click();
  const download = await downloadPromise;
  const csvPath = test.info().outputPath('cash-flow-export.csv');
  await download.saveAs(csvPath);
  const csvText = readFileSync(csvPath, 'utf8');
  const dataLines = csvText.trim().split('\n').slice(1);
  expect(dataLines.length).toBeGreaterThan(0);
  for (const line of dataLines) expect(line.split(',')[3]).toMatch(/^-?\d+\.\d{2}$/);
});

// The Before/After toggle only makes sense once a rebalance plan exists to preview — before that,
// there is no target portfolio to show. The toggle must stay hidden until Run has produced one.
test('Cash Flow Calendar: Before/After toggle hidden before a rebalance is rendered', async ({ page }) => {
  test.setTimeout(20_000);
  await page.locator('#holdings-file').setInputFiles(HOLDINGS_PATH);
  await expect(page.locator('#cash-flow-btn')).toBeVisible({ timeout: 4_000 });
  await page.locator('#cash-flow-btn').click();
  await expect(page.locator('#cash-flow-overlay')).toBeVisible();
  await expect(page.locator('#cash-flow-toggle')).toBeHidden();
});

// After a rebalance is rendered, the toggle appears, defaults to Before, and switching to After
// rebuilds the calendar from the trade ticket's target holdings (rebalDetails[].qtyAfter) rather
// than the currently-held portfolio — the two states are expected to differ for a real ladder.
test('Cash Flow Calendar: Before/After toggle appears after rebalance, switches data source', async ({ page }) => {
  test.setTimeout(20_000);
  await page.locator('#holdings-file').setInputFiles(HOLDINGS_PATH);
  await page.locator('#run-btn').click();
  await expect(page.locator('#simple-table tbody tr').first()).toBeVisible({ timeout: 4_000 });

  await page.locator('#cash-flow-btn').click();
  await expect(page.locator('#cash-flow-overlay')).toBeVisible();
  const toggle = page.locator('#cash-flow-toggle');
  await expect(toggle).toBeVisible();
  const beforeBtn = page.locator('#cash-flow-before-btn');
  const afterBtn = page.locator('#cash-flow-after-btn');
  await expect(beforeBtn).toHaveClass(/active/);
  await expect(afterBtn).not.toHaveClass(/active/);

  // A rebalance that recommends no trades leaves quantities identical, so Before and After
  // legitimately show the same real cash flow — the toggle isn't asserting the two must differ,
  // only that switching re-renders cleanly and is fully reversible.
  const beforeTotal = await page.locator('#cash-flow-content tr.cf-year-header td:last-child').first().textContent();
  expect(beforeTotal).toMatch(/^\$[\d,]+\.\d{2}$/);
  await afterBtn.click();
  await expect(afterBtn).toHaveClass(/active/);
  await expect(beforeBtn).not.toHaveClass(/active/);
  const afterTotal = await page.locator('#cash-flow-content tr.cf-year-header td:last-child').first().textContent();
  expect(afterTotal).toMatch(/^\$[\d,]+\.\d{2}$/);

  // Switching back to Before restores the original figure.
  await beforeBtn.click();
  const backToBefore = await page.locator('#cash-flow-content tr.cf-year-header td:last-child').first().textContent();
  expect(backToBefore).toBe(beforeTotal);
});

// Regression: Build's Cash Flow Calendar was reading currentHoldingsArray (Rebalance's imported/
// auto-loaded sample holdings) instead of the ladder Build just produced — reported live as
// "cash flows do not come anywhere close to $40,000" (Build's default DARA) with the app in its
// default startup state (sample holdings auto-loaded, then switching to Build and running).
test('build: Cash Flow Calendar shows the built ladder, not leftover Rebalance holdings', async ({ page }) => {
  test.setTimeout(20_000);
  // Default startup state: SampleHoldings.csv auto-loads into currentHoldingsArray for Rebalance
  // (see beforeEach comment) — do not clear it, that leftover state is exactly what leaked before.
  await page.locator('.tab-btn[data-mode="build"]').click();
  await expect(page.locator('#cash-flow-btn')).toBeHidden(); // no build run yet
  await page.locator('#run-btn').click(); // default DARA (40000), default First/Last Year
  await expect(page.locator('#build-output')).toHaveCSS('display', 'block', { timeout: 4_000 });

  await expect(page.locator('#cash-flow-btn')).toBeVisible();
  await page.locator('#cash-flow-btn').click();
  await expect(page.locator('#cash-flow-overlay')).toBeVisible();
  await expect(page.locator('#cash-flow-toggle')).toBeHidden(); // Build has no Before/After

  // A full funded year's total cash flow should land near the $40,000 DARA the ladder was built
  // for — not near whatever SampleHoldings.csv happens to throw off.
  const yearRows = page.locator('#cash-flow-content tr.cf-year-header');
  const rowCount = await yearRows.count();
  expect(rowCount).toBeGreaterThan(0);
  const totals = [];
  for (let i = 0; i < rowCount; i++) {
    const text = await yearRows.nth(i).locator('td:last-child').textContent();
    totals.push(Number(text.replace(/[^0-9.-]/g, '')));
  }
  expect(Math.max(...totals)).toBeGreaterThan(30_000);
});
