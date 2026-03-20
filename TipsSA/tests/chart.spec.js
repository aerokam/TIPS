import { test, expect } from '@playwright/test';

test.describe('TipsSA Chart and UI', () => {
  test.beforeEach(async ({ page }) => {
    page.on('request', request => console.log('>>', request.method(), request.url()));
    page.on('response', response => console.log('<<', response.status(), response.url()));

    await page.route('**/data/*.csv', async route => {
      const url = route.request().url();
      console.log('INTERCEPTING CSV:', url);
      if (url.includes('TipsYields.csv')) {
        await route.fulfill({
          status: 200,
          contentType: 'text/csv',
          body: 'settlementDate,cusip,maturity,coupon,baseCpi,price,yield\n' +
                '2026-03-19,91282CCA7,2026-04-15,0.00125,262.25027,100.0625,-0.00715670\n' +
                '2026-03-19,912828S50,2026-07-15,0.00125,239.70132,101.4375,-0.04207774\n' +
                '2026-03-19,91282CDC2,2026-10-15,0.00125,273.25771,100.96875,-0.01548122\n'
        });
      } else if (url.includes('RefCpiNsaSa.csv')) {
        await route.fulfill({
          status: 200,
          contentType: 'text/csv',
          body: 'Ref CPI Date,Ref CPI NSA,Ref CPI SA,SA Factor\n' +
                '2026-04-15,325.96740,326.99493,0.99686\n' +
                '2026-07-15,321.09758,320.44561,1.00203\n' +
                '2026-10-15,323.46710,322.67571,1.00245\n' +
                '2026-03-19,324.74961,326.35442,0.99508\n'
        });
      } else {
        await route.continue();
      }
    });

    const response = await page.goto('http://127.0.0.1:8080/TipsSA/index.html');

    console.log('Final URL:', page.url());
    console.log('Page Title:', await page.title());
    console.log('Response Status:', response.status());
    if (response.status() !== 200) {
      console.log('Page Content:', await page.content());
    }
  });

  test('should load the chart and table', async ({ page }) => {
    await expect(page.locator('#saTable tbody tr')).toHaveCount(3);
    await expect(page.locator('#yieldChart')).toBeVisible();
  });

  test('should zoom and adjust width when dragging on chart', async ({ page }) => {
    const canvas = page.locator('#yieldChart');
    const box = await canvas.boundingBox();
    const resizable = page.locator('#chartResizable');

    // Monitor for console errors/freezes
    const errors = [];
    page.on('pageerror', err => errors.push(err));
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    // Initial width
    await expect(resizable).toHaveCSS('width', /.*px/);
    const initialWidth = (await resizable.boundingBox()).width;

    // Simulate drag selection (Zoom)
    // Start at 20% width, drag to 50% width
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5, { steps: 10 });
    await page.mouse.up();

    // Wait for animation/logic
    await page.waitForTimeout(500);

    // After zoom-to-stretch, the resizable div should be wider than 100%
    const newWidth = (await resizable.boundingBox()).width;
    expect(newWidth).toBeGreaterThan(initialWidth);
    
    // Ensure no JS errors occurred (which would indicate a freeze/crash)
    expect(errors).toHaveLength(0);
  });

  test('reset button should restore chart to 100% width', async ({ page }) => {
    const resizable = page.locator('#chartResizable');
    const canvas = page.locator('#yieldChart');
    const box = await canvas.boundingBox();

    // Trigger a zoom first
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.5);
    await page.mouse.up();
    await page.waitForTimeout(200);

    // Click reset
    await page.click('#resetZoom');
    await page.waitForTimeout(200);

    // Should be back to initial style (which is width: 100%)
    const style = await resizable.getAttribute('style');
    expect(style).toContain('width: 100%');
  });
});
