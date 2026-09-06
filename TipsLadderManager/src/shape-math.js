// shape-math.js -- The shape of a ladder's real cash flow, and the maturity years standing above it.
// Exports: smoothCurve, findSpikes
//
// A ladder's ARA plotted against maturity year is a curve with humps and dips, and a maturity year
// holding excess TIPS shows as a spike departing from it. Comparing each year against a single
// median instead treats every hump as excess, which is what this replaces
// (3.0 §Bracket Identification Rules).

// Median of a numeric array. Even counts average the middle pair, so a curve fitted through an
// even-length run does not jump to one side of it.
function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return NaN;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

// A running median of `width`, applied until the series stops changing (Tukey's repeated median
// smoother). A running median cannot be pulled toward a spike the way a mean is, so the curve
// passes under a spike rather than bending up to meet it.
//
// WIDTH MATTERS, AND NOT IN PROPORTION TO RUN LENGTH. Adjacent spikes are handled mostly by the
// peeling loop in findSpikes, not by the window: on a level series even width 3 recovers a run of
// three, because flattening the strongest leaves the rest still standing above the curve. What
// defeats a narrow window is a run of spikes on a SLOPING stretch, where the window cannot tell
// the run from the slope and the fit passes through it, leaving no residual for peeling to find.
// This is not hypothetical: on the real ladder, whose shape rises toward the gap years, width 3
// followed the two adjacent spikes at 2034 and 2035 and reported neither, while width 5 reported
// both. Width 5 is set for that reason and should not be narrowed without re-checking it against
// tests/dev/RetainedExcessTwoYears.csv.
export function smoothCurve(values, { width = 5 } = {}) {
  const h = (width - 1) / 2;
  if (values.length <= 2 * h) return values.slice();
  let cur = values.slice();
  for (let pass = 0; pass < 40; pass++) {
    const next = cur.slice();
    for (let i = h; i < cur.length - h; i++) next[i] = median(cur.slice(i - h, i + h + 1));
    if (next.every((x, i) => x === cur[i])) break;
    cur = next;
  }
  // The window cannot reach the first and last h points. Carrying the nearest fitted value out
  // flat would break any ladder whose shape is still rising or falling at its ends: the flat end
  // sits below a rising series, and every point near it then reads as standing above the curve.
  // Extrapolate the local slope outward instead, and take the median of that against the raw
  // value, so a spike sitting at the very end still cannot become the curve.
  const n = cur.length;
  for (let i = h - 1; i >= 0; i--) {
    cur[i] = median([values[i], cur[i + 1], 2 * cur[i + 1] - cur[i + 2]]);
  }
  for (let i = n - h; i < n; i++) {
    cur[i] = median([values[i], cur[i - 1], 2 * cur[i - 1] - cur[i - 2]]);
  }
  // One Hann pass, so the fitted curve reads as humps and dips rather than as flat steps.
  const out = cur.slice();
  for (let i = 1; i < cur.length - 1; i++) out[i] = 0.25 * cur[i - 1] + 0.5 * cur[i] + 0.25 * cur[i + 1];
  return out;
}

// 1.4826 x median absolute deviation: the robust counterpart of a standard deviation, scaled so
// that on normally distributed residuals the two agree. Robust because a spike inflates a standard
// deviation and so hides itself, while it cannot move a median.
function robustScale(residuals) {
  return 1.4826 * median(residuals.map(r => Math.abs(r)));
}

// Every index whose value stands above the fitted curve by more than `k` robust scales.
//
// Found one at a time, strongest first, each flattened onto the curve before refitting. Two
// adjacent spikes otherwise lift the curve between them enough to hide the smaller one, and a
// single pass reports only the larger.
//
// Returns [{ index, value, curve, excess, z }] in index order, `excess` being value - curve: the
// part of that year standing above the ladder's own shape.
export function findSpikes(values, { width = 5, k = 4 } = {}) {
  const working = values.slice();
  const found = [];
  for (let pass = 0; pass < values.length; pass++) {
    const curve = smoothCurve(working, { width });
    const resid = working.map((v, i) => v - curve[i]);
    const scale = robustScale(resid);
    let bestIdx = -1, bestZ = k;
    for (let i = 0; i < working.length; i++) {
      if (found.some(f => f.index === i)) continue;
      // A scale of exactly 0 means every point sits on the curve; anything above it is then a
      // spike outright, with no dispersion to measure it against.
      const z = scale > 0 ? resid[i] / scale : (resid[i] > 0 ? Infinity : 0);
      if (z > bestZ) { bestZ = z; bestIdx = i; }
    }
    if (bestIdx < 0) break;
    found.push({ index: bestIdx, value: values[bestIdx], curve: curve[bestIdx],
                 excess: values[bestIdx] - curve[bestIdx], z: bestZ });
    working[bestIdx] = curve[bestIdx];
  }
  return found.sort((a, b) => a.index - b.index);
}
