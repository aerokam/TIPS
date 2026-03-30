import { test, expect } from '@playwright/test';

test.describe('Knowledge Map and Viewer', () => {
  test('should load knowledge map and navigate to a document', async ({ page }) => {
    await page.goto('/knowledge/KNOWLEDGE_MAP');
    await expect(page.locator('h1')).toContainText('Knowledge Map');

    const bondBasicsNode = page.locator('#n-BB');
    await bondBasicsNode.click();

    await expect(page.locator('h1')).toContainText('1.0 Bond Basics', { timeout: 10000 });
    await expect(page.url()).toContain('#/md/knowledge/Bond_Basics.md');
  });

  test('should intercept markdown links and stay within viewer', async ({ page }) => {
    await page.goto('/knowledge/viewer#/md/knowledge/Bond_Basics.md');
    
    const quantityLink = page.locator('a:has-text("Quantity")').first();
    await expect(quantityLink).toBeVisible({ timeout: 10000 });
    
    await quantityLink.click();
    
    await expect(page.locator('h1')).toContainText('Data Dictionary', { timeout: 10000 });
    await expect(page.url()).toContain('#/md/knowledge/DATA_DICTIONARY.md#quantity');
    
    const quantityHeader = page.locator('#quantity');
    await expect(quantityHeader).toBeAttached();
  });

  test('should handle back button correctly (hashchange)', async ({ page }) => {
    await page.goto('/knowledge/viewer#/md/knowledge/Bond_Basics.md');
    const quantityLink = page.locator('a:has-text("Quantity")').first();
    await expect(quantityLink).toBeVisible({ timeout: 10000 });
    await quantityLink.click();
    await expect(page.locator('h1')).toContainText('Data Dictionary', { timeout: 10000 });

    await page.goBack();
    await expect(page.locator('h1')).toContainText('1.0 Bond Basics', { timeout: 10000 });
  });

  test('should show error for non-existent files', async ({ page }) => {
    await page.goto('/knowledge/viewer#/md/knowledge/NonExistent.md');
    await expect(page.locator('.error')).toBeVisible();
    await expect(page.locator('.error')).toContainText('Failed to load');
  });
});
