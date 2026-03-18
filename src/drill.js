// drill.js -- Drill-down popup HTML builder (6.0_UI_Schema.md)
// Exports: buildDrillHTML(d, colKey, summary)

function fm(n)  { return '$' + Math.round(n).toLocaleString('en-US'); }
function fm2(n) { return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fd(n, dp) { return Number(n).toFixed(dp); }

function row(label, formula, value, isTotal) {
  const ts = isTotal ? 'font-weight:700;border-top:2px solid #1e293b;padding-top:6px;' : '';
  const f  = formula
    ? '<td style="padding:3px 14px;color:#64748b;font-size:11px;' + ts + '">' + formula + '</td>'
    : '<td style="padding:3px 14px;' + ts + '"></td>';
  return '<tr>'
    + '<td style="padding:3px 16px 3px 0;white-space:nowrap;' + ts + '">' + label + '</td>'
    + f
    + '<td style="padding:3px 0 3px 14px;text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;' + ts + '">' + value + '</td>'
    + '</tr>';
}

function sep() { return '<tr><td colspan="3" style="padding:4px 0;border-bottom:1px dashed #e2e8f0"></td></tr>'; }

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function bondVarRows(d, nPeriods, principalPerBond, couponPct) {
  const matMonth = MONTHS[parseInt(d.maturityStr.slice(0,2), 10) - 1];
  const nPerLbl  = nPeriods === 1 ? '1 semi-annual' : '2 (Jan + ' + matMonth + ')';
  return row('refCPI', '', fd(d.refCPI, 5))
    + row('Dated date CPI', '', fd(d.baseCpi, 5))
    + row('Index ratio', fd(d.refCPI, 5) + ' / ' + fd(d.baseCpi, 5), fd(d.indexRatio, 5))
    + row('Principal per bond', '1,000 \xd7 index ratio', fd(principalPerBond, 2))
    + row('Coupon per period', 'annual coupon / 2', couponPct)
    + row('Coupon periods in FY', '', nPerLbl);
}

export function buildDrillHTML(d, colKey, summary) {
  const nPeriods         = d.nPeriods != null ? d.nPeriods : (d.halfOrFull === 0.5 ? 1 : 2);
  const principalPerBond = d.principalPerBond != null ? d.principalPerBond : 1000 * d.indexRatio;
  const couponPct        = fd(d.coupon / 2 * 100, 5) + '%';
  const couponLabel      = nPeriods === 1 ? 'Last coupon (1 period)' : 'Last 2 coupons (2 periods)';

  let rows = '';

  // \u2500\u2500 Build: Amount \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  if (colKey === 'amount') {
    const _plCredit  = d.preLadderCreditForYear || 0;
    const _totalFmla = _plCredit > 0
      ? 'Principal + Coupons + Later mat int + Pre-ladder credit'
      : 'Principal + Coupons + Later mat int';
    rows =
      bondVarRows(d, nPeriods, principalPerBond, couponPct) +
      sep() +
      row('Qty', '', d.fundedYearQty + ' bonds') +
      row('Principal', 'principal/bond \xd7 qty', fm(d.fundedYearPrincipalTotal)) +
      row(couponLabel, 'principal/bond \xd7 coupon/period \xd7 periods \xd7 qty', fm(d.fundedYearOwnRungInt)) +
      row('Later maturity interest', 'from bonds maturing after ' + d.fundedYear, fm(d.fundedYearLaterMatInt)) +
      (_plCredit > 0 ? row('Pre-ladder credit', 'pre-ladder pool applied to this year', fm(_plCredit)) : '') +
      sep() +
      row('Funded Year Amount', _totalFmla, fm(d.fundedYearAmt), true) +
      sep() +
      row('DARA', '', fm(d.dara)) +
      row('Surplus / Deficit', 'FY Amount \u2212 DARA', (d.fundedYearAmt - d.dara >= 0 ? '+' : '') + Math.round(d.fundedYearAmt - d.dara).toLocaleString('en-US'));

  // \u2500\u2500 Build: Cost \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  } else if (colKey === 'cost') {
    rows =
      row('Price (unadjusted)', '', fd(d.price, 4)) +
      row('refCPI', '', fd(d.refCPI, 5)) +
      row('Dated date CPI', '', fd(d.baseCpi, 5)) +
      row('Index ratio', fd(d.refCPI, 5) + ' / ' + fd(d.baseCpi, 5), fd(d.indexRatio, 5)) +
      row('Cost per bond', 'price/100 \xd7 index ratio \xd7 1,000', fm2(d.costPerBond)) +
      row('Qty', '', d.fundedYearQty + ' bonds') +
      row('Funded Year Cost', 'cost/bond \xd7 qty', fm(d.fundedYearCost), true);

  // \u2500\u2500 Build: Gap Amount / Gap Cost \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
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
        + row('Gap year total cost', '', fm(s.gapParams.totalCost))
        + row('Target excess cost', 'total cost \xd7 ' + wLabel.toLowerCase(), fm(exCost))
        + sep()
        + row('Cost per bond', 'price/100 \xd7 index ratio \xd7 1,000', fm2(d.costPerBond))
        + row('Excess qty', 'round(target cost \xf7 cost/bond)', d.excessQty + ' bonds');
      if (isAmt) {
        rows += sep()
          + bondVarRows(d, nPeriods, principalPerBond, couponPct)
          + sep()
          + row('P+I per bond', 'principal/bond \xd7 (1 + coupon/period \xd7 periods)', fm2(d.fundedYearPi))
          + sep()
          + row('Gap Amount', 'P+I/bond \xd7 excess qty', fm(d.excessAmt), true);
      } else {
        rows += sep()
          + row('Gap Cost', 'cost/bond \xd7 excess qty', fm(d.excessCost), true);
      }
    }

  // \u2500\u2500 Rebalance: Amount Before / After \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  } else if (colKey === 'amtBefore' || colKey === 'amtAfter') {
    const isBef       = colKey === 'amtBefore';
    const principal   = isBef ? d.araBeforePrincipal   : d.araAfterPrincipal;
    const ownCoupon   = isBef ? d.araBeforeOwnCoupon   : d.araAfterOwnCoupon;
    const laterMatInt = isBef ? d.araBeforeLaterMatInt : d.araAfterLaterMatInt;
    const araTotal    = isBef ? d.araBeforeTotal       : d.araAfterTotal;
    const couponLbl   = nPeriods === 1 ? 'Last coupon (1 period)' : 'Last 2 coupons (2 periods)';
    const araQty      = isBef ? d.fundedYearQtyBefore : d.fundedYearQtyAfter;
    const DARA        = d.DARA ?? summary?.DARA;
    rows = bondVarRows(d, nPeriods, principalPerBond, couponPct) + sep()
      + row('Qty', '', araQty + ' bonds')
      + row('Principal', 'principal/bond \xd7 qty', fm(principal))
      + row(couponLbl, 'principal/bond \xd7 coupon/period \xd7 periods \xd7 qty', fm(ownCoupon))
      + row('Later maturity interest', 'from bonds maturing after FY', fm(laterMatInt))
      + sep()
      + row(isBef ? 'Amount Before' : 'Amount After', 'Principal + Coupons + Later mat int', fm(araTotal), true)
      + sep()
      + row('DARA', '', fm(DARA))
      + row('Surplus / Deficit', (isBef ? 'Amount Before' : 'Amount After') + ' \u2212 DARA',
            (araTotal - DARA >= 0 ? '+' : '') + Math.round(araTotal - DARA).toLocaleString('en-US'));

  // \u2500\u2500 Rebalance: Qty After \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  } else if (colKey === 'qtyAfter') {
    const totalQty = d.qtyAfter;
    const _DARA    = d.DARA ?? summary?.DARA;
    rows = bondVarRows(d, nPeriods, principalPerBond, couponPct) + sep()
      + row('Cost per bond', 'price/100 \xd7 index ratio \xd7 1,000', fm2(d.costPerBond));
    if (d.isBracketTarget) {
      rows += sep()
        + row('Funded Year target qty', 'from rebalance algorithm', d.fundedYearQty + ' bonds')
        + row('Excess cost to deploy', '', fm(d.excessQtyAfter * d.costPerBond))
        + row('Cost per bond', '', fm2(d.costPerBond))
        + row('Excess bonds', 'round(excess cost \xf7 cost per bond)', d.excessQtyAfter + ' bonds')
        + sep()
        + row('Total qty', 'FY target + excess bonds', totalQty + ' bonds', true);
    } else if (d.qtyAfter !== d.qtyBefore) {
      const piPB = principalPerBond * (1 + d.coupon / 2 * nPeriods);
      const lmi  = d.araAfterLaterMatInt ?? 0;
      const net  = _DARA - lmi;
      rows = row('refCPI', '', fd(d.refCPI, 5))
        + row('Dated date CPI', '', fd(d.baseCpi, 5))
        + row('Index ratio', fd(d.refCPI, 5) + ' / ' + fd(d.baseCpi, 5), fd(d.indexRatio, 5))
        + row('Principal per bond', '1,000 \xd7 index ratio', fd(principalPerBond, 2))
        + row('Coupon per period', 'annual coupon / 2', couponPct)
        + row('Coupon periods in FY', '', nPeriods === 1 ? '1 semi-annual' : '2 (Jan + ' + MONTHS[parseInt(d.maturityStr.slice(0,2), 10) - 1] + ')')
        + sep()
        + row('P+I per bond', 'principal/bond \xd7 (1 + coupon/period \xd7 periods)', fm2(piPB))
        + sep()
        + row('DARA', '', fm(_DARA))
        + row('Later mat int', 'from bonds maturing after FY', fm(lmi))
        + row('Net needed', 'DARA \u2212 Later mat int', fm(net))
        + sep()
        + row('Target FY qty', 'round(Net needed \xf7 P+I per bond)', totalQty + ' bonds', true);
    } else {
      rows += sep()
        + row('Qty', 'unchanged from current holdings', totalQty + ' bonds', true);
    }

  // \u2500\u2500 Rebalance: Cash Delta \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  } else if (colKey === 'cashDelta') {
    const qtyDelta  = d.qtyAfter - d.qtyBefore;
    const cashDelta = -(qtyDelta * d.costPerBond);
    const qdSign    = qtyDelta >= 0 ? '+' : '';
    const cdSign    = cashDelta >= 0 ? '+' : '';
    rows =
      row('Price (unadjusted)', '', fd(d.price, 4)) +
      row('refCPI', '', fd(d.refCPI, 5)) +
      row('Dated date CPI', '', fd(d.baseCpi, 5)) +
      row('Index ratio', fd(d.refCPI, 5) + ' / ' + fd(d.baseCpi, 5), fd(d.indexRatio, 5)) +
      sep() +
      row('Cost per bond', 'price/100 \xd7 index ratio \xd7 1,000', fm2(d.costPerBond)) +
      sep() +
      row('Qty delta', 'Qty After \u2212 Qty Before', qdSign + qtyDelta + ' bonds') +
      sep() +
      row('Cash \u0394', '\u2212(Qty delta \xd7 cost/bond)', cdSign + fm(Math.abs(cashDelta)), true);

  // \u2500\u2500 Rebalance: Cost Before / After \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  } else if (colKey === 'costBefore' || colKey === 'costAfter') {
    const isBef    = colKey === 'costBefore';
    const isBT     = d.isBracketTarget;
    const qty      = isBef ? (isBT ? d.fundedYearQtyBefore : d.qtyBefore) : d.fundedYearQtyAfter;
    const qtyLabel = isBef ? (isBT ? 'FY qty (before)' : 'Qty Before') : 'Qty After';
    const cost     = qty * d.costPerBond;
    rows =
      row('Price (unadjusted)', '', fd(d.price, 4)) +
      row('refCPI', '', fd(d.refCPI, 5)) +
      row('Dated date CPI', '', fd(d.baseCpi, 5)) +
      row('Index ratio', fd(d.refCPI, 5) + ' / ' + fd(d.baseCpi, 5), fd(d.indexRatio, 5)) +
      sep() +
      row('Cost per bond', 'price/100 \xd7 index ratio \xd7 1,000', fm2(d.costPerBond)) +
      sep() +
      row(qtyLabel, isBT ? 'FY-only (excluding gap excess)' : '', qty + ' bonds') +
      sep() +
      row(isBef ? 'Cost Before' : 'Cost After', 'qty \xd7 cost/bond', fm(cost), true);

  // \u2500\u2500 Rebalance: Gap Amt/Cost Before/After \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  } else if (colKey === 'gapAmtBefore' || colKey === 'gapAmtAfter' || colKey === 'gapCostBefore' || colKey === 'gapCostAfter') {
    const s       = summary;
    const isAfter = colKey === 'gapAmtAfter' || colKey === 'gapCostAfter';
    const isAmt   = colKey === 'gapAmtBefore' || colKey === 'gapAmtAfter';
    const piPerBond = principalPerBond * (1 + d.coupon / 2 * nPeriods);
    if (!isAfter) {
      const exQty = d.excessQtyBefore;
      rows = bondVarRows(d, nPeriods, principalPerBond, couponPct) + sep();
      if (isAmt) {
        rows += row('P+I per bond', 'principal/bond \xd7 (1 + coupon/period \xd7 periods)', fm2(piPerBond))
          + sep()
          + row('Excess qty', 'current total \u2212 FY target', exQty + ' bonds')
          + sep()
          + row('Excess Amount Before', 'P+I per bond \xd7 excess qty', fm(exQty * piPerBond), true);
      } else {
        rows += row('Cost per bond', 'price/100 \xd7 index ratio \xd7 1,000', fm2(d.costPerBond))
          + sep()
          + row('Excess qty', 'current total \u2212 FY target', exQty + ' bonds')
          + sep()
          + row('Excess Cost Before', 'cost/bond \xd7 excess qty', fm(exQty * d.costPerBond), true);
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
      rows = row('Bracket weights', 'see Duration Calcs \u2197', fd(weight, 4))
        + sep()
        + row('Gap year total cost', '', fm(s.gapParams.totalCost))
        + row('Target excess cost', 'total cost \xd7 ' + wLabel.toLowerCase(), fm(exCost))
        + sep()
        + row('Cost per bond', 'price/100 \xd7 index ratio \xd7 1,000', fm2(d.costPerBond))
        + row('Excess qty', 'round(target cost \xf7 cost/bond)', exQty + ' bonds');
      if (isAmt) {
        rows += sep()
          + bondVarRows(d, nPeriods, principalPerBond, couponPct) + sep()
          + row('P+I per bond', 'principal/bond \xd7 (1 + coupon/period \xd7 periods)', fm2(piPerBond))
          + sep()
          + row('Excess Amount After', 'P+I/bond \xd7 excess qty', fm(exQty * piPerBond), true);
      } else {
        rows += sep()
          + row('Excess Cost After', 'cost/bond \xd7 excess qty', fm(exQty * d.costPerBond), true);
      }
    }
  // ── Rebalance: Gap Cash Delta ─────────────────────────────────────────────────────
  } else if (colKey === 'gapCashDelta') {
    const exQtyBef  = d.excessQtyBefore;
    const exQtyAft  = d.excessQtyAfter;
    const exQtyDel  = exQtyAft - exQtyBef;
    const gapCash   = -(exQtyDel * d.costPerBond);
    const delSign   = exQtyDel >= 0 ? '+' : '';
    const cashSign  = gapCash  >= 0 ? '+' : '';
    rows =
      row('Price (unadjusted)', '', fd(d.price, 4)) +
      row('refCPI', '', fd(d.refCPI, 5)) +
      row('Dated date CPI', '', fd(d.baseCpi, 5)) +
      row('Index ratio', fd(d.refCPI, 5) + ' / ' + fd(d.baseCpi, 5), fd(d.indexRatio, 5)) +
      sep() +
      row('Cost per bond', 'price/100 × index ratio × 1,000', fm2(d.costPerBond)) +
      sep() +
      row('Excess qty before', 'current total − FY target', exQtyBef + ' bonds') +
      row('Excess qty after',  'rebalanced excess', exQtyAft + ' bonds') +
      row('Excess qty delta',  'after − before', delSign + exQtyDel + ' bonds') +
      sep() +
      row('Gap Cash Δ', '−(excess qty delta × cost/bond)', cashSign + fm(Math.abs(gapCash)), true);

  }

  return '<table style="border-collapse:collapse;width:auto;font-size:12px">' + rows + '</table>';
}

export function buildDurationPopupRows(summary, mode) {
  if (mode === 'rebal' && (!summary.gapYears || summary.gapYears.length === 0)) {
    return [{ label: 'No gap years', note: 'Bracket duration matching not applicable for this ladder', total: true }];
  }
  const lowerYear  = mode === 'rebal' ? summary.brackets.lowerYear  : summary.lowerYear;
  const upperYear  = mode === 'rebal' ? summary.brackets.upperYear  : summary.upperYear;
  const lowerLabel = mode === 'build'
    ? summary.lowerMonth + ' ' + lowerYear : String(lowerYear);
  const upperLabel = mode === 'build'
    ? summary.upperMonth + ' ' + upperYear : String(upperYear);
  const { lowerDuration, upperDuration, lowerWeight, upperWeight, gapParams } = summary;
  const is3 = mode === 'rebal' && summary.bracketMode === '3bracket' && summary.newLowerCUSIP;

  let rows = [];

  if (is3) {
    const { newLowerYear, newLowerDuration, origLowerWeight, newLowerWeight3 } = summary;
    const w1 = (origLowerWeight ?? 0), w2 = (newLowerWeight3 ?? 0), w3 = upperWeight ?? 0;
    const fellBack = !!summary.bracketFellBack3to2;
    const match = w1.toFixed(4) + ' × ' + lowerDuration.toFixed(2)
                + ' + ' + w2.toFixed(4) + ' × ' + newLowerDuration.toFixed(2)
                + ' + ' + w3.toFixed(4) + ' × ' + upperDuration.toFixed(2)
                + ' = ' + gapParams.avgDuration.toFixed(2);
    rows = [
      { label: 'Gap avg duration', value: gapParams.avgDuration.toFixed(2) + ' yr' },
      { label: 'Gap years',        value: (summary.gapYears || []).join(', ') || '—' },
      { sep: true },
      { label: 'Orig lower (' + lowerYear + ')',    note: 'mod. duration', value: lowerDuration.toFixed(2) + ' yr' },
      { label: 'New lower (' + newLowerYear + ')',  note: 'mod. duration', value: newLowerDuration.toFixed(2) + ' yr' },
      { label: 'Upper (' + upperYear + ')',         note: 'mod. duration', value: upperDuration.toFixed(2) + ' yr' },
      { sep: true },
      { label: 'Orig lower weight', note: fellBack ? '2-bracket formula (fell back)' : 'current excess / gap total cost (fixed)', value: w1.toFixed(4) },
      { label: 'New lower weight',  note: fellBack ? 'n/a (fell back to 2-bracket)'  : 'solved from duration constraint',         value: w2.toFixed(4) },
      { label: 'Upper weight',      note: fellBack ? '2-bracket formula (fell back)'  : '1 − w1 − w2',                            value: w3.toFixed(4) },
      { sep: true },
      { label: 'Duration match', note: match, total: true },
      ...(fellBack ? [{ sep: true }, { label: '2-bracket fallback', note: 'Orig lower excess exceeded gap cost (w1 > 1). Sold orig lower to 2-bracket target; no new lower bought.' }] : []),
    ];
  } else {
    const wFml = '(upper dur − avg dur) / (upper dur − lower dur)';
    const match = lowerWeight.toFixed(4) + ' × ' + lowerDuration.toFixed(2)
                + ' + ' + upperWeight.toFixed(4) + ' × ' + upperDuration.toFixed(2)
                + ' = ' + gapParams.avgDuration.toFixed(2);
    rows = [
      { label: 'Gap avg duration', value: gapParams.avgDuration.toFixed(2) + ' yr' },
      { label: 'Gap years',        value: (summary.gapYears || []).join(', ') || '—' },
      { sep: true },
      { label: 'Lower bracket (' + lowerLabel + ')', note: 'mod. duration', value: lowerDuration.toFixed(2) + ' yr' },
      { label: 'Upper bracket (' + upperLabel + ')', note: 'mod. duration', value: upperDuration.toFixed(2) + ' yr' },
      { sep: true },
      { label: 'Lower weight', note: wFml, value: lowerWeight.toFixed(4) },
      { label: 'Upper weight', note: '1 − lower weight', value: upperWeight.toFixed(4) },
      { sep: true },
      { label: 'Duration match', note: match, total: true },
    ];
  }

  // Excess Balance Check (Rebalance only)
  if (typeof summary.gapCoverageSurplus === 'number') {
    const s = summary.gapCoverageSurplus;
    const surplusLbl = s >= 0 ? 'Surplus' : 'Deficit';
    const surplusVal = (s >= 0 ? '+' : '') + Math.round(s).toLocaleString('en-US');
    rows.push(
      { sep: true },
      { heading: 'Excess Balance Check' },
      { label: 'Current excess $',  value: '$' + Math.round(summary.totalCurrentExcess).toLocaleString() },
      { label: 'Rebal rungs cost',  note: 'cost to fill newly available years', value: '$' + Math.round(summary.costForNewRungs).toLocaleString() },
      { label: 'Future gap cost',   note: 'cost to fill remaining gaps', value: '$' + Math.round(summary.gapParams.totalCost).toLocaleString() },
      { label: 'Gap coverage ' + surplusLbl.toLowerCase(), note: 'Current excess − Rebal rungs − Future gap', value: surplusVal, total: true }
    );
  }

  return rows;
}
