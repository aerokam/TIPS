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
    ? '<td style="padding:3px 14px;color:#334155;font-size:11px;' + ts + '">' + formula + '</td>'
    : '<td style="padding:3px 14px;' + ts + '"></td>';
  return '<tr' + dk + '>'
    + '<td' + rid + ' style="padding:3px 16px 3px 0;white-space:nowrap;' + ts + lblStyle + '">' + label + '</td>'
    + f
    + '<td style="padding:3px 0 3px 14px;text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;' + ts + '">' + value + '</td>'
    + '</tr>';
}

function sep() { return '<tr><td colspan="3" style="padding:4px 0;border-bottom:1px dashed #e2e8f0"></td></tr>'; }

// Bracket/cover Amount breakdown (Rev 6): Excess P+I − AMD credited earlier + block-coupon add-back
// = coverage delivered. `lmiAdd` is the cover's block-LMI allocation; AMD net-out is derived to reconcile.
function coverageAmtRows(label, grossPI, lmiAdd, finalAmt) {
  const amdNet = Math.max(0, grossPI + (lmiAdd || 0) - finalAmt);
  let fmla = '<span class="formula-var" data-source="expi">Excess P+I</span>';
  if (amdNet > 0.5) fmla += ' − <span class="formula-var" data-source="amdn">AMD credited earlier</span>';
  if (lmiAdd  > 0.5) fmla += ' + <span class="formula-var" data-source="lmiadd">coupon add-back</span>';
  return row('Excess P+I', '<span class="formula-var" data-source="pipb">P+I per TIPS</span> \xd7 <span class="formula-var" data-source="qty">Excess Quantity</span>', fm(grossPI), false, undefined, 'expi')
    + (amdNet > 0.5 ? row('AMD credited to earlier years', 'this cover’s market discount is delivered to the years it accrues in (AMD line items), not coverage here', '−' + fm(amdNet), false, undefined, 'amdn') : '')
    + (lmiAdd  > 0.5 ? row('+ block coupon add-back', 'this cover’s share of the block coupon that sized the synthetic rungs down', fm(lmiAdd), false, undefined, 'lmiadd') : '')
    + sep()
    + row(label, fmla, fm(finalAmt), true);
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// A bracket row links to its own weight drill rather than carrying hover text: the nested popup
// is draggable, resizable, and its content can be selected and copied (5.0 §Nested (Level-3)
// drills).
function wtLink(which, inner) {
  return '<span class="drill-l3" data-l3="bracketwt-' + which + '" style="cursor:pointer;text-decoration:underline dotted #94a3b8;">' + inner + '</span>';
}

function bondVarRows(d, nPeriods, principalPerBond, couponPct) {
  const matMonthName = d.maturityStr.split(' ')[0];
  const matMonthIdx = MONTHS.indexOf(matMonthName);
  let nPerLbl;
  if (nPeriods === 1) {
    nPerLbl = '1 semi-annual (' + matMonthName + ')';
  } else {
    const firstMonthName = MONTHS[(matMonthIdx - 6 + 12) % 12];
    nPerLbl = '2 (' + firstMonthName + ' + ' + matMonthName + ')';
  }
  return row('Ref CPI', '', fd(d.refCPI, 5), false, 'refCPI', 'refcpi')
    + row('Dated Ref CPI', '', fd(d.datedDateRefCpi, 5), false, undefined, 'basecpi')
    + row('Index ratio', '<span class="formula-var" data-source="refcpi">Ref CPI</span> \xf7 <span class="formula-var" data-source="basecpi">Dated Ref CPI</span>', fd(d.indexRatio, 5), false, 'indexRatio', 'ir')
    + row('Par Value per TIPS', '1,000 \xd7 <span class="formula-var" data-source="ir">index ratio</span>', fd(principalPerBond, 2), false, undefined, 'ppb')
    + row('Coupon per period', 'annual coupon \xf7 2', couponPct, false, undefined, 'cpp')
    + row('Yield', '', fd(d.yield * 100, 3) + '%')
    + row('SA Yield', '', d.saYield != null ? fd(d.saYield * 100, 3) + '%' : '—')
    + row('Coupon periods in FY', '', nPerLbl, false, undefined, 'cp');
}

function future30yBreakdownRows(future30yParams) {
  if (!future30yParams?.breakdown) return '';
  let rows = '';
  future30yParams.breakdown.forEach((g, i) => {
    const id = 'fut' + i;
    const fmla = 'round((' + fm(g.dara) + ' \u2212 <span class="formula-var" data-source="' + id + 'lmi">LMI</span>) \u00f7 <span class="formula-var" data-source="' + id + 'pi">P+I</span>)';
    rows += row(g.year + ' quantity', fmla, g.qty, false, undefined, id + 'qty')
          + row('\u21b3 P+I per synthetic TIPS', '', fm2(g.piPerBond), false, undefined, id + 'pi')
          + row('\u21b3 Later mat int (LMI)', 'Coupon interest from longer synthetic Future 30Y TIPS', fm(g.laterMatInt), false, undefined, id + 'lmi')
          + row('\u21b3 Theoretical cost', '<span class="formula-var" data-source="' + id + 'qty">Quantity</span> \xd7 $1,000 \xd7 price ' + fd(g.synPrice ?? 100, 3) + ' \u00f7 100', fm(g.cost ?? g.qty * 1000));
  });
  return rows;
}

// `compact`: the caller has already stated the general (variable-name) formula once, in a legend
// defining LMI/PLI/P+I, so each year's row instead substitutes that year's actual numbers into the
// same formula shape \u2014 the reader maps numbers back to terms via the legend rather than re-reading
// "LMI"/"P+I" spelled out on every row. The P+I, LMI, and PLI sub-rows are all dropped in this mode
// since each already appears, substituted, in the row's own formula.
function gapBreakdownRows(gapParams, dara, opts) {
  if (!gapParams?.breakdown) return '';
  const compact = opts?.compact;
  let rows = '';
  gapParams.breakdown.forEach((g, i) => {
    const id = 'gap' + i;
    const pliCredit = g.pliCredit ?? 0;
    const yearDara = g.dara ?? dara;
    let fmla;
    if (compact) {
      const lmiSpan = '<span class="drill-l3" data-l3="gaplmi-' + g.year + '" style="cursor:pointer;text-decoration:underline dotted #94a3b8;">' + fm(g.laterMatInt) + '</span>';
      const piSpan = '<span class="drill-l3" data-l3="gappi-' + g.year + '" style="cursor:pointer;text-decoration:underline dotted #94a3b8;">' + fm2(g.piPerBond) + '</span>';
      fmla = 'round((' + fm(yearDara) + ' \u2212 ' + lmiSpan;
      if (pliCredit > 0) {
        const pliSpan = '<span class="drill-l3" data-l3="plcpool:' + Math.round(pliCredit) + '" style="cursor:pointer;text-decoration:underline dotted #94a3b8;">' + fm(pliCredit) + '</span>';
        fmla += ' \u2212 ' + pliSpan;
      }
      fmla += ') \u00f7 ' + piSpan + ')';
    } else {
      fmla = 'round((' + fm(yearDara) + ' \u2212 <span class="formula-var" data-source="' + id + 'lmi">LMI</span>';
      if (pliCredit > 0) fmla += ' \u2212 <span class="formula-var" data-source="' + id + 'pli">PLI</span>';
      fmla += ') \u00f7 <span class="formula-var" data-source="' + id + 'pi">P+I</span>)';
    }
    rows += row(g.year + ' quantity', fmla, g.qty, false, undefined, id + 'qty')
          + (compact ? '' : row('\u21b3 P+I per synthetic TIPS', '', fm2(g.piPerBond), false, undefined, id + 'pi'))
          + (compact ? '' : row('\u21b3 LMI (actual TIPS + longer synth)', 'coupon from funded years above + synth LMI from longer gap years', fm(g.laterMatInt), false, undefined, id + 'lmi'))
          + (!compact && pliCredit > 0 ? row('\u21b3 PLI credit', 'pre-ladder pool applied to this gap year', fm(pliCredit), false, 'plcpool:' + Math.round(pliCredit), id + 'pli') : '')
          + row('\u21b3 Theoretical cost', '<span class="formula-var" data-source="' + id + 'qty">Quantity</span> \xd7 $1,000 \xd7 price ' + fd(g.synPrice ?? 100, 3) + ' \u00f7 100', fm(g.cost ?? g.qty * 1000));
  });
  return rows;
}

// Level-3 drill: composition of the pre-ladder pool (coupon interest + pre-ladder AMD).
// Spec: 2.0 §Future 30Y Upper Cover AMD §Pre-Ladder Interest, 6.0 §Pre-ladder pool drill.
export function buildPreLadderPoolDrill(summary, plCreditForYear) {
  const couponPool = summary?.preLadderCouponPool ?? 0;
  const amdPool    = summary?.preLadderAmdPool ?? 0;
  const rollPool   = summary?.preLadderRollCouponPool ?? 0;
  const total      = summary?.preLadderPool ?? (couponPool + amdPool + rollPool);
  const years      = summary?.preLadderYears ?? 0;
  const rows = [
    { label: 'Pre-ladder coupon interest', note: years + ' yr \xd7 annual ladder coupon income', value: fm(couponPool) },
  ];
  if (amdPool > 0) {
    rows.push({ label: 'Pre-ladder AMD from excess TIPS', note: 'discount from sales of excess TIPS before the ladder starts', value: fm(amdPool) });
  }
  if (rollPool > 0) {
    rows.push({ label: 'Pre-ladder Future-30Y coupon', note: 'coupon on the 2052-roll Future-30Y TIPS for pre-ladder years 2053–56', value: fm(rollPool) });
  }
  rows.push({ sep: true });
  rows.push({ label: 'Total pre-ladder pool', note: 'coupon interest + AMD + Future-30Y roll coupon', value: fm(total), total: true });
  if (plCreditForYear > 0) {
    rows.push({ sep: true });
    rows.push({ label: 'Applied to this year', note: 'slice of the pool credited here', value: fm(plCreditForYear) });
  }
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
    const _amd = d.future30yUpperAnnualAmd || 0;
    const _roll = d.future30yRollCoupon || 0;
    // The credit pass applies Available Cash first, so a year's credit and its cash are the same
    // dollars — shown as two lines that split the credit, never added on top of it
    // (2.0 §Available Cash).
    const _creditTotal = d.preLadderCreditForYear || 0;
    const _cashCredit  = Math.min(d.availableCashCredit || 0, _creditTotal);
    // The settlement year's LMI is capped to not-yet-paid coupons only (2.0 §Settlement-year LMI
    // is remaining coupons only), unlike every other year's full-annual figure — the row must say
    // so, the same way the Cash Flow Calendar's Ref CPI label flags its own date exception (label
    // itself carries the disclosure, no separate explanatory sentence).
    const _isSettleYr = d.fundedYear === summary?.settlementYear;
    const _lmiLabel = _isSettleYr ? 'Remaining interest from longer-dated TIPS' : 'Interest from longer-dated TIPS';
    const _lmiDesc = _isSettleYr
      ? 'coupons from TIPS maturing after this year, paid on or after today, based on RMD Options selection'
      : 'from TIPS maturing after ' + d.fundedYear;
    // Multi-TIPS funded year (semiannual / all): the year's principal is delivered by several TIPS
    // with different par values, so list each TIPS's P+I contribution (like the rebalance Amount drill)
    // rather than a single "Par Value × Qty". Single-TIPS years keep the detailed per-bond breakdown.
    const _rungs = (d.fundedRungs && d.fundedRungs.length > 1) ? d.fundedRungs : null;

    let totalFmla = _rungs
      ? 'Funded-year TIPS + <span class="formula-var" data-source="lmi">Longer-dated int</span>'
      : 'Principal + Coupons + <span class="formula-var" data-source="lmi">Longer-dated int</span>';
    if (sameYearExInt > 0) totalFmla += ' + <span class="formula-var" data-source="exlmi">Same-year excess int</span>';
    if (_plCredit - _cashCredit > 0) totalFmla += ' + Pre-ladder credit';
    if (_amd > 0) totalFmla += ' + <span class="formula-var" data-source="amd">AMD</span>';
    if (_roll > 0) totalFmla += ' + <span class="formula-var" data-source="roll">Future-30Y coupon</span>';
    if (_cashCredit > 0) totalFmla += ' + Available cash';

    if (_rungs) {
      let ownSum = 0;
      let rungRows = '';
      _rungs.forEach(h => {
        const piPB = h.principalPerBond * (1 + h.coupon / 2 * h.nPeriods);
        const hTotal = piPB * h.qty;
        ownSum += hTotal;
        const mo = MONTHS[h.maturityMonth], yr = String(h.maturityYear).slice(2);
        rungRows += row(mo + ' ’' + yr + ' \xd7 ' + h.qty, fm2(piPB) + '/TIPS', fm(hTotal));
      });
      rows =
        rungRows +
        sep() +
        row('Funded-year TIPS subtotal', 'principal + last-year coupons across the year’s TIPS', fm(ownSum)) +
        row(_lmiLabel, _lmiDesc, fm(longerDatedInt), false, undefined, 'lmi') +
        (sameYearExInt > 0 ? row('Interest from same-year excess (bracket)', 'from excess TIPS maturing in ' + d.fundedYear, fm(sameYearExInt), false, undefined, 'exlmi') : '') +
        (_plCredit - _cashCredit > 0 ? row('Pre-ladder credit', 'pre-ladder pool applied to this year', fm(_plCredit - _cashCredit), false, 'plcpool') : '') +
        (_amd > 0 ? row('AMD from excess TIPS', 'accrued market discount from sales of excess TIPS', fm(_amd), false, undefined, 'amd') : '') +
        (_roll > 0 ? row('Future-30Y coupon (2052 roll)', 'coupon on the Future-30Y TIPS bought with the matured 2052 cover proceeds (upper-cover share)', fm(_roll), false, undefined, 'roll') : '') +
        (_cashCredit > 0 ? row('Available cash', 'cash on hand applied to this year', fm(_cashCredit)) : '') +
        sep() +
        row('Funded Year Amount', totalFmla, fm(d.fundedYearAmt), true) +
        sep() +
        row('DARA', '', fm(d.dara), false, undefined, 'dara') +
        row('Surplus / Deficit', '<span class="formula-var" data-source="total">FY Amount</span> − <span class="formula-var" data-source="dara">DARA</span>', (d.fundedYearAmt - d.dara >= 0 ? '+' : '') + Math.round(d.fundedYearAmt - d.dara).toLocaleString('en-US'));
      return '<table style="border-collapse:collapse;width:auto;font-size:12px">' + rows + '</table>';
    }

    rows =
      row('Quantity', '', d.fundedYearQty, false, undefined, 'qty') +
      sep() +
      bondVarRows(d, nPeriods, principalPerBond, couponPct) +
      sep() +
      row('Principal', '<span class="formula-var" data-source="ppb">Par Value/TIPS</span> \xd7 <span class="formula-var" data-source="qty">Quantity</span>', fm(d.fundedYearPrincipalTotal)) +
      row(couponLabel, '<span class="formula-var" data-source="ppb">Par Value/TIPS</span> \xd7 <span class="formula-var" data-source="cpp">coupon/period</span> \xd7 <span class="formula-var" data-source="cp">periods</span> \xd7 <span class="formula-var" data-source="qty">Quantity</span>', fm(d.fundedYearOwnRungInt)) +
      row(_lmiLabel, _lmiDesc, fm(longerDatedInt), false, undefined, 'lmi') +
      (sameYearExInt > 0 ? row('Interest from same-year excess (bracket)', 'from excess TIPS maturing in ' + d.fundedYear, fm(sameYearExInt), false, undefined, 'exlmi') : '') +
      (_plCredit - _cashCredit > 0 ? row('Pre-ladder credit', 'pre-ladder pool applied to this year', fm(_plCredit - _cashCredit), false, 'plcpool') : '') +
      (_amd > 0 ? row('AMD from excess TIPS', 'accrued market discount from sales of excess TIPS', fm(_amd), false, undefined, 'amd') : '') +
      (_roll > 0 ? row('Future-30Y coupon (2052 roll)', 'coupon on the Future-30Y TIPS bought with the matured 2052 cover proceeds (upper-cover share)', fm(_roll), false, undefined, 'roll') : '') +
      (_cashCredit > 0 ? row('Available cash', 'cash on hand applied to this year', fm(_cashCredit)) : '') +
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
      row('Dated Ref CPI', '', fd(d.datedDateRefCpi, 5), false, undefined, 'basecpi') +
      row('Index ratio', '<span class="formula-var" data-source="refcpi">Ref CPI</span> \xf7 <span class="formula-var" data-source="basecpi">Dated Ref CPI</span>', fd(d.indexRatio, 5), false, 'indexRatio', 'ir') +
      row('Cost per TIPS', '<span class="formula-var" data-source="price">price/100</span> \xd7 <span class="formula-var" data-source="ir">index ratio</span> \xd7 1,000', fm2(d.costPerBond), false, undefined, 'cpb') +
      sep() +
      row('Funded Year Cost', '<span class="formula-var" data-source="cpb">Cost per TIPS</span> \xd7 <span class="formula-var" data-source="qty">Quantity</span>', fm(d.fundedYearCost), true);

  // ── Build: Bracket Amount / Bracket Cost ───────────────────────────────────────
  } else if (colKey === 'bracketAmount' || colKey === 'bracketCost') {
    const s = summary;
    const isAmt = colKey === 'bracketAmount';
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
        const bracketLMIAlloc = d.gapLMIAlloc ?? 0;
        rows += sep()
          + bondVarRows(d, nPeriods, principalPerBond, couponPct)
          + sep()
          + row('P+I per TIPS', '<span class="formula-var" data-source="ppb">Par Value/TIPS</span> \xd7 (1 + <span class="formula-var" data-source="cpp">coupon/period</span> \xd7 <span class="formula-var" data-source="cp">periods</span>)', fm2(d.fundedYearPi), false, undefined, 'pipb')
          + sep()
          + row('P+I from excess TIPS', '<span class="formula-var" data-source="pipb">P+I/TIPS</span> \xd7 <span class="formula-var" data-source="qty">Excess Qty</span>', fm(d.excessQty * d.fundedYearPi), false, undefined, 'pix')
          + (bracketLMIAlloc > 0 ? row('Bracket LMI credit', 'Bracket weight \xd7 LMI into gap years (actual funded year interest + inter-gap synthetic interest)', fm(bracketLMIAlloc), false, undefined, 'glmi') : '')
          + sep()
          + row('Bracket Amount', '<span class="formula-var" data-source="pix">P+I from excess</span>' + (bracketLMIAlloc > 0 ? ' + <span class="formula-var" data-source="glmi">Bracket LMI credit</span>' : ''), fm(d.excessAmt), true);
      } else {
        rows += row('Bracket Cost', '<span class="formula-var" data-source="cpb">Cost per TIPS</span> \xd7 <span class="formula-var" data-source="qty">Excess Quantity</span>', fm(d.excessCost), true);
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
        + row('Future 30Y total cost', 'Sum of the synthetic Future 30Y year costs', fm(s.future30yParams?.future30yTotalCost ?? 0), true, undefined, 'ftc')
        + row('Target excess cost', '<span class="formula-var" data-source="ftc">total cost</span> \xd7 ' + wLabel.toLowerCase(), fm(exCost), false, undefined, 'tec')
        + sep()
        + row('Cost per TIPS', '<span class="formula-var" data-source="price">price/100</span> \xd7 <span class="formula-var" data-source="ir">index ratio</span> \xd7 1,000', fm2(d.costPerBond), false, undefined, 'cpb')
        + row('Excess Quantity', 'round(<span class="formula-var" data-source="tec">target cost</span> \xf7 <span class="formula-var" data-source="cpb">Cost per TIPS</span>)', d.excessQty);
      if (isAmt) {
        const grossPI = d.excessQty * d.fundedYearPi;
        const amdNet  = d.excessAmdLifetime || 0;     // accretion delivered to earlier years as AMD
        const lmiAdd  = d.future30yLMIAlloc || 0;      // intra-block coupon add-back (this cover's share)
        let amtFmla = '<span class="formula-var" data-source="expi">Excess P+I</span>';
        if (amdNet > 0) amtFmla += ' − <span class="formula-var" data-source="amdn">AMD credited earlier</span>';
        if (lmiAdd > 0) amtFmla += ' + <span class="formula-var" data-source="lmiadd">coupon add-back</span>';
        rows += sep()
          + bondVarRows(d, nPeriods, principalPerBond, couponPct)
          + sep()
          + row('P+I per TIPS', '<span class="formula-var" data-source="ppb">Par Value/TIPS</span> \xd7 (1 + <span class="formula-var" data-source="cpp">coupon/period</span> \xd7 <span class="formula-var" data-source="cp">periods</span>)', fm2(d.fundedYearPi), false, undefined, 'pipb')
          + row('Excess P+I', '<span class="formula-var" data-source="pipb">P+I/TIPS</span> \xd7 <span class="formula-var" data-source="qty">Excess Quantity</span>', fm(grossPI), false, undefined, 'expi')
          + (amdNet > 0 ? row('AMD credited to earlier years', 'this cover’s market discount is delivered to the funded years it accrues in (AMD line items), not as coverage here — netted out to avoid double-counting', '−' + fm(amdNet), false, undefined, 'amdn') : '')
          + (lmiAdd > 0 ? row('+ Future-30Y coupon add-back', 'this cover’s share of the block coupon that sized the synthetic Future-30Y rungs down (analog of the bracket-LMI add-back)', fm(lmiAdd), false, undefined, 'lmiadd') : '')
          + sep()
          + row('Future 30Y Cover Amount', amtFmla, fm(d.excessAmt), true);
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
    const _plCredit   = isBef ? (d.preLadderCreditForYearBefore || 0) : (d.preLadderCreditForYear || 0);
    const _amd        = isBef ? (d.future30yUpperAnnualAmdBefore || 0) : (d.future30yUpperAnnualAmd || 0);
    const _roll       = isBef ? (d.future30yRollCouponBefore || 0)     : (d.future30yRollCoupon || 0);
    // After: cash is part of the credit, so it splits it. Before: no rung was sized down, so the
    // cash the holder actually has is a plain addition (2.0 §Available Cash).
    const _cashRaw    = isBef ? (d.availableCashCreditBefore || 0) : (d.availableCashCredit || 0);
    const _cashCredit = isBef ? _cashRaw : Math.min(_cashRaw, _plCredit);
    const _plShown    = isBef ? _plCredit : _plCredit - _cashCredit;
    // Settlement-year LMI is capped to not-yet-paid coupons only (2.0 §Settlement-year LMI is
    // remaining coupons only) — same disclosure as the Build "amount" popup above.
    const _isSettleYr = d.fundedYear === summary?.settlementYear;
    const _lmiLabel = _isSettleYr ? 'Remaining interest from longer-dated TIPS' : 'Interest from longer-dated TIPS';
    const _lmiDesc = _isSettleYr
      ? 'coupons from TIPS maturing after this year, paid on or after today, based on RMD Options selection'
      : 'from TIPS maturing after ' + d.fundedYear;
    // Compute ownSum first so we can detect PLI-zeroed years (holdings present but all qty=0).
    let ownSum = 0;
    holdings.forEach(h => { ownSum += h.principalPerBond * (1 + h.coupon / 2 * h.nPeriods) * h.qty; });
    // PLI-zeroed years: holdings exist but all qty=0 (vs new rungs where holdings=[]).
    // Display inferredDARA as "Amount Before" since PLI fully covered the rung's need.
    const _pliZeroed  = isBef && holdings.length > 0 && ownSum === 0 && (summary?.inferredDARA ?? 0) > 0;
    const _displayAmt = _pliZeroed ? Math.round(summary.inferredDARA) : araTotal;
    ownSum = 0;
    holdings.forEach((h, i) => {
      const piPB = h.principalPerBond * (1 + h.coupon / 2 * h.nPeriods);
      const hTotal = piPB * h.qty;
      ownSum += hTotal;
      const mo = MONTHS[h.maturityMonth];
      const yr = String(h.maturityYear).slice(2);
      // Two distinct TIPS can share a maturity month/year (e.g. an 'all maturity months' funded
      // year picking up a second, previously-unheld candidate) -- the CUSIP disambiguates what
      // would otherwise render as an unexplained duplicate "Jan '27" line.
      const label = mo + ' \u2019' + yr + (h.cusip ? ' (' + h.cusip + ')' : '') + ' \xd7 ' + h.qty;
      rows += row(label, '<span class="drill-l3" data-l3="pipb-' + i + '" style="cursor:pointer;text-decoration:underline dotted #94a3b8;">' + fm2(piPB) + '/TIPS</span>', fm(hTotal));
    });
    rows += sep()
      + row('Funded year TIPS subtotal', '', fm(ownSum))
      + row(_lmiLabel, _lmiDesc, fm(laterMatInt), false, undefined, 'lmi');
    const excessLMI = isBef ? d.excessLMI_Before : d.excessLMI_After;
    if (excessLMI > 0) {
      const _exDesc = d.isFuture30yCover
        ? 'from additional ' + d.fundedYear + ' TIPS held to cover Future 30Y rungs'
        : 'from additional ' + d.fundedYear + ' TIPS held to cover gap years, where 10-year TIPS have not yet been issued';
      rows += row('Interest from same-year excess (bracket)', _exDesc, fm(excessLMI), false, undefined, 'exlmi');
    }
    if (_plShown > 0) {
      rows += row('Pre-ladder credit', 'pre-ladder pool applied to this year', fm(_plShown), false, 'plcpool', 'plc');
    }
    if (_amd > 0) {
      rows += row('AMD from excess TIPS', 'accrued market discount from sales of excess TIPS', fm(_amd), false, undefined, 'amd');
    }
    if (_roll > 0) {
      rows += row('Future-30Y coupon (2052 roll)', 'coupon on the Future-30Y TIPS bought with the matured 2052 cover proceeds (upper-cover share)', fm(_roll), false, undefined, 'roll');
    }
    if (_cashCredit > 0) {
      rows += row('Available cash', 'cash on hand applied to this year', fm(_cashCredit));
    }
    let totalFmla = _pliZeroed
      ? 'Inferred from CSV'
      : 'Funded year TIPS + <span class="formula-var" data-source="lmi">Longer-dated int</span>';
    if (!_pliZeroed && excessLMI > 0) totalFmla += ' + <span class="formula-var" data-source="exlmi">Same-year excess int</span>';
    if (!_pliZeroed && _plShown > 0) totalFmla += ' + <span class="formula-var" data-source="plc">Pre-ladder credit</span>';
    if (!_pliZeroed && _amd > 0) totalFmla += ' + <span class="formula-var" data-source="amd">AMD</span>';
    if (!_pliZeroed && _roll > 0) totalFmla += ' + <span class="formula-var" data-source="roll">Future-30Y coupon</span>';
    if (!_pliZeroed && _cashCredit > 0) totalFmla += ' + Available cash';
    rows += sep()
      + row(isBef ? 'Amount Before' : 'Amount After', totalFmla, fm(_displayAmt), true)
      + sep()
      + row('DARA', '', fm(DARA), false, undefined, 'dara')
      + row('Surplus / Deficit', (isBef ? 'Amount Before' : 'Amount After') + ' \u2212 <span class="formula-var" data-source="dara">DARA</span>',
            (_displayAmt - DARA >= 0 ? '+' : '') + Math.round(_displayAmt - DARA).toLocaleString('en-US'));

  // ── Rebalance: Qty Before / After (funded-year row only) ──────────────────
  } else if (colKey === 'qtyAfter' || colKey === 'qtyBefore' || colKey === 'qty') {
    const isBef = colKey === 'qtyBefore';
    if (isBef) {
      rows = row('Quantity Before', '', d.fundedYearQtyBefore, true);
    } else {
      const fyQty = d.fundedYearQtyAfter ?? d.fundedYearQty;
      const isSettleYr = d.fundedYear === summary?.settlementYear;
      const lmiLabel = isSettleYr ? 'Remaining interest from longer-dated TIPS' : 'Interest from longer-dated TIPS';
      const lmiDesc = isSettleYr
        ? 'coupons from TIPS maturing after this year, paid on or after today, based on RMD Options selection'
        : 'from TIPS maturing after ' + d.fundedYear;
      const laterMatInt = d.araAfterLaterMatInt ?? 0;
      const sameYearExInt = d.excessLMI_After || 0;
      const plCredit = d.preLadderCreditForYear || 0;
      const amd = d.future30yUpperAnnualAmd || 0;
      const roll = d.future30yRollCoupon || 0;
      const cashCredit = Math.min(d.availableCashCredit || 0, plCredit);
      const piPerBond = principalPerBond * (1 + d.coupon / 2 * nPeriods);
      const dara = d.DARA ?? 0;
      const needed = dara - laterMatInt - sameYearExInt - plCredit - amd - roll;

      let neededFmla = 'DARA − <span class="formula-var" data-source="lmi">Longer-dated int</span>';
      if (sameYearExInt > 0) neededFmla += ' − <span class="formula-var" data-source="exlmi">Same-year excess int</span>';
      if (plCredit > 0) neededFmla += ' − <span class="formula-var" data-source="plc">Pre-ladder credit</span>';
      if (amd > 0) neededFmla += ' − <span class="formula-var" data-source="amd">AMD</span>';
      if (roll > 0) neededFmla += ' − <span class="formula-var" data-source="roll">Future-30Y coupon</span>';


      // P+I needed is the funded YEAR's total requirement; it equals this row's own quantity only
      // when this CUSIP is the only TIPS held for the year. When multiple TIPS share a funded year
      // (Maturity preference: All maturity months / Semiannual), the need is split across them per
      // Allocation policy, which this popup doesn't re-derive — say so rather than show a formula
      // that wouldn't reconcile to this row's own quantity.
      const computedQty = piPerBond > 0 ? Math.max(0, Math.round(needed / piPerBond)) : 0;
      const qtyFmla = computedQty === fyQty
        ? 'round(<span class="formula-var" data-source="needed">P+I needed</span> ÷ <span class="formula-var" data-source="pipb">P+I per TIPS</span>)'
        : 'this CUSIP’s share of the year’s P+I need, split across multiple TIPS per Allocation policy';

      rows =
        row('DARA', '', fm(dara), false, undefined, 'dara') +
        row(lmiLabel, lmiDesc, '−' + fm(laterMatInt), false, undefined, 'lmi') +
        (sameYearExInt > 0 ? row('Interest from same-year excess (bracket)', 'from excess TIPS maturing in ' + d.fundedYear, '−' + fm(sameYearExInt), false, undefined, 'exlmi') : '') +
        (plCredit > 0 ? row('Pre-ladder credit', 'pre-ladder pool applied to this year', '−' + fm(plCredit), false, undefined, 'plc') : '') +
        (amd > 0 ? row('AMD from excess TIPS', 'accrued market discount from sales of excess TIPS', '−' + fm(amd), false, undefined, 'amd') : '') +
        (roll > 0 ? row('Future-30Y coupon (2052 roll)', 'coupon on the Future-30Y TIPS bought with the matured 2052 cover proceeds (upper-cover share)', '−' + fm(roll), false, undefined, 'roll') : '') +
        (cashCredit > 0 ? row('↳ of which Available cash', 'cash on hand applied to this year', fm(cashCredit)) : '') +
        sep() +
        row('P+I needed', neededFmla, fm(needed), true, undefined, 'needed') +
        sep() +
        bondVarRows(d, nPeriods, principalPerBond, couponPct) +
        sep() +
        row('P+I per TIPS', '<span class="formula-var" data-source="ppb">Par Value/TIPS</span> × (1 + <span class="formula-var" data-source="cpp">coupon/period</span> × <span class="formula-var" data-source="cp">periods</span>)', fm2(piPerBond), false, undefined, 'pipb') +
        sep() +
        row('Quantity After', qtyFmla, fyQty, true);
    }

  // ── Rebalance: Excess Quantity After (bracket/cover excess sub-row only) ──────
  } else if (colKey === 'excessQtyAfter') {
    const exQty = d.excessQtyAfter ?? d.excessQty;
    const is3B = summary.bracketMode === '3bracket';
    const weight = is3B
      ? (d.fundedYear === summary.lowerYear ? summary.origLowerWeight : (d.fundedYear === summary.newLowerYear ? summary.newLowerWeight3 : summary.upperWeight3))
      : (d.fundedYear === summary.lowerYear ? summary.lowerWeight : summary.upperWeight);
    const targetExCost = (summary.gapParams?.totalCost ?? 0) * (weight ?? 0);
    const piPerBond = principalPerBond * (1 + d.coupon / 2 * nPeriods);

    rows =
      gapBreakdownRows(summary.gapParams, summary.DARA)
      + row('Gap total cost', 'Sum of gap year theoretical costs', fm(summary.gapParams?.totalCost ?? 0), true, undefined, 'gtc')
      + row('Bracket weight', 'from <a class="info-link" data-popup="duration" style="border-bottom:1px dotted #94a3b8;color:inherit;text-decoration:none;">Duration Calcs</a>', (weight ?? 0).toFixed(4), false, undefined, 'bw')
      + row('Target excess cost', '<span class="formula-var" data-source="gtc">Gap total cost</span> × <span class="formula-var" data-source="bw">Bracket weight</span>', fm(targetExCost), false, undefined, 'tec')
      + row('Cost per TIPS', 'price/100 × index ratio × 1,000', fm2(d.costPerBond), false, undefined, 'cpbn')
      + row('Excess Quantity', 'round(<span class="formula-var" data-source="tec">Target cost</span> ÷ <span class="formula-var" data-source="cpbn">Cost per TIPS</span>)', exQty, true)
      + sep()
      + bondVarRows(d, nPeriods, principalPerBond, couponPct)
      + sep()
      + row('P+I per TIPS', '<span class="formula-var" data-source="ppb">Par Value/TIPS</span> × (1 + <span class="formula-var" data-source="cpp">coupon/period</span> × <span class="formula-var" data-source="cp">periods</span>)', fm2(piPerBond), false, undefined, 'pipb')
      + row('Excess Amount After', '<span class="formula-var" data-source="qty">Excess Quantity</span> × <span class="formula-var" data-source="pipb">P+I per TIPS</span>', fm(exQty * piPerBond), true);

  // ── Rebalance: Cash Delta ─────────────────────────────────────────────────────
  } else if (colKey === 'cashDelta') {
    const qtyDelta  = d.fundedYearQtyDelta;
    const cashDelta = -(qtyDelta * d.costPerBond);
    const qdSign    = qtyDelta >= 0 ? '+' : '';
    const cdSign    = cashDelta >= 0 ? '+' : '';
    // Funded-year quantity only \u2014 mirrors the Excess Cash Delta popup, which is likewise
    // funded-year-free. A bracket-target CUSIP's funded and excess portions are the SAME held
    // maturity, but a rebalance never splits one CUSIP's holdings into buckets, so no such split
    // (or the CUSIP's total held quantity) is shown here.
    rows =
      row('Quantity delta', 'Quantity After \u2212 Quantity Before', qdSign + qtyDelta, false, undefined, 'qty') +
      sep() +
      row('Price (unadjusted)', '', fd(d.price, 4), false, undefined, 'price') +
      row('Ref CPI (settlement date)', '', fd(d.refCPI, 5), false, 'refCPI', 'refcpi') +
      row('Dated Ref CPI', '', fd(d.datedDateRefCpi, 5), false, undefined, 'basecpi') +
      row('Index ratio', '<span class="formula-var" data-source="refcpi">Ref CPI</span> \xf7 <span class="formula-var" data-source="basecpi">Dated Ref CPI</span>', fd(d.indexRatio, 5), false, 'indexRatio', 'ir') +
      row('Cost per TIPS', '<span class="formula-var" data-source="price">price/100</span> \xd7 <span class="formula-var" data-source="ir">index ratio</span> \xd7 1,000', fm2(d.costPerBond), false, undefined, 'cpb') +
      sep() +
      row('Cash \u0394', '\u2212(<span class="formula-var" data-source="qty">Quantity delta</span> \xd7 <span class="formula-var" data-source="cpb">Cost per TIPS</span>)', cdSign + fm(Math.abs(cashDelta)), true);

  // ── Rebalance: Cost Before / After ────────────────────────────────────────────
  } else if (colKey === 'costBefore' || colKey === 'costAfter') {
    const isBef    = colKey === 'costBefore';
    const qty      = isBef ? d.fundedYearQtyBefore : d.fundedYearQtyAfter;
    const cost     = qty * d.costPerBond;
    rows =
      row(isBef ? 'Quantity Before' : 'Quantity After', '', qty, false, undefined, 'qty') +
      sep() +
      row('Price (unadjusted)', '', fd(d.price, 4), false, undefined, 'price') +
      row('Ref CPI (settlement date)', '', fd(d.refCPI, 5), false, 'refCPI', 'refcpi') +
      row('Dated Ref CPI', '', fd(d.datedDateRefCpi, 5), false, undefined, 'basecpi') +
      row('Index ratio', '<span class="formula-var" data-source="refcpi">Ref CPI</span> \xf7 <span class="formula-var" data-source="basecpi">Dated Ref CPI</span>', fd(d.indexRatio, 5), false, 'indexRatio', 'ir') +
      row('Cost per TIPS', '<span class="formula-var" data-source="price">price/100</span> \xd7 <span class="formula-var" data-source="ir">index ratio</span> \xd7 1,000', fm2(d.costPerBond), false, undefined, 'cpb') +
      sep() +
      row(isBef ? 'Cost Before' : 'Cost After', '<span class="formula-var" data-source="qty">Quantity</span> \xd7 <span class="formula-var" data-source="cpb">Cost per TIPS</span>', fm(cost), true);

  // ── Rebalance: Bracket Amt/Cost Before/After ───────────────────────────────────
  } else if (colKey === 'bracketAmtBefore' || colKey === 'bracketAmtAfter' || colKey === 'bracketCostBefore' || colKey === 'bracketCostAfter') {
    const s       = summary;
    const isAfter = colKey === 'bracketAmtAfter' || colKey === 'bracketCostAfter';
    const isAmt   = colKey === 'bracketAmtBefore' || colKey === 'bracketAmtAfter';
    const piPerBond = principalPerBond * (1 + d.coupon / 2 * nPeriods);
    if (!isAfter) {
      const exQty = d.excessQtyBefore;
      rows = row('Excess Quantity', '', exQty, false, undefined, 'qty')
        + sep()
        + bondVarRows(d, nPeriods, principalPerBond, couponPct) + sep();
      if (isAmt) {
        rows += row('P+I per TIPS', '<span class="formula-var" data-source="ppb">Par Value/TIPS</span> \xd7 (1 + <span class="formula-var" data-source="cpp">coupon/period</span> \xd7 <span class="formula-var" data-source="cp">periods</span>)', fm2(piPerBond), false, undefined, 'pipb')
          + sep()
          + coverageAmtRows('Excess Amount Before', exQty * piPerBond, d.excessLMIAlloc ?? 0, d.excessAmtBefore ?? exQty * piPerBond);
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
          + coverageAmtRows('Excess Amount After', exQty * piPerBond, d.excessLMIAlloc ?? 0, d.excessAmtAfter ?? exQty * piPerBond);
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
      rows = row('Excess Quantity', '', exQty, false, undefined, 'qty')
        + sep()
        + bondVarRows(d, nPeriods, principalPerBond, couponPct) + sep();
      if (isAmt) {
        rows += row('P+I per TIPS', '<span class="formula-var" data-source="ppb">Par Value/TIPS</span> \xd7 (1 + <span class="formula-var" data-source="cpp">coupon/period</span> \xd7 <span class="formula-var" data-source="cp">periods</span>)', fm2(piPerBond), false, undefined, 'pipb')
          + sep()
          + coverageAmtRows('Future 30Y Cover Amount Before', exQty * piPerBond, d.excessLMIAlloc ?? 0, d.excessAmtBefore ?? exQty * piPerBond);
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
        + row('Future 30Y total cost', 'Sum of the synthetic Future 30Y year costs', fm(s.future30yParams?.future30yTotalCost ?? 0), true, undefined, 'ftc')
        + row('Target excess cost', '<span class="formula-var" data-source="ftc">total cost</span> \xd7 ' + wLabel.toLowerCase(), fm(exCost));
      if (isAmt) {
        rows += sep()
          + bondVarRows(d, nPeriods, principalPerBond, couponPct)
          + sep()
          + row('P+I per TIPS', '<span class="formula-var" data-source="ppb">Par Value/TIPS</span> \xd7 (1 + <span class="formula-var" data-source="cpp">coupon/period</span> \xd7 <span class="formula-var" data-source="cp">periods</span>)', fm2(piPerBond), false, undefined, 'pipb')
          + sep()
          + coverageAmtRows('Future 30Y Cover Amount After', exQty * piPerBond, d.excessLMIAlloc ?? 0, d.excessAmtAfter ?? exQty * piPerBond);
      } else {
        rows += sep()
          + row('Future 30Y Cover Cost After', '<span class="formula-var" data-source="cpb">Cost per TIPS</span> \xd7 <span class="formula-var" data-source="qty">Excess Quantity</span>', fm(exQty * d.costPerBond), true);
      }
    }

  // ── Rebalance: Excess Cash Delta (bracket/cover excess row) ──────────────────
  } else if (colKey === 'excessCashDelta') {
    const exQtyDel  = d.excessQtyDelta;
    const excessCash = -(exQtyDel * d.costPerBond);
    const delSign   = exQtyDel >= 0 ? '+' : '';
    const cashSign  = excessCash >= 0 ? '+' : '';
    // Mirrors the funded-year Cash Delta popup: a rebalance does not split a CUSIP's holdings
    // into funded-year and excess buckets, so no such split is shown here. Excess quantity is
    // set by Gap Dur duration matching (see that popup); this only explains the cash delta.
    rows =
      row('Excess quantity delta', 'Excess Quantity After − Excess Quantity Before', delSign + exQtyDel, false, undefined, 'qty') +
      sep() +
      row('Price (unadjusted)', '', fd(d.price, 4), false, undefined, 'price') +
      row('Ref CPI (settlement date)', '', fd(d.refCPI, 5), false, 'refCPI', 'refcpi') +
      row('Dated Ref CPI', '', fd(d.datedDateRefCpi, 5), false, undefined, 'basecpi') +
      row('Index ratio', '<span class="formula-var" data-source="refcpi">Ref CPI</span> ÷ <span class="formula-var" data-source="basecpi">Dated Ref CPI</span>', fd(d.indexRatio, 5), false, 'indexRatio', 'ir') +
      row('Cost per TIPS', '<span class="formula-var" data-source="price">price/100</span> × <span class="formula-var" data-source="ir">index ratio</span> × 1,000', fm2(d.costPerBond), false, undefined, 'cpb') +
      sep() +
      row('Excess Cash Δ', '−(<span class="formula-var" data-source="qty">Excess quantity delta</span> × <span class="formula-var" data-source="cpb">Cost per TIPS</span>)', cashSign + fm(Math.abs(excessCash)), true);

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
    { label: 'Dated Ref CPI', value: fd(d.datedDateRefCpi, 5) },
    { sep: true },
    { label: 'Index Ratio', note: 'Settlement Ref CPI / Dated Ref CPI', value: fd(d.indexRatio, 5), total: true },
    { sep: true },
    { label: 'Authority', note: '31 CFR § 356.30', value: '<a href="https://www.ecfr.gov/current/title-31/subtitle-B/chapter-II/subchapter-A/part-356/subpart-C/section-356.30" target="_blank" style="color:#1a56db;text-decoration:none">\u00a7 356.30 \u2197</a>' }
  ];
}

// ─── Trade Ticket popups (5.0 §Trade Ticket) ──────────────────────────────────
// r: { price, indexRatio, costPerBond, coupon, A, E, accruedPerBond, qty,
//      cost, accruedInterest, totalCost } — built per-row in index.html.
// "Cost" (not "Principal") deliberately — Principal already means the inflation-adjusted
// FACE value (1,000 × index ratio, see bond-math.js principalPerBond); this is the dollar
// amount paid, which additionally reflects market price. Matches the main table's existing
// Cost / Cost Before / Cost After columns and "Cost per TIPS" popup wording.
export function buildTradeTicketCostDrill(r) {
  return [
    { label: 'Price', note: 'quoted, % of par', value: fd(r.price, 3) },
    { label: 'Index Ratio', note: 'settlement Ref CPI ÷ dated Ref CPI', value: fd(r.indexRatio, 5) },
    { sep: true },
    { label: 'Cost per TIPS', note: 'price/100 \xd7 index ratio \xd7 1,000', value: fm2(r.costPerBond) },
    { label: 'Quantity', value: r.qty },
    { sep: true },
    { label: 'Cost', note: 'cost per TIPS \xd7 quantity', value: fm(r.cost), total: true },
  ];
}

export function buildTradeTicketAccruedDrill(r) {
  return [
    { label: 'Days since last coupon (A)', value: fd(r.A, 0) },
    { label: 'Days in coupon period (E)', value: fd(r.E, 0) },
    { label: 'Coupon ÷ 2', note: 'semiannual rate', value: fd(r.coupon / 2 * 100, 5) + '%' },
    { sep: true },
    { label: 'Accrued Interest per TIPS', note: '(A ÷ E) \xd7 (coupon/2 \xd7 1,000 \xd7 index ratio)', value: fm2(r.accruedPerBond) },
    { label: 'Quantity', value: r.qty },
    { sep: true },
    { label: 'Accrued Interest', note: 'accrued interest per TIPS \xd7 quantity', value: fm(r.accruedInterest), total: true },
  ];
}

export function buildTradeTicketTotalDrill(r, label) {
  return [
    { label: 'Cost', value: fm(r.cost) },
    { label: 'Accrued Interest', value: fm(r.accruedInterest) },
    { sep: true },
    { label: label || 'Total Cost', value: fm(r.totalCost), total: true },
  ];
}

// ─── Cash Flow Calendar: per-date breakdown (5.0 §Cash Flow Calendar) ─────────
// bucket: { date, coupon, principal, events: [{ cusip, type, amount, qty, refCPI, datedDateRefCpi, indexRatio, principalPerBond, coupon, isActual, refCpiDateDisplay }] }
// Ref CPI is a single national series, not per-bond, so every event sharing this date shares the
// same refCPI/isActual/refCpiDateDisplay — shown once at the top rather than repeated per line.
export function buildCashFlowDateDrill(bucket) {
  const first = bucket.events[0];
  const rows = [];
  if (first) {
    rows.push({ label: first.isActual ? 'Cpn Ref CPI date' : 'Ref CPI date', value: first.refCpiDateDisplay });
    rows.push({ label: 'Ref CPI', value: fd(first.refCPI, 5) });
    rows.push({ sep: true });
  }
  bucket.events.forEach((e, i) => {
    rows.push({
      label: '<span class="cf-event-drill" data-cf-event-idx="' + i + '" style="cursor:pointer;text-decoration:underline dotted #94a3b8;">'
        + e.cusip + (e.type === 'principal' ? ' — Principal' : ' — Coupon') + '</span>',
      value: fm2(e.amount),
    });
  });
  rows.push({ sep: true });
  rows.push({ label: 'Total', value: fm2(bucket.coupon + bucket.principal), total: true });
  return rows;
}

// Nested (click a CUSIP line inside the per-date popup): how that one CUSIP's payment was
// calculated. The date's Ref CPI is already shown once above (buildCashFlowDateDrill) — this starts
// from Dated Ref CPI so nothing is repeated.
export function buildCashFlowEventDrill(e) {
  const rows = [
    { label: 'Ref CPI', value: fd(e.refCPI, 5) },
    { label: 'Dated Ref CPI', value: fd(e.datedDateRefCpi, 5) },
    { label: 'Index ratio', note: 'Ref CPI \xf7 Dated Ref CPI', value: fd(e.indexRatio, 5) },
    { label: 'Par Value per TIPS', note: '1,000 \xd7 index ratio', value: fm2(e.principalPerBond) },
  ];
  if (e.type === 'coupon') {
    rows.push({ label: 'Coupon per period', note: 'annual coupon \xf7 2', value: fd(e.coupon / 2 * 100, 5) + '%' });
    rows.push({ sep: true });
    rows.push({ label: 'Coupon per TIPS', note: 'Par Value/TIPS \xd7 coupon/period', value: fm2(e.principalPerBond * e.coupon / 2) });
  } else {
    rows.push({ sep: true });
    rows.push({ label: 'Principal per TIPS', note: 'Par Value/TIPS at this index ratio', value: fm2(e.principalPerBond) });
  }
  rows.push({ label: 'Quantity', value: e.qty });
  rows.push({ sep: true });
  rows.push({ label: e.type === 'principal' ? 'Principal' : 'Coupon', note: 'Amount per TIPS \xd7 Quantity', value: fm2(e.amount), total: true });
  return rows;
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
        + '<div style="font-size:9px;color:#334155">' + b.label + '</div>'
        + '<div style="width:2px;height:24px;background:#3b82f6;margin:2px auto 0;opacity:0.4;"></div>'
      + '</div>';
  });

  return '<div style="margin:0 0 8px;padding:32px 10px 32px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;position:relative;user-select:none;">'
    + '<div style="height:4px;background:#cbd5e1;border-radius:2px;position:relative;margin:0 20px;">'
      + [min, max].map(v => '<div style="position:absolute;top:8px;left:' + px(v) + '%;transform:translateX(-50%);font-size:9px;color:#334155">' + v + 'y</div>').join('')
      + '<div style="position:absolute;top:-2px;left:' + ap + '%;width:12px;height:12px;background:#1e293b;transform:translate(-50%, -50%) rotate(45deg);z-index:1;" title="Fulcrum: Avg Duration (' + avgDur.toFixed(2) + 'y)"></div>'
      + '<div style="position:absolute;top:12px;left:' + ap + '%;transform:translateX(-50%);text-align:center;white-space:nowrap;">'
        + '<div style="font-weight:700;color:#1e293b">' + avgDur.toFixed(2) + 'y</div>'
        + '<div style="font-size:9px;color:#334155">Average</div>'
      + '</div>'
      + bucketHtml
    + '</div>'
    + '</div>';
}

// Portfolio Avg Mod Dur / Avg Yld / Avg SA Yld popups (4.0 §Weighted Modified Duration): each
// holding's own value (modified duration, or yield/SA yield from market data), weighted by market
// value. `details` carries `mktValue` (single source, set alongside `mDuration`/`yield`/`saYield`
// in build-lib.js / rebalance-lib.js) so no popup can ever drift from the number it explains.
function _weightedAvgPopupRows(details, avg, { field, quantityLabel, fmtValue }) {
  const held = details.filter(d => d.mktValue > 0).sort((a, b) => a.fundedYear - b.fundedYear);
  if (held.length === 0) return [{ label: 'No holdings', total: true }];
  const mvSum = held.reduce((s, d) => s + d.mktValue, 0);

  const rows = [{ heading: 'Holdings' }];
  held.forEach(d => {
    const v = d[field];
    rows.push({
      label: d.fundedYear + ' · ' + d.cusip,
      note: d.maturityStr + ' — ' + fm(d.mktValue) + ' MV',
      value: v != null ? fmtValue(v) : '—',
    });
  });
  rows.push(
    { sep: true },
    { label: 'Weighted by market value',
      note: 'Σ(MV × ' + quantityLabel + ') ÷ ' + fm(mvSum) + ' total MV',
      value: fmtValue(avg), total: true },
  );
  return rows;
}

export function buildWeightedDurationPopupRows(details, wad) {
  return _weightedAvgPopupRows(details, wad, { field: 'mDuration', quantityLabel: 'Mod Dur', fmtValue: v => v.toFixed(2) });
}

export function buildWeightedYieldPopupRows(details, way) {
  return _weightedAvgPopupRows(details, way, { field: 'yield', quantityLabel: 'Yield', fmtValue: v => (v * 100).toFixed(2) + '%' });
}

export function buildWeightedSaYieldPopupRows(details, waySa) {
  return _weightedAvgPopupRows(details, waySa, { field: 'saYield', quantityLabel: 'SA Yield', fmtValue: v => (v * 100).toFixed(2) + '%' });
}

// Brackets are named by the maturity actually holding their excess, not by the year alone
// (DD Bracket Year TIPS). Shared so the weight drill and the popup that links to it agree.
// The row the gap and Future 30Y duration matches both end on: the check that defines Bracket
// Weight (DATA_DICTIONARY §Bracket Weight) — the cost-weighted mean of the durations equals the
// average duration of the years being covered. The mean is computed from the weights and
// durations shown rather than restated as the target, so a solve that does not reach the average
// shows it here. `kind` is 'bracket' or 'cover'; the arithmetic is identical either way.
function durationMatchRows(ws, ds, avg, kind) {
  const of    = kind === 'cover' ? 'cover year' : 'bracket year';
  const avgOf = kind === 'cover' ? 'the Future 30Y years' : 'the gap years';
  const terms = ws.map((w, i) => w.toFixed(4) + '  ×  ' + ds[i].toFixed(2)).join('   +   ');
  const mean  = ws.reduce((s, w, i) => s + w * ds[i], 0);
  const wSum  = ws.reduce((s, w) => s + w, 0);
  return [
    {
      label: 'Cost-weighted mean of the ' + of + ' durations',
      note: terms, value: mean.toFixed(2), total: true,
    },
    { prose: 'The ' + of + ' weights sum to ' + wSum.toFixed(4) + ', and are solved so that this mean'
        + ' equals the average duration of ' + avgOf + ', ' + avg.toFixed(2) + '.' },
  ];
}

function bracketLabels(summary, mode) {
  const lowerYear = mode === 'rebal' ? summary.brackets?.lowerYear : summary.lowerYear;
  const upperYear = mode === 'rebal' ? summary.brackets?.upperYear : summary.upperYear;
  const _my = d => (d ? MONTHS[d.getMonth()] + ' ' + d.getFullYear() : null);
  return {
    lowerYear, upperYear,
    lowerLabel: mode === 'build' ? summary.lowerMonth + ' ' + lowerYear
      : (_my(summary.brackets?.lowerMaturity) ?? String(lowerYear)),
    upperLabel: mode === 'build' ? summary.upperMonth + ' ' + upperYear
      : (_my(summary.brackets?.upperMaturity) ?? String(upperYear)),
    activeLabel: _my(summary.newLowerMaturity) ?? String(summary.newLowerYear),
  };
}

// Level-3 drill for one bracket weight, opened from a bracket row in the Gap Dur popup
// (5.0 §Nested (Level-3) drills, key `bracketwt-<which>`). Every term is named in full so the
// formula reads without a legend: a weight says weight, a duration says duration, and each names
// the bracket it belongs to. Values appear at the precision the popup shows them at, so the
// substitution can be checked against the rows it came from.
export function buildBracketWeightDrill(summary, mode, which) {
  const { lowerLabel, upperLabel, activeLabel } = bracketLabels(summary, mode);
  const is3  = mode === 'rebal' && summary.bracketMode === '3bracket' && summary.newLowerCUSIP;
  const avg  = summary.gapParams?.avgDuration ?? 0;
  const dRet = summary.lowerDuration ?? 0;
  const dAct = is3 ? (summary.newLowerDuration ?? 0) : (summary.lowerDuration ?? 0);
  const dUp  = summary.upperDuration ?? 0;
  const wRet = is3 ? (summary.origLowerWeight ?? 0) : 0;
  const wAct = is3 ? (summary.newLowerWeight3 ?? 0) : (summary.lowerWeight ?? 0);
  const wUp  = is3 ? (summary.upperWeight3 ?? summary.upperWeight ?? 0) : (summary.upperWeight ?? 0);

  const f2 = v => v.toFixed(2), f4 = v => v.toFixed(4);
  const fml = s => ({ html:
    '<div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;'
    + 'line-height:1.7;white-space:pre-wrap;color:#1e293b;">' + s + '</div>' });
  const DEF = 'The share of the gap years’ total cost carried by one bracket year. The weights '
    + 'across the bracket years sum to 1, solved so that the cost-weighted mean of the bracket year '
    + 'durations equals the average duration of the gap years. Durations here are modified durations.';

  const rows = [{ prose: DEF }, { sep: true }];

  if (which === 'retained') {
    const heldCost = summary.retainedExcessCostBefore;
    const totalCost = summary.gapParams?.totalCost ?? 0;
    const sold = !!summary.retainedBracketSold;
    rows.push({ heading: 'Formula' });
    if (sold) {
      // The duration match could not be reached with the retained bracket held where it was, so
      // it was reduced to the weight that brings the active lower bracket back to the excess it
      // already holds (gap-math.js bracketWeightsN; 2.0 §Retained Bracket Excess).
      rows.push(fml('retained lower bracket weight =\n'
        + '    (average gap year duration\n'
        + '       − active lower bracket weight × active lower bracket duration\n'
        + '       − (1 − active lower bracket weight) × upper bracket duration)\n'
        + '    ÷ (retained lower bracket duration − upper bracket duration)'));
      rows.push({ sep: true }, { heading: 'This ladder' });
      rows.push({ label: 'Retained lower bracket', value: lowerLabel });
      rows.push({ label: 'Average gap year duration', value: f2(avg) });
      rows.push({ label: 'Active lower bracket weight', value: f4(wAct) });
      rows.push({ label: 'Active lower bracket duration', value: f2(dAct) });
      rows.push({ label: 'Retained lower bracket duration', value: f2(dRet) });
      rows.push({ label: 'Upper bracket duration', value: f2(dUp) });
      rows.push({ sep: true }, { heading: 'Substituted' });
      rows.push(fml('(' + f2(avg) + '\n'
        + '   − ' + f4(wAct) + ' × ' + f2(dAct) + '\n'
        + '   − (1 − ' + f4(wAct) + ') × ' + f2(dUp) + ')\n'
        + '÷ (' + f2(dRet) + ' − ' + f2(dUp) + ')'));
    } else {
      rows.push(fml('retained lower bracket weight =\n'
        + '    excess already held in the retained lower bracket\n'
        + '    ÷ gap years’ total cost'));
      rows.push({ sep: true }, { heading: 'This ladder' });
      rows.push({ label: 'Retained lower bracket', value: lowerLabel });
      if (heldCost != null) {
        rows.push({ label: 'Excess already held, at cost',
                    value: '$' + Math.round(heldCost).toLocaleString() });
      }
      rows.push({ label: 'Gap years’ total cost',
                  value: '$' + Math.round(totalCost).toLocaleString() });
      if (heldCost != null && totalCost > 0) {
        rows.push({ sep: true }, { heading: 'Substituted' });
        rows.push(fml(Math.round(heldCost).toLocaleString() + ' ÷ ' + Math.round(totalCost).toLocaleString()));
      }
    }
    rows.push({ sep: true });
    rows.push({ label: 'Retained lower bracket weight', value: f4(wRet), total: true });
    rows.push({ sep: true });
    rows.push({ prose: sold
      ? 'The excess already held came to more than the duration match allows, so it was sold down '
        + 'to this weight — only as far as the match requires, and oldest maturity first. A rebalance '
        + 'never increases it.'
      : 'A rebalance never increases this weight. Where the duration match cannot be reached with '
        + 'the excess held where it is, the retained lower bracket is sold down — only as far as the '
        + 'match requires, and oldest maturity first — and this weight follows from the match instead.' });
    return rows;
  }

  if (which === 'active') {
    rows.push({ heading: 'Formula' });
    if (is3) {
      rows.push(fml('active lower bracket weight =\n'
        + '    (1 − retained lower bracket weight) − upper bracket weight'));
      rows.push({ sep: true }, { heading: 'This ladder' });
      rows.push({ label: 'Active lower bracket', value: activeLabel });
      rows.push({ label: 'Retained lower bracket weight', value: f4(wRet) });
      rows.push({ label: 'Upper bracket weight', value: f4(wUp) });
      rows.push({ sep: true }, { heading: 'Substituted' });
      rows.push(fml('(1 − ' + f4(wRet) + ') − ' + f4(wUp)));
    } else {
      rows.push(fml('active lower bracket weight =\n'
        + '    (upper bracket duration − average gap year duration)\n'
        + '    ÷ (upper bracket duration − active lower bracket duration)'));
      rows.push({ sep: true }, { heading: 'This ladder' });
      rows.push({ label: 'Active lower bracket', value: lowerLabel });
      rows.push({ label: 'Average gap year duration', value: f2(avg) });
      rows.push({ label: 'Active lower bracket duration', value: f2(dAct) });
      rows.push({ label: 'Upper bracket duration', value: f2(dUp) });
      rows.push({ sep: true }, { heading: 'Substituted' });
      rows.push(fml('(' + f2(dUp) + ' − ' + f2(avg) + ')'
        + ' ÷ (' + f2(dUp) + ' − ' + f2(dAct) + ')'));
    }
    rows.push({ sep: true });
    rows.push({ label: 'Active lower bracket weight', value: f4(wAct), total: true });
    return rows;
  }

  rows.push({ heading: 'Formula' });
  if (is3) {
    rows.push(fml('upper bracket weight =\n'
      + '    (average gap year duration\n'
      + '       − retained lower bracket weight × retained lower bracket duration\n'
      + '       − (1 − retained lower bracket weight) × active lower bracket duration)\n'
      + '    ÷ (upper bracket duration − active lower bracket duration)'));
    rows.push({ sep: true }, { heading: 'This ladder' });
    rows.push({ label: 'Upper bracket', value: upperLabel });
    rows.push({ label: 'Average gap year duration', value: f2(avg) });
    rows.push({ label: 'Retained lower bracket weight', value: f4(wRet) });
    rows.push({ label: 'Retained lower bracket duration', value: f2(dRet) });
    rows.push({ label: 'Active lower bracket duration', value: f2(dAct) });
    rows.push({ label: 'Upper bracket duration', value: f2(dUp) });
    rows.push({ sep: true }, { heading: 'Substituted' });
    rows.push(fml('(' + f2(avg) + '\n'
      + '   − ' + f4(wRet) + ' × ' + f2(dRet) + '\n'
      + '   − (1 − ' + f4(wRet) + ') × ' + f2(dAct) + ')\n'
      + '÷ (' + f2(dUp) + ' − ' + f2(dAct) + ')'));
  } else {
    rows.push(fml('upper bracket weight = 1 − active lower bracket weight'));
    rows.push({ sep: true }, { heading: 'This ladder' });
    rows.push({ label: 'Upper bracket', value: upperLabel });
    rows.push({ label: 'Active lower bracket weight', value: f4(wAct) });
    rows.push({ sep: true }, { heading: 'Substituted' });
    rows.push(fml('1 − ' + f4(wAct)));
  }
  rows.push({ sep: true });
  rows.push({ label: 'Upper bracket weight', value: f4(wUp), total: true });
  return rows;
}

export function buildDurationPopupRows(summary, mode) {
  if (mode === 'rebal' && (!summary.gapYears || summary.gapYears.length === 0)) {
    return [{ label: 'No gap years', note: 'Bracket duration matching not applicable for this ladder', total: true }];
  }
  const { lowerYear, upperYear, lowerLabel, upperLabel } = bracketLabels(summary, mode);
  
  const { lowerDuration, upperDuration, lowerWeight, upperWeight, gapParams } = summary;
  const is3 = mode === 'rebal' && summary.bracketMode === '3bracket' && summary.newLowerCUSIP;
  const avg = gapParams.avgDuration;

  const rows = [
    { label: 'Weighted average duration of the synthetic TIPS', value: avg.toFixed(2) },
    { sep: true },
  ];

  if (gapParams.breakdown?.length) {
    rows.push({ heading: 'Synthetic Gap Year TIPS' });
    // Each synthetic matures January 15 (2.0 §Synthetic TIPS for Gap Years, gap-math.js), and the
    // average below is cost-weighted, so each row carries the cost that weights it: quantity times
    // cost per bond. Without those the weighted figure cannot be checked against the rows.
    const costSum = gapParams.breakdown.reduce((s, b) => s + (b.cost ?? 0), 0);
    gapParams.breakdown.forEach(b => {
      const yr = b.year + ' (Jan 15)';
      const label = b.durDetail
        ? '<span class="drill-l3" data-l3="gapdur-' + b.year + '" style="cursor:pointer;text-decoration:underline dotted #94a3b8;">' + yr + '</span>'
        : yr;
      const note = b.qty != null && b.costPerBond != null
        ? b.qty.toLocaleString() + ' \u00d7 ' + fd(b.costPerBond, 2) + ' = ' + fd(b.cost, 0) + ' cost'
        : undefined;
      rows.push({ label, note, value: b.dur != null ? b.dur.toFixed(2) : '\u2014' });
    });
    rows.push({
      label: 'Weighted by cost',
      // The divisor is the gap years' total cost; name it in the note rather than leave a bare
      // number standing in the formula.
      note: 'Σ(cost × duration) ÷ gap years’ total cost (' + fd(costSum, 0) + ')',
      value: avg.toFixed(2), total: true,
    });
    rows.push({ sep: true });
  }


  const buckets = [];
  if (is3) {
    const { newLowerYear, newLowerDuration, origLowerWeight, newLowerWeight3 } = summary;
    const { activeLabel } = bracketLabels(summary, mode);
    const w1 = (origLowerWeight ?? 0), w2 = (newLowerWeight3 ?? 0), w3 = (summary.upperWeight3 ?? summary.upperWeight ?? 0);
    // bracketWeightsN (gap-math.js): the retained lower bracket is frozen at held excess/total
    // cost; if the lower brackets are over-allocated it is sold down only as far as the duration match
    // requires (earliest first, clamped to [0, currently held]) \u2014 never depleted outright
    // when a partial sale would restore the match. Only the active lower and upper are solved
    // from the duration constraint, so this note must track that formula exactly.

    const dv = (d, w) => d.toFixed(2) + '  \u00b7  ' + w.toFixed(4);
    rows.push({ heading: 'Bracket Years (modified duration \u00b7 weight)' });
    rows.push(
      { label: wtLink('retained', 'retained lower: ' + lowerLabel),
        value: dv(lowerDuration, w1) },
      { label: wtLink('active', 'active lower: ' + activeLabel),
        value: dv(newLowerDuration, w2) },
      { label: wtLink('upper', 'upper: ' + upperLabel),
        value: dv(upperDuration, w3) }
    );
    buckets.push({ dur: lowerDuration, weight: w1, label: lowerLabel });
    buckets.push({ dur: newLowerDuration, weight: w2, label: activeLabel });
    buckets.push({ dur: upperDuration, weight: w3, label: upperLabel });

    rows.push({ sep: true }, ...durationMatchRows([w1, w2, w3], [lowerDuration, newLowerDuration, upperDuration], avg, 'bracket'));

    // bracketWeightsN reports which condition blocked the solve; each is a different thing to tell
    // the reader, and only the first leaves the mean above short of the gap average.
    const solveNote = {
      coincidentDurations: 'The active lower and upper bracket durations coincide, so the weight left after the retained lower bracket was split evenly between the two rather than solved. The mean above does not reach the average duration of the gap years.',
      upperWeightNegative: 'The duration match solves to a negative upper bracket weight: the average duration of the gap years is shorter than the retained and active lower brackets alone produce.',
      activeBelowFloor:    'The retained lower bracket has been sold down as far as the lower bracket priority rule allows, and the duration match still calls for less excess in the active lower bracket than it currently holds.',
    }[summary.bracketSolveReason];
    if (solveNote) rows.push({ html:
      '<div style="font-size:11px;color:#334155;line-height:1.6;padding:2px 0 0;">' + solveNote + '</div>' });

  } else if (lowerYear == null) {
    // No lower bracket (firstYear is inside the gap \u2014 all coverage on upper bracket alone)
    rows.push(
      { heading: 'Bracket Years (modified duration \u00b7 weight)' },
      { label: 'upper: ' + upperLabel,
        note: 'the ladder starts inside the gap years, so the upper bracket carries all the coverage',
        value: upperDuration.toFixed(2) + '  \u00b7  ' + (upperWeight ?? 1).toFixed(4) }
    );
    buckets.push({ dur: upperDuration, weight: upperWeight ?? 1, label: upperLabel });
    rows.push({ sep: true }, ...durationMatchRows([upperWeight ?? 1], [upperDuration], avg, 'bracket'));
  } else {
    const dv2 = (d, w) => d.toFixed(2) + '  \u00b7  ' + w.toFixed(4);
    rows.push({ heading: 'Bracket Years (modified duration \u00b7 weight)' });
    rows.push(
      { label: wtLink('active', 'active lower: ' + lowerLabel),
        value: dv2(lowerDuration, lowerWeight) },
      { label: wtLink('upper', 'upper: ' + upperLabel),
        value: dv2(upperDuration, upperWeight) }
    );
    buckets.push({ dur: lowerDuration, weight: lowerWeight, label: lowerLabel });
    buckets.push({ dur: upperDuration, weight: upperWeight, label: upperLabel });

    rows.push({ sep: true }, ...durationMatchRows([lowerWeight, upperWeight], [lowerDuration, upperDuration], avg, 'bracket'));
  }

  rows.push(
    { sep: true },
    { heading: 'Modified Duration Balance' },
    { html: renderDurationBeam(buckets, avg) }
  );

  if (gapParams.breakdown?.length) {
    rows.push({ sep: true }, { heading: 'Gap Year Breakdown (theoretical qty)' });
    rows.push({ html:
      '<div style="font-size:11px;color:#334155;margin:0 0 6px;line-height:1.6;">'
      + 'qty = round((DARA \u2212 LMI \u2212 PLI) \u00f7 P+I)<br>'
      + '<b>LMI</b> = Later Maturity Interest \u2014 coupon income from TIPS maturing after this year, including interest from synthetic TIPS<br>'
      + '<b>PLI</b> = Pre-Ladder Interest credit applied to this gap year (0 unless a pre-ladder credit applies)<br>'
      + '<b>P+I</b> = Principal + Interest per synthetic TIPS for this year \u2014 these synthetic TIPS always mature in January, which receives one coupon payment in the maturity year, so P+I reflects half the annual coupon rate shown above<br>'
      + '<i>Click any LMI, PLI, or P+I value below for its breakdown.</i>'
      + '</div>'
      + '<table style="border-collapse:collapse;width:100%">'
      + gapBreakdownRows(gapParams, summary.DARA, { compact: true })
      + row('Theoretical gap cost (Total)', 'Sum of individual gap theoretical costs', fm(gapParams.totalCost), true)
      + '</table>'
    });
    const totalExcess = summary.totalExcessCost;
    if (totalExcess) {
      rows.push({ label: 'Total excess cost', note: 'Cost of excess TIPS now held in brackets', value: '$' + Math.round(totalExcess).toLocaleString() });
      rows.push({ label: 'Coverage status',   note: 'Gap is fully funded by the new bracket excess', value: 'Fully Funded', total: true });
    }
  }

  rows.push({ sep: true }, { html:
    '<a href="../knowledge/viewer.html#/md/TipsLadderManager/knowledge/2.0_TIPS_Ladders.md#two-pass-walkthrough" target="_blank" style="font-size:11px;color:#2563eb;text-decoration:none;font-weight:600;">Plain-language walkthrough of this calculation →</a>'
  });

  return rows;
}

export function buildFuture30yDurationPopupRows(summary) {
  const { future30yYears, future30yParams, future30yLowerYear, future30yUpperYear,
          future30yLowerDuration, future30yUpperDuration, future30yUpperWeight, future30yLowerWeight,
          future30yFellBack, future30yCoverReason, future30yLowerMonth, future30yUpperMonth } = summary;
  if (!future30yYears?.length || !future30yParams) {
    return [{ label: 'No Future 30Y years', note: 'Future 30Y cover matching not applicable', total: true }];
  }
  const lowerLabel = (future30yLowerMonth ? future30yLowerMonth + ' ' : '') + future30yLowerYear;
  const upperLabel = (future30yUpperMonth ? future30yUpperMonth + ' ' : '') + future30yUpperYear;
  const avg = future30yParams.avgDuration;
  const f2 = v => v.toFixed(2), f4 = v => v.toFixed(4);

  const rows = [
    { label: 'Cost-weighted average duration of the Future 30Y years', value: f2(avg) },
    { sep: true },
  ];

  if (future30yParams.breakdown?.length) {
    rows.push({ heading: 'Synthetic Future 30Y TIPS' });
    // The average is cost-weighted (gap-math.js future30yParamsCore, the same rule as the gap
    // years), so each row carries the cost that weights it. The label said "sum ÷ count", which
    // is a different figure from the one it sat beside.
    const costSum = future30yParams.breakdown.reduce((s, b) => s + (b.cost ?? 0), 0);
    future30yParams.breakdown.forEach(b => {
      const yr = b.year + ' (Feb 15)';
      const label = b.durDetail
        ? '<span class="drill-l3" data-l3="f30dur-' + b.year + '" style="cursor:pointer;text-decoration:underline dotted #94a3b8;">' + yr + '</span>'
        : yr;
      const note = b.qty != null && b.costPerBond != null
        ? b.qty.toLocaleString() + ' × ' + fd(b.costPerBond, 2) + ' = ' + fd(b.cost, 0) + ' cost'
        : 'mod. duration';
      rows.push({ label, note, value: b.dur != null ? f2(b.dur) : '—' });
    });
    rows.push({
      label: 'Weighted by cost',
      note: 'Σ(cost × duration) ÷ Future 30Y total cost (' + fd(costSum, 0) + ')',
      value: f2(avg), total: true,
    });
    rows.push({ sep: true });
  }

  // bracketWeights holds the lower weight within 0 to 1 (KNOWN_ISSUES: negative weight on a short
  // single-year Future 30Y run), so the division shown can land outside that range. Say so rather
  // than print an equals sign the arithmetic does not support.
  const _den = future30yUpperDuration - future30yLowerDuration;
  const rawLower = Math.abs(_den) > 1e-9 ? (future30yUpperDuration - avg) / _den : null;
  const rawLowerText = rawLower == null ? f4(future30yLowerWeight)
    : Math.abs(rawLower - future30yLowerWeight) > 1e-9
      ? f4(rawLower) + ', held at ' + f4(future30yLowerWeight)
      : f4(future30yLowerWeight);

  rows.push({ heading: 'Cover Years (modified duration · weight)' });
  rows.push(
    { label: 'lower cover: ' + lowerLabel,
      note: 'lower cover weight = (upper cover duration − average duration) ÷ (upper cover duration'
          + ' − lower cover duration), held within 0 to 1  =  (' + f2(future30yUpperDuration) + ' − '
          + f2(avg) + ') ÷ (' + f2(future30yUpperDuration) + ' − ' + f2(future30yLowerDuration) + ') = '
          + rawLowerText,
      value: f2(future30yLowerDuration) + '  ·  ' + f4(future30yLowerWeight) },
    { label: 'upper cover: ' + upperLabel,
      note: 'upper cover weight = 1 − lower cover weight = 1 − ' + f4(future30yLowerWeight)
          + ' = ' + f4(future30yUpperWeight),
      value: f2(future30yUpperDuration) + '  ·  ' + f4(future30yUpperWeight) },
  );
  // Lower and upper here rank the two covers by duration, not by maturity: the deep-discount,
  // near-zero-coupon cover carries an unusually long duration for its maturity, so the upper
  // cover can mature first (KNOWN_ISSUES: negative weight on a short single-year run).
  rows.push({ prose: 'Lower and upper rank the two covers by duration, not by maturity — a '
    + 'deep-discount cover carries an unusually long duration for its maturity, so the upper cover '
    + 'can be the one maturing first.' });

  rows.push({ sep: true }, ...durationMatchRows(
    [future30yLowerWeight, future30yUpperWeight],
    [future30yLowerDuration, future30yUpperDuration],
    avg, 'cover'));

  if (future30yFellBack) {
    const note = {
      aboveUpper: 'The average duration of the Future 30Y years is longer than either cover, so the '
        + 'whole weight sits on the upper cover and the mean above falls short of it.',
      belowLower: 'The average duration of the Future 30Y years is shorter than either cover, so the '
        + 'whole weight sits on the lower cover and the mean above overshoots it.',
    }[future30yCoverReason];
    if (note) rows.push({ prose: note });
  }

  rows.push(
    { sep: true },
    { heading: 'Modified Duration Balance' },
    { html: renderDurationBeam([
        { dur: future30yLowerDuration, weight: future30yLowerWeight, label: lowerLabel },
        { dur: future30yUpperDuration, weight: future30yUpperWeight, label: upperLabel }
      ], avg) },
  );

  if (future30yParams.breakdown?.length) {
    rows.push({ sep: true }, { heading: 'Future 30Y Year Breakdown (theoretical qty)' });
    future30yParams.breakdown.forEach(b => {
      rows.push({ label: b.year + ' qty', note: 'round((' + fm(b.dara) + ' − ' + Math.round(b.laterMatInt) + ') ÷ ' + b.piPerBond.toFixed(2) + ')', value: String(b.qty) });
    });
    rows.push({ label: 'Total Future 30Y cost', value: '$' + Math.round(future30yParams.future30yTotalCost).toLocaleString(), total: true });
  }

  return rows;
}

function fmtDate(d) {
  return MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
}

// Shared body for the Macaulay-duration walk (5.0 §Duration Disclosure Standards): coupon-date
// schedule, day-count fractions (E/DSC/w), per-period cash flows/PVs, Macaulay sum, then
// Modified duration. `durDetail`/`dur` come straight from gap-math.js's breakdown entry
// (calculateDurationDetail, shared/src/bond-math.js) — never recomputed here.
function macaulayWalkRows(durDetail, dur) {
  const rows = [
    { heading: 'Macaulay Duration' },
    { label: 'Next coupon date', value: fmtDate(durDetail.nextCpn) },
    { label: 'Last coupon date', value: fmtDate(durDetail.lastCpn) },
    { label: 'E (days in period)', value: fd(durDetail.E, 0) },
    { label: 'DSC (days to next coupon)', value: fd(durDetail.DSC, 0) },
    { label: 'w = DSC ÷ E', value: fd(durDetail.w, 4) },
    { sep: true },
  ];
  durDetail.periods.forEach((p, i) => {
    rows.push({ label: 'Period ' + (i + 1) + ' — ' + fmtDate(p.date), note: 't = ' + fd(p.t, 3), value: 'CF ' + fm2(p.cf) + ' → PV ' + fm2(p.pv) });
  });
  rows.push(
    { label: 'Macaulay duration', note: 'Σ(t × PV) ÷ Σ(PV) ÷ 2', value: fd(durDetail.macaulay, 4) + ' yr', total: true },
    { sep: true },
    { heading: 'Modified Duration' },
    { label: 'Modified duration', note: 'Macaulay ÷ (1 + yield ÷ 2)', value: fd(dur, 4), total: true }
  );
  return rows;
}

// Level-3 drill for the P+I of one synthetic Gap-year TIPS (5.0 §Nested (Level-3) drills,
// key `gappi-<year>`). Gap-year synthetic TIPS always carry a Feb maturity, which falls in the
// Jan–Jun bucket and so receives exactly one coupon payment in the maturity year (TIPS_Basics.md
// §Last-Year Interest) — half the annual synthetic coupon rate shown in the Gap Year Duration drill.
export function buildSyntheticPIDrill(summary, year) {
  const g = summary?.gapParams?.breakdown?.find(b => b.year === year);
  if (!g) return [{ label: 'No data', total: true }];
  const couponInterest = 1000 * g.synCpn / 2;
  return [
    { label: 'Principal', note: 'synthetic TIPS auctioned at par — par value used as the approximation for principal at auction', value: '$1,000.00' },
    { label: 'Synthetic coupon (annual rate)', note: 'see Gap Year Duration ↗', value: fd(g.synCpn * 100, 3) + '%' },
    { label: 'Interest: from Feb coupon', note: '$1,000 × ' + fd(g.synCpn * 100, 3) + '% ÷ 2 — Feb maturity falls in the Jan–Jun bucket, which gets one coupon payment in the maturity year', value: '$' + fd(couponInterest, 2) },
    { sep: true },
    { label: 'P+I per synthetic TIPS', value: '$' + fd(g.piPerBond, 2), total: true }
  ];
}

// Level-3 drill for the LMI of one synthetic Gap-year TIPS (5.0 §Nested (Level-3) drills,
// key `gaplmi-<year>`). Splits the year's LMI into synthetic coupon from longer gap years already
// sized in this sweep (each reconstructable from `gapParams.breakdown`, itself drillable via
// `gapdur-<year>`) and coupon from TIPS maturing after 2039 (funded years, bracket
// excess) — the latter only available as a lump sum since gap-math.js doesn't retain a per-source
// breakdown of `lmiAboveByYear`.
export function buildSyntheticLMIDrill(summary, year) {
  const gapParams = summary?.gapParams;
  const g = gapParams?.breakdown?.find(b => b.year === year);
  if (!g) return [{ label: 'No data', total: true }];
  const longerYears = gapParams.breakdown.filter(gy => gy.year > year).sort((a, b) => b.year - a.year);
  const fromSynthetic = longerYears.reduce((s, gy) => s + gy.qty * 1000 * gy.synCpn, 0);
  const fromActual = Math.max(0, g.laterMatInt - fromSynthetic);
  const rows = [];
  if (longerYears.length) {
    rows.push({ heading: 'Synthetic interest from longer gap years' });
    longerYears.forEach(gy => {
      rows.push({ label: gy.year + ' synthetic coupon', note: gy.qty + ' × $1,000 × ' + fd(gy.synCpn * 100, 3) + '%', value: '$' + Math.round(gy.qty * 1000 * gy.synCpn).toLocaleString() });
    });
    rows.push({ label: 'Subtotal', value: '$' + Math.round(fromSynthetic).toLocaleString(), total: true });
    rows.push({ sep: true });
  }
  rows.push({ label: 'Coupon interest from TIPS maturing after 2039', value: '$' + Math.round(fromActual).toLocaleString() });
  rows.push({ sep: true });
  rows.push({ label: 'Later Maturity Interest (LMI)', value: '$' + Math.round(g.laterMatInt).toLocaleString(), total: true });
  return rows;
}

// Level-3 drill for one synthetic Gap-year TIPS's duration (5.0 §Nested (Level-3) drills,
// key `gapdur-<year>`). Shows the yield interpolation, the synthetic coupon derived from it,
// and the full Macaulay/Modified duration walk — everything `calcGapParams`'s breakdown entry
// already carries (gap-math.js gapParamsCore), nothing recomputed.
export function buildGapYearDurationDrill(summary, year) {
  const gapParams = summary?.gapParams;
  const b = gapParams?.breakdown?.find(g => g.year === year);
  const anchors = gapParams?.anchors;
  if (!b || !anchors || !b.durDetail) return [{ label: 'No data', total: true }];
  const synMat = new Date(year, 0, 15);
  return [
    { heading: 'Yield Interpolation' },
    { label: 'Most recently issued 10-year TIPS', note: fmtDate(anchors.before.maturity), value: fd(anchors.before.yield * 100, 3) + '%' },
    { label: 'Feb 2040 TIPS', note: fmtDate(anchors.after.maturity), value: fd(anchors.after.yield * 100, 3) + '%' },
    { label: 'Target date', value: fmtDate(synMat) },
    { sep: true },
    { label: 'Interpolated yield', note: 'linear, by maturity date, between the two anchors above', value: fd(b.synYld * 100, 3) + '%', total: true },
    { sep: true },
    { heading: 'Synthetic Coupon' },
    { label: 'Synthetic coupon', note: 'MAX(0.125%, FLOOR(yield × 100 ÷ 0.125) × 0.125%)', value: fd(b.synCpn * 100, 3) + '%', total: true },
    { sep: true },
    ...macaulayWalkRows(b.durDetail, b.dur),
  ];
}

// Level-3 drill for one synthetic Future 30Y TIPS's duration (5.0 §Nested (Level-3) drills,
// key `f30dur-<year>`). Unlike Gap years, Future 30Y years have no upper anchor to interpolate
// against — every year is priced flat off the same anchor bond (gap-math.js future30yParamsCore).
export function buildFuture30yYearDurationDrill(summary, year) {
  const future30yParams = summary?.future30yParams;
  const b = future30yParams?.breakdown?.find(g => g.year === year);
  const anchorBond = future30yParams?.anchorBond;
  if (!b || !anchorBond || !b.durDetail) return [{ label: 'No data', total: true }];
  const synMat = new Date(year, 1, 15);
  return [
    { heading: 'Anchor Yield' },
    { label: 'Most recently issued 30-year TIPS', note: fmtDate(anchorBond.maturity) + ' — used directly (flat-curve assumption, no second anchor)', value: fd(b.synYld * 100, 3) + '%', total: true },
    { label: 'Target date', value: fmtDate(synMat) },
    { sep: true },
    { heading: 'Synthetic Coupon' },
    { label: 'Synthetic coupon', note: 'MAX(0.125%, FLOOR(yield × 100 ÷ 0.125) × 0.125%)', value: fd(b.synCpn * 100, 3) + '%', total: true },
    { sep: true },
    ...macaulayWalkRows(b.durDetail, b.dur),
  ];
}
