import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:8080/',
    headless: true,
  },
  webServer: {
    command: 'npx serve . -p 8080',
    port: 8080,
    reuseExistingServer: true,
    timeout: 10_000,
  },
});
