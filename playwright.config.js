import { defineConfig } from 'playwright/test';

export default defineConfig({
  testDir: 'tests',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:8080',
    headless: true,
  },
  webServer: {
    command: 'npx serve . -p 8080 -s',
    port: 8080,
    reuseExistingServer: true,
    timeout: 10_000,
  },
});
