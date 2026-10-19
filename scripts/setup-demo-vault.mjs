#!/usr/bin/env node
// Creates (or resets) a clean, non-personal demo vault at ~/Downloads/mozak-demo-vault
// with the MOZAK Obsidian plugin pre-installed and enabled, 3 realistic sample scopes,
// and a step-by-step RECORDING-SCRIPT.md + demo-step.mjs helper for live screen recording.
//
// Usage: node scripts/setup-demo-vault.mjs [target-dir]

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { initScopeState, loadInventory, mutateScope, readScope, reviewShow } from "../packages/core/dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const target = resolve(process.argv[2] ?? join(homedir(), "Downloads", "mozak-demo-vault"));

if (existsSync(target)) {
  rmSync(target, { recursive: true, force: true });
}
mkdirSync(target, { recursive: true });

const OWNER = {
  ownerRef: "owner:demo-session",
  ownerMessageAt: "2026-10-19T12:00:00.000Z",
};

// 1. Create the 3 sample scope folders with realistic, non-personal README.md and AGENTS.md
const scopes = [
  {
    id: "atlas-engine",
    kind: "project",
    title: "Atlas Vector Tile Engine",
    readme: `# Atlas Vector Tile Engine\n\nOffline-first vector map renderer and spatial index written in TypeScript.\n`,
    agents: `# Agent instructions for atlas-engine\n\nRead \`MOZAK.md\` before making changes. Keep tile decoding zero-allocation on the hot path.\n`,
    extraDirs: ["src", "test"],
  },
  {
    id: "routing-notes",
    kind: "topic",
    title: "Offline Routing Literature",
    readme: `# Offline Routing Literature\n\nReading notes and benchmark comparisons on contraction hierarchies and customizable route planning.\n`,
    agents: `# Agent instructions for routing-notes\n\nRead \`MOZAK.md\` first. Cite primary papers with year and section numbers.\n`,
    extraDirs: ["papers"],
  },
  {
    id: "field-kit",
    kind: "project",
    title: "Field Sensor Kit",
    readme: `# Field Sensor Kit\n\nLow-power environmental logger firmware and sync daemon for disconnected field stations.\n`,
    agents: `# Agent instructions for field-kit\n\nRead \`MOZAK.md\` first. Any change to sampling intervals must preserve the 30-day battery budget.\n`,
    extraDirs: ["firmware"],
  },
];

for (const s of scopes) {
  const dir = join(target, s.id);
  mkdirSync(dir, { recursive: true });
  for (const sub of s.extraDirs) mkdirSync(join(dir, sub), { recursive: true });
  writeFileSync(join(dir, "README.md"), s.readme);
  writeFileSync(join(dir, "AGENTS.md"), s.agents);
}

// 2. Write mozak-inventory.json at the vault root so the Obsidian plugin auto-discovers it
const inventoryPath = join(target, "mozak-inventory.json");
writeFileSync(
  inventoryPath,
  `${JSON.stringify(
    {
      format: "mozak.local/v3",
      scopes: scopes.map((s) => ({ id: s.id, root: `./${s.id}` })),
    },
    null,
    2,
  )}\n`,
);

// 3. Initialize all 3 scopes and populate realistic plans so the sidebar shows rich states immediately
const inv = loadInventory(inventoryPath);
const entryById = new Map(inv.scopes.map((e) => [e.id, e]));
let opSeq = 0;

for (const s of scopes) {
  const entry = entryById.get(s.id);
  initScopeState(entry, {
    operationId: `demo-init-${++opSeq}`,
    scopeId: s.id,
    kind: s.kind,
    title: s.title,
    expectedAbsent: { graph: true, bridge: true },
    ...OWNER,
  });
}

function act(scopeId, action, payload, actor = "agent") {
  const entry = entryById.get(scopeId);
  const snap = readScope(entry).snapshot;
  return mutateScope(
    entry,
    {
      operationId: `demo-op-${++opSeq}`,
      scopeId,
      expected: snap,
      action,
      payload,
    },
    actor,
    OWNER.ownerMessageAt,
  );
}

function approveDirection(scopeId, planId) {
  const entry = entryById.get(scopeId);
  const state = readScope(entry).state;
  const plan = state.plans.find((p) => p.id === planId);
  const revId = plan.pending.id;
  const view = reviewShow(state, planId, "approve-direction");
  act(
    scopeId,
    "approve-direction",
    {
      planId,
      revisionId: revId,
      reviewDigest: view.reviewDigest,
      ...OWNER,
      reason: "Approved for demo workspace",
    },
    "owner",
  );
  return readScope(entry).state.plans.find((p) => p.id === planId).accepted.id;
}

// Scope 1: atlas-engine
// - Plan A (completed): tile-format
act("atlas-engine", "propose", {
  planId: "tile-format",
  content: {
    title: "Compact binary tile header",
    purpose: "Shrink per-tile header overhead so regional packs fit on SD cards.",
    outcomes: [
      { id: "header-spec", statement: "16-byte header encodes zoom, bounds, and layer offsets", acceptance: "objective", criterion: "Round-trip decoder tests pass on 10k synthetic tiles" },
    ],
    constraints: [{ id: "c1", text: "Keep little-endian layout" }],
    nonGoals: ["Changing polygon winding rules"],
    rationale: "Fixed-width header avoids varint decoding before bbox culling.",
    questions: [],
    sources: [{ id: "src-1", locator: "atlas-engine/README.md", anchor: null, observedAt: OWNER.ownerMessageAt, version: "v1", limitations: [] }],
  },
});
const tileRev = approveDirection("atlas-engine", "tile-format");
act("atlas-engine", "observe", {
  planId: "tile-format",
  observation: {
    id: "obs-tile-1",
    classification: "observed",
    summary: "16-byte header passes 10,000 round-trip tile checks with zero allocations.",
    evidence: [
      {
        id: "ev-tile-1",
        locator: "atlas-engine/test/header.test.ts",
        anchor: null,
        version: "demo-1",
        inspectedAt: OWNER.ownerMessageAt,
        activity: { kind: "run", description: "npm test -- header.test.ts" },
        result: { verdict: "pass", summary: "10,000 tiles verified" },
        limitations: [],
      },
    ],
  },
  reasoningLinks: [
    {
      id: "link-tile-1",
      relation: "supports",
      from: { planId: "tile-format", revisionId: null, kind: "observation", id: "obs-tile-1" },
      to: { planId: "tile-format", revisionId: tileRev, kind: "outcome", id: "header-spec" },
      rationale: "Direct test verification",
    },
  ],
});
act("atlas-engine", "complete", { planId: "tile-format", revisionId: tileRev });

// - Plan B (open with 3 outcomes: 1 done [green], 1 evidence waiting owner acceptance [gold], 1 current [purple]): offline-cache
act("atlas-engine", "propose", {
  planId: "offline-cache",
  content: {
    title: "Offline regional tile cache",
    purpose: "Let field operators pre-load a region and pan smoothly without network connectivity.",
    outcomes: [
      { id: "pack-index", statement: "Spatial R-tree index maps bounding boxes to byte ranges in a single pack file", acceptance: "objective", criterion: "Lookups finish under 0.2 ms for 50k tiles" },
      { id: "lru-eviction", statement: "Decoded tile LRU stays within the 64 MB budget during rapid zoom sweeps", acceptance: "owner", criterion: "Owner reviews memory trace from a 5-minute pan session" },
      { id: "corrupt-recovery", statement: "Truncated pack files fall back to coarsened parent tiles instead of crashing", acceptance: "objective", criterion: "Fault-injection test suite passes for every byte offset" },
    ],
    constraints: [{ id: "c1", text: "Maximum 64 MB resident memory" }, { id: "c2", text: "Single-file pack format" }],
    nonGoals: ["Background network tile prefetching"],
    rationale: "A single memory-mapped pack file avoids filesystem inode pressure on embedded Linux.",
    questions: [],
    sources: [{ id: "src-cache", locator: "atlas-engine/README.md", anchor: null, observedAt: OWNER.ownerMessageAt, version: "v1", limitations: [] }],
  },
});
const cacheRev = approveDirection("atlas-engine", "offline-cache");
act("atlas-engine", "observe", {
  planId: "offline-cache",
  observation: {
    id: "obs-cache-1",
    classification: "observed",
    summary: "R-tree lookup p99 is 0.08 ms across 50,000 indexed tiles; memory trace peaks at 58.4 MB during zoom sweep.",
    evidence: [
      {
        id: "ev-cache-1",
        locator: "atlas-engine/test/rtree.bench.ts",
        anchor: null,
        version: "demo-1",
        inspectedAt: OWNER.ownerMessageAt,
        activity: { kind: "run", description: "node test/rtree.bench.ts" },
        result: { verdict: "pass", summary: "p99 = 0.08 ms (< 0.2 ms); peak RSS delta = 58.4 MB" },
        limitations: [],
      },
    ],
  },
  reasoningLinks: [
    {
      id: "link-cache-1",
      relation: "supports",
      from: { planId: "offline-cache", revisionId: null, kind: "observation", id: "obs-cache-1" },
      to: { planId: "offline-cache", revisionId: cacheRev, kind: "outcome", id: "pack-index" },
      rationale: "Benchmark satisfies objective criterion",
    },
    {
      id: "link-cache-2",
      relation: "supports",
      from: { planId: "offline-cache", revisionId: null, kind: "observation", id: "obs-cache-1" },
      to: { planId: "offline-cache", revisionId: cacheRev, kind: "outcome", id: "lru-eviction" },
      rationale: "Memory trace attached and awaiting owner acceptance",
    },
  ],
});

// Scope 2: routing-notes (open plan with 1/2 outcomes done)
act("routing-notes", "propose", {
  planId: "contraction-hierarchies",
  content: {
    title: "Compare CH vs CRP turn-cost tables",
    purpose: "Pick a routing graph representation that supports dynamic dirt-road closures without full re-preprocessing.",
    outcomes: [
      { id: "paper-synthesis", statement: "Comparison table of Geisberger 2008 (CH) and Delling 2011 (CRP) preprocessing and query bounds", acceptance: "objective", criterion: "Table committed in routing-notes with exact theorem/table citations" },
      { id: "field-recommendation", statement: "Written recommendation for atlas-engine's offline routing layer", acceptance: "owner", criterion: "Owner accepts the architecture trade-off" },
    ],
    constraints: [{ id: "c1", text: "Preprocessing must run on a laptop in under 2 minutes for a 5M-edge region" }],
    nonGoals: ["Implementing the router in this notes scope"],
    rationale: "Separating the literature review from the engine repo keeps citations reusable.",
    questions: [],
    sources: [{ id: "src-ch", locator: "routing-notes/README.md", anchor: null, observedAt: OWNER.ownerMessageAt, version: "v1", limitations: [] }],
  },
});
const chRev = approveDirection("routing-notes", "contraction-hierarchies");
act("routing-notes", "observe", {
  planId: "contraction-hierarchies",
  observation: {
    id: "obs-ch-1",
    classification: "observed",
    summary: "CRP customization updates edge weights in 1.4 s on a 5M-edge graph vs 95 s full CH rebuild.",
    evidence: [
      {
        id: "ev-ch-1",
        locator: "routing-notes/papers/comparison.md",
        anchor: null,
        version: "demo-1",
        inspectedAt: OWNER.ownerMessageAt,
        activity: { kind: "read", description: "Synthesized Geisberger 2008 Table 2 and Delling 2011 Table 3" },
        result: { verdict: "pass", summary: "Citations and bounds verified" },
        limitations: [],
      },
    ],
  },
  reasoningLinks: [
    {
      id: "link-ch-1",
      relation: "supports",
      from: { planId: "contraction-hierarchies", revisionId: null, kind: "observation", id: "obs-ch-1" },
      to: { planId: "contraction-hierarchies", revisionId: chRev, kind: "outcome", id: "paper-synthesis" },
      rationale: "Comparison table complete",
    },
  ],
});

// Scope 3: field-kit (1 completed plan, ready for live propose -> approve -> observe in the recording)
act("field-kit", "propose", {
  planId: "telemetry-schema",
  content: {
    title: "Fixed-width CBOR sensor frame",
    purpose: "Keep radio bursts under 64 bytes per 10-minute wake cycle.",
    outcomes: [
      { id: "frame-size", statement: "Encoded sensor frame is <= 48 bytes with CRC-16", acceptance: "objective", criterion: "Unit test verifies byte length across extremes" },
    ],
    constraints: [],
    nonGoals: ["Changing LoRa spreading factor"],
    rationale: "Shorter airtime directly extends battery life.",
    questions: [],
    sources: [{ id: "src-fk", locator: "field-kit/README.md", anchor: null, observedAt: OWNER.ownerMessageAt, version: "v1", limitations: [] }],
  },
});
const fkRev = approveDirection("field-kit", "telemetry-schema");
act("field-kit", "observe", {
  planId: "telemetry-schema",
  observation: {
    id: "obs-fk-1",
    classification: "observed",
    summary: "Encoded frame is 42 bytes including CRC-16 across all sensor ranges.",
    evidence: [
      {
        id: "ev-fk-1",
        locator: "field-kit/firmware/frame.test.c",
        anchor: null,
        version: "demo-1",
        inspectedAt: OWNER.ownerMessageAt,
        activity: { kind: "run", description: "ctest -R frame" },
        result: { verdict: "pass", summary: "42 bytes <= 48 bytes" },
        limitations: [],
      },
    ],
  },
  reasoningLinks: [
    {
      id: "link-fk-1",
      relation: "supports",
      from: { planId: "telemetry-schema", revisionId: null, kind: "observation", id: "obs-fk-1" },
      to: { planId: "telemetry-schema", revisionId: fkRev, kind: "outcome", id: "frame-size" },
      rationale: "Verified by unit test",
    },
  ],
});
act("field-kit", "complete", { planId: "telemetry-schema", revisionId: fkRev });

// 4. Install the built Obsidian plugin into .obsidian/plugins/mozak and enable it
const pluginSrc = join(repoRoot, "packages", "obsidian", "dist", "plugin");
const obsidianDir = join(target, ".obsidian");
const pluginDest = join(obsidianDir, "plugins", "mozak");
mkdirSync(pluginDest, { recursive: true });
for (const f of ["main.js", "manifest.json", "styles.css"]) {
  cpSync(join(pluginSrc, f), join(pluginDest, f));
}
const demoMainJs = join(pluginDest, "main.js");
writeFileSync(
  demoMainJs,
  readFileSync(demoMainJs, "utf8").replace(
    "expanded = /* @__PURE__ */ new Set();",
    'expanded = /* @__PURE__ */ new Set(["atlas-engine", "routing-notes", "field-kit"]);',
  ),
);
writeFileSync(join(obsidianDir, "community-plugins.json"), JSON.stringify(["mozak"], null, 2) + "\n");
writeFileSync(
  join(obsidianDir, "app.json"),
  JSON.stringify({ propertiesInDocument: "hidden", showInlineTitle: false }, null, 2) + "\n",
);
writeFileSync(
  join(obsidianDir, "workspace.json"),
  JSON.stringify(
    {
      main: {
        id: "demo-main-split",
        type: "split",
        children: [
          {
            id: "demo-main-tabs",
            type: "tabs",
            children: [
              {
                id: "demo-main-leaf",
                type: "leaf",
                state: {
                  type: "markdown",
                  state: { file: "field-kit/MOZAK.md", mode: "preview", source: false },
                  icon: "lucide-file",
                  title: "MOZAK",
                },
              },
            ],
          },
        ],
        direction: "vertical",
      },
      left: {
        id: "demo-left-split",
        type: "split",
        children: [
          {
            id: "demo-left-tabs",
            type: "tabs",
            children: [
              {
                id: "demo-left-files",
                type: "leaf",
                state: { type: "file-explorer", state: {} },
              },
            ],
          },
        ],
        direction: "horizontal",
        width: 260,
        collapsed: true,
      },
      right: {
        id: "demo-right-split",
        type: "split",
        children: [
          {
            id: "demo-right-tabs",
            type: "tabs",
            children: [
              {
                id: "demo-right-scopes",
                type: "leaf",
                state: {
                  type: "mozak-scopes",
                  state: {},
                  icon: "brain-circuit",
                  title: "MOZAK scopes",
                },
              },
            ],
            currentTab: 0,
          },
        ],
        direction: "horizontal",
        width: 380,
        collapsed: false,
      },
      active: "demo-main-leaf",
      lastOpenFiles: ["atlas-engine/MOZAK.md", "field-kit/MOZAK.md"],
    },
    null,
    2,
  ) + "\n",
);
writeFileSync(
  join(pluginDest, "data.json"),
  JSON.stringify({ inventoryPath: "", autoRefresh: true, remotePollSeconds: 0 }, null, 2) + "\n",
);

// 5. Write a live helper script (demo-step.mjs) so the user can trigger each beat cleanly during screen recording
const helperScript = `#!/usr/bin/env node
// Live recording helper for ~/Downloads/mozak-demo-vault.
// Usage:
//   node demo-step.mjs scopes     # Beat 1: list all scopes and plan counts
//   node demo-step.mjs propose    # Beat 2a: agent proposes 'battery-budget' on field-kit (Obsidian shows 'awaiting approval')
//   node demo-step.mjs approve    # Beat 2b: owner approves direction (Obsidian redraws with open plan + 0/2 strip + Mermaid roadmap)
//   node demo-step.mjs observe    # Beat 3: agent records passing evidence (Obsidian strip advances to 1/2 green)

import { spawnSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const inv = join(dir, "mozak-inventory.json");
const mozak = process.env.MOZAK_BIN || "mozak";
const step = process.argv[2] || "scopes";
const tmp = mkdtempSync(join(tmpdir(), "mozak-live-"));

function run(args, show = true) {
  if (show) console.log("\\x1b[32m$\\x1b[0m mozak " + args.join(" "));
  const r = spawnSync(mozak, [...args, "--config", inv], { encoding: "utf8" });
  if (show && r.stdout) process.stdout.write(r.stdout.replaceAll(dir, "~/mozak-demo-vault"));
  if (r.status !== 0 && r.stderr) process.stderr.write(r.stderr.replaceAll(dir, "~/mozak-demo-vault"));
  return r;
}

function json(args) {
  const r = spawnSync(mozak, [...args, "--config", inv, "--json"], { encoding: "utf8" });
  return JSON.parse(r.stdout || "{}");
}

function reqFile(name, obj) {
  const p = join(tmp, name + ".json");
  writeFileSync(p, JSON.stringify(obj, null, 2));
  return p;
}

if (step === "scopes") {
  run(["scopes"]);
} else if (step === "propose") {
  const snap = json(["context", "--scope", "field-kit"]).snapshot;
  const req = reqFile("propose", {
    operationId: "live-propose-" + Date.now(),
    scopeId: "field-kit",
    expected: snap,
    action: "propose",
    payload: {
      planId: "battery-budget",
      content: {
        title: "30-day deep-sleep power budget",
        purpose: "Keep average draw below 1.8 mA across 10-minute wake cycles.",
        outcomes: [
          { id: "sleep-draw", statement: "Deep-sleep current stays under 45 uA with RTC alarm active", acceptance: "objective", criterion: " Bench ammeter trace < 45 uA over 1 hour" },
          { id: "cold-soak", statement: "30-day projected capacity holds at -10 C", acceptance: "owner", criterion: "Owner signs off on cold-chamber discharge curve" }
        ],
        constraints: [{ id: "c1", text: "No hardware BOM changes" }],
        nonGoals: ["Solar harvester redesign"],
        rationale: "Radio sleep leakage dominates total energy between transmissions.",
        questions: [],
        sources: [{ id: "s1", locator: "field-kit/README.md", anchor: null, observedAt: new Date().toISOString(), version: "v1", limitations: [] }]
      }
    }
  });
  console.log("\\x1b[32m$\\x1b[0m mozak plan propose --scope field-kit --plan battery-budget");
  const r = spawnSync(mozak, ["plan", "propose", "--scope", "field-kit", "--request", req, "--config", inv], { encoding: "utf8" });
  const j = JSON.parse(r.stdout || "{}");
  console.log("  \\x1b[33m→ proposed\\x1b[0m battery-budget (awaiting direction approval)\\n");
  run(["plans", "--scope", "field-kit"]);
} else if (step === "approve") {
  const ctx = json(["context", "--scope", "field-kit"]);
  const view = json(["review", "show", "--scope", "field-kit", "--plan", "battery-budget"]).review;
  const plan = ctx.context.plans.find((p) => (p.planId || p.id) === "battery-budget");
  const revisionId = view.pending?.id || plan.pending?.id;
  const req = reqFile("approve", {
    operationId: "live-approve-" + Date.now(),
    scopeId: "field-kit",
    expected: ctx.snapshot,
    action: "approve-direction",
    payload: {
      planId: "battery-budget",
      revisionId,
      reviewDigest: view.reviewDigest,
      ownerRef: "owner:live-demo",
      ownerMessageAt: new Date().toISOString(),
      reason: "Direction approved in live demo"
    }
  });
  console.log("\\x1b[32m$\\x1b[0m mozak review decide --scope field-kit --plan battery-budget --approve-direction");
  spawnSync(mozak, ["review", "decide", "--scope", "field-kit", "--request", req, "--config", inv], { encoding: "utf8" });
  console.log("  \\x1b[32m✓ direction approved\\x1b[0m → field-kit/MOZAK.json + field-kit/MOZAK.md updated\\n");
  run(["plans", "--scope", "field-kit"]);
} else if (step === "observe") {
  const ctx = json(["context", "--scope", "field-kit"]);
  const plan = ctx.context.plans.find((p) => (p.planId || p.id) === "battery-budget");
  const revisionId = plan.accepted?.id || plan.acceptedRevisionId;
  const now = new Date().toISOString();
  const req = reqFile("observe", {
    operationId: "live-observe-" + Date.now(),
    scopeId: "field-kit",
    expected: ctx.snapshot,
    action: "observe",
    payload: {
      planId: "battery-budget",
      observation: {
        id: "obs-sleep-1",
        classification: "observed",
        summary: "Measured 31.2 uA deep-sleep draw over 60 minutes with SPI flash power-down.",
        evidence: [
          {
            id: "ev-sleep-1",
            locator: "field-kit/firmware/sleep-trace.csv",
            anchor: null,
            version: "v1",
            inspectedAt: now,
            activity: { kind: "run", description: "Bench ammeter 60-min capture" },
            result: { verdict: "pass", summary: "31.2 uA < 45 uA limit" },
            limitations: []
          }
        ]
      },
      reasoningLinks: [
        {
          id: "link-sleep-1",
          relation: "supports",
          from: { planId: "battery-budget", revisionId: null, kind: "observation", id: "obs-sleep-1" },
          to: { planId: "battery-budget", revisionId, kind: "outcome", id: "sleep-draw" },
          rationale: "Bench trace satisfies objective sleep-draw criterion"
        }
      ]
    }
  });
  console.log("\\x1b[32m$\\x1b[0m mozak observe --scope field-kit --plan battery-budget");
  spawnSync(mozak, ["observe", "--scope", "field-kit", "--request", req, "--config", inv], { encoding: "utf8" });
  console.log("  \\x1b[32m✓ evidence recorded\\x1b[0m → outcome 1/2 (sleep-draw) satisfied\\n");
  run(["plans", "--scope", "field-kit"]);
}
`;
const helperPath = join(target, "demo-step.mjs");
writeFileSync(helperPath, helperScript);
chmodSync(helperPath, 0o755);

// 6. Write RECORDING-SCRIPT.md cheat sheet
writeFileSync(
  join(target, "RECORDING-SCRIPT.md"),
  `# MOZAK 45-Second Demo Recording Script

This vault (\`~/Downloads/mozak-demo-vault\`) contains **zero personal data** and has the MOZAK Obsidian plugin pre-installed and enabled.

## Window Setup (before hitting Record)

1. **Right half of screen — Obsidian:**
   - Open Obsidian → **Open folder as vault** → select \`~/Downloads/mozak-demo-vault\`.
   - Click **Trust author and enable plugins** if prompted.
   - Click the **brain-circuit** ribbon icon (**Open MOZAK scopes**) so the **MOZAK Scopes** sidebar is visible.
   - Expand **Atlas Vector Tile Engine**, **Offline Routing Literature**, and **Field Sensor Kit** in the sidebar, and open \`atlas-engine/MOZAK.md\` in the main note pane so its Mermaid roadmap is visible.
2. **Left half of screen — Terminal:**
   - \`cd ~/Downloads/mozak-demo-vault\`
   - Clear the terminal (\`clear\`).

---

## 3-Beat Recording Flow (~45 seconds total)

You can either run the 4 commands below directly, or ask your agent in the terminal.

### Beat 1 (0s – 12s): See all scopes across repos and notes
\`\`\`bash
node demo-step.mjs scopes
\`\`\`
*What the viewer sees:* The terminal lists all 3 scopes from \`mozak-inventory.json\` matching the Obsidian sidebar on the right (\`atlas-engine\` with green/gold/purple outcome segments, \`routing-notes\`, and \`field-kit\`).

### Beat 2 (12s – 28s): Agent proposes → Owner approves direction
\`\`\`bash
node demo-step.mjs propose
\`\`\`
*(Pause 3 seconds — watch **30-day deep-sleep power budget** appear under **Field Sensor Kit** in the Obsidian sidebar as \`awaiting approval\`!)*

\`\`\`bash
node demo-step.mjs approve
\`\`\`
*(Watch the row in Obsidian switch from \`awaiting approval\` to \`open\` with a \`0/2\` outcome strip!)*

### Beat 3 (28s – 45s): Agent records evidence → Click the plan in Obsidian
\`\`\`bash
node demo-step.mjs observe
\`\`\`
1. Watch the progress strip on **30-day deep-sleep power budget** in the Obsidian sidebar turn **green** (\`1/2\`).
2. **Click** **30-day deep-sleep power budget** in the Obsidian sidebar — Obsidian jumps straight to \`## 30-day deep-sleep power budget · battery-budget\` inside \`field-kit/MOZAK.md\`, showing the generated Mermaid roadmap and status table with no UI code written by the agent.

---

## Resetting for Another Take

From \`/Users/fabijanpitlovic/Documents/mozak\`:
\`\`\`bash
node scripts/setup-demo-vault.mjs
\`\`\`
`,
);

console.log(`Prepared clean demo vault at ${target}`);
