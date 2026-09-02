# Seasonally Adjusted Prices for Inflation-Linked Bonds
**Author:** Paul Canty (Deutsche Bank, European Head of Inflation Trading) — *Risk*, January 2009.

This is a thorough working summary of the paper, written to be the canonical reference for the seasonal-adjustment math used across the Treasuries apps. Equation numbers match the paper. Where the apps depend on a result, the dependency is noted.

---

## 1. The problem the paper solves

Three things contaminate the price (and therefore the implied real yield / breakeven inflation) of an inflation-linked bond (ILB):

1. **Seasonality** ($S_t$) — periodic, recurrent CPI swings (clothing, accommodation, and in the US especially **motor fuel**). Reasonably stable in timing, direction and magnitude, so it can be modelled as a fixed set of 12 monthly factors that repeat every year.
2. **Carry** — the gap between the forward rate and the spot rate, driven largely by the **indexation lag** (3 months for TIPS / Canadian-style). Part of an ILB's "inflation protection" is *already-known historical* inflation, not a forward expectation.
3. **Outliers / one-off shocks** ($O_t$) — *known or expected* non-recurring events (a VAT hike, a gasoline move since the last CPI release). Distinct from seasonality (recurrent) and from noise (unforecastable).

Because these distort breakeven inflation (BEI = nominal yield − real yield), Canty argues you cannot meaningfully compare BEI levels, or the *steepness* of the real curve, without stripping them out. A 5y and a 10y react to seasonality **differently**, so even "how steep is the real curve?" is a seasonally-dependent question. The FOMC sidesteps this by quoting the **5y5y forward** (a whole number of years, so seasonality cancels); Canty's method removes the restriction by adjusting each individual bond.

The paper's scope is the **application** of seasonal factors, not their estimation (that is left to the statistical agencies / standard time-series methods).

---

## 1a. TIPS Translation: Canty's Notation → US TIPS Terms

Canty's paper uses generic notation for inflation-linked bonds across any market. For US TIPS, the variables map as follows:

| Canty notation | TIPS equivalent | Notes |
|---|---|---|
| $I_t$ — inflation index at date $t$ | **Ref CPI** on date $t$ | Non-seasonally adjusted CPI-U, daily-interpolated per 31 CFR § 356 App. B with a 3-month lag. A TIPS's adjusted principal = face value × (Ref CPI(t) / Ref CPI(dated date)), so the principal changes daily with the Ref CPI. |
| $I_{Base}$ — base index | **Ref CPI on the dated date** | Fixed at issuance; the inflation index ratio = Ref CPI(settle) / Ref CPI(dated date). This ratio multiplies the face value to give the current adjusted principal. |
| $I_{Settle}$ — index at settlement | **Ref CPI on the settlement date** | App. B interpolation for the specific day of the settlement month |
| $I_i$ — index at each payment date | **Ref CPI on each payment date** | Interpolated for the month/day of each semi-annual coupon and the final maturity |
| $T_t$ — trend component | **Ref CPI SA** on date $t$ | Because $S = \text{NSA}/\text{SA}$ and $I = T \times S$, the trend component is literally the daily-interpolated seasonally adjusted Ref CPI |
| $S_t$ — seasonal component | **SA Factor** on date $t$ | $\text{RefCPI}_{NSA}(t)\,/\,\text{RefCPI}_{SA}(t)$ — ratio of the two daily interpolated series |
| $C_i$ — real cashflows | Semi-annual coupon + principal | Coupon rate / 2 per payment period; 1 + coupon rate / 2 at maturity (per \$100 face, before inflation adjustment) |
| $CP$ — clean price | **Quoted real price** (clean price) | The price excluding inflation accrual, as quoted by FedInvest or brokers |
| $DP$ — dirty price | **Full price** | $CP \times \text{index ratio}$ (roughly) |
| $RAI$ — real accrued interest | Real accrued interest | Coupon accrued since last payment date, before inflation adjustment |
| $t_{Settle\text{-}lag}$ — settlement minus lag | 3 months before settlement | TIPS use a 3-month lag: the Ref CPI for any day in month $M$ interpolates between the CPI-U for months $M{-}3$ and $M{-}2$ |
| $I_{Base}$ at issuance / $RY$ | Dated Date Ref CPI / real yield | Published by Treasury at issuance; available in `TipsRef.csv` |

**Key points for TIPS:**

- **The 3-month lag, stated exactly.** Ref CPI(month $M$, day 1) = CPI-U($M-3$); Ref CPI interpolates linearly from there to Ref CPI(month $M{+}1$, day 1) = CPI-U($M-2$) across the days of month $M$. For example, Ref CPI for **March 1** equals the CPI-U value for **December**; a March 15 settlement (day 15 of a 31-day month) interpolates between the December and January values. Single implementation: `shared/src/ref-cpi.js` `refCpiFromMonthly()`.

- **No official daily SA Ref CPI.** BLS publishes monthly SA CPI-U alongside monthly NSA, but there is no official daily SA Ref CPI — daily interpolation officially applies to NSA only (it drives TIPS inflation accrual). The daily SA Ref CPI in `RefCpiNsaSa.csv` is constructed by applying the same App. B interpolation to the monthly CPI-SA series. It is a necessary calculated construct, not an official publication, and is used solely for seasonal yield comparison.

- **Trend component = SA Ref CPI.** Because the SA Factor $S = \text{NSA}/\text{SA}$ and the index decomposes as $I = T \times S$, the trend component $T$ is exactly the SA Ref CPI: $T = I / S = \text{NSA} / (\text{NSA}/\text{SA}) = \text{SA}$.

- **Semiannual vs annual.** Canty's Eq. 1–14 simplify to annual coupons; TIPS pay semi-annually. Eq. 17 handles two coupon months. As shown in spec [2.2](2.2_SAO_Residual_Analysis.md), the single-factor approximation (Eq. 14) is adequate for TIPS because the second-factor correction is ≤1 bp, driven by the small coupon stream while the principal cashflow (which dominates) falls in the maturity month in both formulas identically.

---

## 1b. Why this matters — the paper's own motivating example

Canty opens the "Seasonally adjusted prices" section (Risk, Jan 2009, p.107) — before introducing any of the math — with a concrete illustration of the problem, not an abstract one:

> Whenever the maturity of an ILB is not a whole number of years after its settlement date, seasonality becomes an issue. For example, if a bond settles in April and matures some years later in September, the indexation period includes an extra six months of inflation from January to June (due to the three-month lag). Inflation in this period is typically much higher than from July to December, which means that the overall breakeven inflation rate should be higher than the same bond with a whole number of years left to maturity. This article focuses on quantifying this effect.

**In TIPS terms.** April → September is a 5-month stub on top of however many whole years separate settlement from maturity. Because of the 3-month indexation lag, that stub's Ref CPI doesn't draw from the April–September window itself — it draws from the CPI-U values **3 months earlier at each end**: April's Ref CPI references January's CPI-U, and September's Ref CPI references June's. So the "extra" stub inflation baked into the principal growth of this TIPS is really the **January–June** window — which, per the seasonal pattern documented in [SeasonalAdjustments/1.0](../../SeasonalAdjustments/knowledge/1.0_SeasonalAdjustments_Explorer.md) (H1 NSA CPI-U MoM changes run hotter than H2), is systematically higher than a bond of the same maturity whose stub happened to fall in the calendar's cooler half. The market prices that predictable extra inflation into the bond, so its **quoted breakeven inflation reads higher — not because expected inflation is actually higher, but purely because of the calendar position of the stub.** This is exactly the effect Eq. 13/14 (§4 below) exist to strip back out; note also that a bond whose settlement and maturity fall on the **same** calendar month/day (a whole number of years apart, zero stub) needs no adjustment at all — see the anniversary identity in §4.

---

## 2. Index decomposition (the foundation)

The inflation index is decomposed multiplicatively:

$$I_t = T_t \, S_t \qquad (2)$$

- $T_t$ — **trend component** of the index (the underlying, deseasonalised inflation path).
- $S_t$ — **seasonal component** of the index for the calendar position of $t$ (repeats every 12 months; *constant over time* — the paper's key simplifying assumption).

> **App mapping.** In this project $S_t = \dfrac{\text{RefCPI}_{NSA}(t)}{\text{RefCPI}_{SA}(t)}$ — the ratio of the (App. B daily-interpolated) Non-Seasonally-Adjusted Ref CPI to the Seasonally-Adjusted Ref CPI. NSA $= T\cdot S$, SA $= T$, so their ratio isolates $S$. The daily SA series is a **calculated construct** (there is no official daily SA Ref CPI); see [1.0 Seasonal Adjustments](1.0_Seasonal_Adjustments.md) and `shared/src/ref-cpi.js`.

The fully-adjusted extension adds the outlier index (used only by FACP, §8):

$$I_t = T_t \, S_t \, O_t \qquad (20)$$

---

## 3. Derivation of the Seasonally Adjusted Clean Price (annual coupons)

Start from the **dirty price** of an ILB with annual real cashflows $C_i$ at times $t_i$ (nominal discount factor $df_i$, base index $I_{Base}$):

$$DP = \sum_{i=1}^{n} C_i \frac{I_i}{I_{Base}} df_i \qquad (1)$$

Substitute the decomposition $I_i = T_i S_i$:

$$DP = \sum_{i=1}^{n} C_i \frac{T_i S_i}{I_{Base}} df_i \qquad (3)$$

For **annual** coupons every $t_i$ falls on the same calendar month as maturity, so all $S_i$ are equal to $S_{Maturity}$ and factor out:

$$DP = \left(\sum_{i=1}^{n} C_i \frac{T_i}{I_{Base}} df_i\right) S_{Maturity} \qquad (4)$$

The bracket is the **seasonally adjusted dirty price** — it contains only trend inflation:

$$DP = SADP \times S_{Maturity} \quad\Rightarrow\quad SADP = \frac{DP}{S_{Maturity}} \qquad (5,6)$$

Convert dirty → clean using the clean-price definition (RAI = **real accrued interest**):

$$CP = \frac{I_{Base}}{I_{Settle}} DP - RAI \qquad (7)$$

Substitute (4), then decompose the settlement index a second time, $I_{Settle}=T_{Settle}S_{Settle}$:

$$CP = \frac{I_{Base}}{T_{Settle}S_{Settle}}\left(\sum_i C_i \frac{T_i}{I_{Base}} df_i\right) S_{Maturity} - RAI \qquad (8,9)$$

The $I_{Base}$ cancels and the trend ratio $T_i/T_{Settle}$ emerges:

$$CP = \left(\sum_i C_i \frac{T_i}{T_{Settle}} df_i\right)\frac{S_{Maturity}}{S_{Settle}} - RAI \qquad (10)$$

Define the **seasonally adjusted clean price** as the trend-only bracket minus RAI:

$$SACP \equiv \sum_i C_i \frac{T_i}{T_{Settle}} df_i - RAI \qquad (11)$$

Combining (10) and (11):

$$CP = (SACP + RAI)\frac{S_{Maturity}}{S_{Settle}} - RAI \qquad (12)$$

Solving for SACP gives the **exact relationship**:

$$\boxed{\,SACP = CP\,\frac{S_{Settle}}{S_{Maturity}} + RAI\left(\frac{S_{Settle}}{S_{Maturity}} - 1\right)\,} \qquad (13)$$

---

## 4. The working approximation (Eq 14) — what the apps use

When RAI is small relative to CP (TIPS coupons are low, typically ≤ 5%, paid semiannually) **and** $\left(\frac{S_{Maturity}}{S_{Settle}}-1\right)\approx 0$, the RAI term drops:

$$\boxed{\,SACP \approx CP\,\frac{S_{Settle}}{S_{Maturity}}\,} \qquad (14)$$

**This is the key result of the paper** and the transform implemented in `src/app.js` (`price × (saSettle / saMature)` → `yieldFromPrice`). The seasonally adjusted real yield is then just the ordinary YTM computed from SACP; seasonally adjusted BEI = nominal yield − SA real yield.

> **Anniversary identity (the crux for intuition).** When the maturity date is a whole number of years after settlement, settlement and maturity fall on the **same calendar month/day**, so $S_{Settle}=S_{Maturity}$, the ratio is **1.0, and SACP = CP — no adjustment at all.** The entire seasonal adjustment is therefore a function of the **stub**: the fractional-year offset between the settlement month/day and the maturity month/day. Over each whole year the seasonal pattern repeats and cancels; only the leftover partial year carries a net seasonal slope. Sliding the settlement date around the calendar sweeps this stub from 0 to a full year and traces the seasonal curve itself.

### What the ratio *means* economically
A TIPS's nominal inflation accrual from settlement to maturity is $\frac{I_{Mat}}{I_{Settle}} = \frac{T_{Mat}}{T_{Settle}}\cdot\frac{S_{Mat}}{S_{Settle}}$. The trend ratio is the "real" expected inflation; the seasonal ratio $\frac{S_{Mat}}{S_{Settle}}$ is a **predictable, calendar-driven** bump on top of it. So:

- **$S_{Mat} > S_{Settle}$** (buy in a low-factor month, mature in a high-factor month): you capture an extra slug of *seasonally guaranteed* nominal inflation. The market prices the bond **up** (lower quoted real yield). Eq 14 multiplies price by $\frac{S_{Settle}}{S_{Mat}}<1$ to **strip that gift out**.
- **$S_{Mat} < S_{Settle}$** (buy high, mature low): you forgo seasonal inflation; the market prices it **down** (higher quoted yield). Eq 14 multiplies by $\frac{S_{Settle}}{S_{Mat}}>1$ to **compensate**.

Thus the seasonal adjustment is fundamentally a correction to **expected nominal return** — it levels out the portion of return that is *seasonally predictable* so bonds maturing in different months compare on equal footing. (This framing is developed further in [2.0](2.0_SAO_Adjustment.md) §"Caveat" and [2.2](2.2_SAO_Residual_Analysis.md) §5.1, which note that other, *non*-seasonally-predictable factors may also move nominal return but cannot be modelled.)

### Why it works (empirical evidence in the paper)
- **Fig 3** (BTPS 1.65% 2008): the SA breakeven series is far less volatile and the April-2007 seasonal peak is largely removed.
- **Fig 4** (eurozone HICPx curve, Apr-2007): the raw BEI curve is wildly inverted at the short end; SA BEI is smooth and gently upward-sloping. A bond maturing in April barely moves under adjustment — because its maturity (April) is ~a whole number of years from the April settlement (the anniversary identity).
- **Fig 5** (UKTI 2.5% 2009, 8-month-lag gilt): seasonal adjustment explains most of the discontinuous "jump" in quoted yield at each new RPI release.

Uses Canty lists: historical BEI/real-yield analysis; plotting a BEI term structure across mixed maturity months; **relative-value** decisions (buy the July vs the September bond; 5y vs 10y); and **pricing new issues** in a maturity month with no comparable bond.

---

## 5. Semiannual coupons (Eq 15–19) — TIPS, BTPs, UK linkers

With semiannual coupons the cashflows fall in **two** calendar months, so there are two seasonal factors $S_1, S_2$ (the maturity month and the month six months away). The dirty price splits:

$$DP = \sum_{i\,\text{odd}} C_i \frac{T_i S_1}{I_{Base}} df_i + \sum_{i\,\text{even}} C_i \frac{T_i S_2}{I_{Base}} df_i \qquad (15)$$

Lacking the full discount curve for a single bond, approximate each seasonally-adjusted real discount factor by the bond's own real yield $RY$:

$$\frac{T_i}{I_{Base}} df_i \approx \frac{1}{(1+RY)^{t_i}} \qquad (16)$$

The SACP becomes a **real-discount-weighted blend** of the two factors:

$$SACP \approx CP\left(\frac{w_1\frac{S_{Settle}}{S_1} + w_2\frac{S_{Settle}}{S_2}}{w_1 + w_2}\right) \qquad (17)$$

$$w_1 = \sum_{i\,\text{odd}} \frac{C_i}{(1+RY)^{t_i}}, \qquad w_2 = \sum_{i\,\text{even}} \frac{C_i}{(1+RY)^{t_i}} \qquad (18,19)$$

> **App note.** The apps deliberately use the **single-factor Eq 14**, not Eq 17. Spec [2.2 §3.3](2.2_SAO_Residual_Analysis.md) tested Eq 17 against the live curve: it moves the worst outlier (2027-04) by **0.0 bp** and corrects at most **+1.1 bp** anywhere, only on high-coupon bonds — because the second-factor weight rides on the small *coupon* stream while the residual rides on the *principal*, which both formulas place in the maturity month identically. Eq 14 is therefore the right simplification.

---

## 6. The indexation lag and interpolation (Appendix A)

Most ILB markets index off a **3-month-lagged, daily-interpolated** CPI. For a settlement on day $d_1$ of a month with $d_2$ days:

$$I_{Interp} = I_1 + w\,(I_2 - I_1), \qquad w = 1 - \frac{d_1 - 1}{d_2}$$

where $I_1$ is the index three months prior to the settlement month and $I_2$ two months prior. (This is the 31 CFR App. B rule used throughout the project, defined once in `shared/src/ref-cpi.js`.) Canty notes the decomposition $I_{Interp}\approx T_{Interp}S_{Interp}$ is adequate because the cross-terms are negligible.

The forward index for a base date $t$ and forward date $T$:

$$I_T = I_t\,\frac{S_T}{S_t}\,\exp\!\big(r_{t,T}(T-t)\big)$$

with $r_{t,T}$ the continuously-compounded **trend** growth rate.

---

## 7. Seasonally adjusted forward prices (carry)

The lag means part of an ILB's inflation protection is **already-known history**, not a forward expectation. Between $t_{Settle-lag}$ and $t_{Settle}$ there have been one or two CPI releases, so some of the indexation is certain. To isolate the *market's forward expectation*, Canty computes the **forward price out to the furthest settlement date whose 3-month lag still references the latest known CPI release** (e.g. with the April CPI published mid-May, the furthest "known" forward settle is ~July 1; beyond that you'd need the unpublished May value). Apply the same seasonal adjustment as before, but using the **forward** nominal yield to that settlement date for the BEI. This strips the **carry** component out of breakeven comparisons.

---

## 8. Fully Adjusted Clean Price (FACP) & outliers (Eq 20–21)

To additionally remove a *known, non-recurring* shock, include the outlier index $O_t$ from (20). Example: an expected UK rate hike feeding the RPI mortgage component → $\{O_t\}=\{1.000,1.000,1.002,1.002,1.002\}$.

$$\boxed{\,FACP = CP\,\frac{S_{Settle}}{S_{Maturity}}\,\frac{1}{O_{Maturity}}\,} \qquad (21)$$

This is needed when significant non-seasonal items hit the short end — e.g. **TIPS gasoline volatility** since the last CPI release.

> **App note — "SAO" ≠ FACP.** This project's **SAO** step is *inspired by* Canty's outlier analysis but is **not** an implementation of $O_t$. Canty determines $O_t$ **analytically, per known event**; we cannot identify specific outlier events, so we instead **smooth the SA curve** with a Nelson-Siegel-Svensson fit and treat off-curve deviations as relative-value noise for a buy-and-hold holder. See [2.0](2.0_SAO_Adjustment.md) and [2.2](2.2_SAO_Residual_Analysis.md). **Do not conflate SAO with Canty's $O_t$.**

---

## Appendix B — Canty's illustrative seasonal factors

These are the paper's **example** factors (Table B), *not* the live US series. The real US CPI-NSA/SA factor used by the apps troughs in **late winter/early spring (Feb–Apr, ~0.994)** and peaks in **late summer/early autumn (Aug–Oct, ~1.0035)** — so US **April-maturity** TIPS sit near the seasonal trough and **October-maturity** near the peak (consistent with the residual signs in [2.2](2.2_SAO_Residual_Analysis.md)).

| Month | Multiplicative ($S$) | Additive (%) |
| :--- | :--- | :--- |
| January | 0.996 | −0.5 |
| February | 0.996 | 0.0 |
| March | 1.001 | 0.5 |
| April | 1.003 | 0.2 |
| May | 1.003 | 0.0 |
| June | 1.004 | 0.1 |
| July | 1.000 | −0.4 |
| August | 0.999 | −0.1 |
| September | 1.000 | 0.1 |
| October | 1.000 | 0.0 |
| November | 0.999 | −0.1 |
| December | 1.001 | 0.2 |

*Key assumption throughout: the 12 monthly factors repeat unchanged every year (seasonality is periodic, recurrent, constant over time).*

## References (from the paper)
- Belgrade & Benhamou (2004), *Impact of seasonality in inflation derivatives pricing* — CDC Ixis QRFI 08-04/2.
- D'Amico, Kim & Wei (2007), *Tips from Tips: the informational content of Treasury Inflation-Protected Security prices.*
- DeLurgio (1998), *Forecasting Principles and Applications*, McGraw-Hill.
