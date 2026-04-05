// Tests that the RANGE date inputs adapt the chart X axis to the selected range.
// The chart should re-scale horizontally to match the filtered data whenever the
// start or end maturity is changed.

import { test, expect } from '@playwright/test';

const SETTLE = '2026-03-25';

// TIPS spanning 2026–2034 so end-date trimming produces a measurable X change.
const TIPS_MULTIYR_CSV = [
  SETTLE,
  'type,cusip,maturity,coupon,datedDateCpi,price,yield',
  'TIPS,TPS2026A,2026-04-15,0.00125,262.25027,100.0625,0.000',
  'TIPS,TPS2026B,2026-07-15,0.00125,239.70132,101.4375,0.000',
  'TIPS,TPS2026C,2026-10-15,0.00125,273.25771,100.96875,0.000',
  'TIPS,TPS2030A,2030-04-15,0.00250,262.25027,99.0625,0.000',
  'TIPS,TPS2034A,2034-07-15,0.00375,262.25027,98.0625,0.000',
].join('\n');

// Nominals spanning 2026–2056 for Treasuries tab tests.
const NOMINALS_CSV = [
  SETTLE,
  'type,cusip,maturity,coupon,datedDateCpi,price,yield',
  'MARKET BASED BILL,912797TB3,2026-06-26,0.000,,99.060,0.000',
  'MARKET BASED NOTE,91282CBT7,2028-03-25,0.04250,,100.000,0.04250',
  'MARKET BASED NOTE,91282CKH3,2031-03-25,0.04350,,100.000,0.04350',
  'MARKET BASED BOND,912810PS1,2036-03-25,0.04750,,100.000,0.04750',
  'MARKET BASED BOND,912810XX1,2056-03-25,0.04850,,100.000,0.04850',
  // A few TIPS rows so rawYieldsData is non-empty (avoids early return in processAndRenderTips)
  'TIPS,TPS2026A,2026-04-15,0.00125,262.25027,100.0625,0.000',
  'TIPS,TPS2030A,2030-04-15,0.00250,262.25027,99.0625,0.000',
].join('\n');

// RefCPI covers the maturity months present in both CSVs (04-15, 07-15, 10-15, 03-25).
const REF_CPI_CSV = [
  'Ref CPI Date,Ref CPI NSA,Ref CPI SA,SA Factor',
  '2026-04-15,325.96740,326.99493,0.99686',
  '2026-07-15,321.09758,320.44561,1.00203',
  '2026-10-15,323.46710,322.67571,1.00245',
  '2026-03-25,324.74961,326.35442,0.99508',
  '2026-03-26,324.74961,326.35442,0.99508',
].join('\n');

const HOLIDAYS_CSV = '"Wednesday, January 1, 2025",New Year\'s Day\n';

// ── Route helpers ─────────────────────────────────────────────────────────────

async function setupTipsRoutes(page) {
  await page.route('**/Treasuries/YieldsDerivedFromFedInvestPrices.csv', r => r.fulfill({ body: TIPS_MULTIYR_CSV, contentType: 'text/csv' }));
  await page.route('**/Treasuries/RefCpiNsaSa.csv', r => r.fulfill({ body: REF_CPI_CSV, contentType: 'text/csv' }));
  await page.route('**/misc/BondHolidaysSifma.csv', r => r.fulfill({ body: HOLIDAYS_CSV, contentType: 'text/csv' }));
  await page.route('**/Treasuries/FidelityTreasuries.csv', r => r.fulfill({ status: 404, body: '' }));
  await page.route('**/Treasuries/FidelityTips.csv', r => r.fulfill({ status: 404, body: '' }));
}

async function setupNominalsRoutes(page) {
  await page.route('**/Treasuries/YieldsDerivedFromFedInvestPrices.csv', r => r.fulfill({ body: NOMINALS_CSV, contentType: 'text/csv' }));
  await page.route('**/Treasuries/RefCpiNsaSa.csv', r => r.fulfill({ body: REF_CPI_CSV, contentType: 'text/csv' }));
  await page.route('**/misc/BondHolidaysSifma.csv', r => r.fulfill({ body: HOLIDAYS_CSV, contentType: 'text/csv' }));
  await page.route('**/Treasuries/FidelityTreasuries.csv', r => r.fulfill({ status: 404, body: '' }));
  await page.route('**/Treasuries/FidelityTips.csv', r => r.fulfill({ status: 404, body: '' }));
}

// ── Chart helpers ─────────────────────────────────────────────────────────────

async function getXBounds(page) {
  return page.evaluate(() => {
    const chart = Chart.getChart(document.getElementById('yieldChart'));
    if (!chart?.scales?.x) return null;
    return { min: chart.scales.x.min, max: chart.scales.x.max };
  });
}

// Trigger a range change via the hidden date-picker input (most reliable path).
// isoDate: 'YYYY-MM-DD'
async function setRangeEnd(page, isoDate) {
  await page.evaluate((iso) => {
    const cal = document.getElementById('endMaturityCal');
    cal.value = iso;
    cal.dispatchEvent(new Event('change', { bubbles: true }));
  }, isoDate);
  await page.waitForTimeout(150);
}

async function setRangeStart(page, isoDate) {
  await page.evaluate((iso) => {
    const cal = document.getElementById('startMaturityCal');
    cal.value = iso;
    cal.dispatchEvent(new Event('change', { bubbles: true }));
  }, isoDate);
  await page.waitForTimeout(150);
}

// ── TIPS tab ──────────────────────────────────────────────────────────────────

test.describe('TIPS tab — RANGE input adapts X axis', () => {
  test.beforeEach(async ({ page }) => {
    await setupTipsRoutes(page);
    await page.goto('./');
    // Wait for all 5 TIPS rows (2026×3 + 2030 + 2034)
    await expect(page.locator('#saTable tbody tr')).toHaveCount(5, { timeout: 10000 });
  });

  test('narrowing end date reduces X max', async ({ page }) => {
    const initial = await getXBounds(page);
    expect(initial).not.toBeNull();
    // initial maxX should reflect the 2034-07-15 end input (≈ Aug 1 2034)
    const jan2034 = new Date(2034, 0, 1).getTime();
    expect(initial.max).toBeGreaterThan(jan2034);

    // Trim end to Oct 2026 — should exclude 2030 and 2034 bonds
    await setRangeEnd(page, '2026-10-15');

    const narrowed = await getXBounds(page);
    expect(narrowed).not.toBeNull();
    expect(narrowed.max).toBeLessThan(initial.max);
    // maxX should be month-snapped to Nov 1 2026 (next month after Oct 2026 input)
    const nov2026 = new Date(2026, 10, 1).getTime();
    const dec2026 = new Date(2026, 11, 1).getTime();
    expect(narrowed.max).toBeGreaterThanOrEqual(nov2026);
    expect(narrowed.max).toBeLessThanOrEqual(dec2026);
  });

  test('widening end date back restores X max', async ({ page }) => {
    // Narrow first
    await setRangeEnd(page, '2026-10-15');
    const narrowed = await getXBounds(page);

    // Restore full range
    await setRangeEnd(page, '2034-07-15');
    const widened = await getXBounds(page);

    expect(widened.max).toBeGreaterThan(narrowed.max);
  });

  test('narrowing start date increases X min', async ({ page }) => {
    const initial = await getXBounds(page);
    expect(initial).not.toBeNull();

    // Move start to 2030 — should exclude all 2026 bonds
    await setRangeStart(page, '2030-04-15');
    const narrowed = await getXBounds(page);

    expect(narrowed).not.toBeNull();
    expect(narrowed.min).toBeGreaterThan(initial.min);
    // minX should be month-snapped to Apr 1 2030
    const apr2030 = new Date(2030, 3, 1).getTime();
    const may2030 = new Date(2030, 4, 1).getTime();
    expect(narrowed.min).toBeGreaterThanOrEqual(apr2030);
    expect(narrowed.min).toBeLessThan(may2030);
  });

  test('widening start date back restores X min', async ({ page }) => {
    await setRangeStart(page, '2030-04-15');
    const narrowed = await getXBounds(page);

    await setRangeStart(page, '2026-04-15');
    const widened = await getXBounds(page);

    expect(widened.min).toBeLessThan(narrowed.min);
  });

  test('prior zoom is discarded when range changes', async ({ page }) => {
    // Simulate a user zoom via chart API
    await page.evaluate(() => {
      const chart = Chart.getChart(document.getElementById('yieldChart'));
      chart.options.scales.x.min = new Date(2028, 0, 1).getTime();
      chart.options.scales.x.max = new Date(2030, 0, 1).getTime();
      chart.update('none');
    });

    // Now change the range — the saved zoom must NOT be restored
    await setRangeEnd(page, '2026-10-15');
    const after = await getXBounds(page);

    // If the zoom was incorrectly restored, max would still be 2030
    const jan2028 = new Date(2028, 0, 1).getTime();
    expect(after.max).toBeLessThanOrEqual(jan2028);
  });
});

// ── Treasuries tab ────────────────────────────────────────────────────────────

test.describe('Treasuries tab — RANGE input adapts X axis', () => {
  test.beforeEach(async ({ page }) => {
    await setupNominalsRoutes(page);
    await page.goto('./');
    // Start on TIPS tab, then switch
    await page.click('[data-tab="treasuries"]');
    await expect(page.locator('#nominalsTable tbody tr')).toHaveCount(5, { timeout: 10000 });
  });

  test('narrowing end date reduces X max', async ({ page }) => {
    const initial = await getXBounds(page);
    expect(initial).not.toBeNull();
    // initial maxX should reflect 2056 bond
    const jan2050 = new Date(2050, 0, 1).getTime();
    expect(initial.max).toBeGreaterThan(jan2050);

    // Trim end to 2031-12-31 — excludes 2036 and 2056 bonds
    await setRangeEnd(page, '2031-12-31');
    const narrowed = await getXBounds(page);

    expect(narrowed).not.toBeNull();
    expect(narrowed.max).toBeLessThan(initial.max);
    // maxX should be month-snapped to Jan 1 2032 (next month after Dec 2031)
    const jan2032 = new Date(2032, 0, 1).getTime();
    const feb2032 = new Date(2032, 1, 1).getTime();
    expect(narrowed.max).toBeGreaterThanOrEqual(jan2032);
    expect(narrowed.max).toBeLessThanOrEqual(feb2032);
  });

  test('widening end date back restores X max', async ({ page }) => {
    await setRangeEnd(page, '2031-12-31');
    const narrowed = await getXBounds(page);

    await setRangeEnd(page, '2056-03-25');
    const widened = await getXBounds(page);

    expect(widened.max).toBeGreaterThan(narrowed.max);
  });

  test('narrowing start date increases X min', async ({ page }) => {
    const initial = await getXBounds(page);

    // Move start past 2026 bill and 2028 notes
    await setRangeStart(page, '2031-01-01');
    const narrowed = await getXBounds(page);

    expect(narrowed.min).toBeGreaterThan(initial.min);
  });

  test('prior zoom is discarded when range changes', async ({ page }) => {
    await page.evaluate(() => {
      const chart = Chart.getChart(document.getElementById('yieldChart'));
      chart.options.scales.x.min = new Date(2040, 0, 1).getTime();
      chart.options.scales.x.max = new Date(2045, 0, 1).getTime();
      chart.update('none');
    });

    await setRangeEnd(page, '2031-12-31');
    const after = await getXBounds(page);

    // If the zoom was incorrectly restored, max would still be 2045
    const jan2040 = new Date(2040, 0, 1).getTime();
    expect(after.max).toBeLessThan(jan2040);
  });
});
