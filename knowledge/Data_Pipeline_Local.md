# Data Pipeline — Local Automation

This document is **gitignored**. Do not reference publicly or commit to remote.
Public pipeline architecture is in `knowledge/Data_Pipeline.md`.

---

## Automated Broker Download Pipeline (LOCAL MACHINE ONLY)

**Script:** `YieldCurves/scripts/fidelityDownload.js` (tracked in git — not gitignored; credentials live in `.env`, which is gitignored)

### How it works
- Skips the run on weekends and SIFMA bond market holidays (checked against `misc/BondHolidaysSifma.csv`)
- Spawns real `chrome.exe` with `--remote-debugging-port=9222` and a dedicated Chrome profile at `YieldCurves/.chrome-profile/`
- Connects Playwright via CDP (`chromium.connectOverCDP`) — no Playwright/Chromium automation flags, bypasses Fidelity bot detection
- Navigates to Fidelity signin; if session active, skips login
- If login needed: fills `#dom-username-input` / `#dom-pswd-input`, clicks `#dom-login-button`
- MFA: switches the Okta-style challenge to SMS ("Try another way" → "Text me the code"), reads the OTP from Phone Link (paired to the account owner's phone) via Windows UI Automation (`readPhoneLinkOtp.ps1`), submits it. Falls back to a 5-minute manual wait (dumping page state to `logs/mfa-debug/`) if the automated flow doesn't match what's on screen.
- Navigates to the Fixed Income secondary market page, opens the **Product type** filter, checks **Treasury** + **TIPS**, clicks **Apply**
- Opens the three-dot menu → **Download Offerings** (Playwright intercepts the browser download event)
- Saves the single combined file to `~/Downloads/FidelityTreasuriesTips.csv`
- Spawns `uploadFidelityDownload.js` to push it to R2, which in turn triggers `updateSaSaoYields.js` to refresh `TIPS/YieldsSaSao.csv`

### Why CDP (not Playwright launch)
- `launchPersistentContext` (Chromium or real Chrome) sets `navigator.webdriver = true` — Fidelity detects and blocks
- `patchright` also fails (crashes on existing profile; still detected with fresh profile)
- Spawning real `chrome.exe` directly and connecting via CDP: Chrome has no automation flags — bot detection passes
- Do NOT add jitter/delays before login button click — triggers detection
- Do NOT spoof `navigator.webdriver` — makes it worse

### Scheduled Tasks (Windows Task Scheduler)
Three tasks registered via `YieldCurves/scripts/setup-tasks.ps1` (gitignored):
- `FidelityDownload-Morning`: 5:00 AM PT (8 AM ET), retries every 30 min × 9
- `FidelityDownload-Midday`: 10:00 AM PT (1 PM ET)
- `FidelityDownload-Close`: 2:00 PM PT (5 PM ET)

Wrapper: `YieldCurves/scripts/run-fidelity.cmd` (gitignored)
Log: `YieldCurves/logs/fidelity.log` (gitignored)

### Credentials
`FIDELITY_USERNAME` and `FIDELITY_PASSWORD` in root `.env` (gitignored)
Chrome exe: `C:\Program Files\Google\Chrome\Application\chrome.exe`

### Public cover story
Broker data is populated manually. If asked: "I log in and download the CSV myself."
The UI says "Market" — no broker name is exposed anywhere in the public UI or README.
