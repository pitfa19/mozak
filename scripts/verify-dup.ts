// V-dup verifier (D3 goal 1). Exits non-zero when a gate fails.
//
//   node scripts/verify-dup.ts                      synthetic public mirror: all gates, prints metrics as JSON
//   node scripts/verify-dup.ts --config FILE [--details] [--max-pairs 4]
//                                                   a real inventory, read only: pooled pair count against the
//                                                   budget, the raw lexical count for comparison, labels.
//                                                   --details adds scope/plan ids per pair (never plan text).
// The real run never writes: the usage log is turned off and scopes are read without git or network.
import { buildMirror, verifyMirror } from "../packages/core/test/vdup-fixture.ts";
import { loadInventory, rawPooledPairs, readScopeQuiet, similarReport, type ScopeState } from "../packages/core/src/index.ts";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };

if (value("config")) {
  process.env.MOZAK_USAGE_LOG = "0";
  const maxPairs = Number(value("max-pairs") ?? 4);
  const inv = loadInventory(value("config")!);
  const started = performance.now();
  const scopes: { id: string; state: ScopeState }[] = [];
  const failed: string[] = [];
  for (const e of inv.scopes) {
    try { scopes.push({ id: e.id, state: readScopeQuiet(e).state }); } catch { failed.push(e.id); }
  }
  const report = similarReport(scopes);
  const ms = Math.round(performance.now() - started);
  const byLabel: Record<string, number> = {};
  for (const p of report.pairs) byLabel[p.label] = (byLabel[p.label] ?? 0) + 1;
  const out = {
    scopes: scopes.length, failedScopes: failed, plans: report.plans, rawLexicalPairs: rawPooledPairs(scopes),
    pooledPairs: report.pairs.length, maxPairs, byLabel, templateFiltered: report.templateFiltered, moved: report.moved.length, ms,
    ...(flag("details") ? { pairs: report.pairs.map((p) => ({ label: p.label, rule: p.rule, a: `${p.a.scope}/${p.a.planId}`, b: `${p.b.scope}/${p.b.planId}`, why: p.why })), movedPlans: report.moved.map((x) => `${x.scope}/${x.planId}`) } : {}),
  };
  console.log(JSON.stringify(out, null, 2));
  const ok = report.pairs.length <= maxPairs && failed.length === 0;
  if (!ok) console.error(`V-dup real run FAILED: ${report.pairs.length} pooled pairs (budget ${maxPairs}), ${failed.length} unreadable scopes`);
  process.exit(ok ? 0 : 1);
}

const m = buildMirror();
try {
  const r = verifyMirror(m);
  console.log(JSON.stringify(r, null, 2));
  if (!r.ok) console.error(`V-dup mirror FAILED: ${r.failures.join("; ")}`);
  process.exitCode = r.ok ? 0 : 1;
} finally {
  m.cleanup();
}
