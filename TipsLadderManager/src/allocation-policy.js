// allocation-policy.js -- Within-Year Allocation Policy for Rebalance's per-year target
// (2.0 §Within-Year Allocation Policy; 3.0 §Named Quantities & Formulas (Rebalance)).
// Scoped to ORDINARY (non-bracket/gap/future30y) funded years only -- bracket/gap/cover
// CUSIP identification (identifyBrackets, calculateGapParameters, bracketWeightsN) is
// entirely untouched by this module; it is never called for a bracket year.

// Returns an ordered array of { cusip, held } over the union of `candidates` (that year's
// canonical yearTipsListMap[year] entries -- ladder-eligible TIPS for the year, from
// selectLadderBonds/maturityPref) and `held` (that year's currently-held holdings, which may
// include maturities no longer in `candidates`), highest buy/hold-priority first.
//
// Trades are driven entirely by the caller's own need-vs-held math -- this function only ever
// decides ORDER, never whether a trade happens (3.0 §Within-Year Allocation Policy, the E
// invariant). `held`'s own relative order/values are never altered by ranking alone.
export function rankForYear({ candidates = [], held = [], piMap = {}, tipsMap = null, policy = 'equal', rankOverride = null, maturityPref = 'last' }) {
  const heldByCusip = new Map(held.map(h => [h.cusip, h]));
  const union = new Map();
  for (const c of candidates) if (!union.has(c.cusip)) union.set(c.cusip, c);
  for (const h of held) if (!union.has(h.cusip)) union.set(h.cusip, h);
  const cusips = [...union.keys()];

  if (rankOverride?.length) {
    const ordered = [];
    const seen = new Set();
    for (const cusip of rankOverride) if (union.has(cusip) && !seen.has(cusip)) { ordered.push(cusip); seen.add(cusip); }
    // A stale override missing a candidate/held cusip never silently drops it from consideration
    // -- anything left over is appended in candidate order.
    for (const cusip of cusips) if (!seen.has(cusip)) { ordered.push(cusip); seen.add(cusip); }
    return ordered.map(cusip => ({ cusip, held: heldByCusip.has(cusip) }));
  }

  // Which maturity direction "wins" a tie follows the top-level Maturity Preference setting
  // (2.0 §Maturity Selection Within a Funded Year): 'last' (default) prefers the latest-maturing
  // candidate, 'first' flips to earliest-maturing. 'semiannual'/'all'/'select' have no single
  // natural direction of their own, so they fall back to 'last'’s latest-wins convention.
  const maturityOf = cusip => union.get(cusip)?.maturity?.getTime?.() ?? 0;
  const dir = maturityPref === 'first' ? -1 : 1; // +1: latest wins ties; -1: earliest wins ties
  let sorted;
  if (policy === 'maturity') {
    sorted = cusips.slice().sort((a, b) => dir * (maturityOf(b) - maturityOf(a)));
  } else if (policy === 'saYield') {
    const saYieldOf = cusip => tipsMap?.get(cusip)?.saYield;
    sorted = cusips.slice().sort((a, b) => {
      const av = saYieldOf(a), bv = saYieldOf(b);
      if (av == null && bv == null) return dir * (maturityOf(b) - maturityOf(a));
      if (av == null) return 1;   // missing SA yield never wins a preference over a real one
      if (bv == null) return -1;
      return bv - av; // highest SA yield preferred/held first, lowest sells first
    });
  } else {
    // 'equal' (default) -- ascending by currently-held ARA value (qty x piPerBond); a
    // not-yet-held candidate has value 0, so it ranks first (buy priority). Reproduces
    // today's exact single-candidate/no-holdings behavior byte-for-byte, since a year with
    // only one candidate has nothing else to sort against.
    const valueOf = cusip => (heldByCusip.get(cusip)?.qty ?? 0) * (piMap[cusip] ?? 0);
    sorted = cusips.slice().sort((a, b) => {
      const av = valueOf(a), bv = valueOf(b);
      if (av !== bv) return av - bv;
      return dir * (maturityOf(b) - maturityOf(a));
    });
  }
  return sorted.map(cusip => ({ cusip, held: heldByCusip.has(cusip) }));
}
