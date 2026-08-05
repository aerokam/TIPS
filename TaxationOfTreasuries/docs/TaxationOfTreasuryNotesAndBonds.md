# Taxation of Treasury Notes and Bonds (Including TIPS)

## Table of Contents

- [About This Document](#about-this-document)
- [Quick Reference](#quick-reference)
- [Coupon Interest](#coupon-interest)
- [Accrued Interest (Paid at Purchase / Received at Sale)](#accrued-interest-paid-at-purchase-received-at-sale)
- [Market Discount and Accrued Market Discount (AMD)](#market-discount-and-accrued-market-discount-amd)
- [Amortized Bond Premium (ABP)](#amortized-bond-premium-abp)
- [TIPS Inflation Adjustment (OID)](#tips-inflation-adjustment-oid)
- [Common Mistakes](#common-mistakes)
- [Caveats](#caveats)
- [References](#references)

---

## About This Document

See [TaxationOfTreasuries_Foundation.md](TaxationOfTreasuries_Foundation.md) for principles that apply across all Treasury types: federal taxability, state and local exemption, composite 1099 structure, general tax software notes, and caveats.

Each item below is broken out by **acquisition method** (original auction, reopening auction, secondary market) and **disposition method** (hold to maturity, sold before maturity) where those change the outcome. It does not cover Treasury bills — see [TaxationOfTreasuryBills.md](TaxationOfTreasuryBills.md). TIPS-specific OID and ABP calculation mechanics are covered in [TIPS_OID_Tax_Reference.md](TIPS_OID_Tax_Reference.md); this document notes where TIPS interact with the items below and points there for the detail.

---

## Quick Reference

| Item | Source | Federal Destination | State | Varies by |
|---|---|---|---|---|
| Coupon interest | 1099-INT Box 3 | Schedule B | Auto-excluded by most software | — |
| Accrued interest paid to seller | 1099 supplement only (not IRS-reported) | Schedule B subtraction (manual) | — | Acquisition method |
| Accrued interest received from buyer | 1099-INT Box 3 | Schedule B | Auto-excluded by most software | Disposition method |
| Accrued Market Discount (AMD) at disposal | 1099-B Box 1f | Form 8949 (Code D) + Schedule B as interest | Manual intervention required | Acquisition method + disposition method |
| De minimis discount (not AMD) | 1099-B | Schedule D | — | Acquisition method |
| Amortized bond premium (ABP) | 1099-INT Box 12 (common) or 1099-OID Box 10 (Schwab, TIPS only) | Reduces Box 3 or Box 2 interest on Schedule B | — | Acquisition method |
| TIPS inflation adjustment (OID) | 1099-OID Box 8 | Schedule B | Auto-excluded by most software | — |

---

## Coupon Interest

**Definition:** Semi-annual cash payments reported on 1099-INT Box 3. Always taxable in the year received. State-exempt.[^pub550-treasury]

Coupon interest is reported the same way regardless of how the security was acquired or when it will be disposed of. Two adjustments to the raw Box 3 figure are common and are covered under their own items below, not here:

- If you bought between coupon dates, Box 3 for the first coupon year is inflated by the accrued interest you prepaid to the seller — see [Accrued Interest](#accrued-interest-paid-at-purchase-received-at-sale).
- If you sold between coupon dates, Box 3 in the year of sale includes accrued interest you received from the buyer — see [Accrued Interest](#accrued-interest-paid-at-purchase-received-at-sale).

**Software:** 1099-INT Box 3 flows to Schedule B and is auto-excluded from state income by TurboTax, H&R Block, and FreeTaxUSA with no manual steps needed federally.[^pub550-treasury]

---

## Accrued Interest (Paid at Purchase / Received at Sale)

**Definition:** When you buy between coupon dates, you prepay the seller's earned-but-unpaid interest. When you sell between coupon dates, the buyer pays you the equivalent. Both are labeled "accrued interest" but move in opposite directions and are handled differently.

### Paid at purchase

Your 1099-INT Box 3 for the year of your first coupon will include the full coupon payment, which is inflated by the accrued interest you paid the seller at purchase. You must subtract it on Schedule B (labeled "Accrued Interest") in the year you receive that first coupon. Your broker notes the amount in the 1099 supplement but does **not** report it to the IRS — you must track and enter it yourself.[^schb-instructions]

How much accrues depends on how you acquired the security:

| Acquisition method | Accrued interest paid at purchase |
|---|---|
| Original auction | Small — only the days between the dated date and the issue date. The tax impact of missing this adjustment is minor because the amount is small. |
| Reopening auction | Larger. With the exception of the 30-year TIPS, the dated date remains the same between the original auction and a reopening, so accrued interest covers the full span since the original dated date — potentially weeks to months. |
| Secondary market purchase | Varies — covers the full period since the security's last coupon payment. Can be the largest of the three. |

> ⚠️ If you don't subtract accrued interest paid on Schedule B, you overreport income by that amount and owe tax on money you didn't keep. Brokers don't report this to the IRS, so there's no automatic correction — the onus is entirely on you to track and adjust it.

### Received at sale

If you sell before maturity between coupon dates, the buyer pays you accrued interest since the last coupon. This is reported on 1099-INT Box 3 in the year of sale and is state-exempt. No manual subtraction is needed — it is income to you, already included correctly in Box 3. Not applicable if you hold to maturity (there is no sale).

### Software

**TurboTax:** In the 1099-INT interview, look for *"I need to adjust the interest reported on my form."* Enter the accrued interest paid as a negative number and select *"My accrued interest is included in this 1099-INT."* Appears on Schedule B as ACCRUED INTEREST with a negative amount.

**H&R Block:** On the 1099-INT data entry screen:

1. Check *"Interest item requires an adjustment (uncommon)"* at the bottom of the screen
2. Click Next
3. On the adjustment options screen, select *"Bought or sold this bond between interest payments"*
4. Click Next
5. Enter the accrued interest paid amount from the supplemental section of your broker's composite 1099

Appears on Schedule B as ACCRUED INTEREST with a negative number.

**If ABP and accrued interest paid both apply to the same 1099-INT** (common in the first coupon year after buying at a premium on the secondary market or at a reopening): H&R Block allows only one adjustment per 1099-INT entry (a feature limitation). Split the broker's 1099-INT into two entries:

- **Entry 1:** Original payer name. Reduce Box 3 by enough to cover Entry 2. Apply the ABP adjustment (see [Amortized Bond Premium](#amortized-bond-premium-abp)).
- **Entry 2:** Same or similar payer name. Remaining Box 3 amount. Apply the accrued interest paid adjustment (steps above).

The two Box 3 amounts must sum to the broker's total. The IRS matches totals, not individual 1099s — this split is acceptable. Keep a note in your records explaining the split.[^hrb-split] TurboTax steps for this combined case are not yet documented — community input needed.

---

## Market Discount and Accrued Market Discount (AMD)

**Definition (nominal note or bond):** Under 26 U.S.C. §1278(a)(2)(A), market discount is "the excess (if any) of (i) the stated redemption price of the bond at maturity, over (ii) the basis of such bond immediately after its acquisition" — you paid less than par on the secondary market or at a reopening, and the discount exceeds the de minimis threshold.[^irc-1278] **Definition (TIPS):** market discount is determined under a different reference point; see below.[^tips-1275-7f] For both: default treatment is tax deferred until disposal (maturity or sale), then reported as ordinary interest income — not capital gain — via 1099-B Box 1f. Alternative election: accrue annually as interest income.[^pub550-mdb]

**De minimis discount (nominal note or bond):** Under 26 U.S.C. §1278(a)(2)(C), "if the market discount is less than ¼ of 1 percent of the stated redemption price of the bond at maturity multiplied by the number of complete years to maturity ... the market discount shall be considered to be zero" — treated as capital gain at maturity, not ordinary income. Bonds bought at original auction typically have only a de minimis discount. *Example: A $10,000 bond with 5 years to maturity has a de minimis threshold of $10,000 × 0.0025 × 5 = $125. A discount ≤$125 is de minimis (taxed as capital gain); a discount >$125 triggers ordinary income treatment (AMD).*[^irc-1278] For a TIPS, see below — the reference amount differs.[^tips-1275-7f]

**Accrued market discount (AMD):** The portion of the market discount that accrued while you held the bond. Reported in 1099-B Box 1f upon disposal (maturity or sale). Treated as ordinary interest income — not capital gain — on your federal return, entering on Schedule B via Form 8949 Code D.[^1099b-instructions] The dollar amount that accrued by the disposal date is computed by the ratable accrual method by default; you may instead elect the constant yield method for a given bond under IRC §1276(b).[^irc-1276b] This is a separate, bond-by-bond election that determines *how* the accrued amount is calculated — distinct from the annual inclusion election below, which determines *when* it is taxed. State tax treatment varies and is unsettled in many states — most states exempt it as Treasury interest, but consult your state's rules (see [Caveats](#caveats)).

How AMD applies depends on both how you acquired the security and how you dispose of it:

| | Hold to maturity | Sold before maturity |
|---|---|---|
| **Original auction** | Price is typically at/near par — discount is de minimis, so no AMD; the small gain at maturity is capital gain on Schedule D. | Same — de minimis discount produces capital gain/loss on Schedule D, not AMD. |
| **Reopening auction** | Price may be above or below par depending on market movement since the original auction. If the discount exceeds de minimis, AMD accrues over the full holding period and is reported in 1099-B Box 1f at maturity. | AMD accrued from purchase to the date of sale is reported in 1099-B Box 1f; remaining gain/loss above AMD is capital (short- or long-term depending on holding period). |
| **Secondary market purchase** | If the discount exceeds de minimis, no annual AMD reporting occurs under the default method — AMD accumulates and is reported in 1099-B Box 1f only at maturity. If the discount is de minimis, the gain at maturity is capital, not ordinary income. | AMD accrued from purchase to the date of sale is reported in 1099-B Box 1f; remaining gain/loss above AMD is capital. |

**TIPS market discount is measured against inflation-adjusted principal.** Under Treas. Reg. §1.1275-7(f)(3), a holder determines market discount on a TIPS "by reference to the adjusted issue price of the instrument on the date the holder acquires the instrument" — which, absent prior premium or discount, is the security's inflation-adjusted principal at acquisition.[^tips-1275-7f] The same regulation requires that "any premium or market discount is taken into account over the remaining term of the debt instrument as if there were no further inflation or deflation" — the accrual, once fixed at acquisition, is not itself re-indexed, and is separate from and in addition to the annual [OID inflation adjustment](#tips-inflation-adjustment-oid) reported in Box 8. See [TIPS_OID_Tax_Reference.md](TIPS_OID_Tax_Reference.md#market-discount-and-premium-for-subsequent-holders-treas-reg-11275-7f3) for the full regulatory text and the inflation-adjusted-principal purchase-cost formula used to identify a TIPS purchased at a discount.

**Form 8949 mechanics:** Use Code D for the AMD adjustment. Enter AMD from Box 1f as an adjustment in column (g) to convert that portion from capital gain to interest. Also add AMD to Schedule B as "Accrued Market Discount."[^schb-instructions]

### Annual Inclusion Election

Instead of deferring market discount to disposal (the default described above), you can elect to include accrued market discount in income annually, computed by either the ratable accrual method or the constant yield method, as it accrues each year.[^pub550-mdb]

This election has consequences beyond the bond it's made for:

- **It is all-or-nothing, not bond-by-bond.** The election applies to every market discount bond you already own and to every one you acquire afterward — you cannot elect it for one holding while leaving others on the default deferral method.[^pub550-mdb]
- **It is effectively irrevocable.** Once made, you can only change it with IRS consent.[^pub550-mdb]
- **Basis increases each year by the amount included.** Because the discount is taxed as it accrues rather than at disposal, there is no remaining AMD to reclassify out of capital gain via Form 8949 Code D when you eventually sell or the bond matures.
- **It changes the investment interest expense deduction limitation.** If you borrow to buy or carry a market discount bond, interest expense on that debt is otherwise limited to the amount by which your interest income exceeds the deferred (unreported) accrued market discount for the year — the excess carries forward until disposal. Under the annual-inclusion election, the market discount you report counts as investment income in the year accrued, which can let you deduct more of that carrying interest currently instead of waiting.[^pub550-mdb]

The trade-off is that you accelerate tax liability — paying tax on the discount before you receive any cash for it — in exchange for a narrow interest-expense-timing benefit and the loss of any ability to control which year AMD lands in via your disposal timing. For that reason it is rarely elected for a simple Treasury holding. Consult a tax professional before making it, given that it applies to your entire portfolio of market discount bonds and is hard to reverse.

### Software

**Import caveat (H&R Block):** AMD from Box 1f may not import correctly from some brokers — it may be missing or have a blank description, causing Schedule D capital gains to be overstated. Check Box 1f after import and add the AMD amount manually if missing.[^hrb-import]

**TurboTax:** Enter each 1099-B transaction *one by one*, not as a sales summary. TT automatically applies Code D on Form 8949 and carries AMD to Schedule B as ordinary interest income.

**Critical: use one-by-one entry, not sales summary.** If you enter as a sales summary total, TT may apply Code D but not carry AMD to Schedule B, causing underreporting of income. Summary-entry adjustments also trigger a requirement to mail a paper statement to the IRS.[^tt-onebyone]

**State handling (TurboTax):** Even when AMD is correctly moved to Schedule B federally, TurboTax typically does *not* automatically carry it to the state Treasury interest exclusion. A manual override of the state Treasury interest exclusion line is usually required, adding the AMD to the Box 3 total for state exclusion purposes. This override does not prevent e-filing.[^tt-ny-override]

**H&R Block:** HRB applies Code D automatically but does not automatically report AMD as interest income — that requires a manual step.[^hrb-dummy]

**Required manual step (H&R Block) — dummy 1099-INT:** Create a new 1099-INT to report the AMD as interest income:

1. Use a descriptive payer name identifying the broker and the purpose, e.g., "Fidelity Accrued Market Discount"
2. Enter the AMD amount in **Box 3** (US Treasury Obligations), NOT Box 1 — this is critical[^hrb-split]

**Why Box 3 matters:** HRB treats Box 3 entries as state-exempt Treasury interest automatically. Box 1 entries are taxed at the state level. This makes HRB's workaround more reliable for state treatment than TT once you know the procedure.

**FreeTaxUSA:** Reportedly handles AMD more automatically — it adds the AMD from Box 1f to Schedule B without requiring a dummy 1099-INT. Whether it correctly identifies it as Treasury interest for state exclusion purposes requires verification by the user.[^ftusa]

---

## Amortized Bond Premium (ABP)

**Definition:** You paid more than par. Default: the broker amortizes the premium and reduces reported coupon interest annually. Most brokers (Vanguard, Fidelity) report ABP in 1099-INT Box 12. This reduces taxable interest each year; there is no capital loss at maturity. Alternative: you can elect NOT to amortize the premium, in which case the premium is treated as a capital loss at maturity. Amortization is almost always optimal for Treasuries because it converts to an accrual-basis reduction annually rather than a capital loss (which is less valuable). Rarely, if you have substantial capital gains elsewhere, you might elect not to amortize — consult a tax professional if you want to explore this.[^pub550-premium]

**TIPS-only reporting quirk:** Some brokers (Schwab confirmed) report ABP in 1099-OID Box 10 instead of 1099-INT Box 12 — this happens only for TIPS, when the broker also reports qualified stated interest in 1099-OID Box 2 rather than 1099-INT Box 3 (IRS rules require ABP and QSI to be on the same form). This does not apply to nominal notes/bonds, which always use 1099-INT Box 12. See [TIPS_OID_Tax_Reference.md](TIPS_OID_Tax_Reference.md) for the full broker-configuration breakdown and the TIPS-specific premium calculation (which uses inflation-adjusted principal, not face, as the basis for the coupon in the amortization formula).

How likely you are to encounter a premium depends on acquisition method:

| Acquisition method | Premium likelihood |
|---|---|
| Original auction | Rare — auction price is typically at or near par, or at a slight discount. |
| Reopening auction | Common — price reflects market movement since the original auction and is often above par. |
| Secondary market purchase | Common — depends entirely on the prevailing market price relative to par at the time of purchase. |

Disposition method does not change how ABP is calculated: the premium amortizes annually regardless of whether you eventually hold to maturity or sell early. If you sell before the premium is fully amortized, the broker's basis reporting already reflects the cumulative amortization to date, so only the remaining principal difference is a capital gain/loss.

### Software

**H&R Block:** If downloaded, Box 12 is already populated. If manual, enter the Box 12 amount first. Then on the 1099-INT data entry screen:

1. Copy the Box 12 amount (Ctrl+C Windows / Cmd+C Mac)
2. Check *"Interest item requires an adjustment (uncommon)"* at the bottom of the screen
3. Click Next
4. On the adjustment options screen, select *"The premium on this bond can be amortized"*
5. Click Next
6. Paste the amount (Ctrl+V / Cmd+V) into the amortizable bond premium adjustment field

Note: this adjustment screen appears automatically after clicking Next, even without checking the adjustment box. Entering the amount on both screens is not double-counting — HRB requires it.

**To verify (desktop version):** Forms → Schedule B — ABP should appear as a negative number.

**TurboTax:** Unknown — community input needed.

**If ABP and accrued interest paid both apply to the same 1099-INT**, see the combined-case steps under [Accrued Interest](#accrued-interest-paid-at-purchase-received-at-sale).

---

## TIPS Inflation Adjustment (OID)

**Definition:** The annual increase in TIPS principal due to inflation is taxable but not received in cash. Reported on 1099-OID Box 8. State-exempt.[^pub1212]

- **Deflation year:** if CPI falls, negative OID reduces your taxable income (shown as negative in Box 8 or as an adjustment). Cannot reduce below zero for the year.
- **At maturity:** you receive the inflation-adjusted principal. There is no additional tax on the principal increase at that point — it was already taxed annually via OID.
- **Acquisition premium (secondary market):** if you paid more than inflation-adjusted par, that acquisition premium offsets OID each year. The broker tracks this; it is reported in 1099-OID Box 6.[^pub1212]
- **Reopening auctions:** TIPS bought at a reopening carry the same accrued-interest complications as nominal notes/bonds (see [Accrued Interest](#accrued-interest-paid-at-purchase-received-at-sale)), plus OID complications.

This item is otherwise unaffected by the acquisition/disposition breakdown used elsewhere in this document — the annual OID accrual happens every year you hold the TIPS, regardless of how you bought it.

**Software:** Flows to Schedule B as ordinary income in both TurboTax and H&R Block with no manual steps needed federally. State exemption also handled automatically. No known issues.

For the full regulatory basis, OID/ABP calculation formulas, broker reporting comparisons, cost basis step-up mechanics, and broker error case studies, see [TIPS_OID_Tax_Reference.md](TIPS_OID_Tax_Reference.md).

---

## Common Mistakes

- **Forgetting to subtract accrued interest paid on Schedule B.** Your 1099-INT shows the full coupon (including accrued interest you prepaid to the seller), but the IRS doesn't know you paid accrued interest — only you do. Result: overstated income and a tax bill on money you didn't keep. This applies to all reopening and secondary market purchases.
- **Entering AMD in the wrong software field.** In H&R Block, AMD **must** go in Box 3 of a dummy 1099-INT to achieve state exemption. Entering it in Box 1 causes it to be taxed at the state level. In TurboTax, AMD flows correctly to Schedule B via Code D on Form 8949, but you must still manually override the state return.
- **Not verifying state AMD treatment after software import.** Most tax software doesn't automatically carry AMD to the state Treasury interest exclusion. Even if your federal return is correct, your state return may be taxing AMD as ordinary income. Check your state provisions and manually adjust if needed.
- **Assuming all Treasury discounts are de minimis.** Only bonds bought at original auction typically have de minimis discounts. Secondary market purchases at a significant discount trigger AMD rules and ordinary income treatment, not capital gain.
- **Mixing up "accrued interest paid" with "accrued market discount" (AMD).** They are different:
  - *Accrued interest paid:* Interest you prepay to the seller at purchase; subtracted from the first coupon. No IRS reporting.
  - *AMD:* Portion of the market discount accrued while you held the bond; reported by broker on 1099-B Box 1f at disposal; taxed as ordinary income.
- **Not tracking reopening auction accrued interest.** Your broker's notation is helpful but doesn't go to the IRS — you must copy it to Schedule B manually.
- **Entering 1099-B as a summary instead of one-by-one in TurboTax.** This prevents AMD from flowing to Schedule B and can trigger an IRS requirement to mail a paper statement.

---

## Caveats

*For general caveats applicable to all Treasury types, see [TaxationOfTreasuries_Foundation.md](TaxationOfTreasuries_Foundation.md).*

- State treatment of AMD on Treasuries is unsettled in several states (notably NY). The dominant view is that AMD, being reclassified as Treasury interest income, should be state-exempt, but no definitive ruling exists in all states.
- Tax software behavior can change year to year. Verify your software is handling AMD correctly before filing.
- This is a summary of general principles. IRS Publication 550 is the authoritative source. Consult a tax professional for your specific situation.

---

## References

[^pub550-treasury]: IRS Publication 550 (2024), *Investment Income and Expenses* — "U.S. Treasury Bills, Notes, and Bonds" section. <https://www.irs.gov/publications/p550>

[^pub550-mdb]: IRS Publication 550 (2024), *Investment Income and Expenses* — "Market Discount Bonds" section. <https://www.irs.gov/publications/p550>

[^irc-1278]: 26 U.S.C. §1278(a)(2)(A) and (C), *Definitions and special rules* — statutory definition of market discount and the de minimis rule for nominal (non-inflation-indexed) bonds. <https://www.law.cornell.edu/uscode/text/26/1278>

[^irc-1276b]: 26 U.S.C. §1276(b); IRS Publication 1212 (12/2025), *Guide to Original Issue Discount (OID) Instruments* — "Market Discount" section. Ratable accrual is the default method for accruing market discount on a bond; a taxpayer may instead elect the constant yield method under §1276(b)(2), on a bond-by-bond basis. <https://www.irs.gov/publications/p1212>

[^tips-1275-7f]: Treas. Reg. §1.1275-7(f)(3), *Inflation-indexed debt instruments*, "Subsequent holders." Full text quoted in [TIPS_OID_Tax_Reference.md](TIPS_OID_Tax_Reference.md#market-discount-and-premium-for-subsequent-holders-treas-reg-11275-7f3). <https://www.law.cornell.edu/cfr/text/26/1.1275-7>

[^pub550-premium]: IRS Publication 550 (2024), *Investment Income and Expenses* — "Bond Premium Amortization" section. <https://www.irs.gov/publications/p550>

[^schb-instructions]: IRS Instructions for Schedule B (Form 1040) (2025) — "Accrued Interest" and "Accrued Market Discount" subsections. <https://www.irs.gov/instructions/i1040sb>

[^1099b-instructions]: IRS Instructions for Form 1099-B (2026) — Box 1f (Accrued Market Discount) and Code D. <https://www.irs.gov/instructions/i1099b>

[^pub1212]: IRS Publication 1212 (12/2025), *Guide to Original Issue Discount (OID) Instruments* — TIPS OID reporting, acquisition premium. <https://www.irs.gov/publications/p1212>

[^tt-onebyone]: Intuit TurboTax community discussion: "Accrued Market Discount on treasury bond" — confirms one-by-one entry required for AMD to flow to Schedule B. <https://ttlc.intuit.com/community/taxes/discussion/accrued-market-discount-on-treasury-bond/00/3463770>

[^tt-ny-override]: Intuit TurboTax community discussion: "Accrued Market Discount on treasury bond" — NY state override required for AMD Treasury exclusion. <https://ttlc.intuit.com/community/taxes/discussion/accrued-market-discount-on-treasury-bond/00/3463770>

[^hrb-dummy]: Bogleheads.org forum, "Reporting accrued interest paid in H&R Block" — Kevin M's description of dummy 1099-INT workaround, Box 3 requirement. <https://www.bogleheads.org/forum/viewtopic.php?t=273370>

[^hrb-import]: Bogleheads.org megathread, "Taxation of Treasury bills, notes and bonds" — HRB Schwab import AMD memo field issue. <https://www.bogleheads.org/forum/viewtopic.php?t=390405>

[^hrb-split]: Bogleheads.org forum, "H&R Block: tax-exempt interest with bond premium and accrued interest" — Kevin M's documentation of the Bond Premium + Accrued Interest split workaround. <https://www.bogleheads.org/forum/viewtopic.php?t=273011>

[^ftusa]: Bogleheads.org megathread, "Taxation of Treasury bills, notes and bonds" — FreeTaxUSA AMD handling reported by users. <https://www.bogleheads.org/forum/viewtopic.php?t=390405>
