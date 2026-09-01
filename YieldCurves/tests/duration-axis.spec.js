import { test, expect } from '@playwright/test';

// Duration X-axis mode — knowledge/3.0_Visual_Standards.md §2b.
// Verifies the third x-axis choice renders on every tab/chart and that the
// BEI leg-pairing switches from closest-maturity to closest-duration.

const SETTLE = '2026-03-25';

const FED_YIELDS_CSV = [
  SETTLE,
  'type,cusip,maturity,coupon,datedDateCpi,price,yield',
  'MARKET BASED BILL,912797TB3,2026-06-26,0.000,,99.060,0.000',
  'MARKET BASED NOTE,91282CBT7,2028-03-25,0.04250,,100.000,0.04250',
  'MARKET BASED NOTE,91282CKH3,2031-03-25,0.04350,,100.000,0.04350',
  'MARKET BASED BOND,912810PS1,2036-03-25,0.04750,,100.000,0.04750',
  'MARKET BASED BOND,912810XX1,2056-03-25,0.04850,,100.000,0.04850',
  'TIPS,91282CCA7,2026-04-15,0.00125,262.25027,100.0625,0.000',
  'TIPS,912828S50,2026-07-15,0.00125,239.70132,101.4375,0.000',
  'TIPS,91282CDC2,2026-10-15,0.00125,273.25771,100.96875,0.000',
].join('\n');

const REF_CPI_CSV = [
  'Ref CPI Date,Ref CPI NSA,Ref CPI SA,SA Factor',
  '2026-04-15,325.96740,326.99493,0.99686',
  '2026-07-15,321.09758,320.44561,1.00203',
  '2026-10-15,323.46710,322.67571,1.00245',
  '2026-03-25,324.74961,326.35442,0.99508',
  '2026-03-26,324.74961,326.35442,0.99508',
].join('\n');

const HOLIDAYS_CSV = '"Wednesday, January 1, 2025",New Year\'s Day\n';

const FID_COMBINED_CSV = [
  'Product,Description,Cusip|State,Coupon,Frequency,Maturity date,Call protected,Moody\'s/S&P rating,Yield,Bid price/Quantity (min),Adjusted bid price,Inflation factor,Ask price/Quantity (min),Adjusted ask price,Ask yield to worst,Ask yield to sink,Ask yield to maturity,3rd party price,Depth of book,Attributes,',
  'Treasury,"UNITED STATES TREAS BILLS ZERO CPN 0.00000% 06/26/2026",912797TB3,0.000,,2026-06-26,Yes,--/ --,3.820,99.040/1000(1000),--,--,99.060/1000(1000),--,3.810,--,3.810,--,--,CP',
  'Treasury,"UNITED STATES TREAS SER W-2028 4.25000% 03/25/2028 NTS NOTE",91282CBT7,4.250,semi-annually,2028-03-25,Yes,AA1/ --,4.310,99.900/1000(1000),--,--,100.000/1000(1000),--,4.300,--,4.300,--,--,"CP, IE"',
  'Treasury,"UNITED STATES TREAS SER AZ-2031 4.35000% 03/25/2031 NTS NOTE",91282CKH3,4.350,semi-annually,2031-03-25,Yes,AA1/ --,4.410,99.900/1000(1000),--,--,100.000/1000(1000),--,4.400,--,4.400,--,--,"CP, IE"',
  'Treasury,"UNITED STATES TREAS BDS 4.75000% 03/25/2036",912810PS1,4.750,semi-annually,2036-03-25,Yes,AA1/ --,4.810,99.900/1000(1000),--,--,100.000/1000(1000),--,4.800,--,4.800,--,--,"CP, IE"',
  'Treasury,"UNITED STATES TREAS BDS 4.85000% 03/25/2056",912810XX1,4.850,semi-annually,2056-03-25,Yes,AA1/ --,4.910,99.900/1000(1000),--,--,100.000/1000(1000),--,4.900,--,4.900,--,--,"CP, IE"',
  'TIPS,"UNITED STATES TREAS NTS SER X-2026 0.12500% 04/15/2026",91282CCA7,0.125,semi-annually,2026-04-15,Yes,AA1/ --,-1.019,100.062/6000(100),124.011839,1.23935,100.132/6000(100),124.098594,-2.274,--,-2.274,--,--,"CP, IE"',
  'TIPS,"UNITED STATES TREAS NTS 0.12500% 07/15/2026 TIPS",912828S50,0.125,semi-annually,2026-07-15,Yes,AA1/ --,-3.842,101.231/6000(100),137.263162,1.35594,101.284/6000(100),137.335026,-4.011,--,-4.011,--,--,"CP, IE"',
  'TIPS,"UNITED STATES TREAS NTS SER AE-2026 0.12500% 10/15/2026",91282CDC2,0.125,semi-annually,2026-10-15,Yes,AA1/ --,-1.095,100.680/6000(100),119.751812,1.18943,100.738/6000(100),119.820799,-1.197,--,-1.197,--,--,"CP, IE"',
].join('\n');

async function setupRoutes(page) {
  await page.route('**/Treasuries/YieldsFromFedInvestPrices.csv', r => r.fulfill({ status: 200, contentType: 'text/csv', body: FED_YIELDS_CSV }));
  await page.route('**/TIPS/RefCpiNsaSa.csv',                      r => r.fulfill({ status: 200, contentType: 'text/csv', body: REF_CPI_CSV }));
  await page.route('**/misc/BondHolidaysSifma.csv',               r => r.fulfill({ status: 200, contentType: 'text/csv', body: HOLIDAYS_CSV }));
  await page.route('**/Treasuries/FidelityTreasuriesTips.csv',     r => r.fulfill({ status: 200, contentType: 'text/csv', body: FID_COMBINED_CSV }));
}

const durationRadio = page => page.locator('input[name="xAxisMode"][value="duration"]');

async function load(page) {
  await setupRoutes(page);
  await page.goto('./');
  await expect(page.locator('#saTable tbody tr')).toHaveCount(3, { timeout: 10000 });
  await expect(page.locator('#chkTipsBroker')).not.toBeDisabled({ timeout: 5000 });
}

// Read the current chart's x-axis tick labels via Chart.js.
async function xTickLabels(page) {
  return page.evaluate(() => {
    const c = window.Chart?.getChart('yieldChart');
    return c ? c.scales.x.ticks.map(t => t.label).filter(Boolean) : null;
  });
}

test('Duration radio renders the TIPS chart with a duration axis', async ({ page }) => {
  await load(page);
  await durationRadio(page).check();
  await expect(page.locator('#yieldChart')).toBeVisible();
  await expect(page.locator('#saTable tbody tr')).toHaveCount(3);
  // Front-end TIPS (< 1y) → sub-year tick labels ("Xw" / "Xm"), never a calendar year.
  const labels = await xTickLabels(page);
  expect(labels && labels.length).toBeGreaterThan(0);
  expect(labels.some(l => /^\d{4}$/.test(l))).toBe(false);
});

test('Duration mode persists to the Treasuries tab', async ({ page }) => {
  await load(page);
  await durationRadio(page).check();
  await page.click('[data-tab="treasuries"]');
  await expect(page.locator('#nominalsTable tbody tr')).toHaveCount(5, { timeout: 10000 });
  await expect(page.locator('#yieldChart')).toBeVisible();
  await expect(durationRadio(page)).toBeChecked();
});

test('Duration mode renders the BEI chart', async ({ page }) => {
  await load(page);
  await page.click('[data-tab="bei"]');
  await expect(page.locator('#beiTableBody tr')).toHaveCount(3, { timeout: 10000 });
  await durationRadio(page).check();
  await expect(page.locator('#yieldChart')).toBeVisible();
  await expect(page.locator('#beiTableBody tr')).toHaveCount(3);
});

test('Duration mode renders the Bid-Ask Spread charts', async ({ page }) => {
  await load(page);
  await page.click('.tab-btn[data-mode="spread"]');
  await expect(page.locator('#spreadChartWrap')).toBeVisible();
  await durationRadio(page).check();
  await expect(page.locator('#spreadYieldChart')).toBeVisible();
  await expect(page.locator('#spreadPriceChart')).toBeVisible();
});

test('BEI still pairs every TIPS to a real nominal in Duration mode', async ({ page }) => {
  await load(page);
  await page.click('[data-tab="bei"]');
  await expect(page.locator('#beiTableBody tr')).toHaveCount(3, { timeout: 10000 });
  await durationRadio(page).check();
  await expect(page.locator('#beiTableBody tr')).toHaveCount(3);

  // Column 6 is the matched nominal's yield — must be a real % for every row,
  // i.e. the duration-based matcher returned a bond, not null.
  const nominalYields = await page.evaluate(() =>
    [...document.querySelectorAll('#beiTableBody tr')].map(tr => tr.children[7]?.textContent?.trim()));
  expect(nominalYields).toHaveLength(3);
  expect(nominalYields.every(y => /%$/.test(y) && y !== '—')).toBe(true);
});
