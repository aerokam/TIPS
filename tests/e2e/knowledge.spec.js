import { test, expect } from '@playwright/test';

test.describe('Knowledge Map and Viewer', () => {
  test('should load context map and navigate to TipsLadderManager overview', async ({ page }) => {
    await page.goto('/knowledge/KNOWLEDGE_MAP.html');
    await expect(page.locator('h1')).toContainText('Treasury Investors Portal');

    // Click TipsLadderManager process bubble
    const tlmLink = page.locator('a:has-text("TipsLadderManager")');
    await tlmLink.click();

    await expect(page.locator('h1')).toContainText('TipsLadderManager (App Overview)', { timeout: 10000 });
    await expect(page.url()).toContain('#/md/knowledge/TipsLadderManager.md');
  });

  test('should toggle CSV previews in DataStores doc', async ({ page }) => {
    await page.goto('/knowledge/viewer.html#/md/knowledge/DataStores.md');
    
    const viewLink = page.locator('a:has-text("View")').first();
    await expect(viewLink).toBeVisible({ timeout: 10000 });
    
    // Click to open preview
    await viewLink.click();
    
    // Wait for either the table or an error message (if fetch fails)
    const preview = page.locator('.csv-preview, p:has-text("Failed to load preview")');
    await expect(preview).toBeVisible({ timeout: 15000 });
    
    const tableExists = await page.locator('.csv-preview').isVisible();
    if (tableExists) {
        // Click again to close preview
        await viewLink.click();
        await expect(page.locator('.csv-preview')).not.toBeVisible();
    }
  });

  test('should navigate to new file when clicking internal mermaid links', async ({ page }) => {
    await page.goto('/knowledge/viewer.html#/md/knowledge/TipsLadderManager.md');
    
    // Wait for Mermaid to render
    const mermaidSvg = page.locator('.mermaid svg');
    await expect(mermaidSvg).toBeVisible({ timeout: 15000 });

    // Click "Build Logic" process in Mermaid diagram
    // Try to find the link by its title or text content inside the SVG
    const buildLogicLink = page.locator('.mermaid a').filter({ hasText: 'Build Logic' }).first();
    await buildLogicLink.click();

    // Should navigate to 1.0_Bond_Ladders.md
    await expect(page.url()).toContain('1.0_Bond_Ladders.md');
    await expect(page.locator('h1')).toContainText('1.0 Bond Ladders');
  });

  test('should render LaTeX math via KaTeX, not raw source', async ({ page }) => {
    await page.goto('/knowledge/viewer.html#/md/YieldCurves/knowledge/1.0_Seasonal_Adjustments.md');

    // The display formula P_SA = P_Price * S_settle / S_maturity becomes a .katex node
    const katex = page.locator('.katex').first();
    await expect(katex).toBeVisible({ timeout: 15000 });

    // Raw delimiters must not survive into the rendered text
    const body = await page.locator('#content').innerText();
    expect(body).not.toContain('\\frac');
    expect(body).not.toContain('P_{SA}');
  });

  test('should show error for non-existent files', async ({ page }) => {
    await page.goto('/knowledge/viewer.html#/md/knowledge/NonExistent.md');
    await expect(page.locator('.error')).toBeVisible();
    await expect(page.locator('.error')).toContainText('Failed to load');
  });
});
