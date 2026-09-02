# Close-Price Investigation (June 2026)

Investigation into what "daily close" the Yields Monitor should use, what CNBC actually
stores, and how that relates to official Treasury yields. This is the authoritative record
of findings; `1.0_Operation.md` references it.

## TL;DR

- CNBC's Treasury/TIPS data source is **Tradeweb**.
- The CNBC `1D`/`5D` chart feeds are **24-hour continuous** (electronic/overnight).
- Each weekday the day session ends with one **fixed-time consolidation bar per symbol, stamped `17:05` ET**, followed by a ~2.5h gap (resume ~19:30 ET). This is the *actual end-of-session close*.
- **BUT CNBC's stored DAILY close (the value in the longer-range feeds that the history files are built from) is NOT the 17:05 bar — it is the ~3:00 PM ET mid-afternoon benchmark.** Verified across US10Y, US10YTIPS, US30YTIPS.
- The U.S. Treasury's official **Constant Maturity (CMT) nominal yields and real/TIPS yields** are derived from FRBNY indicative quotations at **~3:30 PM ET**. The mid-afternoon snapshot is the industry "official close" convention.
- **Decision:** history (UI ranges **1Y and longer**) uses the **~3 PM benchmark close**, refreshed by **re-reading the daily feeds** (no 17:05 extraction). Short views (**2D/10D** = `1D`/`5D`) may keep the **actual 17:05 session close** even though that differs from the long-range basis (tentative).

---

## 1. Feed → range mapping

The app's `TIME_RANGE_MAP` (UI label → CNBC provider `timeRange`):

| UI | Provider | Resolution / span | Used for |
|---|---|---|---|
| 2D | `1D` | 1-min, ~2 days, 24h continuous | intraday |
| 10D | `5D` | 5-min, ~10 days, 24h continuous | intraday |
| 1Y | `1M` | daily closes | history baseline |
| 2Y | `3M` | daily closes | history baseline |
| 3Y | `6M` | daily (resolution thins out) | history baseline |
| 10Y | `5Y` | daily→weekly (older = sparser) | history baseline |
| ALL | `ALL` | monthly/quarterly | history baseline |

Runtime: long ranges read the **R2 history baseline** (`yields-history/history.json`, nested by symbol), not these CNBC ranges live. The daily feeds are used by `updateYieldsHistory.js` (and this investigation) to build/refresh that baseline.

## 2. Intraday feed structure & the 17:05 bar

Feeds trade 24h. Each weekday: continuous trading to ~16:56–17:04 ET → one **`17:05` consolidation bar** per symbol → ~2.5h gap → overnight session resumes ~19:30 ET.

The `17:05` stamp is **fixed-time, not a random last trade** — it appears for every symbol every weekday regardless of liquidity, even after a `17:04` bar, even when continuous trading stopped minutes earlier.

Evidence (raw `1D` bars, 06/09/2026):
```
US10Y     17:02=4.5200  17:04=4.5160  17:05=4.5200  →[gap]→ 19:30   (liquid: continuous + 17:05)
US5YTIPS  16:56=1.7960               17:05=1.7990  →[gap]→ 19:30   (lone 17:05 after 9-min gap)
US1YTIPS  17:01=1.0860               17:05=1.0990  →[gap]→ 19:30   (illiquid, still 17:05)
US1M      17:01=3.6600               17:05=3.6600  →[gap]→ 19:30   (illiquid, still 17:05)
```
The `1D` (1-min) feed carries a clean `17:05`; the `5D` (5-min) feed buckets it to ~17:02–17:04. **`1D` is authoritative for the session close.**

## 3. CNBC's daily close ≠ 17:05 — it's the ~3 PM benchmark

Comparing the daily-feed close (midnight-stamped value used for history) against intraday values at 15:00 / 16:00 / 16:59 / 17:05, the daily close consistently matches **15:00 ET** within 0–2bp — **not** 17:05.

Evidence, 06/08/2026 (last completed day):

| Symbol | daily close | @15:00 | @16:00 | 16:59 | 17:05 |
|---|---|---|---|---|---|
| US10Y | **4.5500** | 4.5500 ✓ | 4.5660 | 4.5660 | 4.5680 (−1.8bp) |
| US10YTIPS | **2.1930** | 2.1910 ✓ | 2.2030 | 2.2010 | 2.2030 (−1.0bp) |
| US30YTIPS | **2.7820** | 2.7810 ✓ | 2.7930 | 2.7900 | 2.7910 (−0.9bp) |

US10Y matched 15:00 **exactly** (Δ0.0000) on 06/01, 06/03, and 06/08. The daily close runs ~1–2bp *below* the 17:05 bar. (Same-day rows are provisional — the current day's daily bar tracks the live level until it settles, so ignore them.)

**Conclusion:** CNBC stores the **mid-afternoon (~3 PM) Tradeweb benchmark** as the daily close. This is the same basis as the `previous_day_closing` quote field noted historically. The existing multi-year history files are already on this basis.

**Current-day bar is provisional (tracks live, not 3 PM).** The daily feeds (`1M`/`3M`/`6M`/`5Y`/`ALL`) show the current day all day, but its value **tracks the live price**, not the 3 PM close — e.g. 06/09 evening: daily feed = 2.1990 = live latest, while ~15:00 = 2.1760. The bar is later **revised to the ~3 PM benchmark** once finalized (overnight); completed prior days already read ~3 PM. **Therefore: persist completed days only (skip the current day); run-timing is non-critical.** Use `scripts/inspect.js` to see the current-day status at any time.

## 4. Provenance

- **CNBC source = Tradeweb** (attributed on CNBC quote pages).
- **Tradeweb FTSE U.S. Treasury Benchmark Closing Prices** — launched 2024-06-10; snapshots at **3:00 PM and 4:00 PM ET**; a **2025-10-17** methodology change emphasizes the **4:00 PM** "risk-clearing" level. FTSE Russell = administrator, Tradeweb = calculation agent; IOSCO-compliant. It is a **paid LSEG/Tradeweb product**, *not* in the free CNBC chart feed.
- **U.S. Treasury Daily Yield Curve Rates (CMT, nominal)** and **Daily Real Yield Curve (TIPS)** — both derived from **indicative secondary-market quotations obtained by the Federal Reserve Bank of New York at ~3:30 PM ET** each business day. Nominal maturities: 1,1.5,2,3,4,6mo & 1,2,3,5,7,10,20,30yr. Real: 5,7,10,20,30yr.

**Three reference times** (do not conflate):

| Time | What | Where |
|---|---|---|
| ~3:00–3:30 PM ET | mid-afternoon **official-close benchmark** (Tradeweb 3/4pm; Treasury CMT/real ~3:30pm) | CNBC **daily** close; Treasury published curves |
| ~16:59 ET | last continuous-trade bar | chart intraday stream |
| 17:05 ET | end-of-**session** consolidation bar | chart `1D` feed; the actual trading-day close |

## 5. Decision & rationale

### Feed resolution → reread vs. merge

Measured bar spacing per provider range (US10Y / US10YTIPS, consistent):

| UI range | provider | span | resolution | below daily? |
|---|---|---|---|---|
| 1Y | `1M` | 1yr | daily | no |
| 2Y | `3M` | 2yr | daily | no |
| 3Y | `6M` | 3yr | daily | no |
| **10Y** | `5Y` | 10yr | **weekly (~7d)** | **yes ← crossover** |
| ALL | `ALL` | ~30–46yr | **quarterly (~91d)** | yes |

`1Y/2Y/3Y` are fully daily; resolution first drops below daily at **10Y** (weekly), and **ALL** is quarterly (~3mo). The merge/append therefore matters **only for 10Y and ALL** — the ranges where CNBC's own feed is sub-daily but we hold finer recent data.

### Decision

| Scope | Close basis | Mechanism | Status |
|---|---|---|---|
| **1Y / 2Y / 3Y** | ~3 PM benchmark | **Reread fresh** from CNBC provider `6M` (daily, ~3 yr) on each page load. No `history.json`, no 5D tip. Covers all three ranges from one cached fetch per symbol. Includes the current day's provisional bar (tracks live). | **Implemented** — `app.js` `fetchOne()` `_6Mdaily` cache |
| **10Y / ALL** | ~3 PM benchmark | **Persistent merge store**: CNBC's coarse deep history (weekly/quarterly) + accumulated **daily** recent closes (`history.json`). `updateYieldsHistory.js` runs weekdays at 5 PM ET to persist completed days. | Live |
| **2D / 10D** | actual **17:05** session close (tentative) | already renders real intraday bars incl. the 17:05 bar; keep that, though it differs from the long-range basis. | Live |

Rationale:
- The 3 PM basis is **internally consistent**, **matches CNBC**, **matches Treasury's CMT/real methodology (~3:30pm)**, and is the **IOSCO Tradeweb benchmark**.
- A 17:05 basis is **infeasible for history** (the `1D` feed spans only ~2 days).
- For **1Y/2Y/3Y** the feeds are fully daily, so a fresh reread equals CNBC exactly — no store, no drift, simplest.
- For **10Y/ALL** the append earns its keep: it preserves daily recent resolution the CNBC feed lacks. (The old append broke — `3M`-midnight bars stopped returning recent completed days — so this becomes a **bootstrap-coarse + accumulate-daily** merge, persisting completed days only.)

## 6. Symbol reliability

**US5YTIPS (5Y TIPS) is flaky** — sparse/irregular bars and a broken/gapped daily feed. Do **not** depend on it. Use **US10YTIPS** as the reliable TIPS reference. Other 14-symbol coverage is fine; this caveat governs which symbol any *logic/probe* anchors to.

## 7. Investigation tooling (all read-only / additive)

| Script | Purpose |
|---|---|
| `scripts/dumpFeed.js <sym> <1D\|5D>` | dump a raw feed with ET-annotated bars |
| `scripts/archiveIntraday.js` | daily immutable raw 1D+5D snapshot per symbol → R2 `yields-history/intraday-raw/{sym}/{YYYYMMDD}.json` (task `IntradayArchive`, 17:05 ET) |
| `scripts/analyzeCloseWindow.js <sym>` | per-day close-window structure from an archived snapshot |
| `scripts/probeClose.js <sym>` | log last `1D` bar over time → `yields-history/close-probe/{sym}.csv` (task `CloseProbe`, 17:05+15min×1h) to pin when the 17:05 bar posts |
| `scripts/probeLock.js` | hourly overnight, log the last 5 daily (`6M`) bars **by date** vs live `1D` for US10YTIPS+US10Y → `yields-history/lock-probe/lock-probe.csv` (task `LockProbe`, 17:00 ET +1h×18h) to pin the **overnight revision time** — when a completed day's bar flips from live-tracked to the ~3PM benchmark (§8). Per-date keying survives the ~01:00 ET rollover and the feed's intermittent dropping of recent days (§5). |
| `scripts/analyzeLock.js` | read `lock-probe.csv` and report, per completed day, the **lock time** (earliest run after which that day's bar value never changes) + a live→frozen timeline. Run after an overnight `LockProbe` collection. |
| `scripts/compareDailyVsIntraday.js <sym>` | compare daily-feed close vs intraday 15:00/16:00/16:59/17:05 (Section 3) |

## 8. Open items

- Confirm exact CNBC daily-close time (our 5D-grid match says ~3:00pm; Treasury is ~3:30pm; Tradeweb 3/4pm). Sub-bp distinction; the `close-probe`/archive can refine over time.
- **Pin the overnight REVISION time** — `LockProbe` task runs hourly 2PM–8AM ET weekdays. Findings so far:
  - **Benchmark snap: 14:59 ET** — confirmed across June 10, 11, 12 (3 consecutive days). Both US10YTIPS and US10Y locked to their finalized daily close value exactly at the 14:59 ET minute bar in the 1D intraday archive.
  - **Two-bar phenomenon**: after ~17:00 ET the `6M` feed temporarily returns two bars for the just-closed date — benchmark (correct, first) + session-close ghost (second). Last-write-wins means session close overwrites if processed during this window.
  - **Convergence**: the two-bar state collapses to a single (benchmark) bar at ~01:00 ET next morning (Mon–Thu) when the overnight session opens and a new current-day bar is created, displacing the ghost. **Friday: no convergence until Sunday ~18:30 ET market reopen.**
  - **Safe update windows**: Mon–Thu closes → after ~01:30 ET next morning. Friday close → after Sunday ~19:00 ET.
  - `updateYieldsHistory.js` runs at 5 PM ET (same day as the close), so today's bar is always skipped by the `>= todayET` guard — the two-bar window never affects it. The risk window only matters for ad-hoc runs during the post-close evening.
- **1Y/2Y/3Y reread implemented** (`app.js` 2026-06-14). Reads provider `6M` live on page load; `history.json` retained for 10Y/ALL only. `history.json` refreshed through 6/12 same date.
- Day-change `closeP` anchor (sidebar) currently uses `≤17:00` (picks ~16:59). Decide whether short-view day-change should reference 17:05 or the 3 PM basis, for consistency with whichever close the view adopts.
