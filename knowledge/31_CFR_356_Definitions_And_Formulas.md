# 31 CFR Part 356 — Cached Reference Text

Treasury's auction regulations. This is the primary corpus for word choice
and sentence construction anywhere this suite writes about Treasury/TIPS
concepts — CFR text first, then the language each app's own UI/spec uses,
never generic paraphrase. Covers Subpart A in full (§356.0–§356.5),
Appendix B (Formulas and Tables), Appendix C (Investment Considerations),
and Appendix D (Description of the Indexes). Subparts B, C, and D
(bidding/certification, auction-award/settlement mechanics, and STRIPS/tax
miscellany) and Appendix A (Bidder Categories) are not transcribed here —
out of scope for every app that currently cites this file — but the full
Part 356 text, including those, is cached as a source PDF (see below) if
ever needed.

**Sources:**
- §356.0, §356.1, §356.2, §356.5, Appendix C, Appendix D text: extracted directly from the official codified PDF, `https://www.govinfo.gov/content/pkg/CFR-2025-title31-vol2/pdf/CFR-2025-title31-vol2-part356.pdf` (`pdftotext`, no `-layout` flag — that flag interleaves the source's two-column layout and garbles reading order), cross-checked against eCFR where separately verified.
- Appendix B text: GovInfo annual codified edition `CFR-2025-title31-vol2` (effective 7-1-2025), cross-checked against the eCFR XML.
- Appendix B, Section IV formulas (floating rate notes) render as scanned images (CCITT Group 4 fax-compressed TIFF-in-PDF) in *every* text rendition of the CFR — eCFR HTML, the codified PDF, and the original Federal Register PDF (78 FR 46428, July 31, 2013) all embed them as graphics with no text alternative. They were recovered here by decoding the embedded CCITT streams directly and are reproduced below as plain-text formulas. Each was cross-checked against the worked numerical examples in the surrounding text (results match to the penny), so transcription is verified, not reconstructed from memory.
- **Appendix B, Table 2** (the 160-row lookup table of daily interest decimals for rates 1/8%–20% in 1/8-point increments, across 4 half-year lengths) is a pre-calculator convenience table, not a formula — by design decision, it is **omitted** here. The generating formula is given in its place (§I.A.2 below); consult the CFR directly if the printed table itself is ever needed.
- eCFR (`www.ecfr.gov`) blocks automated fetching (redirects through a bot-check) — govinfo.gov's codified PDF does not, and is the reliable source going forward.

---

## § 356.0 What authority does the Treasury have to sell and issue securities?

Chapter 31 of Title 31 of the United States Code authorizes the Secretary of the Treasury to issue United States obligations, and to offer them for sale with the terms and conditions that the Secretary prescribes.

## § 356.1 To which securities does this circular apply?

The provisions in this part, including the appendices, and each individual auction announcement govern the sale and issuance of marketable Treasury securities issued on or after March 1, 1993. This part also governs all securities eligible for the STRIPS (Separate Trading of Registered Interest and Principal of Securities) Program (See § 356.31.). In addition, these provisions and the auction announcements govern any other types of securities we may issue under this part.

## § 356.2 What definitions do I need to know to understand this part?

*13-week bill* means a Treasury bill where the security description is "13-Week Bill" as referenced on the Treasury auction announcement.

*Accrued interest* means an amount that bidders must pay to us for interest income as part of the settlement amount. Accrued interest compensates us up front for interest that bidders will be paid but did not earn because it is attributable to a period of time prior to the issue date. (See appendix B, section I, paragraph D of this part for additional explanation and examples.)

*Adjusted value* means, for an interest component stripped from an inflation-protected security, an amount derived by:

(1) Multiplying the semiannual interest rate by the par amount, and then

(2) Multiplying this value by: 100 divided by the Reference CPI of the original issue date (or dated date, when the dated date is different from the original issue date). (See appendix B, section V of this part for an example of how to calculate the adjusted value.)

*Auction* means a bidding process by which we sell marketable Treasury securities to the public.

*Autocharge agreement* means an agreement in a format acceptable to Treasury between a submitter or clearing corporation and a depository institution that authorizes us to:

(1) Deliver awarded securities to the book-entry securities account of a designated depository institution in the commercial book-entry system, and

(2) Charge a funds account of a designated depository institution for the settlement amount of the securities.

*Bid* means an offer to purchase a stated par amount of securities, either competitively or noncompetitively, in an auction.

*Bid-to-cover ratio* means the total par amount of securities bid for in an auction divided by the total par amount of securities awarded. It excludes bids by, and awards to, the Federal Reserve for its own account.

*Bidder,* as further defined in appendix A, means a person or an entity that offers to purchase Treasury securities in an auction either directly or through a depository institution or dealer. We may consider two or more persons or entities to be one bidder based on their relationship or their actions in participating in an auction. We consider a controlled account to be a bidder when an investment adviser bids in the name of the controlled account (See § 356.15.).

*Bidder Identification Number* means a number we assign to each institutional submitter and to certain other bidders. We assign such numbers either to identify certain bidders or to grant separate bidder status to different parts of the same corporate or partnership structure.

*Book-entry security* means a security that is issued or maintained as an accounting entry or electronic record. (*See* § 356.4.)

*Business day* means any day on which the Federal Reserve Banks are open for business.

*Call* means the redemption of a security prior to maturity under the terms specified in its auction announcement.

*Certificate of indebtedness* means a one-day non-interest-bearing security that may be held in TreasuryDirect and that automatically matures and is rolled over each day until its owner requests that it be redeemed.

*Clearing corporation* means a clearing agency as defined in section 3 of the Securities Exchange Act of 1934 (15 U.S.C. 78c(a)(23)). A clearing corporation must be registered with the Securities and Exchange Commission under section 17A of the Securities Exchange Act of 1934 and its rules.

*Competitive bid* means a bid to purchase a stated par amount of securities at a specified yield, discount rate, or discount margin.

*Consumer Price Index* (CPI) means the monthly non-seasonally adjusted U.S. City Average All Items Consumer Price Index for All Urban Consumers, published by the Bureau of Labor Statistics of the Department of Labor. We use the CPI as the basis for adjusting the principal amounts of inflation-protected securities. (See appendix D.)

*Corpus* means the principal component of a security that has been stripped of its interest components.

*CUSIP number* means the unique identifying number assigned to each separate security issue and each separate STRIPS component. CUSIP numbers are provided by the CUSIP Service Bureau of Standard & Poor's Corporation. CUSIP is an acronym for Committee on Uniform Securities Identification Procedures.

*Customer* means a bidder that directs a depository institution or dealer to submit or forward a bid for a specific amount of securities in a specific auction on the bidder's behalf. Only depository institutions and dealers may submit bids for customers directly to us, or forward them to another depository institution or dealer.

*Dated date* means the date from which interest accrues for notes and bonds. The dated date and issue date are usually the same. In those cases where interest begins accruing prior to the issue date, however, the dated date will be prior to the issue date. An example is when the dated date is a Saturday and the issue date is the following Monday.

*Dealer* means an entity that is registered or has given notice of its status as a government securities broker or government securities dealer under Section 15C(a)(1) of the Securities Exchange Act of 1934.

*Delivery and payment agreement* means a written agreement between a clearing corporation and a submitter, acknowledged by a Federal Reserve Bank, regarding securities awarded to the submitter for its own account. It authorizes us to deliver such securities to, and accept payment from, a depository institution acting on behalf of the clearing corporation under an acknowledged autocharge agreement.

*Depository institution* means:

(1) An entity described in Section 19(b)(1)(A), excluding subparagraph (vii), of the Federal Reserve Act (12 U.S.C. 461(b)(1)(A)).

(2) Any agency or branch of a foreign bank as defined by the International Banking Act of 1978, as amended (12 U.S.C. 3101).

*Discount* means the difference between par and the price of the security, when the price is less than par. (See appendix B for formulas and examples.)

*Discount amount* means the discount divided by 100 and multiplied by the par amount. (See appendix B for formulas and examples.)

*Discount margin* means the margin over the index that equates the present values of the assumed cash flows on a floating rate note to the sum of the price of and accrued interest on the floating rate note. The assumed cash flows are calculated based upon the index rate applicable to the dated date. Bidders in floating rate note auctions bid on the basis of discount margin. (See appendix B.)

*Discount rate* means a rate of return, on an annual basis, on bills held until they mature. The discount rate is expressed in percentage terms and based on a 360-day year. It is also referred to as the "bank discount rate." (See appendix B for formulas and examples.)

*Funds account* means a cash account maintained by a depository institution at a Federal Reserve Bank.

*Index* means the Consumer Price Index for inflation-protected securities. For floating rate notes, the index is the highest accepted discount rate on 13-week bills determined by Treasury auctions of those securities.

*Index rate* means the simple-interest money market yield, computed on an actual/360 basis and rounded to nine decimal places, from the highest accepted discount rate of a 13-week bill auction as announced in the Treasury auction results. (*See* appendix B for methods and examples for computing the index rate.)

*Index ratio* means, for an inflation-protected security, the Reference CPI of a particular date divided by the Reference CPI of the original issue date. (When the dated date is different from the original issue date, the denominator of the index ratio is the Reference CPI of the dated date rather than that of the original issue date.)

*Inflation-adjusted principal* means, for an inflation-protected security, the value of the security derived by multiplying the par amount by the applicable index ratio as described in appendix B, section I, paragraph B.

*Interest rate* means the annual percentage rate of interest paid on the par amount (or the inflation-adjusted principal) of a specific issue of notes or bonds. (See appendix B for methods and examples of interest calculations on notes and bonds.)

*Intermediary* means a depository institution or dealer that forwards bids for customers to another depository institution or dealer. An intermediary does not submit bids directly to us.

*Issue date* means the date specified in the auction announcement on which we issue a security as an obligation of the United States. Interest normally begins to accrue on a security's issue date.

*Marketable security* means a security that may be bought, sold and transferred in the secondary market.

*Maturity date* means the date on which a security becomes due and payable, and ceases to earn interest. The maturity date is specified in the auction announcement.

*Minimum to bid* means the smallest amount of a security that may be bid for in an auction as stated in the auction announcement.

*Multiple to bid* means the smallest additional amount of a security that may be bid for in an auction as stated in the auction announcement.

*Multiple-price auction* means an auction in which each successful competitive bidder pays the price equivalent to the yield, discount rate, or discount margin that it bid.

*Noncompetitive bid* means, for a single-price auction, a bid to purchase a stated par amount of securities at the highest yield, discount rate, or discount margin awarded to competitive bidders. For a multiple-price auction, a noncompetitive bid means a bid to purchase securities at the weighted average yield, discount rate, or discount margin of awards to competitive bidders.

*Offering amount* means the par amount of securities we are offering to the public for purchase in an auction, as specified in the auction announcement.

*Par* means a price of 100. (See appendix B.)

*Par amount* means the stated value of a security at original issuance.

*Person* means a natural person.

*Premium* means the difference between par and the price of the security, when the price is greater than par.

*Premium amount* means the premium divided by 100 and multiplied by the par amount.

*Price* means the price of a security per 100 dollars of its stated value as calculated using the formulas in appendix B.

*Real yield* means, for an inflation-protected security, the yield based on the payment stream in constant dollars. In other words, the real yield is the yield in the absence of inflation.

*Reference CPI* (Ref CPI) means, for an inflation-protected security, the index number applicable to a given date. (See appendix B, section I, paragraph B.)

*Reopening* means the auction of an additional amount of an outstanding security.

*Security* means a Treasury bill, note, or bond, each as described in this part. Security also means any other obligation we issue that is subject to this part according to its auction announcement. Security includes an interest or principal component under the STRIPS program, as well as a certificate of indebtedness.

*Settlement* means final and complete payment for securities awarded in an auction and delivery of those securities.

*Settlement amount* means the total of the par amount of securities awarded, less any discount amount or plus any premium amount, and plus any accrued interest. For inflation-protected securities, the settlement amount also includes any inflation adjustment when such securities are reopened or when the dated date is different from the issue date.

*Single-price auction* means an auction in which all successful bidders pay the same price regardless of the yields, discount rates, or discount margins they each bid.

*Spread* means the fixed amount over the life of a floating rate note that is added to the index rate in order to determine the interest rate of the floating rate note. The spread will be determined in the auction of a new floating rate note and is expressed in tenths of a basis point (*i.e.*, to three decimals). Additionally, the spread will be equal to the high discount margin at the time a new floating rate note is auctioned.

*STRIPS* (Separate Trading of Registered Interest and Principal of Securities) means our program under which eligible securities are authorized to be separated into principal and interest components, and transferred separately. These components are maintained and transferred in the commercial book-entry system.

*Submitter* means a person or entity submitting bids directly to us for its own account, for customer accounts, or both. Only depository institutions and dealers are permitted to submit bids for customer accounts. We permit investment advisers to submit bids on behalf of controlled accounts.

*TINT* means an interest component from a stripped security.

*We* (or "us") means the Secretary of the Treasury and his or her delegates, including the Department of the Treasury, Bureau of the Fiscal Service, and their representatives. The term also includes Federal Reserve Banks acting as fiscal agents of the United States.

*Weighted-average* means the average of the yields, discount rates, or discount margins at which we award securities to competitive bidders in multiple-price auctions weighted by the par amount of securities allotted at each yield, discount rate, or discount margin.

*Yield* means the annualized rate of return to maturity on a non-indexed security. Yield is expressed as a percentage. For an inflation-protected security, yield means the real yield. Yield is also referred to as "yield to maturity." (See appendix B.)

*You* means a prospective bidder in an auction.

*[69 FR 45202, July 28, 2004, as amended at 70 FR 57439, Sept. 30, 2005; 73 FR 14938, Mar. 20, 2008; 76 FR 18063, Apr. 1, 2011; 78 FR 46428, July 31, 2013; 81 FR 43070, July 1, 2016; 87 FR 40439, July 7, 2022]*

---

## § 356.5 What types of securities does the Treasury auction?

We offer securities under this part exclusively in book-entry form and as direct obligations of the United States issued under Chapter 31 of Title 31 of the United States Code. When we issue additional securities with the same CUSIP number as outstanding securities, we consider them to be the same securities as the outstanding securities.

**(a) Treasury bills.**
(1) Are issued at a discount or at par, depending upon the auction results;
(2) Are redeemed at their par amount at maturity; and
(3) Have maturities of not more than one year.

**(b) Treasury notes.**

*(1) Treasury non-indexed notes.*[^1]
(i) Are issued with a stated rate of interest to be applied to the par amount;
(ii) Have interest payable semiannually;
(iii) Are redeemed at their par amount at maturity;
(iv) Are sold at discount, par, or premium, depending upon the auction results; and
(v) Have maturities of at least one year, but of not more than ten years.

[^1]: We use the term "non-indexed" in this part to distinguish such notes and bonds from "inflation-protected securities" and "floating rate notes." We refer to non-indexed notes and non-indexed bonds as "notes" and "bonds" in official Treasury publications, such as auction announcements and auction results, as well as in auction systems.

*(2) Treasury inflation-protected notes.*
(i) Are issued with a stated rate of interest to be applied to the inflation-adjusted principal on each interest payment date;
(ii) Have interest payable semiannually;
(iii) Are redeemed at maturity at their inflation-adjusted principal, or at their par amount, whichever is greater;
(iv) Are sold at discount, par, or premium, depending on the auction results (See appendix B for price and interest payment calculations and appendix C for Investment Considerations.); and
(v) Have maturities of at least one year, but not more than ten years.
(vi) Are only reopened as scheduled or announced.

*(3) Treasury floating rate notes.*
(i) Are issued with a stated spread to be added to the index rate for daily interest accrual throughout each interest payment period;
(ii) Have a zero-percent minimum daily interest accrual rate;
(iii) Have interest payable quarterly;
(iv) Are redeemed at their par amount at maturity;
(v) Are sold at discount, par, or premium depending on the auction results (See appendix B for price and interest payment calculations and appendix C for Investment Considerations.); and
(vi) Have maturities of at least one year, but not more than ten years.

**(c) Treasury bonds.**

*(1) Treasury non-indexed bonds.*
(i) Are issued with a stated rate of interest to be applied to the par amount;
(ii) Have interest payable semiannually;
(iii) Are redeemed at their par amount at maturity;
(iv) Are sold at discount, par, or premium, depending on the auction results; and
(v) Have maturities of more than ten years.

*(2) Treasury inflation-protected bonds.*
(i) Are issued with a stated rate of interest to be applied to the inflation-adjusted principal on each interest payment date;
(ii) Have interest payable semiannually;
(iii) Are redeemed at maturity at their inflation-adjusted principal, or at their par amount, whichever is greater;
(iv) Are sold at discount, par, or premium, depending on the auction results; and
(v) Have maturities of more than ten years. (See appendix B for price and interest payment calculations and appendix C for Investment Considerations.)
(vi) Are only reopened as scheduled or announced.

*[69 FR 45202, July 28, 2004, as amended at 70 FR 57439, Sept. 30, 2005; 74 FR 26086, June 1, 2009; 78 FR 46428, 46429, July 31, 2013; 87 FR 40439, July 7, 2022]*

---

## Appendix B to Part 356 — Formulas and Tables

I. Computation of Interest on Treasury Bonds and Notes.
II. Formulas for Conversion of Non-indexed Security Yields to Equivalent Prices.
III. Formulas for Conversion of Inflation-Protected Security Yields to Equivalent Prices.
IV. Formulas for Conversion of Floating Rate Note Discount Margins to Equivalent Prices.
V. Computation of Adjusted Values and Payment Amounts for Stripped Inflation-Protected Interest Components.
VI. Computation of Purchase Price, Discount Rate, and Investment Rate (Coupon-Equivalent Yield) for Treasury Bills.

The examples in this appendix are given for illustrative purposes only and are in no way a prediction of interest rates on any bills, notes, or bonds issued under this part. In some of the following examples, Treasury uses intermediate rounding for ease in following the calculations.

### I. Computation of Interest on Treasury Bonds and Notes

#### A. Treasury Non-indexed Securities

**1. Regular Half-Year Payment Period.** Treasury pays interest on marketable Treasury non-indexed securities on a semiannual basis. The regular interest payment period is a full half-year of six calendar months. Examples of half-year periods are: (1) February 15 to August 15, (2) May 31 to November 30, and (3) February 29 to August 31 (in a leap year). Calculation of an interest payment for a non-indexed note with a par amount of $1,000 and an interest rate of 8% is made in this manner: ($1,000 × .08)/2 = $40. Specifically, a semiannual interest payment represents one half of one year's interest, and is computed on this basis regardless of the actual number of days in the half-year.

**2. Daily Interest Decimal.** Treasury computes a daily interest decimal in cases where an interest payment period for a non-indexed security is shorter or longer than six months or where accrued interest is payable by an investor. The daily interest decimal is based on the actual number of calendar days in the half-year or half-years involved:

> daily interest decimal = (annual interest rate / 2) / (number of days in the applicable half-year)

The number of days in any half-year period is shown in **Table 1**:

| Interest period | 1st/15th-of-month boundary — regular yr | 1st/15th-of-month boundary — leap yr | last-day-of-month boundary — regular yr | last-day-of-month boundary — leap yr |
|---|---|---|---|---|
| January–July | 181 | 182 | 181 | 182 |
| February–August | 181 | 182 | 184 | 184 |
| March–September | 184 | 184 | 183 | 183 |
| April–October | 183 | 183 | 184 | 184 |
| May–November | 184 | 184 | 183 | 183 |
| June–December | 183 | 183 | 184 | 184 |
| July–January | 184 | 184 | 184 | 184 |
| August–February | 184 | 184 | 181 | 182 |
| September–March | 181 | 182 | 182 | 183 |
| October–April | 182 | 183 | 181 | 182 |
| November–May | 181 | 182 | 182 | 183 |
| December–June | 182 | 183 | 181 | 182 |

Table 2 (omitted here — see note at top of file) tabulates this daily decimal pre-computed for rates 1/8% to 20% in 1/8-point increments, across half-years of 181/182/183/184 days, e.g. for 8⅜% and a 184-day half-year the decimal is $0.227581522 per $1,000 par.

**3. Short First Payment Period.** In cases where the first interest payment period for a Treasury non-indexed security covers less than a full half-year period (a "short coupon"), Treasury multiplies the daily interest decimal by the number of days from, but not including, the issue date to, and including, the first interest payment date. In cases where the par amount of securities is a multiple of $1,000, the appropriate multiple is applied to the unrounded interest payment amount per $1,000 par amount.

*Example:* A 2-year note paying 8⅜% interest was issued on July 2, 1990, with the first interest payment on December 31, 1990. The number of days in the full half-year period of June 30 to December 31, 1990, was 184 (Table 1). The number of days for which interest actually accrued was 182 (not including July 2, but including December 31). The daily interest decimal, $0.227581522 (Table 2, line for 8⅜%, half-year of 184 days), multiplied by 182, resulted in a payment of $41.419837004 per $1,000. For $20,000 of these notes, $41.419837004 × 20 = $828.39674008 ($828.40).

**4. Long First Payment Period.** In cases where the first interest payment period for a bond or note covers more than a full half-year period (a "long coupon"), Treasury multiplies the daily interest decimal by the number of days from, but not including, the issue date to, and including, the last day of the fractional period that ends one full half-year before the interest payment date. Treasury adds that amount to the regular interest amount for the full half-year ending on the first interest payment date.

*Example:* A 5-year 2-month note paying 7⅞% interest was issued on December 3, 1990, with the first interest payment due on August 15, 1991. Interest for the regular half-year portion of the payment was computed to be $39.375 per $1,000 par amount. The fractional portion of the payment, from December 3 to February 15, fell in a 184-day half-year (August 15, 1990, to February 15, 1991). The daily interest decimal for 7⅞% was $0.213994565, multiplied by 74 (days from but not including December 3, 1990, to and including February 15) = $15.835597810. Added to $39.375, this produced a first interest payment of $55.210597810, or $55.21 per $1,000 par amount. For $7,000 par amount, $55.210597810 × 7 = $386.474184670 ($386.47).

#### B. Treasury Inflation-Protected Securities

**1. Indexing Process.** Treasury pays interest on marketable Treasury inflation-protected securities on a semiannual basis, with a stated rate of interest that remains constant until maturity. Interest payments are based on the security's inflation-adjusted principal at the time interest is paid — the par amount multiplied by the applicable Index Ratio.

**2. Index Ratio.** The numerator of the Index Ratio, the Ref CPI_Date, is the index number applicable for a specific day. The denominator is the Ref CPI applicable for the original issue date (or, when the dated date differs from the original issue date, the Ref CPI for the dated date):

> Index Ratio_Date = Ref CPI_Date / Ref CPI_IssueDate

**3. Reference CPI.** The Ref CPI for the first day of any calendar month is the CPI for the third preceding calendar month (e.g., Ref CPI for April 1 is the CPI for January, reported in February). The Ref CPI for any other day of a month is found by linear interpolation between the Ref CPI for the first day of that month and the Ref CPI for the first day of the next month. Interpolation calculations are truncated to six decimal places, then rounded to five decimal places — so Ref CPI and Index Ratio are always expressed to five decimal places.

(i) Formula for the Ref CPI for a specific date:

> Ref CPI_Date = Ref CPI_M + [(t − 1)/D] × (Ref CPI_(M+1) − Ref CPI_M)

Where: Date = valuation date; D = number of days in the month in which Date falls; t = the calendar day corresponding to Date; CPI_M = CPI reported for calendar month M by the Bureau of Labor Statistics; Ref CPI_M = Ref CPI for the first day of the calendar month in which Date falls (e.g. Ref CPI_April1 is CPI_January); Ref CPI_(M+1) = Ref CPI for the first day of the calendar month immediately following Date.

(ii)–(iii) Example: Ref CPI for April 15, 1996 (D = 30, t = 15), where Ref CPI_April1,1996 = 154.40 (non-seasonally-adjusted CPI-U for January 1996) and Ref CPI_May1,1996 = 154.90 (CPI-U for February 1996):

> Ref CPI_April15,1996 = 154.40 + (14/30)(154.90 − 154.40) = 154.633333333

Truncated to six decimals: 154.633333; rounded to five decimals: 154.63333.

(iv) To calculate the Index Ratio for April 16, 1996 for a security issued April 15, 1996: using t = 16, Ref CPI_April16,1996 = 154.65000. Then:

> Index Ratio_April16,1996 = 154.65000 / 154.63333 = 1.000107803

Truncated to six decimals: 1.000107; rounded to five decimals: 1.00011.

**4. Index Contingencies.**

(i) If a previously reported CPI is revised, Treasury continues to use the previously reported (unrevised) CPI for principal value and interest payment calculations. If the CPI is rebased to a different year, Treasury continues to use the CPI based on the base reference period in effect when the security was first issued, as long as that CPI continues to be published.

(ii) Treasury will replace the CPI with an appropriate alternative index if, while a TIPS is outstanding, the applicable CPI is discontinued; in the Secretary's judgment fundamentally altered in a manner materially adverse to investors; or in the Secretary's judgment altered by legislation or Executive Order in a manner materially adverse to investors.

(iii) If Treasury decides to substitute an alternative index, it will consult the Bureau of Labor Statistics (or successor agency) and notify the public of the substitute index and its application. Determinations of the Secretary are final.

(iv) If the CPI for month M is not reported by the last day of the following month, Treasury announces an index number based on the last available twelve-month change in the CPI:

> (a) CPI_M = CPI_(M−1) × (CPI_(M−1) / CPI_(M−13))^(1/12)
>
> (b) Generalizing for the last reported CPI issued N months prior to month M: CPI_M = CPI_(M−N) × (CPI_(M−N) / CPI_(M−N−12))^(N/12)
>
> (c) If necessary to use these formulas, Treasury uses that derived number for all subsequent calculations relying on that month's index, and will not replace it with the actual CPI when later reported (except for use in these formulas themselves).

**5. Computation of Interest for a Regular Half-Year Payment Period.** Interest is a fixed percentage of the value of the inflation-adjusted principal, in current dollars, for the date on which it is paid: one-half of the specified annual interest rate multiplied by the inflation-adjusted principal for the interest payment date, computed on the basis of one-half of one year's interest regardless of the actual number of days in the half-year.

*Example:* A 10-year TIPS paying 3⅞% interest was issued January 15, 1999, with the first interest payment on July 15, 1999. Ref CPI_IssueDate (Jan 15, 1999) = 164; Ref CPI_Date (Jul 15, 1999) = 166.2. For a par amount of $100,000, the inflation-adjusted principal on July 15, 1999 was (166.2/164) × $100,000 = $101,341. Multiplied by .03875/2 = .019375, resulting in a payment of $1,963.48.

#### C. Treasury Floating Rate Notes

**1. Indexing and Interest Payment Process.** Treasury issues floating rate notes (FRNs) with a daily interest accrual feature — the interest rate "floats" based on changes in the representative index rate — and pays interest quarterly. The index rate is the High Rate of the 13-week Treasury bill auction, converted into a simple-interest money market yield computed on an actual/360 basis and rounded to nine decimal places. Interest payments are based on the FRN's variable interest rate from, and including, the dated date or last interest payment date to, but excluding, the next interest payment or maturity date, by accruing daily interest amounts over the period.

**2. Interest Rate.** The FRN interest rate is the spread plus the index rate (adjusted on the calendar day following each 13-week bill auction).

**3. Interest Accrual.** Accrued interest for a calendar day in an accrual period uses the index rate from the most recent 13-week bill auction before the accrual day, plus the spread fixed at the FRN's original auction, divided by 360 — subject to a zero-percent minimum daily accrual rate. A 13-week bill auction occurring in the two-business-day period prior to a settlement or interest payment date is excluded from that calculation (a "lockout" period); any rate change that would have occurred during lockout takes effect on the first calendar day after the lockout period ends.

**4. Index Contingencies.** If Treasury discontinues 13-week bill auctions, the Secretary may determine and announce a new index for outstanding FRNs. If a particular week's 13-week bill auction doesn't occur, the interest rate in effect at the time of the last auction results announcement remains in effect until the next auction results are announced. Treasury reserves the right to change the index rate for any newly issued FRN.

#### D. Accrued Interest

1. An investor pays accrued interest on a bond or note when interest accrues prior to the issue date, to compensate Treasury for interest that will be paid but wasn't earned by the investor.

2. For a non-indexed security, if accrued interest covers a fractional portion of a full half-year, the number of days in the full half-year and the stated interest rate determine the daily interest decimal; multiply by the number of accrued days.

3. If a reopened bond or note has a long first interest payment period and the dated date is less than six full months before the first interest payment, accrued interest falls into two separate half-year periods, each with its own daily interest decimal multiplied by its respective day count.

4. Treasury rounds all accrued interest computations to five decimal places for a $1,000 par amount, using normal rounding, then applies the appropriate multiple/fraction for other par amounts (also rounded to five decimals).

5. For an inflation-protected security, accrued interest is computed per section III, paragraphs A and B of this appendix.

6. For a floating rate note, accrued interest covering a portion of a quarterly period is computed per section IV, paragraphs C and D of this appendix.

*Examples — (1) Involving one half-year:* A 6¾% note, originally issued May 15, 2000 as a 5-year note with a first interest payment date of November 15, 2000, was reopened August 15, 2000. Interest accrued for 92 days (May 15–August 15), the regular period (May 15–November 15) covering 184 days. The daily interest decimal $0.183423913 × 92 = $16.874999996, or $16.87500 per $1,000 note. For $150,000 par: 150 × $16.87500 = $2,531.25.

*(2) Involving two half-years:* A 10¾% bond, originally issued July 2, 1985 as a 20-year 1-month bond with a first interest payment date of February 15, 1986, was reopened November 4, 1985. Interest accrued 44 days (July 2–August 15, 1985, in a 181-day half-year) and 81 days (August 15–November 4, in a 184-day half-year). $0.296961326 × 44 = $13.066298344, and $0.292119565 × 81 = $23.661684765; sum = $36.727983109, or $36.72798 per $1,000 bond. For $11,000 par: 11 × $36.72798 = $404.00778 ($404.01).

### II. Formulas for Conversion of Non-indexed Security Yields to Equivalent Prices

**Definitions**

- P = price per 100 (dollars), rounded to six places, using normal rounding procedures.
- C = the regular annual interest per $100, payable semiannually, e.g., 6.125 (the decimal equivalent of a 6⅛% interest rate).
- i = nominal annual rate of return or yield to maturity, based on semiannual interest payments, expressed in decimals, e.g., .0719.
- n = number of full semiannual periods from the issue date to maturity, except that, if the issue date is a coupon frequency date, n is one less than the number of full semiannual periods remaining to maturity. Coupon frequency dates are the two semiannual dates based on the maturity date (e.g., a security maturing November 15, 2015 has coupon frequency dates of May 15 and November 15).
- r = (1) number of days from the issue date to the first interest payment (regular or short first payment period), or (2) number of days in the fractional portion ("initial short period") of a long first payment period.
- s = (1) number of days in the full semiannual period ending on the first interest payment date (regular or short first payment period), or (2) number of days in the full semiannual period in which the fractional portion of a long first payment period falls, ending at the onset of the regular portion of the first interest payment.
- v^n = 1 / [1 + (i/2)]^n = present value of 1 due at the end of n periods.
- a_n = (1 − v^n) / (i/2) = v + v² + v³ + … + v^n = present value of 1 per period for n periods. **Special case:** if i = 0, a_n = n (computed as the summation v + v² + … + v^n, not via the division formula).
- A = accrued interest.

**A. Non-indexed securities with a regular first interest payment period**

> Formula: P[1 + (r/s)(i/2)] = (C/2)(r/s) + (C/2)a_n + 100v^n

*Example:* 8¾% 30-year bond issued May 15, 1990, due May 15, 2020, interest on Nov 15/May 15, yield 8.84%. C=8.75, i=.0884, r=s=184, n=59, v^n=.0779403508, a_n=20.8610780353. Resolution: P[1.0442] = 4.375 + 91.2672164044 + 7.7940350840 = 103.4362514884; P = 103.4362514884 / 1.0442 = **99.057893**.

**B. Non-indexed securities with a short first interest payment period**

> Formula: P[1 + (r/s)(i/2)] = (C/2)(r/s) + (C/2)a_n + 100v^n

*Example:* 8½% 2-year note issued April 2, 1990, due March 31, 1992, interest Sept 30/Mar 31, yield 8.59%. C=8.50, i=.0859, n=3, r=181, s=183, v^n=.8814740565, a_n=2.7596261590. P[1.042480601] = 4.2035519126 + 11.7284111757 + 88.14740565 = 104.0793687354; P = **99.838183**.

**C. Non-indexed securities with a long first interest payment period**

> Formula: P[1 + (r/s)(i/2)] = [(C/2)(r/s)]v + (C/2)a_n + 100v^n

*Example:* 8½% 5-year 2-month note issued March 1, 1990, due May 15, 1995, interest Nov 15/May 15 (first payment Nov 15, 1990), yield 8.53%. C=8.50, i=.0853, n=10, r=75, s=181, v=.9590946147, v^n=.658589, a_n=8.0049454082. P[1.017672652] = 1.6890133062 + 34.0210179850 + 65.8589078339 = 101.5689391251; P = **99.805118**.

**D(1). Non-indexed securities reopened during a regular interest period, where the purchase price includes predetermined accrued interest / D(2). New non-indexed securities accruing interest from the coupon frequency date immediately preceding the issue date, with the auction interest rate used to determine accrued interest payable on the issue date**

> Formula: (P + A)[1 + (r/s)(i/2)] = C/2 + (C/2)a_n + 100v^n, where A = [(s−r)/s](C/2)

*Example:* 9½% 10-year note, interest accruing from Nov 15, 1985, issued Nov 29, 1985 (14 days accrued), due Nov 15, 1995, interest May 15/Nov 15, yield 9.54%. C=9.50, i=.0954, n=19, r=167, s=181, v^n=.4125703996, a_n=12.3150859630, A=.367403. (P+.367403)[1.044010497] = 4.75 + 58.4966583243 + 41.25703996 = 104.5036982843; P + .367403 = 100.098321; P = **99.730918**.

**E. Non-indexed securities reopened during the regular portion of a long first payment period**

> Formula: (P + A)[1 + (r/s)(i/2)] = (r'/s')(C/2) + C/2 + (C/2)a_n + 100v^n
>
> Where: A = AI₁ + AI₂; AI₁ = (r/s)(C/2); AI₂ = [(s' − r')/s'](C/2); r = number of days from the reopening date to the first interest payment date; s = number of days in the semiannual period for the regular portion of the first interest payment period; r' = number of days in the fractional portion ("initial short period") of the first interest payment period; s' = number of days in the semiannual period ending with the commencement date of the regular portion of the first interest payment period.

*Example:* 10¾% 19-year 9-month bond due Aug 15, 2005, issued July 2, 1985, reopened Nov 4, 1985, interest Feb 15/Aug 15 (first payment Feb 15, 1986), yield 10.47%, accrued interest calculated July 2 to Nov 4. C=10.75, i=.1047, n=39, r=103, s=184, r'=44, s'=181, v^n=.1366947986, a_n=16.4910258142, AI₁=1.306630, AI₂=2.366168, A=3.672798. (P+3.672798)[1.02930462] = 1.3066298343 + 5.375 + 88.6392637512 + 13.6694798628 = 108.9903734482; P + 3.672798 = 105.887384; P = **102.214586**.

**F. Non-indexed securities reopened during a short first payment period**

> Formula: (P + A)[1 + (r/s)(i/2)] = (r/s)(C/2) + (C/2)a_n + 100v^n, where A = [(r' − r)/s](C/2), r' = number of days from the original issue date to the first interest payment date, r = number of days in the short period, s = number of days in the semiannual period ending with the end of the short period.

*Example:* 10½% 8-year note due May 15, 1991, originally issued May 16, 1983, reopened Aug 15, 1983, interest Nov 15/May 15 (first payment Nov 15, 1983), yield 10.53%, accrued interest May 16–Aug 15. C=10.50, i=.1053, n=15, r=92, s=184, r'=183, v^n=.4631696332, a_n=10.1962082956, A=2.596467. (P+2.596467)[1.026325] = 5.2214673913 + 53.5300935520 + 46.31696332 = 105.0685242633; P + 2.596467 = 102.373541; P = **99.777074**.

**G. Non-indexed securities reopened during the fractional portion (initial short period) of a long first payment period**

> Formula: (P + A)[1 + (r/s)(i/2)] = [(r/s)(C/2)]v + (C/2)a_n + 100v^n, where A = [(r' − r)/s](C/2), r' = number of days from the original issue date to the end of the short period, r = number of days in the short period, s = number of days in the semiannual period ending with the end of the short period.

*Example:* 9¾% 6-year 2-month note due Dec 15, 1994, originally issued Oct 15, 1988, reopened Nov 15, 1988, interest June 15/Dec 15 (first payment June 15, 1989), yield 9.79%, accrued interest Oct 15–Nov 15. C=9.75, i=.0979, n=12, r=30, s=183, r'=61, v=.9533342867, v^n=.5635631040, a_n=8.9159733613, A=.825820. (P+.825820)[1.00802459] = 1.549168216 + 43.4653701362 + 56.35631040 = 101.3708487520; P + .825820 = 100.563865; P = **99.738045**.

### III. Formulas for Conversion of Inflation-Protected Security Yields to Equivalent Prices

**Definitions**

- P = unadjusted (real) price per 100 (dollars).
- P_adj = inflation-adjusted price; P × Index Ratio_Date.
- A = unadjusted accrued interest per $100 original principal.
- A_adj = inflation-adjusted accrued interest; A × Index Ratio_Date.
- SA = settlement amount including accrued interest, in current dollars per $100 original principal; P_adj + A_adj.
- r = days from settlement date to next coupon date.
- s = days in current semiannual period.
- i = real yield, in decimals (e.g., 0.0325).
- C = real annual coupon, payable semiannually, in terms of real dollars paid per $100 of real principal.
- n = number of full semiannual periods from issue date to maturity (same coupon-frequency-date convention as Section II).
- v^n = 1/(1+i/2)^n; a_n = (1 − v^n)/(i/2) = v + v² + … + v^n (same special case if i = 0 as in Section II).
- D = number of days in the month in which Date falls; t = calendar day corresponding to Date.
- Ref CPI_M = reference CPI for the first day of the calendar month in which Date falls (= CPI for the third preceding month); Ref CPI_(M+1) = reference CPI for the first day of the following month.
- Ref CPI_Date = Ref CPI_M + [(t − 1)/D][Ref CPI_(M+1) − Ref CPI_M].
- Index Ratio_Date = Ref CPI_Date / Ref CPI_IssueDate (Ref CPI_DatedDate instead of Ref CPI_IssueDate when the dated date differs from the issue date).

**A. Inflation-protected securities with a regular first interest payment period**

> Formulas:
> P = [ (C/2) + (C/2)a_n + 100v^n − [(s−r)/s](C/2) ] / [1 + (r/s)(i/2)]
> P_adj = P × Index Ratio_Date
> A = [(s−r)/s] × (C/2)
> A_adj = A × Index Ratio_Date
> SA = P_adj + A_adj

*Example:* 10-year TIPS issued Jan 15, 1999 at a discount to yield 3.898% (real), 3⅞% real coupon, interest Jul 15/Jan 15, base CPI index 164. C=3.875, i=.03898, n=19, r=s=181, Ref CPI_Date = Ref CPI_IssueDate = 164 → Index Ratio = 1. A = 0, A_adj = 0. v^n = 0.692984572, a_n = 15.752459107. P = [1.9375 + 30.52038952 + 69.29845720 − 0] / 1.01949000 = 101.75634672/1.01949000 = **99.811030**. P_adj = 99.811030 × 1 = 99.811030. SA = 99.811030 + 0 = **99.811030**.

**B(1). Inflation-protected securities reopened during a regular interest period, where the purchase price includes predetermined accrued interest / B(2). New inflation-protected securities accruing interest from the coupon frequency date immediately preceding the issue date, with the auction interest rate used to determine accrued interest payable on the issue date**

Bidding note: bid dollar amounts are in terms of par; e.g. if Ref CPI at issue date is 120 and at reopening issue date is 132, a $10,000 bid is effectively a bid of $10,000 × (132/120) = $11,000.

> Formulas: (same P, P_adj, A, A_adj, SA as III.A above)

*Example:* 3⅝% 10-year TIPS issued Jan 15, 1998, interest Jul 15/Jan 15; reopened Oct 15, 1998, inflation compensation accruing from Jan 15, 1998, accrued interest accruing from Jul 15, 1998 (92 days), real yield 3.65%. Base index (issue date) = 161.55484; Ref CPI_Date (Oct 15, 1998) = 163.29032. C=3.625, i=.0365, n=18, r=92, s=184. Index Ratio_Date = 163.29032/161.55484 = 1.01074. v^n=0.722138438, a_n=15.225291068. P = [1.8125 + 27.59584006 + 72.21384380 − 0.906250]/1.009125 = 101.62218386.../1.009125... = **99.797017**. P_adj = 99.797017 × 1.01074 = **100.868837**. A = [(184−92)/184] × 3.625/2 = 0.906250. A_adj = 0.906250 × 1.01074 = **0.915983**. SA = 100.868837 + 0.915983 = **101.784820**.

### IV. Formulas for Conversion of Floating Rate Note Discount Margins to Equivalent Prices

> **Transcription note:** every formula in this section is embedded as a scanned image in eCFR, the codified PDF, and the original Federal Register PDF alike — recovered here via CCITT decode as described at the top of this file, and cross-checked against the worked numeric examples (all reconcile to the penny).

**Definitions for newly issued floating rate notes**

- P = the price per $100 par value.
- T₀ = the issue date. N = the total number of quarterly interest payments. T_i = the i-th quarterly interest payment date. T_i − T_(i−1) = number of days between interest payment date T_i and the preceding one. T_N = the maturity date.
- i, k = indexes identifying the sequence of interest payment dates.
- r = the index rate applicable to the issue date. s = the spread. m = the discount margin.

**A. For newly issued floating rate notes issued at par / B. …issued at a premium**

Let a_i = 100 × max(r+s, 0)/360 (daily projected interest per $100 par), and A_i = a_i × (T_i − T_(i−1)) + 100×1{i=N} (projected cash flow at T_i, including par payback at maturity). Let B_i = 1 + (r+m) × (T_i − T_(i−1))/360 (projected compound factor between T_(i−1) and T_i).

> **Price formula:**
>
> P = Σ_{i=1}^{N} [ A_i / (B₁×B₂×…×B_i) ]
>
> (equivalently: P = A₁/B₁ + A₂/(B₁B₂) + A₃/(B₁B₂B₃) + … + A_N/(B₁B₂…B_N) — the par-value payback is folded into A_N)

*Example (issued at par):* new 2-year FRN auctioned July 25, 2012, issued July 31, 2012, maturing July 31, 2014; N=8; interest accrual rate on issue date 0.215022819% (index rate 0.095022819% + spread 0.120%, both equal to the discount margin since this is a new issuance). Quarterly A_i values: 0.054950312 (×6, adjusting for 89-day quarters → 0.053158454), final A₈ = 100.054950312. B_i ≈ 1.000549503 (or 1.000531584 for 89-day quarters). Resolution: P = 0.054920133 + 0.054889971 + 0.053071869 + 0.054830678 + 0.054800565 + 0.054770469 + 0.052956324 + 99.619760194 = 100.000000203 = **$100.000000**.

**Computing the index rate** (used throughout this section):

> r = D / [1 − (ΔT/360)D]
>
> where D is the discount rate (auction high rate) and ΔT is the number of days from (and including) the 13-week bill's issue date to (but excluding) its maturity date.

*Example:* auction high rate D = 0.095%, ΔT = 91 days → r = 0.095% / [1 − (91/360)(0.095%)] = **0.095022819%**.

*Example (issued at a premium):* same note structure, but discount margin at auction = −0.150% (spread = −0.150%), subject to a 0.000% daily accrual floor. a_i = 100×max(0.00095022819−0.00150, 0)/360 = 0 for all i (floor binds). A₈ = 100. B_i ≈ 0.999859503 (or 0.999864084 for 89-day quarters). P = 0 + 0 + … + 100.000000000/0.998885730 = **$100.111551**.

**Definitions for reopenings of floating rate notes and calculation of interest payments**

- IP_i = the quarterly interest payment at date T_i.
- P_D = the price including accrued interest per $100 par as of the reopening issue date. AI = accrued interest per $100 par as of the reopening issue date. P_C = the price without accrued interest per $100 par as of the reopening issue date (P_C = P_D − AI).
- T_(−1) = the dated date (if reopening occurs before the first interest payment date) or otherwise the latest interest payment date prior to the reopening issue date. T₀ = the reopening issue date. N = total remaining quarterly interest payments as of the reopening issue date.
- i, k = indexes identifying interest payment dates relative to the issue date (T₁, T₂, T₃ = 1st/2nd/3rd interest payment dates after the issue date; T_(−1) = the preceding interest payment date before the issue date).
- j = index identifying days between consecutive interest payment dates. r_j's = the effective index rates for days between the last interest payment date and the reopening issue date.
- r = the index rate applicable to the reopening issue date. s = the spread (unchanged from the FRN's original auction). m = the discount margin.

**C. Pricing and accrued interest for reopened floating rate notes**

> Formula:
>
> P_D = { 100 × (1/360) × Σ_{j=T₋₁}^{T₀−1} max(r_j + s, 0) } / { 1 + (1/360)(T₁ − T₀)(r + m) }
>   + Σ_{i=1}^{N} [ 100×(1/360)(T_i − T_(i−1))×max(r+s,0) / Π_{k=1}^{i}(1 + (1/360)(T_k − T_(k−1))(r+m)) ]
>   + 100 / Π_{k=1}^{N}(1 + (1/360)(T_k − T_(k−1))(r+m))
>
> AI = 100 × (1/360) × Σ_{j=T₋₁}^{T₀−1} max(r_j + s, 0)
>
> P_C = P_D − AI

*Example:* 2-year FRN originally auctioned July 25, 2012 (issue date July 31, 2012, spread s=0.120%), reopened in an auction on August 30, 2012, issued August 31, 2012, maturing July 31, 2014; discount margin at reopening m=0.100%, index rate at reopening r=0.105027876%. Accrued interest sums the effective daily rates across six 13-week-bill-auction windows between July 31 and August 31, 2012: AI = 1×0.000597286 + 6×0.000638974 + 7×0.000611181 + 7×0.000638974 + 7×0.000625078 + 3×0.000625077 = 0.019432992 = **$0.019433**. Then A₁ = 0.038129697 (61-day first stub + AI), A₂…A₇ ≈ 0.0555–0.0575, A₈ = 100.057507084; B_i ≈ 1.0003–1.0044 (cumulative products). P_D = 0.057542698 + 0.057457007 + 0.055555250 + 0.057397824 + 0.057367766 + 0.057337723 + 0.055439914 + 99.660074368 = **$100.058173**. P_C = 100.058172550 − 0.019432992 = **$100.038740**.

**D. For calculating interest payments**

> (a) New floating rate note: IP_i = 100 × (1/360)(T_i − T_(i−1)) × max(r + s, 0)
>
> (b) Reopened floating rate note, first interest payment after the reopening: IP_i = 100×(1/360)×Σ_{j=T₋₁}^{T₀−1} max(r_j+s,0) + 100×(1/360)(T₁−T₀)×max(r+s,0)
>
> (c) Reopened floating rate note, not the first interest payment after the reopening: IP_i = 100 × (1/360)(T_i − T_(i−1)) × max(r + s, 0)

*Example 1 (new issue, as of the original issue date):* same 2-year FRN as above (T₀ = July 31, 2012, r = 0.095022819%, s = 0.120%). IP₁ = 92 × [100×max(0.00095022819+0.00120,0)/360] = 92 × 0.000597286 = **0.054950312**. IP₇ = 89 × 0.000597286 = **0.053158454** (89-day quarter).

*Example 2 (as of the reopening issue date):* reopened FRN (T₋₁ = July 31 2012, T₀ = August 31 2012, r = 0.105027876%, s = 0.120%, using formula (b) for the first payment): IP₁ = AI + 61×[100×max(0.00105027876+0.00120,0)/360] = 0.019432992 + 61×0.000625077 = 0.019432992 + 0.038129697 = **0.057562689**. Later payments use formula (c): IP₈ = 92 × 0.000625077 = **0.057507084**.

**Definitions for newly issued floating rate notes with an issue date that occurs after the dated date**

- P_D = the price including accrued interest from the dated date to the issue date, per $100 par, as of the issue date. AI = accrued interest per $100 par as of the issue date. P_C = the price without accrued interest per $100 par as of the issue date.
- T₋₁ = the dated date. T₀ = the issue date. N = total remaining quarterly interest payments as of the issue date.
- j = index identifying days between the dated date and the issue date. r_j's = the effective index rates for that span. Other symbols (T_i, r, s, m) as in section IV.C.

**E. Pricing and accrued interest for new issue floating rate notes with an issue date that occurs after the dated date**

> Formula: (identical structure to IV.C's P_D / AI / P_C formulas above, substituting the dated-date-to-issue-date accrual span for T₋₁ … T₀−1)

*Example:* 2-year FRN, dated date Dec 31 2011, auctioned Dec 29 2011, issue date Jan 3 2012 (3-day stub), maturity Dec 31 2013; spread/discount margin = 1.000%; index rate at issue r = 0.025001580%. AI = 3 × 100×max(0.00025001580+0.01000,0)/360 = 3 × 0.002847227 = 0.008541681 = **$0.008542**. First projected cash flow A₁ = 88 × 0.002847227 = 0.250555976 (88-day first quarter); final A₈ = 92×0.002847227+100 = 100.261944884. Compound factors B_i ≈ 1.0025–1.0026. Resulting P_D = 0.258450095 + 0.257782188 + 0.259934075 + 0.259254970 + 0.252970754 + 0.255120529 + 0.257250198 + 98.207758055 = **$100.008521**; P_C = 100.008520864 − 0.008541681 = **$99.999979**.

### V. Computation of Adjusted Values and Payment Amounts for Stripped Inflation-Protected Interest Components

> **Note:** Valuing an interest component stripped from a TIPS at its adjusted value enables it to be fungible with other interest components of the same maturity date, regardless of the underlying TIPS it was stripped from — supporting trading and reconstitution.

**Definitions**

- c = C/100 = the regular annual interest rate, payable semiannually, e.g. .03625 (decimal equivalent of a 3⅝% rate).
- Par = par amount of the security to be stripped.
- Ref CPI_IssueDate = reference CPI for the original issue date (or dated date, if different) of the underlying (unstripped) security.
- Ref CPI_Date = reference CPI for the maturity date of the interest component.
- AV = adjusted value of the interest component. PA = payment amount at maturity by Treasury.

> Formulas:
> AV = Par × (c/2) × (100 / Ref CPI_IssueDate) — rounded to 2 decimals, no intermediate rounding
> PA = AV × (Ref CPI_Date / 100) — rounded to 2 decimals, no intermediate rounding

*Example:* 10-year TIPS paying 3⅞% interest issued January 15, 1999, second interest payment January 15, 2000. Ref CPI_IssueDate = 164.00000; Ref CPI_Date (Jan 15, 2000) = 168.24516. For Par = $1,000,000: AV = $1,000,000 × (.03875/2) × (100/164.00000) = **$11,814.02**. PA = $11,814.02 × (168.24516/100) = **$19,876.52**.

### VI. Computation of Purchase Price, Discount Rate, and Investment Rate (Coupon-Equivalent Yield) for Treasury Bills

**A. Conversion of the discount rate to a purchase price**

> Formula: P = 100(1 − dr/360)
>
> Where: d = discount rate, in decimals; r = number of days remaining to maturity; P = price per 100 (dollars).

*Example:* bill issued Nov 24, 1989, due Feb 22, 1990, discount rate 7.610%, r = 90 days. P = 100[1 − (.07610)(90)/360] = 100(1 − .019025) = 100(.980975) = **98.097500**.

> Note: purchase prices per $100 are rounded to six decimal places, using normal rounding procedures.

**B. Computation of purchase prices and discount amounts based on price per $100**

1. To determine the purchase price of any bill: divide the par amount by 100 and multiply by the price per $100.

*Example:* $10,000 13-week bill at $98.098000 per $100 → ($10,000/100) × 98.098000 = **$9,809.80**.

2. To determine the discount amount for any bill: subtract the purchase price from the par amount.

*Example:* $10,000 bill with purchase price $9,809.80 → discount amount = $10,000 − $9,809.80 = **$190.20**.

**C. Conversion of prices to discount rates**

> Formula: d = (100 − P)/100 × 360/r
>
> Where: P = price per 100 (dollars); d = discount rate; r = number of days remaining to maturity.

*Example:* 26-week bill issued Dec 30, 1982, due June 30, 1983, price $95.934567, r = 182 days. d = [(100 − 95.934567)/100] × (360/182) = .04065433 × 1.978021978 = .080415158 = **8.042%**.

> Note: prior to April 18, 1983, Treasury sold all bills in price-basis auctions (discount rates from prices rounded to three places). Since then, bills sell only on a discount-rate basis.

**D. Calculation of investment rate (coupon-equivalent yield)**

**1. For bills of not more than one half-year to maturity:**

> Formula: i = [(100 − P)/P] × (y/r)
>
> Where: i = investment rate, in decimals; P = price per 100; r = days remaining to maturity; y = days in the year following the issue date — normally 365, but 366 if the 1-year period from the issue date contains February 29 (e.g. issue date Feb 28, 2019 → 1 year ahead is Feb 28, 2020, no Feb 29 in between → y=365; issue date March 1, 2019 → 1 year ahead is March 1, 2020, which does span Feb 29, 2020 → y=366).

*Example:* cash management bill issued June 1, 1990, due June 21, 1990, price $99.559444 (from a 7.930% discount rate), r = 20, y = 365. i = (100−99.559444)/99.559444 × 365/20 = .004425 × 18.25 = .080756 = **8.076%**.

**2. For bills of more than one half-year to maturity:**

> Formula: P[1 + (r − y/2)(i/y)](1 + i/2) = 100
>
> This must be solved via the quadratic equation ax² + bx + c = 0, rewritten as: (r/2y)i² + (r/y)i + [(P−100)/P] = 0, giving i = [−b + √(b² − 4ac)] / 2a, where: b = r/y; a = (r/2y) − .25; c = (P−100)/P.

*Example:* 52-week bill issued June 7, 1990, due June 6, 1991, price $92.265000 (from a 7.65% discount rate), r = 364, y = 365. b = 364/365 = .997260274; a = (364/730) − .25 = .248630137; c = (92.265−100)/92.265 = −.083834607. i = [−.997260274 + √((.997260274)² − 4(.248630137)(−.083834607))] / [2(.248630137)] = [−.997260274 + √(.994528054 + .083375239)] / .497260274 = (−.997260274 + 1.038221216) / .497260274 = .040960942 / .497260274 = .082373244 = **8.237%**.

---

*[Appendix B citation history: 69 FR 45202, July 28, 2004, as amended at 69 FR 52967, Aug. 30, 2004; 69 FR 53622, Sept. 2, 2004; 73 FR 14939, Mar. 20, 2008; 78 FR 46428, 46430, July 31, 2013; 78 FR 50335, Aug. 19, 2013; 78 FR 52857, Aug. 27, 2013; 78 FR 59228-59230, Sept. 26, 2013; 81 FR 43070, July 1, 2016; 87 FR 40440, July 7, 2022]*

---

## Appendix C to Part 356 — Investment Considerations

### I. Inflation-Protected Securities

**A. Principal and Interest Variability**

An investment in securities with principal or interest determined by reference to an inflation index involves factors not associated with an investment in a non-indexed security. Such factors include the possibility that: the inflation index may be subject to significant changes; changes in the index may or may not correlate to changes in interest rates generally or with changes in other indices; the resulting interest may be greater or less than that payable on other securities of similar maturities; and in the event of sustained deflation, the amount of the semiannual interest payments, the inflation-adjusted principal of the security, and the value of stripped components will decrease. However, if at maturity the inflation-adjusted principal is less than a security's par amount, we will pay an additional amount so that the additional amount plus the inflation-adjusted principal equals the par amount. Regardless of whether or not we pay such an additional amount, we will always base interest payments on the inflation-adjusted principal as of the interest payment date. If a security has been stripped, we will pay any such additional amount at maturity to holders of principal components only. (See § 356.30.)

**B. Trading in the Secondary Market**

The Treasury securities market is the largest and most liquid securities market in the world. The market for Treasury inflation-protected securities, however, may not be as active or liquid as the market for Treasury non-indexed securities. In addition, Treasury inflation-protected securities may not be as widely traded or as well understood as Treasury non-indexed securities. Lesser liquidity and fewer market participants may result in larger spreads between bid and asked prices for inflation-protected securities than the bid-asked spreads for non-indexed securities with the same time to maturity. Larger bid-asked spreads normally result in higher transaction costs and/or lower overall returns. The liquidity of an inflation-protected security may be enhanced over time as we issue additional amounts or more entities participate in the market.

**C. Tax Considerations**

Treasury inflation-protected securities and the stripped interest and principal components of these securities are subject to specific tax rules provided by Treasury regulations issued under sections 1275(d) and 1286 of the Internal Revenue Code of 1986, as amended.

**D. Indexing Issues**

While the Consumer Price Index ("CPI") measures changes in prices for goods and services, movements in the CPI that have occurred in the past do not necessarily indicate changes that may occur in the future.

The calculation of the index ratio incorporates an approximate three-month lag, which may have an impact on the trading price of the securities, particularly during periods of significant, rapid changes in the index.

The CPI is reported by the Bureau of Labor Statistics, a bureau within the Department of Labor. The Bureau of Labor Statistics operates independently of Treasury and, therefore, we have no control over the determination, calculation, or publication of the index. For a discussion of how we will apply the CPI in various situations, see appendix B, section I, paragraph B of this part. In addition, for a discussion of actions that we would take in the event the CPI is: discontinued; in the judgment of the Secretary, fundamentally altered in a manner materially adverse to the interests of an investor in the security; or, in the judgment of the Secretary, altered by legislation or Executive Order in a manner materially adverse to the interests of an investor in the security, see appendix B, section I, paragraph B.4 of this part.

### II. Floating Rate Notes

*(Not transcribed in full here — out of scope for this suite's apps. Covers interest variability, secondary-market trading, tax considerations, and indexing issues for FRNs, parallel in structure to Section I above. See the source PDF if ever needed.)*

*[69 FR 45202, July 28, 2004, as amended at 78 FR 46428, 46444, July 31, 2013]*

---

## Appendix D to Part 356 — Description of the Indexes

### I. Consumer Price Index

The Consumer Price Index ("CPI") for purposes of inflation-protected securities is the non-seasonally adjusted U.S. City Average All Items Consumer Price Index for All Urban Consumers. It is published monthly by the Bureau of Labor Statistics (BLS), a bureau within the Department of Labor. The CPI is a measure of the average change in consumer prices over time in a fixed market basket of goods and services. This market basket includes food, clothing, shelter, fuels, transportation, charges for doctors' and dentists' services, and drugs.

In calculating the index, price changes for the various items are averaged together with weights that represent their importance in the spending of urban households in the United States. The BLS periodically updates the contents of the market basket of goods and services, and the weights assigned to the various items, to take into account changes in consumer expenditure patterns.

The CPI is expressed in relative terms in relation to a time base reference period for which the level is set at 100. For example, if the CPI for the 1982–84 reference period is 100.0, an increase of 16.5 percent from that period would be shown as 116.5. The CPI for a particular month is released and published during the following month. From time to time, the CPI is rebased to a more recent base reference period. We provide the base reference period for a particular inflation-protected security on the auction announcement for that security.

Further details about the CPI may be obtained by contacting the BLS.

### II. Floating Rate Note Index

The floating rate note index is the 13-week Treasury bill auction High Rate (stop out rate), and converted to the simple-interest money market yield computed on an actual/360 basis.

*[69 FR 45202, July 28, 2004, as amended at 78 FR 46444, July 31, 2013]*
