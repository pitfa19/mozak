// Prints the plugin data layer for an inventory. Run from the repo root:
//   node --experimental-strip-types packages/obsidian/scripts/dump-model.mjs <mozak-inventory.json>
import { loadScopesModel } from "../src/load.ts";
const m = loadScopesModel(process.argv[2]);
console.log(`${m.scopes.length} scopes (failed ${m.totals.failed})`);
for (const s of m.scopes) {
  console.log(`- ${s.id} [${s.kind}] ${s.title}: ${s.counts.completed} completed, ${s.counts.open} open, ${s.counts.awaiting} awaiting${s.errorCode ? ` ERROR ${s.errorCode}` : ""}`);
  for (const p of s.plans) console.log(`    ${p.stateLabel.padEnd(18)} ${p.id}: ${p.title}${p.flags.length ? ` (${p.flags.join(", ")})` : ""}`);
}
