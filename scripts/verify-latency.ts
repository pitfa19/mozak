// V-latency verifier for S6 (D3 goal 3). Exits non-zero when a budget is exceeded.
//
//   node scripts/verify-latency.ts                        synthetic: 23 scopes in one vault repo, 10 plans each
//   node scripts/verify-latency.ts --config FILE          a real inventory, read only (plans.md is printed, never written)
//   options: --runs N (default 5), --plans-md-ms 1000, --locators-ms 300
//
// Budgets (D3): plans.md under 1 s for the inventory's scopes, locator resolution under 300 ms. Each budget is checked
// on the slowest of N in-process runs. The CLI run of `plans-md --print` (process start included) is checked too.
// The usage log is off, so nothing is written next to the inventory.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LocatorResolver, loadInventory, planCitations, plansIndex, readScopeQuiet } from "../packages/core/src/index.ts";
import { cleanupS6, s6world } from "../packages/core/test/s6-fixture.ts";

process.env.MOZAK_USAGE_LOG = "0";
const args = process.argv.slice(2);
const value = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const runs = Number(value("runs") ?? 5);
const budget = { plansMd: Number(value("plans-md-ms") ?? 1000), locators: Number(value("locators-ms") ?? 300) };

let config = value("config");
let synthetic = false;
if (!config) {
  synthetic = true;
  const scopes: Record<string, string> = {};
  for (let i = 1; i <= 23; i++) scopes[`s${i}`] = `vault/${i % 2 ? "research" : "personal"}/s${i}`;
  const w = s6world(scopes, { repos: ["vault"] });
  for (let i = 1; i <= 23; i++) for (let k = 1; k <= 10; k++) {
    w.propose(`s${i}`, `plan-${k}`, { title: `Synthetic topic ${i} item ${k}`, sources: [{ locator: "README.md" }, { locator: `[[note-${k}]]` }] }, k % 3 ? "approve" : "await");
  }
  config = w.config;
}

const inv = loadInventory(config);
const ms = (f: () => void) => { const t = performance.now(); f(); return performance.now() - t; };

let files = 0, plans = 0;
const plansMdRuns = Array.from({ length: runs }, () => ms(() => {
  const r = plansIndex(inv, { write: false });
  files = r.files.length;
  plans = r.files.reduce((n, f) => n + f.plans, 0);
}));

let locators = 0;
const statusCounts: Record<string, number> = {};
const locatorRuns = Array.from({ length: runs }, () => ms(() => {
  const resolver = new LocatorResolver(inv);
  locators = 0;
  for (const k of Object.keys(statusCounts)) delete statusCounts[k];
  for (const entry of inv.scopes) {
    let state;
    try { state = readScopeQuiet(entry).state; } catch { continue; }
    for (const p of state.plans) for (const c of planCitations(p)) {
      const r = resolver.resolve(entry, c.locator, c.anchor);
      locators++;
      statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1;
    }
  }
}));

const cli = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "packages", "cli", "dist", "index.js");
let cliMs: number | null = null;
if (existsSync(cli)) {
  const t = performance.now();
  const r = spawnSync(process.execPath, ["--no-warnings", cli, "plans-md", "--config", config, "--print", "--json"], { encoding: "utf8", env: { ...process.env, MOZAK_USAGE_LOG: "0" } });
  cliMs = performance.now() - t;
  if (r.status !== 0 && r.status !== 6) { console.error(`plans-md CLI exited ${r.status}: ${r.stderr}`); cliMs = Infinity; }
}

const round = (x: number) => Math.round(x * 10) / 10;
const max = (xs: number[]) => Math.max(...xs);
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const result = {
  synthetic, scopes: inv.scopes.length, runs,
  plansMd: { files, plans, maxMs: round(max(plansMdRuns)), medianMs: round(median(plansMdRuns)), budgetMs: budget.plansMd, cliMs: cliMs === null ? null : round(cliMs) },
  locators: { count: locators, statuses: statusCounts, maxMs: round(max(locatorRuns)), medianMs: round(median(locatorRuns)), budgetMs: budget.locators },
};
console.log(JSON.stringify(result, null, 2));
const failures = [
  ...(max(plansMdRuns) > budget.plansMd ? [`plans.md took ${round(max(plansMdRuns))} ms (budget ${budget.plansMd})`] : []),
  ...(cliMs !== null && cliMs > budget.plansMd ? [`plans-md CLI took ${round(cliMs)} ms (budget ${budget.plansMd})`] : []),
  ...(max(locatorRuns) > budget.locators ? [`locator resolution took ${round(max(locatorRuns))} ms (budget ${budget.locators})`] : []),
];
if (synthetic) cleanupS6();
if (failures.length) console.error(`V-latency FAILED: ${failures.join("; ")}`);
process.exitCode = failures.length ? 1 : 0;
