// Paired tests for the D3 ship rule, in plain code with no dependencies.
// McNemar exact test (binomial on discordant pairs) and the Wilcoxon signed-rank test.

function logFactorialTable(n) {
  const t = new Float64Array(n + 1);
  for (let i = 2; i <= n; i++) t[i] = t[i - 1] + Math.log(i);
  return t;
}

// P(X <= k) for X ~ Binomial(n, 0.5).
export function binomCdfHalf(k, n) {
  if (k < 0) return 0;
  if (k >= n) return 1;
  const lf = logFactorialTable(n);
  const lhalf = n * Math.log(0.5);
  let s = 0;
  for (let i = 0; i <= k; i++) s += Math.exp(lf[n] - lf[i] - lf[n - i] + lhalf);
  return Math.min(1, s);
}

// Exact McNemar test. b = pairs where only arm 1 is correct, c = pairs where only arm 2 is correct.
export function mcnemarExact(b, c) {
  if (!Number.isInteger(b) || !Number.isInteger(c) || b < 0 || c < 0) throw new Error('b and c must be non-negative integers');
  const n = b + c;
  if (n === 0) return { b, c, n, p: 1 };
  return { b, c, n, p: Math.min(1, 2 * binomCdfHalf(Math.min(b, c), n)) };
}

// From two boolean arrays of per-item correctness (same items, same order).
export function mcnemarFromPairs(arm1, arm2) {
  if (arm1.length !== arm2.length) throw new Error('paired arrays differ in length');
  let b = 0, c = 0;
  for (let i = 0; i < arm1.length; i++) {
    if (arm1[i] && !arm2[i]) b++;
    else if (!arm1[i] && arm2[i]) c++;
  }
  return mcnemarExact(b, c);
}

// Standard normal CDF via erfc (Numerical Recipes erfcc, fractional error under 1.2e-7).
export function normalCdf(z) {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.5 * x);
  const erfc = t * Math.exp(-x * x - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 +
    t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return z >= 0 ? 1 - erfc / 2 : erfc / 2;
}

// Average ranks of values (1-based), ties share the mean rank.
export function averageRanks(values) {
  const idx = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const ranks = new Array(values.length);
  const tieSizes = [];
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const r = (i + j + 2) / 2;
    for (let k = i; k <= j; k++) ranks[idx[k][1]] = r;
    if (j > i) tieSizes.push(j - i + 1);
    i = j + 1;
  }
  return { ranks, tieSizes };
}

// Exact null distribution of W+ for n untied ranks: counts[k] = number of sign patterns with W+ = k.
export function wilcoxonExactCounts(n) {
  const max = (n * (n + 1)) / 2;
  let counts = new Array(max + 1).fill(0);
  counts[0] = 1;
  for (let r = 1; r <= n; r++) {
    const next = counts.slice();
    for (let k = r; k <= max; k++) next[k] += counts[k - r];
    counts = next;
  }
  return counts;
}

// Wilcoxon signed-rank test on paired samples (x, y) or on differences (x only).
// Zero differences are dropped (Wilcox method). Exact p when n <= 50 and no ties, else normal approximation
// with tie correction and no continuity correction (matches scipy.stats.wilcoxon defaults).
// alternative: 'two-sided' (default), 'greater' (x > y), 'less' (x < y).
export function wilcoxonSignedRank(x, y = null, { alternative = 'two-sided' } = {}) {
  const d0 = y ? x.map((v, i) => v - y[i]) : x.slice();
  if (y && x.length !== y.length) throw new Error('paired arrays differ in length');
  const d = d0.filter((v) => v !== 0);
  const zeros = d0.length - d.length;
  const n = d.length;
  if (n === 0) return { n, zeros, wPlus: 0, wMinus: 0, statistic: 0, p: 1, method: 'none' };
  const { ranks, tieSizes } = averageRanks(d.map(Math.abs));
  let wPlus = 0, wMinus = 0;
  d.forEach((v, i) => { if (v > 0) wPlus += ranks[i]; else wMinus += ranks[i]; });
  const statistic = alternative === 'two-sided' ? Math.min(wPlus, wMinus) : wPlus;
  let p, method;
  if (n <= 50 && tieSizes.length === 0) {
    method = 'exact';
    const counts = wilcoxonExactCounts(n);
    const total = 2 ** n;
    const cdf = (k) => { let s = 0; for (let i = 0; i <= Math.min(k, counts.length - 1); i++) s += counts[i]; return s / total; };
    const sf = (k) => 1 - cdf(k - 1); // P(W+ >= k)
    if (alternative === 'two-sided') p = Math.min(1, 2 * cdf(Math.min(wPlus, wMinus)));
    else if (alternative === 'greater') p = sf(wPlus);
    else p = cdf(wPlus);
  } else {
    method = 'normal';
    const mean = (n * (n + 1)) / 4;
    const tieCorr = tieSizes.reduce((s, t) => s + (t ** 3 - t), 0);
    const sd = Math.sqrt((n * (n + 1) * (2 * n + 1)) / 24 - tieCorr / 48);
    const z = (wPlus - mean) / sd;
    if (alternative === 'two-sided') p = Math.min(1, 2 * normalCdf(-Math.abs(z)));
    else if (alternative === 'greater') p = 1 - normalCdf(z);
    else p = normalCdf(z);
  }
  return { n, zeros, wPlus, wMinus, statistic, p, method };
}

export function median(values) {
  if (values.length === 0) return null;
  const s = values.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
