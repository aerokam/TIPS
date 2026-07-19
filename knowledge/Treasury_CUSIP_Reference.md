---
title: Treasury CUSIP Root Reference
description: 6-character CUSIP prefix map for U.S. Treasury instrument types, including STRIPS identification
---

# Treasury CUSIP Root Reference

The first 6 characters of a U.S. Treasury CUSIP identify the instrument type. This is the **sole, canonical way** to classify a security as Bill/Note/Bond/STRIPS — never guess type from a broker's free-text description (see "Why not description text" below). Implemented once in `shared/src/treasury-cusip.js` and imported by every app that needs it.

## CUSIP Prefix Map

| Prefix | Instrument Type | Status |
|--------|----------------|--------|
| 912797 | Treasury Bill | Active |
| 912793–912796 | Treasury Bill | Retired — no new issuance, but appear on old (matured) Bills |
| 912810 | Treasury Bond | Active |
| 912828 | Treasury Note | Active |
| 91282C | Treasury Note | Active |
| 912827 | Treasury Note | Retired — used 1980–2002; last maturity 2012-02-15, none outstanding |
| 912803 | STRIPS — Bond principal | Active |
| 912820 | STRIPS — Note principal | Active |
| 912821 | STRIPS — Note principal | Active |
| 912833 | STRIPS — Interest (coupon) | Active |
| 912834 | STRIPS — Interest (coupon) | Active |

**Cross-checked** against `Treasuries/Auctions.csv` (full FiscalData auction history, 11,037 rows, 1980–present) on 2026-07-19: every CUSIP root appearing in auction records for `security_type` Bill/Note/Bond matched this table exactly, with two additions this check surfaced — the four retired Bill roots and the previously-undocumented retired Note root `912827`. STRIPS roots don't appear in auction records (STRIPS are created by stripping an existing security post-issuance, not auctioned directly), so they weren't independently re-verified here — carried forward from the prior version of this table.

**TIPS and FRNs share roots with their nominal counterparts.** Auctions data shows TIPS issued under `912810` (30-year), `912828`/`91282C`/`912827` (5/10-year), and FRNs under `912828`/`91282C` — the same roots as nominal Bonds/Notes. CUSIP root identifies the Bill/Note/Bond/STRIPS instrument family only; whether a Note or Bond is inflation-protected (TIPS) or floating-rate (FRN) is an orthogonal classification carried by a separate field in each data source (FedInvest's `Type` column already says `TIPS` directly; Fidelity's combined export has a `Product` column with `Treasury`/`TIPS`).

## Why not description text

Broker exports (e.g. Fidelity) carry a free-text description that is **not a reliable type signal**: as a security nears maturity, Fidelity renames it from a form that says "NOTE"/"BILL" to a generic `"UNITED STATES TREAS SER <code>-YYYY"` form with no type wording at all. Code that regex-matched on this description defaulted every near-maturity Note to "Bond" once the word "NOTE" disappeared from the text, which made Notes maturing within the next several months invisible from the Notes filter in YieldCurves. CUSIP root has no such failure mode: it's structural, always present, and doesn't degrade near maturity.

## STRIPS

STRIPS (Separate Trading of Registered Interest and Principal of Securities) are zero-coupon instruments created by stripping the coupon payments and principal from a nominal Treasury. They trade separately but are derived from, and backed by, the underlying Treasury security.

STRIPS are excluded from yield curve analysis by default because:
- They are zero-coupon instruments; their yields are not comparable to coupon bond yields on the same curve
- They are more thinly traded and serve a different purpose (duration-matching, pension liability hedging)
- Their prices embed a liquidity discount relative to the underlying coupon bonds

STRIPS are identified in code via the `isStrip(cusip)` helper using the prefixes above (912803, 912820, 912821, 912833, 912834).
