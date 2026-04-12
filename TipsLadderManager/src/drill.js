// drill.js -- Drill-down popup HTML builder (6.0_UI_Schema.md)
// Exports: buildDrillHTML(d, colKey, summary)

function fm(n)  { return '$' + Math.round(n).toLocaleString('en-US'); }
function fm2(n) { return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fd(n, dp) { return Number(n).toFixed(dp); }

function row(label, formula, value, isTotal, drillKey, rowId) {
  const ts = isTotal ? 'font-weight:700;border-top:2px solid #1e293b;padding-top:6px;' : '';
  const dk = drillKey ? ' class="drill-l3" data-l3="' + drillKey + '" style="cursor:pointer;"' : '';
  const rid = rowId ? ' data-row-id="' + rowId + '"' : '';
  const lblStyle = drillKey ? 'text-decoration:underline dotted #94a3b8;' : '';
  const f  = formula
    ? '<td style="padding:3px 14px;color:#64748b;font-size:11px;' + ts + '">' + formula + '</td>'
    : '<td style="padding:3px 14px;' + ts + '"></td>';
  return '<tr' + dk + '>'
    + '<td' + rid + ' style="padding:3px 16px 3px 0;white-space:nowrap;' + ts + lblStyle + '">' + label + '</td>'
    + f
    + '<td style="padding:3px 0 3px 14px;text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;' + ts + '">' + value + '</td>'
    + '</tr>';
}

function sep() { return '<tr><td colspan="3" style="padding:4px 0;border-bottom:1px dashed #e2e8f0"></td></tr>'; }

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function bondVarRows(d, nPeriods, principalPerBond, couponPct) {
  const matDate = new Date(d.maturityStr);
  const matMonthName = MONTHS[matDate.getMonth()];
  let nPerLbl;
  if (nPeriods === 1) {
    nPerLbl = '1 semi-annual (' + matMonthName + ')';
  } else {
    const firstMonthName = MONTHS[(matDate.getMonth() - 6 + 12) % 12];
    nPerLbl = '2 (' + firstMonthName + ' + ' + matMonthName + ')';
  }
  return row('Ref CPI', '', fd(d.refCPI, 5), false, 'refCPI', 'refcpi')
    + row('Dated Ref CPI', '', fd(d.baseCpi, 5), false, undefined, 'basecpi')
    + row('Index ratio', '<span class="formula-var" data-source="refcpi">Ref CPI</span> \xf7 <span class="formula-var" data-source="basecpi">Dated Ref CPI</span>', fd(d.indexRatio, 5), false, 'indexRatio', 'ir')
    + row('Par Value per TIPS', '1,000 \xd7 <span class="formula-var" data-source="ir">index ratio</span>', fd(principalPerBond, 2), false, undefined, 'ppb')
    + row('Coupon per period', 'annual coupon \xf7 2', couponPct, false, undefined, 'cpp')
    + row('Yield', '', fd(d.yield * 100, 3) + '%')
    + row('Coupon periods in FY', '', nPerLbl, false, undefined, 'cp');
}

function future30yBreakdownRows(future30yParams) {
  if (!future30yParams?.breakdown) return '';
  let rows = '';
  future30yParams.breakdown.forEach((g, i) => {
    const id = 'fut' + i;
    const fmla = 'round((DARA \u2212 <span class="formula-var" data-source="' + id + 'lmi">LMI</span>) \u00f7 <span class="formula-var" data-source="' + id + 'pi">P+I</span>)';
    rows += row(g.year + ' quantity', fmla, g.qty, false, undefined, id + 'qty')
          + row('\u21b3 P+I per hypothetical TIPS', '', fm2(g.piPerBond), false, undefined, id + 'pi')
          + row('\u21b3 Later mat int (LMI)', 'Coupon interest from longer hypothetical TIPS rungs', fm(g.laterMatInt), false, undefined, id + 'lmi')
          + row('\u21b3 Theoretical cost', '<span class="formula-var" data-source="' + id + 'qty">Quantity</span> \xd7 $1,000', fm(g.qty * 1000));
  });
  return rows;
}

function gapBreakdownRows(gapParams, dara) {
  if (!gapParams?.breakdown) return '';
  let rows = '';
  gapParams.breakdown.forEach((g, i) => {
    const id = 'gap' + i;
    const fmla = 'round((DARA \u2212 <span class="formula-var" data-source="' + id + 'lmi">LMI</span>) \u00f7 <span class="formula-var" data-source="' + id + 'pi">P+I</span>)';
    rows += row(g.year + ' quantity', fmla, g.qty, false, undefined, id + 'qty')
          + row('\u21b3 P+I per synthetic TIPS', '', fm2(g.piPerBond), false, undefined, id + 'pi')
          + row('\u21b3 Later mat int', 'Total coupon interest from Future 30Y TIPS rungs', fm(g.laterMatInt), false, undefined, id + 'lmi')
          + row('\u21b3 Theoretical cost', '<span class="formula-var" data-source="' + id + 'qty">Quantity</span> \xd7 $1,000', fm(g.qty * 1000));
  });
  return rows;
}

export function buildDrillHTML(d, colKey, summary) {
  const nPeriods         = d.nPeriods != null ? d.nPeriods : (d.halfOrFull === 0.5 ? 1 : 2);
  const principalPerBond = d.principalPerBond != null ? d.principalPerBond : 1000 * d.indexRatio;
  const couponPct        = fd(d.coupon / 2 * 100, 5) + '%';
  const couponLabel      = nPeriods === 1 ? 'Last coupon (1 period)' : 'Last 2 coupons (2 periods)';

  let rows = '';

  // ── Build: Amount ─────────────────────────────────────────────────────────────
  if (colKey === 'amount') {
    const _plCredit  = d.preLadderCreditForYear || 0;
    const sameYearExInt = d.excessLMI_After || 0;
    const longerDatedInt = d.longerDatedLMI ?? d.fundedYearLaterMatInt; // use separated if available, else combined legacy
    
    let totalFmla = 'Principal + Coupons + <span class="formula-var" data-source="lmi">Longer-dated int</span>';
    if (sameYearExInt > 0) totalFmla += ' + <span class="formula-var" data-source="exlmi">Same-year excess int</span>';
    if (_plCredit > 0) totalFmla += ' + Pre-ladder credit';

    rows =
      row('Quantity', '', d.fundedYearQty, false, undefined, 'qty') +
      sep() +
      bondVarRows(d, nPeriods, principalPerBond, couponPct) +
      sep() +
      row('Principal', '<span class="formula-var" data-source="ppb">Par Value/TIPS</span> \xd7 <span class="formula-var" data-source="qty">Quantity</span>', fm(d.fundedYearPrincipalTotal)) +
      row(couponLabel, '<span class="formula-var" data-source="ppb">Par Value/TIPS</span> \xd7 <span class="formula-var" data-source="cpp">coupon/period</span> \xd7 <span class="formula-var" data-source="cp">periods</span> \xd7 <span class="formula-var" data-source="qty">Quantity</span>', fm(d.fundedYearOwnRungInt)) +
      row('Interest from longer-dated TIPS', 'from TIPS maturing after ' + d.fundedYear, fm(longerDatedInt), false, undefined, 'lmi') +
      (sameYearExInt > 0 ? row('Interest from same-year excess (bracket)', 'from excess TIPS maturing in ' + d.fundedYear, fm(sameYearExInt), false, undefined, 'exlmi') : '') +
      (_plCredit > 0 ? row('Pre-ladder credit', 'pre-ladder pool applied to this year', fm(_plCredit)) : '') +
      sep() +
      row('Funded Year Amount', totalFmla, fm(d.fundedYearAmt), true) +
      sep() +
      row('DARA', '', fm(d.dara), false, undefined, 'dara') +
      row('Surplus / Deficit', '<span class="formula-var" data-source="total">FY Amount</span> \u2212 <span class="formula-var" data-source="dara">DARA</span>', (d.fundedYearAmt - d.dara >= 0 ? '+' : '') + Math.round(d.fundedYearAmt - d.dara).toLocaleString('en-US'));

  // ── Build: Cost ───────────────────────────────────────────────────────────────
  } else if (colKey === 'cost') {
    rows =
      row('Quantity', '', d.fundedYearQty, false, undefined, 'qty') +
      sep() +
      row('Price (unadjusted)', '', fd(d.price, 4), false, undefined, 'price') +
      row('Ref CPI (settlement date)', '', fd(d.refCPI, 5), false, 'refCPI', 'refcpi') +
      row('Dated Ref CPI', '', fd(d.baseCpi, 5), false, undefined, 'basecpi') +
      row('Index ratio', '<span class="formula-var" data-source="refcpi">Ref CPI</span> \xf7 <span class="formula-var" data-source="basecpi">Dated Ref CPI</span>', fd(d.indexRatio, 5), false, 'indexRatio', 'ir') +
      row('Cost per TIPS', '<span class="formula-var" data-source="price">price/100</span> \xd7 <span class="formula-var" data-source="ir">index ratio</span> \xd7 1,000', fm2(d.costPerBond), false, undefined, 'cpb') +
      sep() +
      row('Funded Year Cost', '<span class="formula-var" data-source="cpb">Cost per TIPS</span> \xd7 <span class="formula-var" data-source="qty">Quantity</span>', fm(d.fundedYearCost), true);

  // ── Build: Gap Amount / Gap Cost ──────────────────────────────────────────────
  } else if (colKey === 'gapAmount' || colKey === 'gapCost') {
    const s = summary;
    const isAmt = colKey === 'gapAmount';
    if (s) {
      const isLower = d.fundedYear === s.lowerYear;
      const weight  = isLower ? s.lowerWeight  : s.upperWeight;
      const wLabel  = isLower ? 'Lower weight' : 'Upper weight';
      const exCost  = s.gapParams.totalCost * weight;
      rows = row('Bracket weights', 'see Duration Calcs \u2197', fd(weight, 4))
        + sep()
        + gapBreakdownRows(s.gapParams, s.DARA)
        + row('Gap total cost', 'Sum of gap year theoretical costs', fm(s.gapParams.totalCost), true, undefined, 'gtc')
        + row('Target excess cost', '<span class="formula-var" data-source="gtc">total cost</span> \xd7 ' + wLabel.toLowerCase(), fm(exCost), false, undefined, 'tec')
        + sep()
        + row('Cost per TIPS', '<span class="formula-var" data-source="price">price/100</span> \xd7 <span class="formula-var" data-source="ir">index ratio</span> \xd7 1,000', fm2(d.costPerBond), false, undefined, 'cpb')
        + row('Excess Quantity', 'round(<span class="formula-var" data-source="tec">target cost</span> \xf7 <span class="formula-var" data-source="cpb">Cost per TIPS</span>)', d.excessQty);
      if (isAmt) {
        rows += sep()
          + bondVarRows(d, nPeriods, principalPerBond, couponPct)
          + sep()
          + row('P+I per TIPS', '<span class="formula-var" data-source="ppb">Par Value/TIPS</span> \xd7 (1 + <span class="formula-var" data-source="cpp">coupon/period</span> \xd7 <span class="formula-var" data-source="cp">periods</span>)', fm2(d.fundedYearPi), false, undefined, 'pipb')
          + sep()
          + row('Gap Amount', '<span class="formula-var" data-source="pipb">P+I/TIPS</span> \xd7 <span class="formula-var" data-source="qty">Excess Quantity</span>', fm(d.excessAmt), true);
      } else {
        rows += row('Gap Cost', '<span class="formula-var" data-source="cpb">Cost per TIPS</span> \xd7 <span class="formula-var" data-source="qty">Excess Quantity</span>', fm(d.excessCost), true);
      }
    }

  // ── Build: Future 30Y Amount / Future 30Y Cost ────────────────────────────────
  } else if (colKey === 'future30yAmt' || colKey === 'future30yCost') {
    const s = summary;
    const isAmt = colKey === 'future30yAmt';
    if (s) {
      const isLower = d.fundedYear === s.future30yLowerYear;
      const weight  = isLower ? s.future30yLowerWeight : s.future30yUpperWeight;
      const wLabel  = isLower ? 'Lower weight' : 'Upper weight';
      const exCost  = (s.future30yParams?.future30yTotalCost ?? 0) * weight;
      rows = row('Cover weights', 'see Future 30Y Duration Calcs \u2197', fd(weight, 4))
        + sep()
        + future30yBreakdownRows(s.future30yParams)
        + row('Future 30Y total cost', 'Sum of hypothetical Future 30Y year costs', fm(s.future30yParams?.future30yTotalCost ?? 0), true, undefined, 'ftc')
        + row('Target excess cost', '<span class="formula-var" data-source="ftc">total cost</span> \xd7 ' + wLabel.toLowerCase(), fm(exCost), false, undefined, 'tec')
        + sep()
        + row('Cost per TIPS', '<span class="formula-var" data-source="price">price/100</span> \xd7 <span class="formula-var" data-source="ir">index ratio</span> \xd7 1,000', fm2(d.costPerBond), false, undefined, 'cpb')
        + row('Excess Quantity', 'round(<span class="formula-var" data-source="tec">target cost</span> \xf7 <span class="formula-var" data-source="cpb">Cost per TIPS</span>)', d.excessQty);
      if (isAmt) {
        rows += sep()
          + bondVarRows(d, nPeriods, principalPerBond, couponPct)
          + sep()
          + row('P+I per TIPS', '<span class="formula-var" data-source="ppb">Par Value/TIPS</span> \xd7 (1 + <span class="formula-var" data-source="cpp">coupon/period</span> \xd7 <span class="formula-var" data-source="cp">periods</span>)', fm2(d.fundedYearPi), false, undefined, 'pipb')
          + sep()
          + row('Future 30Y Cover Amount', '<span class="formula-var" data-source="pipb">P+I/TIPS</span> \xd7 <span class="formula-var" data-source="qty">Excess Quantity</span>', fm(d.excessAmt), true);
      } else {
        rows += sep()
          + row('Future 30Y Cover Cost', '<span class="formula-var" data-source="cpb">Cost per TIPS</span> \xd7 <span class="formula-var" data-source="qty">Excess Quantity</span>', fm(d.excessCost), true);
      }
    }

  } else if (colKey === 'amtBefore' || colKey === 'amtAfter') {
    const isBef       = colKey === 'amtBefore';
    const holdings    = (isBef ? d.araBeforeHoldings : d.araAfterHoldings) ?? [];
    const laterMatInt = isBef ? d.araBeforeLaterMatInt : d.araAfterLaterMatInt;
    const araTotal    = isBef ? d.araBeforeTotal       : d.araAfterTotal;
    const DARA        = d.DARA ?? summary?.DARA;
    let ownSum = 0;
    holdings.forEach((h, i) => {
      const piPB = h.principalPerBond * (1 + h.coupon / 2 * h.nPeriods);
      const hTotal = piPB * h.qty;
      ownSum += hTotal;
      const mo = MONTHS[h.maturityMonth];
      const yr = String(h.maturityYear).slice(2);
      rows += row(mo + ' \u2019' + yr + ' \xd7 ' + h.qty, '<span class="drill-l3" data-l3="pipb-' + i + '" style="cursor:pointer;text-decoration:underline dotted #94a3b8;">' + fm2(piPB) + '/TIPS</span>', fm(hTotal));
    });
    rows += sep()
      + row('Funded year TIPS subtotal', '', fm(ownSum))
      + row('Interest from longer-dated TIPS', 'from TIPS maturing after ' + d.fundedYear, fm(laterMatInt), false, undefined, 'lmi');
    const excessLMI = isBef ? d.excessLMI_Before : d.excessLMI_After;
    if (excessLMI > 0) {
    rows += row('Interest from same-year excess (bracket)', 'from additional ' + d.fundedYear + ' TIPS held to cover Future 30Y rungs', fm(excessLMI), false, undefined, 'exlmi');
    }
    const totalFmla = excessLMI > 0
      ? 'Funded year TIPS + <span class="formula-var" data-source="lmi">Longer-dated int</span> + <span class="formula-var" data-source="exlmi">Same-year excess int</span>'
      : 'Funded year TIPS + <span class="formula-var" data-source="lmi">Longer-dated int</span>';
    rows += sep()
      + row(isBef ? 'Amount Before' : 'Amount After', totalFmla, fm(araTotal), true)
      + sep()
      + row('DARA', '', fm(DARA), false, undefined, 'dara')
      + row('Surplus / Deficit', (isBef ? 'Amount Before' : 'Amount After') + ' \u2212 <span class="formula-var" data-source="dara">DARA</span>',
            (araTotal - DARA >= 0 ? '+' : '') + Math.round(araTotal - DARA).toLocaleString('en-US'));

  // ── Rebalance: Qty Before / After ─────────────────────────────────────────────
  } else if (colKey === 'qtyAfter' || colKey === 'qtyBefore' || colKey === 'qty') {
    const isBef = colKey === 'qtyBefore';
    const totalQty = isBef ? d.qtyBefore : (d.qtyAfter ?? d.qty);
    const fyQty    = isBef ? d.fundedYearQtyBefore : (d.fundedYearQtyAfter ?? d.fundedYearQty);
    const exQty    = isBef ? d.excessQtyBefore : (d.excessQtyAfter ?? d.excessQty);

    rows = row('Funded year portion', 'Units needed for this year\'s DARA target', fyQty)
         + row('Excess portion', d.isBracketTarget ? 'Units held for gap duration matching' : 'No excess held', exQty);

    if (d.isBracketTarget && !isBef) {
      const is3B = summary.bracketMode === '3bracket';
      const weight = is3B
        ? (d.fundedYear === summary.lowerYear ? summary.origLowerWeight : (d.fundedYear === summary.newLowerYear ? summary.newLowerWeight3 : summary.upperWeight3))
        : (d.fundedYear === summary.lowerYear ? summary.lowerWeight : summary.upperWeight);
      const targetExCost = (summary.gapParams?.totalCost ?? 0) * (weight ?? 0);
      const piPerBond = principalPerBond * (1 + d.coupon / 2 * nPeriods);

      rows += sep()
        + gapBreakdownRows(summary.gapParams, summary.DARA)
        + row('Gap total cost', 'Sum of gap year theoretical costs', fm(summary.gapParams?.totalCost ?? 0), true, undefined, 'gtc')
        + row('Bracket weight', 'from <a class="info-link" data-popup="duration" style="border-bottom:1px dotted #94a3b8;color:inherit;text-decoration:none;">Duration Calcs</a>', (weight ?? 0).toFixed(4), false, undefined, 'bw')
        + row('Target excess cost', '<span class="formula-var" data-source="gtc">Gap total cost</span> \xd7 <span class="formula-var" data-source="bw">Bracket weight</span>', fm(targetExCost), false, undefined, 'tec')
        + row('Cost per TIPS', 'price/100 \xd7 index ratio \xd7 1,000', fm2(d.costPerBond), false, undefined, 'cpbn')
        + row('Excess portion', 'round(<span class="formula-var" data-source="tec">Target cost</span> \u00f7 <span class="formula-var" data-source="cpbn">Cost per TIPS</span>)', exQty, true)
        + sep()
        + bondVarRows(d, nPeriods, principalPerBond, couponPct)
        + sep()
        + row('P+I per TIPS', '<span class="formula-var" data-source="ppb">Par Value/TIPS</span> \xd7 (1 + <span class="formula-var" data-source="cpp">coupon/period</span> \xd7 <span class="formula-var" data-source="cp">periods</span>)', fm2(piPerBond), false, undefined, 'pipb')
        + row('Excess Amount After', '<span class="formula-var" data-source="qty">Excess Quantity</span> \xd7 <span class="formula-var" data-source="pipb">P+I per TIPS</span>', fm(exQty * piPerBond), true);
    }

    rows += sep()
      + row(isBef ? 'Quantity Before' : 'Quantity After', 'Funded year portion + Excess portion', totalQty, true);

  // ── Rebalance: Cash Delta ─────────────────────────────────────────────────────
  } else if (colKey === 'cashDelta') {
    const qtyDelta  = d.qtyAfter - d.qtyBefore;
    const cashDelta = -(qtyDelta * d.costPerBond);
    const qdSign    = qtyDelta >= 0 ? '+' : '';
    const cdSign    = cashDelta >= 0 ? '+' : '';
    rows =
      row('Quantity delta', 'Quantity After \u2212 Quantity Before', qdSign + qtyDelta, false, undefined, 'qty') +
      sep() +
      row('Price (unadjusted)', '', fd(d.price, 4), false, undefined, 'price') +
      row('Ref CPI (settlement date)', '', fd(d.refCPI, 5), false, 'refCPI', 'refcpi') +
      row('Dated Ref CPI', '', fd(d.baseCpi, 5), false, undefined, 'basecpi') +
      row('Index ratio', '<span class="formula-var" data-source="refcpi">Ref CPI</span> \xf7 <span class="formula-var" data-source="basecpi">Dated Ref CPI</span>', fd(d.indexRatio, 5), false, 'indexRatio', 'ir') +
      row('Cost per TIPS', '<span class="formula-var" data-source="price">price/100</span> \xd7 <span class="formula-var" data-source="ir">index ratio</span> \xd7 1,000', fm2(d.costPerBond), false, undefined, 'cpb') +
      sep() +
      row('Cash \u0394', '\u2212(<span class="formula-var" data-source="qty">Quantity delta</span> \xd7 <span class="formula-var" data-source="cpb">Cost per TIPS</span>)', cdSign + fm(Math.abs(cashDelta)), true);

  // ── Rebalance: Cost Before / After ────────────────────────────────────────────
  } else if (colKey === 'costBefore' || colKey === 'costAfter') {
    const isBef    = colKey === 'costBefore';
    const isBT     = d.isBracketTarget;
    const qty      = isBef ? (isBT ? d.fundedYearQtyBefore : d.qtyBefore) : d.fundedYearQtyAfter;
    const qtyLabel = isBef ? (isBT ? 'FY quantity (before)' : 'Quantity Before') : 'Quantity After';
    const cost     = qty * d.costPerBond;
    rows =
      row(qtyLabel, isBT ? 'FY-only (excluding gap excess)' : '', qty, false, undefined, 'qty') +
      sep() +
      row('Price (unadjusted)', '', fd(d.price, 4), false, undefined, 'price') +
      row('Ref CPI (settlement date)', '', fd(d.refCPI, 5), false, 'refCPI', 'refcpi') +
      row('Dated Ref CPI', '', fd(d.baseCpi, 5), false, undefined, 'basecpi') +
      row('Index ratio', '<span class="formula-var" data-source="refcpi">Ref CPI</span> \xf7 <span class="formula-var" data-source="basecpi">Dated Ref CPI</span>', fd(d.indexRatio, 5), false, 'indexRatio', 'ir') +
      row('Cost per TIPS', '<span class="formula-var" data-source="price">price/100</span> \xd7 <span class="formula-var" data-source="ir">index ratio</span> \xd7 1,000', fm2(d.costPerBond), false, undefined, 'cpb') +
      sep() +
      row(isBef ? 'Cost Before' : 'Cost After', '<span class="formula-var" data-source="qty">Quantity</span> \xd7 <span class="formula-var" data-source="cpb">Cost per TIPS</span>', fm(cost), true);

  // ── Rebalance: Gap Amt/Cost Before/After ──────────────────────────────────────
  } else if (colKey === 'gapAmtBefore' || colKey === 'gapAmtAfter' || colKey === 'gapCostBefore' || colKey === 'gapCostAfter') {
    const s       = summary;
    const isAfter = colKey === 'gapAmtAfter' || colKey === 'gapCostAfter';
    const isAmt   = colKey === 'gapAmtBefore' || colKey === 'gapAmtAfter';
    const piPerBond = principalPerBond * (1 + d.coupon / 2 * nPeriods);
    if (!isAfter) {
      const exQty = d.excessQtyBefore;
      rows = row('Excess Quantity', 'Current total \u2212 FY target', exQty, false, undefined, 'qty')
        + sep()
        + bondVarRows(d, nPeriods, principalPerBond, couponPct) + sep();
      if (isAmt) {
        rows += row('P+I per TIPS', '<span class="formula-var" data-source="ppb">Par Value/TIPS</span> \xd7 (1 + <span class="formula-var" data-source="cpp">coupon/period</span> \xd7 <span class="formula-var" data-source="cp">periods</span>)', fm2(piPerBond), false, undefined, 'pipb')
          + sep()
          + row('Excess Amount Before', '<span class="formula-var" data-source="pipb">P+I per TIPS</span> \xd7 <span class="formula-var" data-source="qty">Excess Quantity</span>', fm(exQty * piPerBond), true);
      } else {
        rows += row('Cost per TIPS', '<span class="formula-var" data-source="price">price/100</span> \xd7 <span class="formula-var" data-source="ir">index ratio</span> \xd7 1,000', fm2(d.costPerBond), false, undefined, 'cpb')
          + sep()
          + row('Excess Cost Before', '<span class="formula-var" data-source="cpb">Cost per TIPS</span> \xd7 <span class="formula-var" data-source="qty">Excess Quantity</span>', fm(exQty * d.costPerBond), true);
      }
    } else if (s && s.brackets) {
      const isLower = d.cusip === s.brackets.lowerCUSIP;
      const isNewLower = s.bracketMode === '3bracket' && d.cusip === s.newLowerCUSIP;
      const weight  = isLower ? (s.origLowerWeight ?? s.lowerWeight)
                   : isNewLower ? (s.newLowerWeight3 ?? 0)
                   : s.upperWeight;
      const wLabel  = isLower ? 'Orig lower weight' : isNewLower ? 'New lower weight' : 'Upper weight';
      const exCost  = s.gapParams.totalCost * weight;
      const exQty   = d.excessQtyAfter;
      rows = row('Excess Quantity', 'round(target cost \xf7 <span class="formula-var" data-source="cpb">Cost per TIPS</span>)', exQty, false, undefined, 'qty')
        + sep()
        + row('Bracket weights', 'see Duration Calcs \u2197', fd(weight, 4))
        + sep()
        + row('Gap year total cost', '', fm(s.gapParams.totalCost), false, undefined, 'total')
        + row('Target excess cost', '<span class="formula-var" data-source="total">total cost</span> \xd7 ' + wLabel.toLowerCase(), fm(exCost))
        + sep()
        + row('Cost per TIPS', '<span class="formula-var" data-source="price">price/100</span> \xd7 <span class="formula-var" data-source="ir">index ratio</span> \xd7 1,000', fm2(d.costPerBond), false, undefined, 'cpb')
        + sep();
      if (isAmt) {
        rows += bondVarRows(d, nPeriods, principalPerBond, couponPct) + sep()
          + row('P+I per TIPS', '<span class="formula-var" data-source="ppb">Par Value/TIPS</span> \xd7 (1 + <span class="formula-var" data-source="cpp">coupon/period</span> \xd7 <span class="formula-var" data-source="cp">periods</span>)', fm2(piPerBond), false, undefined, 'pipb')
          + sep()
          + row('Excess Amount After', '<span class="formula-var" data-source="pipb">P+I per TIPS</span> \xd7 <span class="formula-var" data-source="qty">Excess Quantity</span>', fm(exQty * piPerBond), true);
      } else {
        rows += row('Excess Cost After', '<span class="formula-var" data-source="cpb">Cost per TIPS</span> \xd7 <span class="formula-var" data-source="qty">Excess Quantity</span>', fm(exQty * d.costPerBond), true);
      }
    }
  // ── Rebalance: Future 30Y Amt/Cost Before/After ───────────────────────────────
  } else if (colKey === 'future30yAmtBefore' || colKey === 'future30yAmtAfter' || colKey === 'future30yCostBefore' || colKey === 'future30yCostAfter') {
    const s       = summary;
    const isAfter = colKey === 'future30yAmtAfter' || colKey === 'future30yCostAfter';
    const isAmt   = colKey === 'future30yAmtBefore' || colKey === 'future30yAmtAfter';
    const piPerBond = principalPerBond * (1 + d.coupon / 2 * nPeriods);
    if (!isAfter) {
      const exQty = d.excessQtyBefore;
      rows = row('Excess Quantity', 'Current total \u2212 FY target', exQty, false, undefined, 'qty')
        + sep()
        + bondVarRows(d, nPeriods, principalPerBond, couponPct) + sep();
      if (isAmt) {
        rows += row('P+I per TIPS', '<span class="formula-var" data-source="ppb">Par Value/TIPS</span> \xd7 (1 + <span class="formula-var" data-source="cpp">coupon/period</span> \xd7 <span class="formula-var" data-source="cp">periods</span>)', fm2(piPerBond), false, undefined, 'pipb')
          + sep()
          + row('Future 30Y Cover Amount Before', '<span class="formula-var" data-source="pipb">P+I per TIPS</span> \xd7 <span class="formula-var" data-source="qty">Excess Quantity</span>', fm(exQty * piPerBond), true);
      } else {
        rows += row('Cost per TIPS', '<span class="formula-var" data-source="price">price/100</span> \xd7 <span class="formula-var" data-source="ir">index ratio</span> \xd7 1,000', fm2(d.costPerBond), false, undefined, 'cpb')
          + sep()
          + row('Future 30Y Cover Cost Before', '<span class="formula-var" data-source="cpb">Cost per TIPS</span> \xd7 <span class="formula-var" data-source="qty">Excess Quantity</span>', fm(exQty * d.costPerBond), true);
      }
    } else if (s) {
      const isLower = d.cusip === s.future30yLowerCoverCUSIP;
      const weight  = isLower ? s.future30yLowerWeight : s.future30yUpperWeight;
      const wLabel  = isLower ? 'Lower weight' : 'Upper weight';
      const exCost  = (s.future30yParams?.future30yTotalCost ?? 0) * weight;
      const exQty   = d.excessQtyAfter;
      rows = row('Excess Quantity', 'round(target cost \xf7 <span class="formula-var" data-source="cpb">Cost per TIPS</span>)', exQty, false, undefined, 'qty')
        + sep()
        + row('Cost per TIPS', '<span class="formula-var" data-source="price">price/100</span> \xd7 <span class="formula-var" data-source="ir">index ratio</span> \xd7 1,000', fm2(d.costPerBond), false, undefined, 'cpb')
        + sep()
        + future30yBreakdownRows(s.future30yParams)
        + row('Future 30Y total cost', 'Sum of hypothetical Future 30Y year costs', fm(s.future30yParams?.future30yTotalCost ?? 0), true, undefined, 'ftc')
        + row('Target excess cost', '<span class="formula-var" data-source="ftc">total cost</span> \xd7 ' + wLabel.toLowerCase(), fm(exCost));
      if (isAmt) {
        rows += sep()
          + bondVarRows(d, nPeriods, principalPerBond, couponPct)
          + sep()
          + row('P+I per TIPS', '<span class="formula-var" data-source="ppb">Par Value/TIPS</span> \xd7 (1 + <span class="formula-var" data-source="cpp">coupon/period</span> \xd7 <span class="formula-var" data-source="cp">periods</span>)', fm2(piPerBond), false, undefined, 'pipb')
          + sep()
          + row('Future 30Y Cover Amount After', '<span class="formula-var" data-source="pipb">P+I per TIPS</span> \xd7 <span class="formula-var" data-source="qty">Excess Quantity</span>', fm(exQty * piPerBond), true);
      } else {
        rows += sep()
          + row('Future 30Y Cover Cost After', '<span class="formula-var" data-source="cpb">Cost per TIPS</span> \xd7 <span class="formula-var" data-source="qty">Excess Quantity</span>', fm(exQty * d.costPerBond), true);
      }
    }

  // ── Rebalance: Gap Cash Delta ─────────────────────────────────────────────────
  } else if (colKey === 'gapCashDelta') {
    const exQtyBef  = d.excessQtyBefore;
    const exQtyAft  = d.excessQtyAfter;
    const exQtyDel  = exQtyAft - exQtyBef;
    const gapCash   = -(exQtyDel * d.costPerBond);
    const delSign   = exQtyDel >= 0 ? '+' : '';
    const cashSign  = gapCash  >= 0 ? '+' : '';
    rows =
      row('Excess Quantity before', 'Current total \u2212 FY target', exQtyBef) +
      row('Excess Quantity after',  'Rebalanced excess', exQtyAft) +
      row('Excess Quantity delta',  'After \u2212 before', delSign + exQtyDel, false, undefined, 'qty') +
      sep() +
      row('Price (unadjusted)', '', fd(d.price, 4), false, undefined, 'price') +
      row('Ref CPI (settlement date)', '', fd(d.refCPI, 5), false, 'refCPI', 'refcpi') +
      row('Dated Ref CPI', '', fd(d.baseCpi, 5), false, undefined, 'basecpi') +
      row('Index ratio', '<span class="formula-var" data-source="refcpi">Ref CPI</span> \xf7 <span class="formula-var" data-source="basecpi">Dated Ref CPI</span>', fd(d.indexRatio, 5), false, 'indexRatio', 'ir') +
      sep() +
      row('Cost per TIPS', '<span class="formula-var" data-source="price">price/100</span> \xd7 <span class="formula-var" data-source="ir">index ratio</span> \xd7 1,000', fm2(d.costPerBond), false, undefined, 'cpb') +
      sep() +
      row('Gap Cash \u0394', '\u2212(<span class="formula-var" data-source="qty">Excess Quantity delta</span> \xd7 <span class="formula-var" data-source="cpb">Cost per TIPS</span>)', cashSign + fm(Math.abs(gapCash)), true);

  }

  return '<table style="border-collapse:collapse;width:auto;font-size:12px">' + rows + '</table>';
}

export function buildPIPerBondDrill(h) {
  const ir = h.principalPerBond / 1000;
  const couponInterest = h.principalPerBond * h.coupon / 2 * h.nPeriods;
  const piPB = h.principalPerBond + couponInterest;
  const matMo = MONTHS[h.maturityMonth];
  const prevMo = MONTHS[(h.maturityMonth - 6 + 12) % 12];
  const periodLabel = h.nPeriods === 1 ? matMo + ' coupon' : prevMo + ' + ' + matMo + ' coupons';
  const couponNote = '$' + fd(h.principalPerBond, 2) + ' \u00d7 ' + fd(h.coupon / 2 * 100, 5) + '% \u00d7 ' + h.nPeriods + ' (' + periodLabel + ')';
  return [
    { label: 'Index ratio', note: 'Ref CPI \u00f7 Dated Ref CPI', value: fd(ir, 5) },
    { label: 'Par Value', note: '1,000 \u00d7 index ratio', value: '$' + fd(h.principalPerBond, 2) },
    { label: 'Coupon interest', note: couponNote, value: '$' + fd(couponInterest, 2) },
    { sep: true },
    { label: 'P+I per TIPS', value: '$' + fd(piPB, 2), total: true }
  ];
}

export function buildIndexRatioDrill(d) {
  return [
    { label: 'Settlement Ref CPI', value: fd(d.refCPI, 5) },
    { label: 'Dated Ref CPI', value: fd(d.baseCpi, 5) },
    { sep: true },
    { label: 'Index Ratio', note: 'Settlement Ref CPI / Dated Ref CPI', value: fd(d.indexRatio, 5), total: true },
    { sep: true },
    { label: 'Authority', note: '31 CFR § 356.30', value: '<a href="https://www.ecfr.gov/current/title-31/subtitle-B/chapter-II/subchapter-A/part-356/subpart-C/section-356.30" target="_blank" style="color:#1a56db;text-decoration:none">\u00a7 356.30 \u2197</a>' }
  ];
}

export function buildRefCpiDrill(d, complexity = 'quant', refCpiRows = null) {
  const date = new Date(d.settlementDate || d.settlementDateStr || new Date());
  const day = date.getDate();
  const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  const m3 = MONTHS[(date.getMonth() - 3 + 12) % 12];
  const m2 = MONTHS[(date.getMonth() - 2 + 12) % 12];
  const _pad = n => String(n).padStart(2, '0');
  const _m3Key = date.getFullYear() + '-' + _pad(date.getMonth() + 1) + '-01';
  const _m2Next = new Date(date.getFullYear(), date.getMonth() + 1, 1);
  const _m2Key = _m2Next.getFullYear() + '-' + _pad(_m2Next.getMonth() + 1) + '-01';
  const cpiM3Val = refCpiRows ? (refCpiRows.find(r => r.date === _m3Key)?.refCpi ?? null) : null;
  const cpiM2Val = refCpiRows ? (refCpiRows.find(r => r.date === _m2Key)?.refCpi ?? null) : null;

  const isQuant = complexity === 'quant';

  const rows = [
    { toggle: { options: [
        { label: 'ELI5', value: 'eli5', active: !isQuant },
        { label: 'Quant', value: 'quant', active: isQuant }
      ]}},
    { label: 'Settlement Date', value: (d.settlementDate || d.settlementDateStr || 'Current') },
  ];

  if (!isQuant) {
    rows.push(
      { sep: true },
      { heading: 'The Simple Version' },
      { label: 'Core Idea', note: 'Ref CPI is a daily "smooth" value between two monthly CPI-U readings.', value: '\ud83d\udcc8' },
      { label: 'Anchor 1', note: 'CPI-U from 3 months ago (' + m3 + ')', value: 'Start' },
      { label: 'Anchor 2', note: 'CPI-U from 2 months ago (' + m2 + ')', value: 'End' },
      { label: 'Progress', note: 'How far through the current month we are', value: Math.round((day - 1) / daysInMonth * 100) + '%' },
      { sep: true },
      { label: 'Ref CPI', note: 'Today\'s value, partway between anchors', value: fd(d.refCPI, 5), total: true }
    );
  } else {
    rows.push(
      { label: 'Day of month (d)', value: day },
      { label: 'Days in month (D)', value: daysInMonth },
      { sep: true },
      { heading: 'Interpolation Formula' },
      { label: 'Ref CPI', value: 'CPI(m-3) + (d-1)/D \u00d7 [CPI(m-2) - CPI(m-3)]', note: 'Per 31 CFR \u00a7 356 Appx B' },
      { sep: true },
      { label: 'm-3 CPI-U (NSA)', note: 'CPI-U for ' + m3, value: cpiM3Val != null ? fd(cpiM3Val, 3) : 'see BLS' },
      { label: 'm-2 CPI-U (NSA)', note: 'CPI-U for ' + m2, value: cpiM2Val != null ? fd(cpiM2Val, 3) : 'see BLS' },
      { sep: true },
      { label: 'Ref CPI', note: 'Interpolated daily value', value: fd(d.refCPI, 5), total: true }
    );
  }

  rows.push(
    { sep: true },
    { label: 'Authority', note: '31 CFR \u00a7 356 Appendix B', value: '<a href="https://www.ecfr.gov/current/title-31/subtitle-B/chapter-II/subchapter-A/part-356/appendix-Appendix%20B%20to%20Part%20356" target="_blank" style="color:#1a56db;text-decoration:none">Appx B \u2197</a>' }
  );

  return rows;
}

function renderDurationBeam(buckets, avgDur) {
  const durs = buckets.map(b => b.dur);
  const min = Math.floor(Math.min(...durs, avgDur)) - 1;
  const max = Math.ceil(Math.max(...durs, avgDur)) + 1;
  const range = max - min;
  const px = d => ((d - min) / range) * 100;

  const ap = px(avgDur);

  let bucketHtml = '';
  buckets.forEach(b => {
    const p = px(b.dur);
    const w = Math.round(b.weight * 100);
    bucketHtml += 
      '<div style="position:absolute;top:-24px;left:' + p + '%;transform:translateX(-50%);text-align:center;">'
        + '<div style="font-weight:700;color:#1a56db">' + w + '%</div>'
        + '<div style="font-size:9px;color:#64748b">' + b.label + '</div>'
        + '<div style="width:2px;height:24px;background:#3b82f6;margin:2px auto 0;opacity:0.4;"></div>'
      + '</div>';
  });

  return '<div style="margin:0 0 8px;padding:32px 10px 32px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;position:relative;user-select:none;">'
    + '<div style="height:4px;background:#cbd5e1;border-radius:2px;position:relative;margin:0 20px;">'
      + [min, max].map(v => '<div style="position:absolute;top:8px;left:' + px(v) + '%;transform:translateX(-50%);font-size:9px;color:#94a3b8">' + v + 'y</div>').join('')
      + '<div style="position:absolute;top:-2px;left:' + ap + '%;width:12px;height:12px;background:#1e293b;transform:translate(-50%, -50%) rotate(45deg);z-index:1;" title="Fulcrum: Avg Duration (' + avgDur.toFixed(2) + 'y)"></div>'
      + '<div style="position:absolute;top:12px;left:' + ap + '%;transform:translateX(-50%);text-align:center;white-space:nowrap;">'
        + '<div style="font-weight:700;color:#1e293b">' + avgDur.toFixed(2) + 'y</div>'
        + '<div style="font-size:9px;color:#64748b">Average</div>'
      + '</div>'
      + bucketHtml
    + '</div>'
    + '</div>';
}

export function buildDurationPopupRows(summary, mode) {
  if (mode === 'rebal' && (!summary.gapYears || summary.gapYears.length === 0)) {
    return [{ label: 'No gap years', note: 'Bracket duration matching not applicable for this ladder', total: true }];
  }
  const lowerYear  = mode === 'rebal' ? summary.brackets.lowerYear  : summary.lowerYear;
  const upperYear  = mode === 'rebal' ? summary.brackets.upperYear  : summary.upperYear;
  const lowerLabel = mode === 'build' ? summary.lowerMonth + ' ' + lowerYear : String(lowerYear);
  const upperLabel = mode === 'build' ? summary.upperMonth + ' ' + upperYear : String(upperYear);
  
  const { lowerDuration, upperDuration, lowerWeight, upperWeight, gapParams } = summary;
  const is3 = mode === 'rebal' && summary.bracketMode === '3bracket' && summary.newLowerCUSIP;
  const avg = gapParams.avgDuration;

  const rows = [
    { label: 'Gap average duration', value: avg.toFixed(2) + ' yr' },
    { sep: true },
  ];

  if (gapParams.breakdown?.length) {
    rows.push({ heading: 'Gap Year Durations' });
    const durSum = gapParams.breakdown.reduce((s, b) => s + (b.dur ?? 0), 0);
    gapParams.breakdown.forEach(b => {
      rows.push({ label: b.year + ' (Feb 15)', note: 'mod. duration (interpolated)', value: b.dur != null ? b.dur.toFixed(2) + ' yr' : '\u2014' });
    });
    rows.push({ label: 'Avg (' + durSum.toFixed(2) + ' \u00f7 ' + gapParams.breakdown.length + ')', value: avg.toFixed(2) + ' yr', total: true });
    rows.push({ sep: true });
  }

  const buckets = [];
  if (is3) {
    const { newLowerYear, newLowerDuration, origLowerWeight, newLowerWeight3 } = summary;
    const w1 = (origLowerWeight ?? 0), w2 = (newLowerWeight3 ?? 0), w3 = (summary.upperWeight3 ?? summary.upperWeight ?? 0);
    const fellBack = !!summary.bracketFellBack3to2;
    
    rows.push(
      { label: 'Orig lower (' + lowerYear + ')',    note: 'mod. duration', value: lowerDuration.toFixed(2) + ' yr' },
      { label: 'New lower (' + newLowerYear + ')',  note: 'mod. duration', value: newLowerDuration.toFixed(2) + ' yr' },
      { label: 'Upper (' + upperYear + ')',         note: 'mod. duration', value: upperDuration.toFixed(2) + ' yr' },
      { sep: true },
      { label: 'Orig lower weight', note: fellBack ? '2-bracket formula (fell back)' : 'current excess / gap total cost (fixed)', value: w1.toFixed(4) },
      { label: 'New lower weight',  note: fellBack ? 'n/a (fell back to 2-bracket)'  : 'solved from duration constraint',         value: w2.toFixed(4) },
      { label: 'Upper weight',      note: fellBack ? '2-bracket formula (fell back)'  : '1 \u2212 w1 \u2212 w2',                            value: w3.toFixed(4) }
    );
    buckets.push({ dur: lowerDuration, weight: w1, label: String(lowerYear) });
    if (!fellBack) buckets.push({ dur: newLowerDuration, weight: w2, label: String(newLowerYear) });
    buckets.push({ dur: upperDuration, weight: w3, label: String(upperYear) });

    const match = w1.toFixed(4) + ' \u00d7 ' + lowerDuration.toFixed(2)
                + (fellBack ? '' : ' + ' + w2.toFixed(4) + ' \u00d7 ' + newLowerDuration.toFixed(2))
                + ' + ' + w3.toFixed(4) + ' \u00d7 ' + upperDuration.toFixed(2)
                + ' = ' + avg.toFixed(2);
    rows.push({ sep: true }, { label: 'Duration match', note: match, total: true });
    if (fellBack) rows.push({ sep: true }, { label: '2-bracket fallback', note: 'Orig lower excess exceeded gap cost (w1 > 1). Sold orig lower to 2-bracket target; no new lower bought.' });

  } else {
    const wFml = '(upper dur \u2212 avg dur) / (upper dur \u2212 lower dur)';
    rows.push(
      { label: 'Lower bracket (' + lowerLabel + ')', note: 'mod. duration', value: lowerDuration.toFixed(2) + ' yr' },
      { label: 'Upper bracket (' + upperLabel + ')', note: 'mod. duration', value: upperDuration.toFixed(2) + ' yr' },
      { sep: true },
      { label: 'Lower weight', note: wFml,                    value: lowerWeight.toFixed(4) },
      { label: 'Upper weight', note: '1 \u2212 lower weight', value: upperWeight.toFixed(4) }
    );
    buckets.push({ dur: lowerDuration, weight: lowerWeight, label: lowerLabel });
    buckets.push({ dur: upperDuration, weight: upperWeight, label: upperLabel });

    const match = lowerWeight.toFixed(4) + ' \u00d7 ' + lowerDuration.toFixed(2)
                + ' + ' + upperWeight.toFixed(4) + ' \u00d7 ' + upperDuration.toFixed(2)
                + ' = ' + avg.toFixed(2);
    rows.push({ sep: true }, { label: 'Duration match', note: match, total: true });
  }

  rows.push(
    { sep: true },
    { heading: 'Duration Balance (Mod. Duration)' },
    { html: renderDurationBeam(buckets, avg) }
  );

  if (gapParams.breakdown?.length) {
    rows.push({ sep: true }, { heading: 'Gap Year Breakdown (theoretical qty)' });
    gapParams.breakdown.forEach(g => {
      rows.push({ label: g.year + ' qty', note: 'round((DARA \u2212 ' + Math.round(g.laterMatInt) + ') \u00f7 ' + g.piPerBond.toFixed(2) + ')', value: String(g.qty) });
    });
    rows.push({ label: 'Theoretical gap cost (Total)', note: 'Sum of individual gap theoretical costs', value: '$' + Math.round(gapParams.totalCost).toLocaleString(), total: true });
    const totalExcess = summary.totalExcessCost;
    if (totalExcess) {
      rows.push({ label: 'Total excess cost', note: 'Cost of excess TIPS now held in brackets', value: '$' + Math.round(totalExcess).toLocaleString() });
      rows.push({ label: 'Coverage status',   note: 'Gap is fully funded by the new bracket excess', value: 'Fully Funded', total: true });
    }
  }

  return rows;
}

export function buildFuture30yDurationPopupRows(summary) {
  const { future30yYears, future30yParams, future30yLowerYear, future30yUpperYear,
          future30yLowerDuration, future30yUpperDuration, future30yUpperWeight, future30yLowerWeight,
          future30yFellBack, future30yLowerMonth, future30yUpperMonth } = summary;
  if (!future30yYears?.length || !future30yParams) {
    return [{ label: 'No Future 30Y years', note: 'Future 30Y cover matching not applicable', total: true }];
  }
  const lowerLabel = (future30yLowerMonth ? future30yLowerMonth + ' ' : '') + future30yLowerYear;
  const upperLabel = (future30yUpperMonth ? future30yUpperMonth + ' ' : '') + future30yUpperYear;
  const avg = future30yParams.avgDuration;
  const wFml = '(avg dur \u2212 lower dur) / (upper dur \u2212 lower dur)';
  const match = future30yLowerWeight.toFixed(4) + ' \u00d7 ' + future30yLowerDuration.toFixed(2)
              + ' + ' + future30yUpperWeight.toFixed(4) + ' \u00d7 ' + future30yUpperDuration.toFixed(2)
              + ' = ' + avg.toFixed(2);

  const rows = [
    { label: 'Future 30Y average duration', value: avg.toFixed(2) + ' yr' },
    { sep: true },
  ];

  if (future30yParams.breakdown?.length) {
    rows.push({ heading: 'Hypothetical TIPS Durations' });
    const durSum = future30yParams.breakdown.reduce((s, b) => s + (b.dur ?? 0), 0);
    future30yParams.breakdown.forEach(b => {
      rows.push({ label: b.year + ' (Feb 15)', note: 'mod. duration', value: b.dur != null ? b.dur.toFixed(2) + ' yr' : '\u2014' });
    });
    rows.push({ label: 'Avg (' + durSum.toFixed(2) + ' \u00f7 ' + future30yParams.breakdown.length + ')', value: avg.toFixed(2) + ' yr', total: true });
    rows.push({ sep: true });
  }

  rows.push(
    { label: 'Lower cover (' + lowerLabel + ')', note: 'mod. duration', value: future30yLowerDuration.toFixed(2) + ' yr' },
    { label: 'Upper cover (' + upperLabel + ')', note: 'mod. duration', value: future30yUpperDuration.toFixed(2) + ' yr' },
    { sep: true },
    { label: 'Lower weight', note: wFml,                    value: future30yLowerWeight.toFixed(4) },
    { label: 'Upper weight', note: '1 \u2212 lower weight', value: future30yUpperWeight.toFixed(4) },
    { sep: true },
    { label: 'Duration match', note: match, total: true },
    { sep: true },
    { heading: 'Duration Balance (Mod. Duration)' },
    { html: renderDurationBeam([
        { dur: future30yLowerDuration, weight: future30yLowerWeight, label: lowerLabel },
        { dur: future30yUpperDuration, weight: future30yUpperWeight, label: upperLabel }
      ], avg) },
  );

  if (future30yFellBack) {
    rows.push({ sep: true }, { label: 'Fallback applied', note: 'Avg duration exceeds upper cover duration; all weight assigned to upper cover.' });
  }

  if (future30yParams.breakdown?.length) {
    rows.push({ sep: true }, { heading: 'Future 30Y Year Breakdown (hypothetical qty)' });
    future30yParams.breakdown.forEach(b => {
      rows.push({ label: b.year + ' qty', note: 'round((DARA \u2212 ' + Math.round(b.laterMatInt) + ') \u00f7 ' + b.piPerBond.toFixed(2) + ')', value: String(b.qty) });
    });
    rows.push({ label: 'Total Future 30Y cost', value: '$' + Math.round(future30yParams.future30yTotalCost).toLocaleString(), total: true });
  }

  return rows;
}
