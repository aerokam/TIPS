# Taxation of Treasury Bills

## Table of Contents

- [About This Document](#about-this-document)
- [How T-Bills Work — Key Concepts](#how-t-bills-work--key-concepts)
- [Scenario A: Held to Maturity](#scenario-a-held-to-maturity)
- [Scenario B: Sold Before Maturity](#scenario-b-sold-before-maturity)
- [Where Things Go — Quick Reference](#where-things-go--quick-reference)
- [T-Bills vs. Notes/Bonds: Key Differences](#t-bills-vs-notesbonds-key-differences)

---

## About This Document

See [TaxationOfTreasuries_Foundation.md](TaxationOfTreasuries_Foundation.md) for principles that apply across all Treasury types: federal taxability, state and local exemption, composite 1099 structure, general tax software notes, and caveats.

This document covers Treasury bills only. For notes, bonds, and TIPS, see [TaxationOfTreasuryNotesAndBonds.md](TaxationOfTreasuryNotesAndBonds.md).

---

## How T-Bills Work — Key Concepts

**Zero coupon.** T-bills make no periodic interest payments. The entire return comes from buying at a discount to face value and receiving face value at maturity. There is no accrued interest at purchase.

**Accrued acquisition discount.** The IRS term for the discount on a T-bill is *accrued acquisition discount* — not accrued market discount (AMD), which applies to notes and bonds. Pub 550 defines it as: *the stated redemption price at maturity minus your basis in the obligation.* It is treated as ordinary interest income, not capital gain, and is state-exempt.[^pub550-stgov]

**T-bill is a tax-law classification, not just a maturity label.** The IRS "short-term government obligations" rules apply only to obligations with an **original maturity of not more than 1 year from the date of issue.**[^pub550-stgov] A Treasury note or bond that has less than 1 year remaining when you buy it on the secondary market is still a note or bond for tax purposes — it is subject to AMD rules, not acquisition discount rules. T-bills come in 4-week, 8-week, 13-week, 17-week, 26-week, and 52-week maturities. The maximum original maturity is 52 weeks.

---

## Scenario A: Held to Maturity

The simple, common case. Applies whether you bought at auction or on the secondary market.

- **No 1099 until maturity.** There are no coupon payments and no mid-year reporting. Nothing to do until the bill matures.
- **At maturity:** your broker reports the full acquisition discount (face value minus your purchase price) in **1099-INT Box 3** for the year of maturity. This is your entire taxable income from the bill. Import and file — done.
- **State return:** Box 3 is automatically excluded from state income by most tax software. No manual intervention needed.
- **Cross-year bills:** If you bought a bill in one calendar year and it matures in the next, you report income in the year of **maturity**, not the year of purchase. Example: buy a 52-week bill in February 2025, maturing in February 2026 — you report on your 2026 return (the 1099-INT will be dated 2026 and arrive in February 2027). No 1099-INT is issued at year-end 2025.
- **Auction vs. secondary market:** the same tax result and same 1099-INT Box 3 reporting applies either way. Unlike notes and bonds, there is no accrued interest to subtract at purchase.

**Filing checklist:**
- ☐ Received 1099-INT Box 3 in year of maturity?
- ☐ Box 3 automatically excluded from state return by tax software?
- ☐ If bill straddled two calendar years: confirmed income is in maturity year only?

---

## Scenario B: Sold Before Maturity

More complex. Broker reporting varies across firms, and state tax requires manual attention.

### The Tax Rule

Per Pub 550, "Short-term government obligations":[^pub550-stgov]

> *Treat gains on short-term federal, state, or local government obligations (other than tax-exempt obligations) as ordinary income up to your ratable share of the acquisition discount. Acquisition discount is the stated redemption price at maturity minus your basis in the obligation.*

The **ratable share** is the prorated portion of the total acquisition discount for the days you held the bill:

> **Ratable share = (days held ÷ days from settlement to maturity) × (face value − your purchase price)**

For bills purchased at auction, settlement date and issue date are the same, but for secondary market purchases, use your actual settlement date — not the  issue date.

Any gain above the ratable share is a capital gain (short-term, since all T-bills have original maturity ≤52 weeks). In practice the gain almost never exceeds the ratable share. The ratable share is reported as ordinary interest income and is state-exempt.

### How Brokers Report T-Bills Sold Before Maturity

Broker practice varies and is inconsistent:

- **Schwab:** Held to maturity → 1099-INT Box 3 (reported to IRS). Sold before maturity → Supplemental section only — "Short-Term Realized Gain or (Loss) — not reported on Form 1099-B or to the IRS. Report on Form 8949 Part I, Box C checked."
- **Fidelity / some others:** Held to maturity → 1099-INT Box 3. Sold before maturity → May report all gain in 1099-INT Box 3 (broker characterizes entire gain as interest).
- **Ally / some others:** Held to maturity → 1099-INT Box 3. Sold before maturity → May issue no 1099 at all (IRS does not require brokers to report these sales).

**Critical state tax issue:** If the sale appears in the supplemental section (Schwab-style) rather than in Box 3, it flows into your tax software as a short-term capital gain on Form 8949, not as Treasury interest. Federal tax owed is the same (short-term capital gain is taxed as ordinary income), but your state will not automatically exclude it as Treasury interest. Manual intervention is required to obtain the state exemption.

### If Your Broker Uses the Supplemental Section (Schwab-Style)

**H&R Block (steps confirmed from thread):**

1. The supplemental section data imports into "Sales of Collectibles and Other Investment Property" — not the 1099-B section.
2. For each lot sold before maturity, confirm that dates, proceeds, and cost basis are correct.
3. In the "Special type" dropdown, select **O — Other adjustment**.
4. In the Adjustment field, enter the **ratable share of acquisition discount as a negative number**: (days held ÷ days from settlement to maturity) × (face value − cost basis).
5. Whatever gain remains after the adjustment flows to Form 8949 Part I, Box C as a short-term capital gain. (In practice this residual is very small or zero.)
6. **Create a dummy 1099-INT** with the total ratable share for all bills sold before maturity in **Box 3** — NOT Box 1. This reports the acquisition discount as Treasury interest income. Box 3 triggers the automatic state exemption in HRB.

> **Why Box 3, not Box 1:** HRB treats Box 3 as state-exempt Treasury interest automatically. Box 1 is taxed at the state level. This is the same principle used for AMD in the notes/bonds document — Box 3 is the correct location for all Treasury interest in HRB.

*TurboTax:* Steps for sold-before-maturity T-bills are not yet documented in the source thread — community input needed.

### If Your Broker Reports Everything in Box 3 (Fidelity-Style)

The broker has already characterized the gain as interest. Verify that the amount in Box 3 is close to your calculation of the ratable share. If the full gain is in Box 3 and doesn't exceed the ratable share, accept it — import and file. The IRS will receive a 1099-INT matching what you report.

### If Your Broker Issues No 1099 (Ally-Style)

You are still required to report the income. You must calculate the ratable share yourself and report it as interest income. Create a 1099-INT entry in your tax software with the ratable share in Box 3, using the broker name as payer. For any residual capital gain, report it on Form 8949 Part I, Box C. The absence of a 1099 does not eliminate your reporting obligation.

**Filing checklist:**
- ☐ Identified which bills were sold before maturity?
- ☐ Confirmed how your broker reported them (supplemental, Box 3, or no 1099)?
- ☐ Calculated ratable share for each lot?
- ☐ If supplemental: entered Code O adjustment on Form 8949 per lot?
- ☐ If supplemental: created dummy 1099-INT with total ratable share in Box 3?
- ☐ If no 1099: created manual 1099-INT entry with ratable share in Box 3?
- ☐ State return: confirmed ratable share is excluded as Treasury interest (not taxed as capital gain)?

---

## Where Things Go — Quick Reference

| Item | Source | Federal Destination | State |
|---|---|---|---|
| Acquisition discount — held to maturity | 1099-INT Box 3 | Schedule B | Auto-excluded by most software |
| Acquisition discount — sold early, broker uses Box 3 | 1099-INT Box 3 | Schedule B | Auto-excluded by most software |
| Gain from early sale — supplemental section (Schwab) | Supplemental (not on 1099-B) | Form 8949 Part I, Box C (Code O) + dummy 1099-INT Box 3 | Manual intervention required |
| Residual capital gain above ratable share | Form 8949 Part I | Schedule D | Taxable at state level |

---

## T-Bills vs. Notes/Bonds: Key Differences

| | T-Bills | Notes/Bonds |
|---|---|---|
| **Income type** | Acquisition discount (no coupon) | Coupon interest + possible AMD |
| **When income is reported** | Year of maturity (or sale) | Each coupon year |
| **IRS term for discount** | Accrued acquisition discount | Accrued market discount (AMD) |
| **Broker reports at maturity** | 1099-INT Box 3 | 1099-INT Box 3 (coupon) + 1099-B Box 1f (AMD if applicable) |
| **Sold before maturity** | Supplemental section (not 1099-B); Code O on Form 8949 | 1099-B with AMD in Box 1f; Code D on Form 8949 |
| **State exemption** | Automatic for Box 3; manual if in supplemental section | Manual for AMD; automatic for Box 3 coupon |
| **Accrued interest at purchase** | N/A (no coupon) | Required adjustment for reopenings and secondary market purchases |

---

## References

[^pub550-stgov]: IRS Publication 550 (2024), *Investment Income and Expenses* — "Short-term government obligations" and "U.S. Treasury Bills, Notes, and Bonds" sections. <https://www.irs.gov/publications/p550>
