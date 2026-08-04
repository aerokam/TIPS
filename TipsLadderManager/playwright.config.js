import { defineConfig } from 'playwright/test';

// Port is overridable via TLM_TEST_PORT so a git worktree checkout (a separate copy of this repo
// on disk, potentially with commits main doesn't have yet) can point its own local server/test run
// at a different port than main's, without the two colliding on the same one. Defaults to 8080 —
// unset, this behaves exactly as before.
const PORT = process.env.TLM_TEST_PORT || 8080;

export default defineConfig({
  testDir: 'tests',
  // Failures should fail fast, but the cap must sit just ABOVE the spec's inline { timeout: 4_000 }
  // assertion waits, else a slow-but-legit test races the cap and flakes. 4.5s is that floor; to go
  // shorter, lower the per-assertion 4_000 waits in app.spec.js too.
  timeout: 4_500,
  use: {
    baseURL: `http://127.0.0.1:${PORT}/TipsLadderManager/`,
    headless: true,
  },
  webServer: {
    command: `cmd /c npx serve .. -p ${PORT}`,
    port: PORT,
    reuseExistingServer: true,
    timeout: 10_000,
  },
});
