# security-basics
ch: Terminology
title: Security nomenclature

## Security
### CFR
Security means a Treasury bill, note, or bond, each as described in this part. Security also means any other obligation we issue that is subject to this part according to its auction announcement. Security includes an interest or principal component under the STRIPS program, as well as a certificate of indebtedness. [[356.2:§356.2]]

### Usage
"We offer __securities__ under this part exclusively in book-entry form and as direct obligations of the United States issued under Chapter 31 of Title 31 of the United States Code." [[356.5:§356.5]]

### Notes
A term commonly used for this is "bond", but since Treasury uses "bond" to denote one type of Security, we'll avoid using "bond" for this.

## Marketable securities
### CFR
Marketable security means a security that may be bought, sold and transferred in the secondary market. [[356.2:§356.2]]

### Usage
"Treasury floating rate notes may not be as widely traded or as well understood as these other types of Treasury __marketable securities__." [[appC:Appendix C to Part 356, §I.B]]

### Notes
by contrast, U.S. savings bonds, such as series I and EE, are not marketable.

## CUSIP number
### CFR
CUSIP number means the unique identifying number assigned to each separate security issue and each separate STRIPS component. CUSIP numbers are provided by the CUSIP Service Bureau of Standard & Poor's Corporation. CUSIP is an acronym for Committee on Uniform Securities Identification Procedures. [[356.2:§356.2]]

### Usage
"The auction announcement lists the specifics of each auction, e.g., offering amount, term and type of security, __CUSIP number__, and issue and maturity dates." [[356.10:§356.10]]

### Notes

# Valuation terms
ch: Terminology
title: Valuation terms

## Par
### CFR
Par means a price of 100. [[356.2:§356.2]]

### Usage
"Are sold at discount, __par__, or premium, depending upon the auction results." [[356.5:§356.5(b)(1)(iv)]]

### Notes

Treasury securities mature at par: price = 100, maturity value of one security = 1,000 (unadjusted for TIPS)

## Par amount
### CFR
Par amount means the stated value of a security at original issuance. [[356.2:§356.2]]

### Usage
"Are redeemed at their __par amount__ at maturity." [[356.5:§356.5(a)(2)]]

### Notes
Brokers trade Treasuries in increments of $1,000, so we will assume par amount = $1,000 per security. For TIPS, this does not include the inflation adjustment.

## Price
### CFR
Price means the price of a security per 100 dollars of its stated value as calculated using the formulas in appendix B. [[356.2:§356.2]]

### Usage
"Discount means the difference between par and the __price__ of the security, when the __price__ is less than par." [[356.2:§356.2, Discount]]

### Notes
Combining definitions of par and price, we can say that price is expressed as a percent of par. So a price of 99.5 is 99.5% of par = 99.5% × 100. Since broker par amount per security is 1,000, the value of a Treasury security at a price of 99.5 is 99.5% × 1,000 = 995.

For a quantity of more than one, value can be calculated as price / 100 × 1,000 × quantity. The first term (price / 100) converts price to a decimal — the decimal form of the percent-of-par, e.g. 99.5 → 0.995; the second term (× 1,000) converts that decimal into par amount terms, giving the value of one security; multiplied by the last term (× quantity), that gives the total value.

As always, for TIPS, this does not include the inflation adjustment; stay tuned.

## Principal
### CFR
Not independently defined in 31 CFR Part 356.

### Usage
"...if at maturity the inflation-adjusted __principal__ is less than a security's par amount, we will pay an additional amount so that the additional amount plus the inflation-adjusted __principal__ equals the par amount." [[appC:Appendix C to Part 356, §I.A]]

### Notes
Other than for TIPS, principal is used as a synonym for par amount. For TIPS, the qualifier "inflation-adjusted" is added, which enables us to distinguish it from par amount, which remains $1,000 per security at brokers.

## Face value
### CFR
Not a term used anywhere in 31 CFR Part 356.

### Usage
n/a

### Notes
Face value is a common synonym for par amount.

# dates
ch: Terminology
title: Dates

## Dated date
### CFR
Dated date means the date from which interest accrues for notes and bonds. The dated date and issue date are usually the same. In those cases where interest begins accruing prior to the issue date, however, the dated date will be prior to the issue date. An example is when the dated date is a Saturday and the issue date is the following Monday. [[356.2:§356.2]]

### Usage
"Interest on notes and bonds accrues from the __dated date__." [[356.30:§356.30(a)]]

### Notes

## Issue date
### CFR
Issue date means the date specified in the auction announcement on which we issue a security as an obligation of the United States. Interest normally begins to accrue on a security's issue date. [[356.2:§356.2]]

### Usage
"Securities bought in the auction must be paid for by the __issue date__." [[356.25:§356.25]]

### Notes

## Maturity date
### CFR
Maturity date means the date on which a security becomes due and payable, and ceases to earn interest. The maturity date is specified in the auction announcement. [[356.2:§356.2]]

### Usage
"We will pay principal on bills, notes, and bonds on the __maturity date__ as specified in the auction announcement." [[356.30:§356.30(a)]]

### Notes

# interest-rate-yield
ch: Terminology
title: Interest rate, yield & real yield

## Interest rate
### CFR
Interest rate means the annual percentage rate of interest paid on the par amount (or the inflation-adjusted principal) of a specific issue of notes or bonds. [[356.2:§356.2]]

### Usage
"Interest is expressed as a percentage of the par amount and accrues daily on the basis of the actual number of days elapsed in a half-year period." [[356.30:§356.30(a)]]

### Notes
Interest rate is fixed at auction and does not change. Yield (see next card) is not fixed — it depends on price, per the Appendix B §II/§III formulas covered in Chapters 6–7.

## Yield
### CFR
Yield means the annualized rate of return to maturity on a non-indexed security. Yield is expressed as a percentage. For an inflation-protected security, yield means the real yield. Yield is also referred to as "yield to maturity." [[356.2:§356.2]]

### Usage
"Competitive bidders bid on the basis of yield…on non-indexed securities." [[356.10:§356.10]]

### Notes
Yield varies with price in the secondary market. For TIPS, "yield" already denotes real yield — there is no separate CFR term for nominal yield.

## Real yield
### CFR
Real yield means, for an inflation-protected security, the yield based on the payment stream in constant dollars. In other words, the real yield is the yield in the absence of inflation. [[356.2:§356.2]]

### Usage
"For an inflation-protected security, yield means the __real yield__." [[356.2:§356.2, Yield]]

### Notes

# treasury-bills
ch:
title:

## Treasury bills
### CFR-list
- Are issued at a discount or at par, depending upon the auction results;
- Are redeemed at their par amount at maturity; and
- Have maturities of not more than one year.
[[356.5:§356.5(a)]]

### Usage
"Interest on __bills__ consists of the difference between the discounted amount paid by the investor at original issue and the par value we pay to the investor at maturity." [[356.30:§356.30(a)]]

### Notes
Example: Bills are issued at 990 and mature at 1,000 (par); the discount, 10, is the interest.

# treasury-notes
ch:
title:

## Treasury notes
### CFR-list
(1) Treasury non-indexed notes
- Are issued with a stated rate of interest to be applied to the par amount;
- Have interest payable semiannually;
- Are redeemed at their par amount at maturity;
- Are sold at discount, par, or premium, depending upon the auction results; and
- Have maturities of at least one year, but of not more than ten years.
(2) Treasury inflation-protected notes
- Are issued with a stated rate of interest to be applied to the inflation-adjusted principal on each interest payment date;
- Have interest payable semiannually;
- Are redeemed at maturity at their inflation-adjusted principal, or at their par amount, whichever is greater;
- Are sold at discount, par, or premium, depending on the auction results; and
- Have maturities of at least one year, but not more than ten years.
- Are only reopened as scheduled or announced.
(3) Treasury floating rate notes
- Are issued with a stated spread to be added to the index rate for daily interest accrual throughout each interest payment period;
- Have a zero-percent minimum daily interest accrual rate;
- Have interest payable quarterly;
- Are redeemed at their par amount at maturity;
- Are sold at discount, par, or premium depending on the auction results; and
- Have maturities of at least one year, but not more than ten years.
[[356.5:§356.5(b)]]

### Usage
"Interest on __notes__ and bonds accrues from the dated date." [[356.30:§356.30(a)]]

### Notes

# treasury-bonds
ch:
title:

## Treasury bonds
### CFR-list
(1) Treasury non-indexed bonds
- Are issued with a stated rate of interest to be applied to the par amount;
- Have interest payable semiannually;
- Are redeemed at their par amount at maturity;
- Are sold at discount, par, or premium, depending on the auction results; and
- Have maturities of more than ten years.
(2) Treasury inflation-protected bonds
- Are issued with a stated rate of interest to be applied to the inflation-adjusted principal on each interest payment date;
- Have interest payable semiannually;
- Are redeemed at maturity at their inflation-adjusted principal, or at their par amount, whichever is greater;
- Are sold at discount, par, or premium, depending on the auction results; and
- Have maturities of more than ten years.
- Are only reopened as scheduled or announced.
[[356.5:§356.5(c)]]

### Usage
"We will pay principal on bills, notes, and __bonds__ on the maturity date as specified in the auction announcement." [[356.30:§356.30(a)]]

### Notes

# cpi
ch: 4 · TIPS & the CPI Index
title: CPI & "The Index"

## CPI (Consumer Price Index)
The monthly, **non-seasonally-adjusted** U.S. City Average All Items Consumer Price Index for All Urban Consumers, published by the Bureau of Labor Statistics. This is the raw inflation gauge Treasury uses to adjust TIPS principal — not a seasonally-adjusted variant.

## Index
For inflation-protected securities, "the Index" just means the CPI, as just defined. (For Floating Rate Notes, "the index" means something unrelated — the 13-week bill discount rate — but FRNs are out of scope here.)

:::lead
§356.2 uses the CPI as "the basis for adjusting the principal amounts of inflation-protected securities." This chapter covers how that adjustment is actually computed.
:::

# ref-cpi
ch: 4 · TIPS & the CPI Index
title: Reference CPI & Index Ratio

## Reference CPI (Ref CPI)
The specific index number that applies to a given calendar day — not the same thing as "this month's CPI reading." Ref CPI exists for *every single day*, derived from CPI readings that are only published monthly.

:::lead
Ref CPI for the first day of any calendar month is the CPI for the third preceding calendar month (e.g., Ref CPI for April 1 is the CPI for January, reported in February). Ref CPI for any other day of a month is found by linear interpolation between the Ref CPI for the first day of that month and the Ref CPI for the first day of the next month.
:::

:::example
Worked example from the CFR: Ref CPI for April 1, 1996 = the January 1996 CPI-U = 154.40. Ref CPI for May 1, 1996 = the February 1996 CPI-U = 154.90. Ref CPI for **April 15** (14 days into a 30-day month) = 154.40 + (14/30) × (154.90 − 154.40) = **154.63333**, rounded to 5 decimals.
:::

## Index Ratio
Ref CPI on a given date, divided by Ref CPI on the security's **dated date** (its "base CPI"). This ratio is what actually scales par up or down into the inflation-adjusted principal — see two pages ahead.

:::aside
If a previously-published CPI is later revised, Treasury keeps using the original (unrevised) number for every past and future Ref CPI/Index Ratio calculation — the correction never retroactively changes what TIPS holders were owed.
:::

# index-ratio-calc
ch: 4 · TIPS & the CPI Index
title: Calculator: Index Ratio

:::lead
Pick a TIPS and a date. This looks up the *actual, published* daily Reference CPI (TreasuryDirect's official series) — not a recomputation — and divides it by that TIPS's base CPI to get its Index Ratio right now.
:::

# inflation-adjusted-principal
ch: 4 · TIPS & the CPI Index
title: Inflation-Adjusted Principal

## Inflation-adjusted principal
The par amount, multiplied by the Index Ratio. This — not the original par amount — is what a TIPS actually pays interest on.

# index-contingency
ch: 4 · TIPS & the CPI Index
title: When the CPI Isn't Published

:::lead
TIPS math depends on CPI being published on schedule. Appendix B §I.B.4 covers what happens when it isn't:
:::

## Revisions & rebasing
Treasury always uses the CPI reading as *originally* published, ignoring later revisions. If BLS ever rebases the CPI to a new reference year, Treasury keeps using the base year in effect when the TIPS was first issued.

## Discontinuation
If CPI is ever discontinued or materially altered against investors' interests (by law, executive order, or BLS's own change), the Secretary of the Treasury will designate a substitute index after consulting BLS.

## Late publication — the fallback formula
If a month's CPI isn't reported by the last day of the *following* month, Treasury doesn't just wait: it announces a stand-in number, extrapolated from the last available 12-month CPI change. Once used, that stand-in number is *never* replaced with the real figure later — it's permanent for every calculation that already relied on it.

:::callout
**This actually happened.** The October 2025 CPI-U reading was delayed by the federal government shutdown that began October 1, 2025. Treasury invoked exactly this fallback provision to keep computing Ref CPI and Index Ratios for TIPS on schedule while the real September/October readings were unavailable.
:::

# strips
ch: 5 · STRIPS & Interest Accrual
title: STRIPS

## STRIPS
*STRIPS* (Separate Trading of Registered Interest and Principal of Securities) means our program under which eligible securities are authorized to be separated into principal and interest components, and transferred separately. These components are maintained and transferred in the commercial book-entry system.

## Corpus
The principal component of a security that has been stripped of its interest components.

:::lead
This primer covers the §356.2 definitions above. Appendix B §V (adjusted-value and payment-amount formulas for stripped inflation-protected interest components) is out of scope for this pass.
:::

# regular-interest
ch: 5 · STRIPS & Interest Accrual
title: How Interest Payments Work

:::lead
Treasury pays interest on marketable Treasury securities — Notes and Bonds, both non-indexed and inflation-protected — **semiannually**, twice a year, six calendar months apart. Each payment is simply half the annual rate applied to the principal, full stop — Treasury does not prorate for the exact number of days in that particular half-year.
:::

:::example
$1,000 par, 8% coupon → each semiannual payment = $1,000 × 8% ÷ 2 = **$40**, every six months, regardless of whether that particular half-year was 181, 182, 183, or 184 days long.
:::

:::lead
Appendix B §I.A.3 and §I.A.4 give separate day-count formulas for a short or long first payment period, when a security's dated date doesn't line up with the regular semiannual schedule. Out of scope for this pass.
:::

:::aside
**Floating Rate Notes** work differently: instead of a fixed semiannual coupon, they accrue interest *daily* at a rate that resets off each week's 13-week bill auction, and pay out quarterly. Out of scope for this primer beyond this mention.
:::

# accrued-interest
ch: 5 · STRIPS & Interest Accrual
title: Accrued Interest

## Accrued interest
An amount that bidders must pay to us for interest income as part of the settlement amount. Accrued interest compensates us up front for interest that bidders will be paid but did not earn because it is attributable to a period of time prior to the issue date.

:::lead
The mechanics are the same daily-proration idea as the last page, run in reverse: a daily interest amount (the semiannual coupon spread evenly over however many days are in that half-year) multiplied by the number of days since the last coupon date.
:::

:::example
A 6.75% note pays $33.75 every half-year on $1,000 par. Reopened 92 days into a 184-day half-year: accrued interest = ($33.75 ÷ 184) × 92 = **$16.875** per $1,000 — added to the price to get the settlement amount.
:::

:::aside
For TIPS, accrued interest is computed the same way but on the *inflation-adjusted* principal, not the original par amount (Chapter 4). For Floating Rate Notes, it's the sum of actual daily accrual amounts over the elapsed days — a different mechanism, out of scope here.
:::

# meet-symbols
ch: 6 · From Yield to Price
title: Meet P, C, i, n

:::lead
Appendix B §II's definitions:
:::

:::grid2
## P
Price per 100 (dollars), rounded to six places, using normal rounding procedures.

## C
The regular annual interest per $100, payable semiannually, e.g. 6.125 (the decimal equivalent of a 6⅛% interest rate).

## i
Nominal annual rate of return or yield to maturity, based on semiannual interest payments, expressed in decimals, e.g. .0719.

## n
Number of full semiannual periods from the issue date to maturity, except that, if the issue date is a coupon frequency date, n is one less than the number of full semiannual periods remaining to maturity.

## v<sup>n</sup>
1 / [1 + (i/2)]<sup>n</sup> = present value of 1 due at the end of n periods.

## a<sub>n</sub>
(1 − v<sup>n</sup>) / (i/2) = present value of 1 per period for n periods.
:::

:::lead
§II.A — non-indexed securities with a regular first interest payment period, where r = days from the issue date to the first interest payment and s = days in that full semiannual period (so r = s = a full period, r/s = 1, for this regular case):
:::

:::example
P[1 + (r/s)(i/2)] = (C/2)(r/s) + (C/2)a<sub>n</sub> + 100v<sup>n</sup>
:::

:::lead
§II.B–G give six further variants of this same formula for short first payment periods, long first payment periods, and reopenings (where r/s take the other values listed in their definitions above) — out of scope for this pass.
:::

# price-vs-yield-calc
ch: 6 · From Yield to Price
title: Calculator: Price vs. Yield

# price-function
ch: 7 · The Practical Formula
title: The PRICE Function

:::lead
The spreadsheet function **PRICE(settlement, maturity, rate, yield, redemption, frequency, basis)**, with redemption = 100 and basis = 1 (actual/actual), reproduces the §II/§III formulas for Notes and Bonds — non-indexed (§I.A/§II) or inflation-protected (§I.B/§III, using the real yield) — either way.
:::

:::card-table The one setting that actually matters: frequency
| Security | Frequency |
| Notes and Bonds (non-indexed or inflation-protected), any maturity | **2** (semiannual coupons) |
| Bills, > 26 weeks to maturity | **2** |
| Bills, ≤ 26 weeks to maturity | **1** |
:::

:::lead
This frequency assignment was checked numerically against both of Appendix B §VI.D's own worked examples (Chapter 8), and matches what this suite's shared pricing code (`shared/src/bond-math.js`) already does.
:::

:::callout
**Naming collision, take two:** §III labels the settlement-amount-with-accrued-interest total "SA" (short for Settlement Amount) — the same two letters this whole app suite otherwise reserves for **Seasonally Adjusted**. This primer avoids the abbreviation entirely except to flag the collision.
:::

# price-calc
ch: 7 · The Practical Formula
title: Calculator: PRICE

# bill-formulas
ch: 8 · Treasury Bills in Practice
title: Bill Pricing Formulas

## Discount rate
A rate of return, on an annual basis, on bills held until they mature. The discount rate is expressed in percentage terms and based on a 360-day year. It is also referred to as the "bank discount rate."

:::lead
Two formulas convert between discount rate and price (§VI.A/§VI.C); a third (§VI.D) converts either one into an investment rate.
:::

## Discount rate → Price (§VI.A)
`Price = 100 × (1 − d × r / 360)`, where d = discount rate (decimal), r = days to maturity.

## Price → Discount rate (§VI.C)
`d = [(100 − Price) / 100] × (360 / r)` — just the first formula solved for d.

## Investment rate / coupon-equivalent yield (§VI.D)
Splits into two cases:

**≤ 26 weeks to maturity:** a simple day-count formula, `i = [(100 − P)/P] × (y/r)`, where y = 365 (or 366 if the year ahead spans Feb 29).

**> 26 weeks to maturity:** a compounding (quadratic) formula — because more than one semiannual period stands between settlement and maturity.

:::callout
In practice, this suite doesn't implement the §VI.D quadratic directly. **PRICE/YIELD with frequency = 2** already compounds correctly for >26-week bills, and for ≤26-week bills, frequency = 2 collapses to a single period with a simple day-count formula that's *almost* identical to §VI.D's simple case using frequency = 1 — except when that single period spans a Feb 29: frequency = 1's own annual period is 365 or 366 days depending on the leap day, and §VI.D's formula makes that same adjustment, so the two agree when there's no leap day in the span and diverge slightly when there is. Verified against both of Appendix B's own worked examples (Chapter 8's calculator uses the same math this suite's other apps do).
:::

# bill-calc
ch: 8 · Treasury Bills in Practice
title: Calculator: Bill Pricing
