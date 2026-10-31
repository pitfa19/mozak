import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  binomCdfHalf, mcnemarExact, mcnemarFromPairs, normalCdf, averageRanks,
  wilcoxonExactCounts, wilcoxonSignedRank, median,
} from '../lib/stats.mjs';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b} (eps ${eps})`);

test('binomial cdf at p = 0.5', () => {
  close(binomCdfHalf(2, 12), 79 / 4096);
  close(binomCdfHalf(0, 5), 1 / 32);
  assert.equal(binomCdfHalf(12, 12), 1);
  assert.equal(binomCdfHalf(-1, 12), 0);
});

test('McNemar exact matches known values', () => {
  // statsmodels mcnemar([[., 10], [2, .]], exact=True).pvalue = 0.03857421875
  close(mcnemarExact(10, 2).p, 0.03857421875);
  close(mcnemarExact(2, 10).p, 0.03857421875);
  // b = 0, c = 5: 2 * 0.5^5
  close(mcnemarExact(0, 5).p, 0.0625);
  // b = 0, c = 6: 2 * 0.5^6
  close(mcnemarExact(0, 6).p, 0.03125);
  assert.equal(mcnemarExact(4, 4).p, 1);
  assert.equal(mcnemarExact(0, 0).p, 1);
  assert.throws(() => mcnemarExact(-1, 2));
});

test('McNemar from paired correctness arrays', () => {
  const a = [true, true, false, true, false, true];
  const b = [true, false, false, false, true, true];
  const r = mcnemarFromPairs(a, b);
  assert.equal(r.b, 2);
  assert.equal(r.c, 1);
  close(r.p, 1);
  assert.throws(() => mcnemarFromPairs([true], []));
});

test('normal cdf', () => {
  close(normalCdf(0), 0.5, 1e-7);
  close(normalCdf(1.959963984540054), 0.975, 2e-7);
  close(normalCdf(-1), 0.15865525393145707, 2e-7);
});

test('average ranks with ties', () => {
  const { ranks, tieSizes } = averageRanks([10, 20, 20, 30]);
  assert.deepEqual(ranks, [1, 2.5, 2.5, 4]);
  assert.deepEqual(tieSizes, [2]);
});

test('exact Wilcoxon null distribution sums to 2^n and is symmetric', () => {
  for (const n of [1, 5, 10, 20]) {
    const c = wilcoxonExactCounts(n);
    assert.equal(c.reduce((s, v) => s + v, 0), 2 ** n);
    for (let k = 0; k < c.length; k++) assert.equal(c[k], c[c.length - 1 - k]);
  }
  // n = 3: W+ in {0,1,2,3,3,4,5,6}
  assert.deepEqual(wilcoxonExactCounts(3), [1, 1, 1, 2, 1, 1, 1]);
});

test('Wilcoxon signed-rank matches scipy documentation example', () => {
  // scipy.stats.wilcoxon docs: statistic 24.0, pvalue 0.041259765625; alternative="greater" p 0.0206298828125
  const d = [6, 8, 14, 16, 23, 24, 28, 29, 41, -48, 49, 56, 60, -67, 75];
  const r = wilcoxonSignedRank(d);
  assert.equal(r.method, 'exact');
  assert.equal(r.statistic, 24);
  close(r.p, 0.041259765625);
  close(wilcoxonSignedRank(d, null, { alternative: 'greater' }).p, 0.0206298828125);
});

test('Wilcoxon exact small cases and paired input', () => {
  close(wilcoxonSignedRank([1, 2, 3, 4, 5]).p, 0.0625);
  close(wilcoxonSignedRank([1, 2, 3, 4, 5, 6]).p, 0.03125);
  const x = [10, 12, 15, 9];
  const y = [10, 11, 13, 6];
  const r = wilcoxonSignedRank(x, y);
  assert.equal(r.zeros, 1);
  assert.equal(r.n, 3);
  close(r.p, 0.25);
});

test('Wilcoxon normal approximation with ties', () => {
  // d = [1, 1, -1, 2, 2, 2]: ranks of |d| are 2,2,2,5,5,5; W+ = 2+2+5+5+5 = 19, W- = 2
  // mean 10.5, var = 6*7*13/24 - (2*(27-3))/48 = 22.75 - 1 = 21.75, z = 8.5/sqrt(21.75)
  const r = wilcoxonSignedRank([1, 1, -1, 2, 2, 2]);
  assert.equal(r.method, 'normal');
  assert.equal(r.wPlus, 19);
  const z = 8.5 / Math.sqrt(21.75);
  close(r.p, 2 * normalCdf(-z), 1e-12);
  // z = 1.82259..., two-sided p = 0.068365
  close(r.p, 0.068365, 1e-5);
});

test('median', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([]), null);
});
