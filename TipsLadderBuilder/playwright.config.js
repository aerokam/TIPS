import { defineConfig } from 'playwright/test';

export default defineConfig({
  testDir: 'tests',
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:8080/TipsLadderBuilder/',
    headless: true,
  },
  webServer: {
    command: 'cmd /c npx serve .. -p 8080',
    port: 8080,
    reuseExistingServer: true,
    timeout: 10_000,
  },
});
