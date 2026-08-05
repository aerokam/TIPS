# Taxation of Treasuries — Foundation

## Table of Contents

- [About This Document](#about-this-document)
- [Federal Taxability](#federal-taxability)
- [State and Local Exemption](#state-and-local-exemption)
- [Composite 1099 Structure](#composite-1099-structure)
- [Tax Software: General Notes](#tax-software-general-notes)
- [Caveats](#caveats)
- [References](#references)

---

## About This Document

This document sets out the principles that apply across all U.S. Treasury security types: Treasury bills, Treasury notes and bonds, and TIPS.

**See also:**
- [Taxation of Treasury Notes and Bonds (Including TIPS)](TaxationOfTreasuryNotesAndBonds.md)
- [Taxation of Treasury Bills](TaxationOfTreasuryBills.md)
- [TIPS OID and Tax Reference](TIPS_OID_Tax_Reference.md)

---

## Federal Taxability

All interest income from U.S. Treasury securities — bills, notes, bonds, and TIPS — is taxable at the federal level as ordinary income in the year received or constructively received. This applies regardless of whether the security was purchased at original auction, at a reopening auction, or on the secondary market.[^pub550-treasury]

Forms used to report Treasury income:

- **1099-INT Box 3** — Coupon interest (notes/bonds/TIPS); acquisition discount (T-bills)
- **1099-OID Box 8** — TIPS annual inflation adjustment (OID)
- **1099-OID Box 2** — TIPS qualified stated interest — alternative broker configuration (see TIPS OID Reference)
- **1099-B Box 1f** — Accrued market discount (AMD) at disposal — notes/bonds only

---

## State and Local Exemption

All Treasury interest is exempt from state and local income tax under 31 U.S.C. § 3124(a). This applies to:[^3124a]

- Coupon interest (1099-INT Box 3)
- TIPS inflation adjustment (1099-OID Box 8)
- Accrued acquisition discount on T-bills (1099-INT Box 3)
- Accrued market discount (AMD) on notes/bonds — state treatment is not uniformly settled in all states (see [Caveats](#caveats)), but the dominant view and common practice is that AMD is state-exempt because it is reclassified as Treasury interest income for federal purposes

**Software handling:** Most tax software (TurboTax, H&R Block, FreeTaxUSA) automatically excludes 1099-INT Box 3 and 1099-OID Box 8 from state taxable income. Items that require manual intervention for the state exemption:

- AMD from 1099-B Box 1f — does not automatically flow to the state Treasury interest exclusion in most software
- T-bill acquisition discount appearing as a capital gain in broker supplemental sections (Schwab-style) — does not automatically flow to the state exclusion

Specific steps for each item are documented in the relevant dependent document.

---

## Composite 1099 Structure

Brokers issue a **consolidated (composite) 1099** that contains both IRS-reportable sections and broker-only supplemental sections. These are not the same thing.

Sections reported to the IRS:

- **1099-INT** — Box 3: coupon interest / acquisition discount; Box 12: ABP
- **1099-OID** — Box 8: TIPS OID; Box 10: ABP (Schwab / alternative config)
- **1099-B** — Proceeds, basis, AMD in Box 1f

Section **not** reported to the IRS:

- **Supplemental / "Additional Information"** — Accrued interest paid to seller; T-bill gains not on 1099-B; other broker detail

**Key implication:** Items in the supplemental section are not reported to the IRS and are not imported into tax software. You must locate them in the paper or PDF composite 1099 and enter them manually.

Examples of supplemental-only items:
- **Accrued interest paid to seller** when buying notes/bonds between coupon dates (labeled "Taxable accrued Treasury interest paid" or similar — label varies by broker)
- **T-bill gains from bills sold before maturity** (in the "Short-Term Realized Gain or (Loss)" section, with an instruction to report on Form 8949)

Fidelity, Schwab, and Vanguard all include accrued interest paid in a supplemental section, though the exact location and label differ.

---

## Tax Software: General Notes

**Downloaded vs. manual entry:** If you download your 1099s directly from your broker into your tax software, most fields will be pre-populated. Your job is to navigate to the adjustment screens and enter any required manual adjustments. If you enter manually, you'll first transcribe each box value from your paper or PDF 1099, then proceed to the same adjustment screens.

**IRS matches totals, not individual 1099s.** This means:
- Splitting one broker 1099-INT into two entries (to work around a software limitation) is acceptable, provided the totals are correct
- Creating a "dummy" 1099-INT to report AMD or acquisition discount as Box 3 Treasury interest is accepted practice — the IRS receives only aggregate totals
- Keep a brief note in your records explaining any splits or dummy entries

**Software changes year to year.** Behavior around AMD, ABP, and state exclusions can change between software versions. Steps documented in the dependent documents were verified for recent tax years but should be re-verified before filing, especially after a software update.

---

## Caveats

- **State treatment of AMD** is unsettled in several states (notably NY). The dominant view is that AMD — reclassified as Treasury interest income under federal rules — should be state-exempt, but no definitive ruling exists in all states. CA and MI have clearer treatment. See the Notes/Bonds document for further detail.
- **Tax software behavior can change year to year.** Verify that AMD, ABP, and state exclusions are handled correctly before filing.
- This document and all dependent documents summarize general principles. IRS Publication 550 is the authoritative federal source. Consult a tax professional for your specific situation.

---

## References

[^pub550-treasury]: IRS Publication 550 (2024), *Investment Income and Expenses* — "U.S. Treasury Bills, Notes, and Bonds." <https://www.irs.gov/publications/p550>

[^3124a]: 31 U.S.C. § 3124(a) — Exemption of United States obligations from state taxation. <https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title31-section3124&num=0&edition=prelim>
