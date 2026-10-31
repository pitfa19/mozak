#!/usr/bin/env node
// S7a paired analysis. Input JSON: { "tasks": [ { "id": "t01", "control": [n, n, n], "treatment": [n, n, n] } ] }
// (total tokens to the first useful action, one value per run). Output: per-task medians, the Wilcoxon
// signed-rank test on the paired medians (alpha 0.05), the median reduction, and the D3 goal 3 check
// (treatment at least 30% lower). Usage: node eval/s7a/compare.mjs FILE [--alpha 0.05]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { median, wilcoxonSignedRank } from '../lib/stats.mjs';

export function compare(data, { alpha = 0.05, target = 0.3 } = {}) {
  const rows = data.tasks.map((t) => ({ id: t.id, control: median(t.control), treatment: median(t.treatment), runs: [t.control.length, t.treatment.length] }));
  const paired = rows.filter((r) => r.control !== null && r.treatment !== null);
  const w = wilcoxonSignedRank(paired.map((r) => r.control), paired.map((r) => r.treatment));
  const mc = median(paired.map((r) => r.control));
  const mt = median(paired.map((r) => r.treatment));
  const reduction = mc ? (mc - mt) / mc : null;
  return {
    pairs: paired.length,
    medianControl: mc,
    medianTreatment: mt,
    medianReduction: reduction === null ? null : Math.round(reduction * 10000) / 10000,
    wilcoxon: w,
    significant: w.p < alpha,
    meetsTarget: w.p < alpha && reduction !== null && reduction >= target,
    rows,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (!file) { console.error('usage: compare.mjs FILE'); process.exit(2); }
  const ai = process.argv.indexOf('--alpha');
  const alpha = ai > 0 ? Number(process.argv[ai + 1]) : 0.05;
  console.log(JSON.stringify(compare(JSON.parse(fs.readFileSync(file, 'utf8')), { alpha }), null, 2));
}
