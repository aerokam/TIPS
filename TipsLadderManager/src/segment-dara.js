// segment-dara.js -- Shared (build + rebalance) per-year DARA segmentation helpers.
//
// Any number of "split years" partitions a ladder into consecutive segments the user manages
// on independent DARA targets — e.g. a near-term liability-matching stretch, then one or more
// tapering or speculative/heirs stretches beyond it. These helpers are pure range/map
// operations and are intentionally mode-agnostic: Build can reuse them as-is.
//
// The rebalance-only self-finance solve that computes a segment's "median" DARA lives in
// rebalance-lib.js (it depends on current holdings + net-cash → 0, which Build has no analog for).
// See 3.0 TIPS Ladder Rebalancing § Segmented DARA.

/**
 * Partition [firstYear, lastYear] at one or more split years into consecutive segments.
 * A split at firstYear is valid — it carves off a singleton first segment. A split at lastYear
 * is dropped, since it would produce an empty trailing segment; splits outside [firstYear, lastYear)
 * are dropped too. Duplicates are collapsed. With no usable split years the whole ladder is a
 * single segment.
 * @param {number|number[]} splitYears - one split year, or an array of them (any order).
 * @returns {Set<number>[]} segments in ascending year order, length = usable splits + 1.
 */
export function segmentRanges(splitYears, firstYear, lastYear) {
  const splits = [...new Set([].concat(splitYears))]
    .filter(y => y >= firstYear && y < lastYear)
    .sort((a, b) => a - b);
  const bounds = [firstYear - 1, ...splits, lastYear];
  const segments = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const years = new Set();
    for (let y = bounds[i] + 1; y <= bounds[i + 1]; y++) years.add(y);
    segments.push(years);
  }
  return segments;
}

/** Map of every year in `years` (Set or array) → constant `value`. */
export function constantMap(years, value) {
  const m = new Map();
  for (const y of years) m.set(y, value);
  return m;
}

/**
 * Write `segmentMap` into `store` for the segment's `years` only — every other year is left
 * untouched (the no-clobber guarantee that lets one segment be re-derived without disturbing
 * the other). Mutates and returns `store`.
 */
export function applySegmentMap(store, years, segmentMap) {
  for (const y of years) {
    if (segmentMap.has(y)) store.set(y, segmentMap.get(y));
  }
  return store;
}
