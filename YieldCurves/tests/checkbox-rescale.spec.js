import { test, expect } from '@playwright/test';

// ─── Mock data ────────────────────────────────────────────────────────────────
// Bills ~3.8%  |  Notes ~4.25–4.35%  |  Bonds ~4.75–4.85%
// (par bonds: yield ≈ coupon;  bill yield computed via BEY from discount price)

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
  '2026-03-26,324.74961,326.35442,0.99508', // T+1 settlement date for broker source
].join('\n');

const HOLIDAYS_CSV = '"Wednesday, January 1, 2025",New Year\'s Day\n';

// Same CUSIPs as FedInvest so parseFidelityNominals accepts them
const FID_TREASURIES_CSV = [
  'Cusip,State,Description,Coupon,Maturity Date,Moody\'s Rating,S&P Rating,Price Bid,Price Ask,Yield Bid,Ask Yield to Worst,Ask Yield to Maturity,Quantity Bid(min),Quantity Ask(min),Attributes',
  '912797TB3,"N/A","UNITED STATES TREAS BILLS ZERO CPN 0.00000% 06/26/2026","0.000","06/26/2026","--","--","99.040","99.060","3.820","3.810","3.810","1000","1000",CP D ',
  '91282CBT7,"N/A","UNITED STATES TREAS SER W-2028 4.25000% 03/25/2028 NTS NOTE","4.250","03/25/2028","AA1","--","99.900","100.000","4.310","4.300","4.300","1000","1000",CP D ',
  '91282CKH3,"N/A","UNITED STATES TREAS SER AZ-2031 4.35000% 03/25/2031 NTS NOTE","4.350","03/25/2031","AA1","--","99.900","100.000","4.410","4.400","4.400","1000","1000",CP D ',
  '912810PS1,"N/A","UNITED STATES TREAS BDS 4.75000% 03/25/2036","4.750","03/25/2036","AA1","--","99.900","100.000","4.810","4.800","4.800","1000","1000",CP D ',
  '912810XX1,"N/A","UNITED STATES TREAS BDS 4.85000% 03/25/2056","4.850","03/25/2056","AA1","--","99.900","100.000","4.910","4.900","4.900","1000","1000",CP D ',
].join('\n');

const FID_TIPS_CSV = [
  'Cusip,State,Description,Coupon,Maturity Date,Moody\'s Rating,S&P Rating,Price Bid,Price Ask,Yield Bid,Ask Yield to Worst,Ask Yield to Maturity,Inflation Factor,Adjusted Price Bid,Adjusted Price Ask,Attributes',
  '91282CCA7,"N/A","UNITED STATES TREAS NTS SER X-2026 0.12500% 04/15/2026","0.125","04/15/2026","AA1","--","100.062","100.132","-1.019","-2.274","-2.274","1.23935","124.011839","124.098594",CP D ',
  '912828S50,"N/A","UNITED STATES TREAS NTS 0.12500% 07/15/2026 TIPS","0.125","07/15/2026","AA1","--","101.231","101.284","-3.842","-4.011","-4.011","1.35594","137.263162","137.335026",CP D ',
  '91282CDC2,"N/A","UNITED STATES TREAS NTS SER AE-2026 0.12500% 10/15/2026","0.125","10/15/2026","AA1","--","100.680","100.738","-1.095","-1.197","-1.197","1.18943","119.751812","119.820799",CP D ',
].join('\n');

// ─── Outlier mock: 52 nominals including 2 extreme low-yield notes ─────────────
// Normal notes: 4.00–4.58%  |  Normal bonds: 4.60–5.17%
// Extreme notes: 1.50%, 2.00% (both below lo≈3.63% with 1×IQR fence≈0.59)
// excluded/total = 2/52 = 3.8% < 5% threshold → clip applies

function makeFedOutlierCsv() {
  const rows = [
    SETTLE,
    'type,cusip,maturity,coupon,datedDateCpi,price,yield',
    'MARKET BASED NOTE,NLOW00001,2027-01-15,0.01500,,100.000,0.01500',
    'MARKET BASED NOTE,NLOW00002,2028-01-15,0.02000,,100.000,0.02000',
    'TIPS,91282CCA7,2026-04-15,0.00125,262.25027,100.0625,0.000',
    'TIPS,912828S50,2026-07-15,0.00125,239.70132,101.4375,0.000',
    'TIPS,91282CDC2,2026-10-15,0.00125,273.25771,100.96875,0.000',
  ];
  for (let i = 0; i < 30; i++) {
    const y = (0.0400 + i * 0.0002).toFixed(5);
    const cusip = `NORM${String(i).padStart(5, '0')}`;
    const matYear = 2029 + Math.floor(i / 2);
    const matMonth = i % 2 === 0 ? '01' : '07';
    rows.push(`MARKET BASED NOTE,${cusip},${matYear}-${matMonth}-15,${y},,100.000,${y}`);
  }
  for (let i = 0; i < 20; i++) {
    const y = (0.0460 + i * 0.0003).toFixed(5);
    const cusip = `BNDX${String(i).padStart(5, '0')}`;
    rows.push(`MARKET BASED BOND,${cusip},${2057 + i * 2}-01-15,${y},,100.000,${y}`);
  }
  return rows.join('\n');
}

const FED_YIELDS_CSV_OUTLIER = makeFedOutlierCsv();

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function setupRoutes(page) {
  await page.route('**/Treasuries/YieldsDerivedFromFedInvestPrices.csv', r => r.fulfill({ status: 200, contentType: 'text/csv', body: FED_YIELDS_CSV }));
  await page.route('**/Treasuries/RefCpiNsaSa.csv', r => r.fulfill({ status: 200, contentType: 'text/csv', body: REF_CPI_CSV }));
  await page.route('**/misc/BondHolidaysSifma.csv', r => r.fulfill({ status: 200, contentType: 'text/csv', body: HOLIDAYS_CSV }));
  await page.route('**/Treasuries/FidelityTreasuries.csv', r => r.fulfill({ status: 200, contentType: 'text/csv', body: FID_TREASURIES_CSV }));
  await page.route('**/Treasuries/FidelityTips.csv', r => r.fulfill({ status: 200, contentType: 'text/csv', body: FID_TIPS_CSV }));
}

async function setupOutlierRoutes(page) {
  await page.route('**/Treasuries/YieldsDerivedFromFedInvestPrices.csv', r => r.fulfill({ status: 200, contentType: 'text/csv', body: FED_YIELDS_CSV_OUTLIER }));
  await page.route('**/Treasuries/RefCpiNsaSa.csv', r => r.fulfill({ status: 200, contentType: 'text/csv', body: REF_CPI_CSV }));
  await page.route('**/misc/BondHolidaysSifma.csv', r => r.fulfill({ status: 200, contentType: 'text/csv', body: HOLIDAYS_CSV }));
  // No matching Fidelity CUSIPs — Market source inactive for this test
  await page.route('**/Treasuries/FidelityTreasuries.csv', r => r.fulfill({ status: 200, contentType: 'text/csv', body: FID_TREASURIES_CSV.split('\n')[0] }));
  await page.route('**/Treasuries/FidelityTips.csv', r => r.fulfill({ status: 200, contentType: 'text/csv', body: FID_TIPS_CSV.split('\n')[0] }));
}

async function getYBounds(page) {
  return page.evaluate(() => {
    const chart = Chart.getChart(document.getElementById('yieldChart'));
    if (!chart?.scales?.y) return null;
    return { min: chart.scales.y.min, max: chart.scales.y.max };
  });
}

// ─── Treasuries tab ───────────────────────────────────────────────────────────

test.describe('Treasuries tab — checkbox rescale', () => {
  test.beforeEach(async ({ page }) => {
    await setupRoutes(page);
    await page.goto('./');
    // Wait for initial TIPS load
    await expect(page.locator('#saTable tbody tr')).toHaveCount(3, { timeout: 10000 });
    // Switch to Treasuries
    await page.click('[data-tab="treasuries"]');
    // Wait for nominals table and Market checkbox to be enabled
    await expect(page.locator('#nominalsTable tbody tr')).toHaveCount(5, { timeout: 10000 });
    await expect(page.locator('#chkFidelity')).not.toBeDisabled({ timeout: 5000 });
  });

  test('uncheck Bonds rescales Y axis down', async ({ page }) => {
    const before = await getYBounds(page);
    await page.click('#filterBonds');
    const after = await getYBounds(page);
    expect(after.max).toBeLessThan(before.max);
  });

  test('recheck Bonds rescales Y axis back up', async ({ page }) => {
    await page.click('#filterBonds'); // uncheck
    const withoutBonds = await getYBounds(page);
    await page.click('#filterBonds'); // recheck
    const withBonds = await getYBounds(page);
    expect(withBonds.max).toBeGreaterThan(withoutBonds.max);
  });

  test('uncheck Notes removes Notes series from chart', async ({ page }) => {
    const before = await page.evaluate(() => Chart.getChart(document.getElementById('yieldChart'))?.data.datasets.length);
    await page.click('#filterNotes');
    const after = await page.evaluate(() => Chart.getChart(document.getElementById('yieldChart'))?.data.datasets.length);
    expect(after).toBeLessThan(before);
  });

  test('recheck Notes restores Notes series to chart', async ({ page }) => {
    await page.click('#filterNotes');
    const fewer = await page.evaluate(() => Chart.getChart(document.getElementById('yieldChart'))?.data.datasets.length);
    await page.click('#filterNotes');
    const more = await page.evaluate(() => Chart.getChart(document.getElementById('yieldChart'))?.data.datasets.length);
    expect(more).toBeGreaterThan(fewer);
  });

  test('uncheck Bills rescales Y axis up (min increases)', async ({ page }) => {
    const before = await getYBounds(page);
    await page.click('#filterBills');
    const after = await getYBounds(page);
    expect(after.min).toBeGreaterThan(before.min);
  });

  test('recheck Bills rescales Y axis back down', async ({ page }) => {
    await page.click('#filterBills');
    const withoutBills = await getYBounds(page);
    await page.click('#filterBills');
    const withBills = await getYBounds(page);
    expect(withBills.min).toBeLessThan(withoutBills.min);
  });

  test('uncheck FedInvest removes FedInvest datasets from chart', async ({ page }) => {
    const before = await page.evaluate(() => Chart.getChart(document.getElementById('yieldChart'))?.data.datasets.length);
    await page.click('#chkFedInvest');
    const after = await page.evaluate(() => Chart.getChart(document.getElementById('yieldChart'))?.data.datasets.length);
    expect(after).toBeLessThan(before);
  });

  test('recheck FedInvest restores FedInvest datasets to chart', async ({ page }) => {
    await page.click('#chkFedInvest');
    const marketOnly = await page.evaluate(() => Chart.getChart(document.getElementById('yieldChart'))?.data.datasets.length);
    await page.click('#chkFedInvest');
    const both = await page.evaluate(() => Chart.getChart(document.getElementById('yieldChart'))?.data.datasets.length);
    expect(both).toBeGreaterThan(marketOnly);
  });

  test('uncheck Market rescales Y axis', async ({ page }) => {
    const before = await getYBounds(page);
    await page.click('#chkFidelity');
    const after = await getYBounds(page);
    expect(after).not.toEqual(before);
  });

  test('recheck Market rescales Y axis', async ({ page }) => {
    await page.click('#chkFidelity');
    const fedOnly = await getYBounds(page);
    await page.click('#chkFidelity');
    const both = await getYBounds(page);
    expect(both).not.toEqual(fedOnly);
  });

  test('uncheck Clip Outliers widens Y range', async ({ page }) => {
    const clipped = await getYBounds(page);
    await page.click('#clipOutliers');
    const unclipped = await getYBounds(page);
    // Without clipping, range is >= clipped range
    const clippedRange = clipped.max - clipped.min;
    const unclippedRange = unclipped.max - unclipped.min;
    expect(unclippedRange).toBeGreaterThanOrEqual(clippedRange);
  });

  test('recheck Clip Outliers restores clipped Y range', async ({ page }) => {
    await page.click('#clipOutliers'); // off
    const unclipped = await getYBounds(page);
    await page.click('#clipOutliers'); // on
    const clipped = await getYBounds(page);
    const clippedRange = clipped.max - clipped.min;
    const unclippedRange = unclipped.max - unclipped.min;
    expect(clippedRange).toBeLessThanOrEqual(unclippedRange);
  });

  test('Reset View rescales Y to fit current data', async ({ page }) => {
    // Manually zoom Y axis via chart API
    await page.evaluate(() => {
      const chart = Chart.getChart(document.getElementById('yieldChart'));
      chart.options.scales.y.min = 4.5;
      chart.options.scales.y.max = 4.6;
      chart.update('none');
    });
    const zoomed = await getYBounds(page);
    expect(zoomed.max - zoomed.min).toBeLessThan(0.2);

    await page.click('#resetZoom');
    const reset = await getYBounds(page);
    expect(reset.max - reset.min).toBeGreaterThan(0.2);
  });

  test('deselecting all sources clears chart', async ({ page }) => {
    await page.click('#chkFedInvest');
    await page.click('#chkFidelity');
    const bounds = await getYBounds(page);
    expect(bounds).toBeNull();
  });
});

// ─── TIPS tab ─────────────────────────────────────────────────────────────────

test.describe('TIPS tab — checkbox rescale', () => {
  test.beforeEach(async ({ page }) => {
    await setupRoutes(page);
    await page.goto('./');
    await expect(page.locator('#saTable tbody tr')).toHaveCount(3, { timeout: 10000 });
    await expect(page.locator('#chkTipsBroker')).not.toBeDisabled({ timeout: 5000 });
  });

  test('uncheck FedInvest reduces TIPS chart datasets', async ({ page }) => {
    const before = await page.evaluate(() => Chart.getChart(document.getElementById('yieldChart'))?.data.datasets.length);
    await page.click('#chkTipsFed');
    const after = await page.evaluate(() => Chart.getChart(document.getElementById('yieldChart'))?.data.datasets.length);
    expect(after).toBeLessThan(before);
  });

  test('recheck FedInvest restores TIPS chart', async ({ page }) => {
    await page.click('#chkTipsFed');
    await page.click('#chkTipsFed');
    const bounds = await getYBounds(page);
    expect(bounds).not.toBeNull();
  });

  test('uncheck Market reduces TIPS chart datasets', async ({ page }) => {
    const before = await page.evaluate(() => Chart.getChart(document.getElementById('yieldChart'))?.data.datasets.length);
    await page.click('#chkTipsBroker');
    const after = await page.evaluate(() => Chart.getChart(document.getElementById('yieldChart'))?.data.datasets.length);
    expect(after).toBeLessThan(before);
  });

  test('recheck Market restores TIPS chart datasets', async ({ page }) => {
    await page.click('#chkTipsBroker');
    const fewer = await page.evaluate(() => Chart.getChart(document.getElementById('yieldChart'))?.data.datasets.length);
    await page.click('#chkTipsBroker');
    const more = await page.evaluate(() => Chart.getChart(document.getElementById('yieldChart'))?.data.datasets.length);
    expect(more).toBeGreaterThan(fewer);
  });

  test('Reset View rescales TIPS Y to fit data', async ({ page }) => {
    await page.evaluate(() => {
      const chart = Chart.getChart(document.getElementById('yieldChart'));
      chart.options.scales.y.min = -1;
      chart.options.scales.y.max = -0.9;
      chart.update('none');
    });
    const zoomed = await getYBounds(page);
    expect(zoomed.max - zoomed.min).toBeLessThan(0.2);

    await page.click('#resetZoom');
    const reset = await getYBounds(page);
    expect(reset.max - reset.min).toBeGreaterThan(0.2);
  });

  test('deselecting all sources clears TIPS chart', async ({ page }) => {
    await page.click('#chkTipsFed');
    await page.click('#chkTipsBroker');
    const bounds = await getYBounds(page);
    expect(bounds).toBeNull();
  });
});

// ─── Outlier clipping: bonds+notes combined ────────────────────────────────────

test.describe('Treasuries tab — outlier clipping: bonds+notes combined', () => {
  test.beforeEach(async ({ page }) => {
    await setupOutlierRoutes(page);
    await page.goto('./');
    await expect(page.locator('#saTable tbody tr')).toHaveCount(3, { timeout: 10000 });
    await page.click('[data-tab="treasuries"]');
    // 52 nominals: 2 extreme notes + 30 normal notes + 20 normal bonds
    await expect(page.locator('#nominalsTable tbody tr')).toHaveCount(52, { timeout: 10000 });
  });

  test('none → bonds → notes: clip outliers excludes extreme low-yield notes from Y scale', async ({ page }) => {
    // Reproduce bug path: start from default (all checked), uncheck to none, then add bonds, then notes
    await page.click('#filterNotes');          // uncheck Notes
    await page.click('#filterBonds');          // uncheck Bonds → nothing selected
    await page.click('#filterBonds');          // recheck Bonds only
    await page.click('#filterNotes');          // add Notes → bonds + notes (includes 1.5%, 2.0% extreme notes)

    const bounds = await getYBounds(page);
    // Clip Outliers default on; with 1×IQR: lo≈3.63%, extreme notes at 1.5% and 2.0% excluded
    expect(bounds.min).toBeGreaterThan(2.5);
  });

  test('long-dated high-yield bonds remain visible when Clip Outliers is enabled', async ({ page }) => {
    // Setup: Start with default (all checked, Clip Outliers enabled)
    // The mock data includes bonds at ~5.17% (BNDX00019 maturing in 2095)
    // and notes at ~4.00-4.58%.
    const bounds = await getYBounds(page);
    
    // The max Y bound should be high enough to include the 5.17% bond
    expect(bounds.max).toBeGreaterThan(5.1);
    
    // Toggle clipping off and then on again to ensure it doesn't accidentally 
    // clip the high end during rescale
    await page.click('#clipOutliers'); // off
    const unclipped = await getYBounds(page);
    await page.click('#clipOutliers'); // on
    const clipped = await getYBounds(page);
    
    expect(clipped.max).toBeCloseTo(unclipped.max, 1);
    expect(clipped.max).toBeGreaterThan(5.1);
  });
});
