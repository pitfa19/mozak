// V-dup public mirror (D3 goal 1). Synthetic plans only: no real plan text. It mirrors the shapes of the private
// set: exact copies under neutral ids, 60 mutations (12 bases x 5 kinds, a third of them Croatian), templated
// siblings that must never be called duplicates, one supersession pair, and one reject moved to another scope.
// Used by packages/core/test/vdup.test.ts (every commit) and scripts/verify-dup.ts (on demand).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initScopeState, mutateScope, readScope } from "../src/scope-store.ts";
import { reviewShow } from "../src/review.ts";
import { executeOperation } from "../src/api.ts";
import { loadInventory } from "../src/scope-index.ts";
import type { SimilarPair, SimilarReport } from "../src/similar.ts";

const NOW = "2026-10-20T09:00:00.000Z";

interface Base { id: string; title: string; purpose: string; outcomes: [string, string][]; hr: boolean }

const BASES: Base[] = [
  { id: "cedar-export-2026", hr: false, title: "Cedar export pipeline for quarterly reports", purpose: "Build an export pipeline that turns the Cedar ledger into quarterly PDF reports for the finance team in 2026.", outcomes: [["exporter-runs", "The exporter runs every night without manual steps."], ["pdf-layout", "The quarterly PDF layout matches the finance template."]] },
  { id: "lunar-archive", hr: false, title: "Lunar archive validation suite", purpose: "Check every scanned page in the Lunar archive for missing metadata and broken image files.", outcomes: [["metadata-checked", "Each scanned page has its title, date and source fields."], ["images-verified", "Broken image files are listed with their shelf numbers."]] },
  { id: "harbor-invoices", hr: false, title: "Harbor invoice reconciliation", purpose: "Match Harbor shipping invoices against bank statements and flag the ones that do not reconcile.", outcomes: [["matched", "Invoices and bank lines are matched by amount and reference."], ["flags-reviewed", "Unmatched invoices are flagged for a human review."]] },
  { id: "quartz-telemetry-v2", hr: false, title: "Quartz telemetry transport", purpose: "Move Quartz device telemetry from polling to a push transport with retries and backpressure.", outcomes: [["push-live", "Devices push telemetry through the new transport."], ["retries", "Dropped messages are retried with backoff."]] },
  { id: "orchard-sensors", hr: false, title: "Orchard soil sensor network", purpose: "Install soil moisture sensors across the orchard rows and send readings to a dashboard.", outcomes: [["sensors-installed", "Every row has a working moisture sensor."], ["dashboard", "Readings appear on the irrigation dashboard hourly."]] },
  { id: "maple-onboarding", hr: false, title: "Maple volunteer onboarding guide", purpose: "Write an onboarding guide so new Maple volunteers can run a shift without a mentor present.", outcomes: [["guide-written", "The guide covers opening, shift duties and closing."], ["tested", "Two new volunteers ran a shift using only the guide."]] },
  { id: "comet-scheduler", hr: false, title: "Comet shift scheduler rewrite", purpose: "Rewrite the Comet shift scheduler so swaps and holidays are handled without spreadsheet edits.", outcomes: [["swaps", "Staff can swap shifts inside the scheduler."], ["holidays", "Public holidays block shifts automatically."]] },
  { id: "tundra-backup-2025", hr: false, title: "Tundra photo backup rotation", purpose: "Rotate Tundra photo backups between two offsite disks every month of 2025 and verify restores.", outcomes: [["rotation", "Disks are swapped monthly with a log entry."], ["restore-test", "A sample restore succeeds after each swap."]] },
  { id: "natjecaj-udruge-2026", hr: true, title: "Prijava na natječaj za studentske udruge", purpose: "Pripremiti i predati prijavu na natječaj studentskog zbora za financiranje radionica, uključujući proračun i opis projekta za 2026.", outcomes: [["proracun", "Proračun radionica je usklađen s pravilima natječaja."], ["predano", "Prijava je predana prije roka s potpisima voditelja."]] },
  { id: "ljetna-skola", hr: true, title: "Organizacija ljetne škole programiranja", purpose: "Organizirati tjedan ljetne škole programiranja za srednjoškolce u Đakovu s mentorima i radionicama.", outcomes: [["mentori", "Pet mentora je potvrdilo dolazak u Đakovo."], ["raspored", "Raspored radionica je objavljen učenicima."]] },
  { id: "prirucnik-plaze", hr: true, title: "Prijevod priručnika za čišćenje plaža", purpose: "Prevesti priručnik za volontersko čišćenje plaža na hrvatski i prilagoditi ga lokalnim pravilima o otpadu.", outcomes: [["prijevod", "Cijeli priručnik je preveden na hrvatski jezik."], ["pravila", "Poglavlje o otpadu slijedi lokalna pravila."]] },
  { id: "anketa-smjestaj", hr: true, title: "Analiza ankete o studentskom smještaju", purpose: "Analizirati odgovore ankete o studentskom smještaju i izdvojiti glavne probleme s cijenama i udaljenošću.", outcomes: [["ciscenje", "Odgovori su očišćeni od duplikata i praznih redaka."], ["izvjestaj", "Izvještaj navodi tri glavna problema sa smještajem."]] },
];

const strip = (s: string) => s.replace(/[čć]/g, "c").replace(/[ČĆ]/g, "C").replace(/š/g, "s").replace(/Š/g, "S").replace(/ž/g, "z").replace(/Ž/g, "Z").replace(/đ/g, "d").replace(/Đ/g, "D");

function content(title: string, purpose: string, outcomes: [string, string][]) {
  return {
    constraints: [], nonGoals: [], questions: [], sources: [] as unknown[],
    outcomes: outcomes.map(([id, statement]) => ({ acceptance: "objective", criterion: "Synthetic check passes", id, statement })),
    purpose, rationale: "Synthetic mirror plan", title,
  };
}

/** The five mutation kinds, each one a copy that a person would still call the same plan. */
const MUTATIONS: { kind: string; apply: (b: Base) => { id: string; c: ReturnType<typeof content> } }[] = [
  { kind: "whitespace-punctuation", apply: (b) => ({ id: "m1", c: content(`${b.title}.`, `  ${b.purpose.replace(/ /g, "  ").replace(/\.$/, "")} `, b.outcomes) }) },
  { kind: "id-and-year-renumbered", apply: (b) => ({ id: "m2-2031", c: content(b.title, b.purpose.replace(/20\d\d/g, "2031"), b.outcomes) }) },
  { kind: "diacritics-stripped-or-lowercased", apply: (b) => ({ id: "m3", c: b.hr ? content(strip(b.title), strip(b.purpose), b.outcomes.map(([i, s]) => [i, strip(s)] as [string, string])) : content(b.title.toLowerCase(), b.purpose.toLowerCase(), b.outcomes) }) },
  { kind: "outcomes-reordered-one-dropped", apply: (b) => ({ id: "m4", c: content(b.title, b.purpose, [b.outcomes[1]]) }) },
  { kind: "sentence-appended-title-reordered", apply: (b) => ({ id: "m5", c: content(b.title.split(" ").reverse().join(" "), `${b.purpose} ${b.hr ? "Vlasnik dobiva kratki tjedni izvještaj." : "The owner gets a short weekly update."}`, b.outcomes) }) },
];


/** Templated siblings: same template, different subject. None is a duplicate of another. */
const TEMPLATES: { scope: string; id: string; c: ReturnType<typeof content> }[] = [
  // Same outcome ids, titles share one word: the template filter drops these.
  ...["Cedar study", "Harbor survey", "Quartz model"].map((s, i) => ({ scope: `tmpl-${i + 1}`, id: "manuscript-submitted", c: content(`${s} manuscript`, `The ${s} paper is finished and was submitted to the award committee.`, [["draft", "The paper draft is finished."], ["submitted", "The paper is submitted."]]) })),
  // One-line closures.
  ...[["grant-completed", "Grant application completed"], ["travel-completed", "Travel stipend completed"], ["lecture-completed", "Lecture recording completed"]].map(([id, title], i) => ({ scope: `tmpl-${i + 1}`, id, c: content(title, `The ${title.toLowerCase().replace(" completed", "")} is completed.`, [["o1", `The ${title.toLowerCase().replace(" completed", "")} is completed.`]]) })),
  // Croatian template: titles share three words, subjects differ.
  ...["biologije", "kemije"].map((s, i) => ({ scope: `tmpl-${i + 1}`, id: `zavrsni-rad-${s}`, c: content(`Završni rad iz ${s} predan`, `Završni rad iz ${s} je napisan i predan mentoru na pregled.`, [["rad-predan", "Rad je predan mentoru."]]) })),
  // Two-outcome research template with unrelated ideas.
  ...[["robot-club", "Robotics club for primary schools"], ["garden-planner", "Garden planner for allotments"]].map(([id, title], i) => ({ scope: `tmpl-${i + 1}`, id, c: content(title, `Explore the idea: ${title.toLowerCase()}.`, [["grill-me", "The owner answered the grill-me questions."], ["research", "A research note lists prior work and costs."]]) })),
];

export interface Mirror {
  base: string;
  config: string;
  /** "scope/plan" -> family. Same family means a true duplicate pair. */
  family: Map<string, string>;
  templated: Set<string>;
  exactCopies: string[][];
  bases: { scope: string; id: string; content: ReturnType<typeof content> }[];
  cleanup(): void;
}

export function buildMirror(): Mirror {
  const base = mkdtempSync(join(process.env.JCODE_SCRATCH_DIR ?? process.env.TMPDIR ?? tmpdir(), "mozak-vdup-"));
  const scopes = ["mirror-a", "copies", "mut-1", "mut-2", "mut-3", "mut-4", "mut-5", "tmpl-1", "tmpl-2", "tmpl-3", "relay-old", "relay-bridge"];
  const entries: Record<string, { id: string; root: string }> = {};
  for (const id of scopes) {
    const root = join(base, id);
    mkdirSync(root);
    writeFileSync(join(root, "README.md"), "Synthetic V-dup scope\n");
    writeFileSync(join(root, "AGENTS.md"), "Synthetic instructions\n");
    entries[id] = { id, root };
    initScopeState(entries[id], { operationId: `init-${id}`, scopeId: id, kind: "project", title: `Mirror ${id}`, expectedAbsent: { graph: true, bridge: true }, ownerRef: "synthetic:init", ownerMessageAt: NOW });
  }
  const config = join(base, "inventory.json");
  writeFileSync(config, JSON.stringify({ format: "mozak.local/v3", scopes: scopes.map((id) => ({ id, root: entries[id].root })) }));
  let seq = 0;
  const change = (scope: string, action: string, payload: unknown, actor: "agent" | "owner" = "agent") =>
    mutateScope(entries[scope], { operationId: `op-${++seq}`, scopeId: scope, expected: readScope(entries[scope]).snapshot, action, payload }, actor);
  const propose = (scope: string, planId: string, c: unknown) => change(scope, "propose", { planId, content: c, distinctFromPlanIds: readScope(entries[scope]).state.plans.map((p) => p.id) });
  const reject = (scope: string, planId: string, reason: string) => {
    const shown = reviewShow(readScope(entries[scope]).state, planId, "reject-pending");
    change(scope, "reject-pending", { planId, revisionId: shown.revisionId, reviewDigest: shown.reviewDigest, ownerRef: `synthetic:reject-${++seq}`, ownerMessageAt: NOW, reason }, "owner");
  };

  const family = new Map<string, string>();
  const templated = new Set<string>();
  const exactCopies: string[][] = [];
  const bases: Mirror["bases"] = [];
  BASES.forEach((b, i) => {
    const fam = `f${i + 1}`;
    const c = content(b.title, b.purpose, b.outcomes);
    propose("mirror-a", b.id, c);
    bases.push({ scope: "mirror-a", id: b.id, content: c });
    family.set(`mirror-a/${b.id}`, fam);
    const copyId = `copy-${String(i + 1).padStart(2, "0")}`;
    propose("copies", copyId, c);
    family.set(`copies/${copyId}`, fam);
    exactCopies.push([`mirror-a/${b.id}`, `copies/${copyId}`]);
    MUTATIONS.forEach((m, k) => {
      const { id, c: mc } = m.apply(b);
      const planId = `${id}-${String(i + 1).padStart(2, "0")}`;
      propose(`mut-${k + 1}`, planId, mc);
      family.set(`mut-${k + 1}/${planId}`, fam);
    });
  });
  for (const t of TEMPLATES) {
    propose(t.scope, t.id, t.c);
    family.set(`${t.scope}/${t.id}`, `t:${t.scope}/${t.id}`);
    templated.add(`${t.scope}/${t.id}`);
  }
  propose("relay-old", "calendar-relay-v1", content("Calendar relay for the team planner", "Copy team calendar events into the planner through a relay script on the server.", [["relay-script", "The relay script copies new events."], ["two-way", "Edits in the planner flow back to the calendar."]]));
  reject("relay-old", "calendar-relay-v1", "Replaced by a bridge design.");
  propose("relay-bridge", "sync-bridge-v2", { ...content("Sync bridge between the calendar relay and the team planner", "Replace plan calendar-relay-v1 with a sync bridge that keeps the team calendar and the planner in step.", [["bridge-live", "The bridge syncs events both ways."], ["conflicts", "Conflicting edits are shown to a person."]]), sources: [{ id: "s1", locator: "scope relay-old, plan calendar-relay-v1", anchor: null, observedAt: NOW, version: null, limitations: [] }] });
  family.set("relay-old/calendar-relay-v1", "s:old");
  family.set("relay-bridge/sync-bridge-v2", "s:new");
  propose("mut-5", "moved-placeholder", content("Placeholder for a moved plan", "This draft belongs to another scope.", [["moved", "The plan lives in its new scope."]]));
  reject("mut-5", "moved-placeholder", "Moved to scope mirror-a, see there.");
  family.set("mut-5/moved-placeholder", "moved");
  return { base, config, family, templated, exactCopies, bases, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

export interface VdupResult {
  ok: boolean;
  failures: string[];
  metrics: {
    plans: number; pairs: number; duplicates: number; truePositive: number; precision: number; recall: number;
    familyPairs: number; supersedes: number; overlap: number; templateFiltered: number; templatedDuplicates: number;
    exactCopiesInScopeRefused: number; exactCopiesCrossScopeLabelled: number; exactCopies: number; moved: number; ms: number;
  };
}

const key = (r: { scope: string; planId: string }) => `${r.scope}/${r.planId}`;

/** Gates from D3 goal 1: in-scope exact copies refused, cross-scope copies labelled duplicate, supersession caught, templates clean, precision >= 0.95. */
export function verifyMirror(m: Mirror): VdupResult {
  const failures: string[] = [];
  const inv = loadInventory(m.config);
  // Exact copies in scope: proposing a base's content again under a neutral id is refused.
  let refused = 0;
  for (const b of m.bases) {
    const out = executeOperation(inv, "propose", { scope: b.scope, request: { operationId: `copy-try-${b.id}`, scopeId: b.scope, expected: readScope(inv.scopes.find((s) => s.id === b.scope)!).snapshot, action: "propose", payload: { planId: "zz-new", content: b.content } } });
    if (out.exitCode === 3 && out.data.status === "duplicate-plan-candidate") refused++;
    else failures.push(`exact copy of ${b.id} was not refused in scope (status ${String(out.data.status)})`);
  }
  const started = performance.now();
  const out = executeOperation(inv, "similar", { all: true });
  const ms = Math.round(performance.now() - started);
  if (out.exitCode !== 0) failures.push(`similar exited ${out.exitCode}`);
  const report = out.data.similar as SimilarReport;
  const pairs = report.pairs;
  const fam = (p: SimilarPair, side: "a" | "b") => m.family.get(key(p[side]));
  const dups = pairs.filter((p) => p.label === "duplicate");
  const tp = dups.filter((p) => fam(p, "a") !== undefined && fam(p, "a") === fam(p, "b")).length;
  const precision = dups.length ? tp / dups.length : 0;
  let familyPairs = 0;
  const counts = new Map<string, number>();
  for (const f of m.family.values()) counts.set(f, (counts.get(f) ?? 0) + 1);
  for (const n of counts.values()) familyPairs += (n * (n - 1)) / 2;
  const recall = familyPairs ? tp / familyPairs : 0;
  if (precision < 0.95) failures.push(`duplicate precision ${precision.toFixed(3)} is below 0.95`);
  const templatedDuplicates = dups.filter((p) => m.templated.has(key(p.a)) || m.templated.has(key(p.b))).length;
  if (templatedDuplicates) failures.push(`${templatedDuplicates} templated pair(s) labelled duplicate`);
  let crossLabelled = 0;
  for (const [x, y] of m.exactCopies) {
    if (dups.some((p) => [key(p.a), key(p.b)].sort().join() === [x, y].sort().join())) crossLabelled++;
    else failures.push(`exact copy ${x} ~ ${y} not labelled duplicate`);
  }
  const sup = pairs.find((p) => key(p.a) === "relay-bridge/sync-bridge-v2" && key(p.b) === "relay-old/calendar-relay-v1");
  if (!sup || sup.label !== "supersedes-candidate") failures.push(`sync-bridge-v2 over calendar-relay-v1 is ${sup ? sup.label : "missing"}, expected supersedes-candidate`);
  if (!report.moved.some((x) => key(x) === "mut-5/moved-placeholder")) failures.push("the reject moved to another scope is not listed");
  if (report.templateFiltered < 1) failures.push("the template filter dropped nothing");
  return {
    ok: failures.length === 0,
    failures,
    metrics: {
      plans: report.plans, pairs: pairs.length, duplicates: dups.length, truePositive: tp, precision: Math.round(precision * 1000) / 1000,
      recall: Math.round(recall * 1000) / 1000, familyPairs, supersedes: pairs.filter((p) => p.label === "supersedes-candidate").length,
      overlap: pairs.filter((p) => p.label === "overlap").length, templateFiltered: report.templateFiltered, templatedDuplicates,
      exactCopiesInScopeRefused: refused, exactCopiesCrossScopeLabelled: crossLabelled, exactCopies: m.exactCopies.length, moved: report.moved.length, ms,
    },
  };
}

export const MUTATION_COUNT = BASES.length * MUTATIONS.length;
