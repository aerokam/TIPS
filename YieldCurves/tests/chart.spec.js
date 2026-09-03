import { test, expect } from '@playwright/test';

test.describe('Yield Curves Chart and UI', () => {
  test.beforeEach(async ({ page }) => {
    // Intercept CSV fetches to use mock data
    await page.route('**/Treasuries/YieldsFromFedInvestPrices.csv', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'text/csv',
        body: '2026-03-19\n' +
              'type,cusip,maturity,coupon,datedDateCpi,price,yield\n' +
              'TIPS,91282CCA7,2026-04-15,0.00125,262.25027,100.0625,-0.00715670\n' +
              'TIPS,912828S50,2026-07-15,0.00125,239.70132,101.4375,-0.04207774\n' +
              'TIPS,91282CDC2,2026-10-15,0.00125,273.25771,100.96875,-0.01548122\n'
      });
    });

    await page.route('**/TIPS/RefCpiNsaSa.csv', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'text/csv',
        body: 'Ref CPI Date,Ref CPI NSA,Ref CPI SA,SA Factor\n' +
              '2026-04-15,325.96740,326.99493,0.99686\n' +
              '2026-07-15,321.09758,320.44561,1.00203\n' +
              '2026-10-15,323.46710,322.67571,1.00245\n' +
              '2026-03-19,324.74961,326.35442,0.99508\n'
      });
    });

    await page.route('**/misc/BondHolidaysSifma.csv', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'text/csv',
        body: '"Wednesday, January 1, 2025",New Year’s Day\n'
      });
    });
    await page.route('**/TIPS/GswTipsCurve.json', r => r.fulfill({ status: 404, body: '' }));  // GSW overlay: force snapshot fallback in tests

    await page.goto('./');
    // FedInvest defaults off and no Market data is mocked here, so it must be
    // checked explicitly for these FedInvest-sourced fixtures to render.
    await page.check('#chkTipsFed');
    // Wait for the table to load (indicates data processing finished)
    await expect(page.locator('#saTable tbody tr')).toHaveCount(3, { timeout: 10000 });
  });

  test('should load the chart and table', async ({ page }) => {
    await expect(page.locator('#saTable tbody tr')).toHaveCount(3);
    await expect(page.locator('#yieldChart')).toBeVisible();
  });

  test('should show correct yield curve labels', async ({ page }) => {
    // FedInvest source label + settle date now live in the TIPS source checkbox row.
    const fedLabel = page.locator('#chkTipsFed').locator('..');
    await expect(fedLabel).toContainText('FedInvest');
    await expect(page.locator('#tipsFedMeta')).toContainText('settle 03/19/2026 (T)');
  });

  test('should allow maturity range filtering', async ({ page }) => {
    const startSel = page.locator('#startMaturity');
    const endSel = page.locator('#endMaturity');
    
    // Initial state: all 3 bonds
    await expect(page.locator('#saTable tbody tr')).toHaveCount(3);
    
    // Select second bond as start
    const options = await startSel.locator('option').allInnerTexts();
    if (options.length > 1) {
      await startSel.selectOption({ index: 1 });
      // Should now have 2 bonds (Jul and Oct)
      await expect(page.locator('#saTable tbody tr')).toHaveCount(2);
    }
  });

  test('reset button should restore chart view', async ({ page }) => {
    const canvas = page.locator('#yieldChart');
    await expect(canvas).toBeVisible();

    // Simple click test for reset button to ensure no crash
    await page.click('#resetZoom');
    await expect(canvas).toBeVisible();
  });

  test('SHOW-row labels open help popups', async ({ page }) => {
    await page.click('#tipsControls a.col-help[data-col="spot"]');
    await expect(page.locator('#drill-modal')).toContainText('Zero-Coupon Yield Curve');
    await page.click('#drill-close');
    await page.click('#tipsControls a.col-help[data-col="sa-yield"]');
    await expect(page.locator('#drill-modal')).toContainText('Seasonal Adjustment');
  });

  test('GSW row is hidden without ?gsw, shown with it', async ({ page }) => {
    await expect(page.locator('#tipsGswShow')).toBeHidden();
    await page.goto('./?gsw');
    await page.check('#chkTipsFed');
    await expect(page.locator('#saTable tbody tr')).toHaveCount(3, { timeout: 10000 });
    await expect(page.locator('#tipsGswShow')).toBeVisible();
  });
});
