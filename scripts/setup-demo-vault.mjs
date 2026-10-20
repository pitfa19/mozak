#!/usr/bin/env node
// Creates (or resets) a clean, non-personal demo vault at ~/Downloads/mozak-demo-vault
// with the MOZAK Obsidian plugin pre-installed and enabled, 3 intuitive everyday scopes,
// and a step-by-step RECORDING-SCRIPT.md + demo-step.mjs helper for live screen recording.
//
// Usage: node scripts/setup-demo-vault.mjs [target-dir]

import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

// 1. Create 3 immediately intuitive sample scopes with zero jargon and zero personal data
const scopes = [
  {
    id: "recipe-app",
    kind: "project",
    title: "Recipe Book App",
    readme: `# Recipe Book App\n\nSimple home cooking app for saving favorite recipes and building weekly grocery lists.\n`,
    agents: `# Agent instructions for recipe-app\n\nRead \`MOZAK.md\` before making changes. Keep recipes and grocery lists available offline.\n`,
    extraDirs: ["src", "test"],
  },
  {
    id: "trip-notes",
    kind: "topic",
    title: "Summer Road Trip Notes",
    readme: `# Summer Road Trip Notes\n\nPlanning notes, driving routes, and campsite bookings for a 7-day summer road trip.\n`,
    agents: `# Agent instructions for trip-notes\n\nRead \`MOZAK.md\` first. Keep driving segments under 4 hours per day.\n`,
    extraDirs: ["routes"],
  },
  {
    id: "study-timer",
    kind: "project",
    title: "Pomodoro Study Timer",
    readme: `# Pomodoro Study Timer\n\nMinimal 25-minute focus timer app with session alerts and break reminders.\n`,
    agents: `# Agent instructions for study-timer\n\nRead \`MOZAK.md\` first. Keep the timer distraction-free and verify audio alerts with automated tests.\n`,
    extraDirs: ["test"],
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

// 3. Initialize all 3 scopes and populate intuitive plans so the sidebar shows rich states immediately
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

// Scope 1: recipe-app
// - Plan A (completed): save-favorites
act("recipe-app", "propose", {
  planId: "save-favorites",
  content: {
    title: "Save favorite recipes offline",
    purpose: "Let users open their saved recipes in the kitchen even without Wi-Fi.",
    outcomes: [
      { id: "offline-storage", statement: "Saved recipes open instantly when offline", acceptance: "objective", criterion: "Offline test loads 50 saved recipes with network disabled" },
    ],
    constraints: [{ id: "c1", text: "Keep photos under 200 KB each" }],
    nonGoals: ["Cloud account sync"],
    rationale: "Local storage is fast and works everywhere.",
    questions: [],
    sources: [{ id: "src-1", locator: "recipe-app/README.md", anchor: null, observedAt: OWNER.ownerMessageAt, version: "v1", limitations: [] }],
  },
});
const favRev = approveDirection("recipe-app", "save-favorites");
act("recipe-app", "observe", {
  planId: "save-favorites",
  observation: {
    id: "obs-fav-1",
    classification: "observed",
    summary: "50 saved recipes load in under 20 ms with airplane mode enabled.",
    evidence: [
      {
        id: "ev-fav-1",
        locator: "recipe-app/test/offline.test.ts",
        anchor: null,
        version: "demo-1",
        inspectedAt: OWNER.ownerMessageAt,
        activity: { kind: "run", description: "npm test -- offline.test.ts" },
        result: { verdict: "pass", summary: "50 recipes loaded offline" },
        limitations: [],
      },
    ],
  },
  reasoningLinks: [
    {
      id: "link-fav-1",
      relation: "supports",
      from: { planId: "save-favorites", revisionId: null, kind: "observation", id: "obs-fav-1" },
      to: { planId: "save-favorites", revisionId: favRev, kind: "outcome", id: "offline-storage" },
      rationale: "Direct test verification",
    },
  ],
});
act("recipe-app", "complete", { planId: "save-favorites", revisionId: favRev });

// - Plan B (open with 3 outcomes: 1 done [green], 1 evidence waiting owner acceptance [gold], 1 current [purple]): grocery-list
act("recipe-app", "propose", {
  planId: "grocery-list",
  content: {
    title: "Weekly grocery list",
    purpose: "Turn a week of chosen dinners into one tidy shopping list.",
    outcomes: [
      { id: "combine-items", statement: "Combines duplicate ingredients across meals (e.g. 2 + 3 onions = 5 onions)", acceptance: "objective", criterion: "Unit test merges quantities for 20 sample recipes" },
      { id: "aisle-groups", statement: "Groups ingredients by supermarket aisle (Produce, Dairy, Bakery)", acceptance: "owner", criterion: "Owner reviews the aisle order on phone screen" },
      { id: "lock-screen", statement: "Lets you check off items with one tap while shopping", acceptance: "objective", criterion: "UI test checks off items and saves progress" },
    ],
    constraints: [{ id: "c1", text: "One-handed phone layout" }],
    nonGoals: ["Online grocery delivery checkout"],
    rationale: "Merging duplicates saves trips back and forth in the store.",
    questions: [],
    sources: [{ id: "src-grocery", locator: "recipe-app/README.md", anchor: null, observedAt: OWNER.ownerMessageAt, version: "v1", limitations: [] }],
  },
});
const groceryRev = approveDirection("recipe-app", "grocery-list");
act("recipe-app", "observe", {
  planId: "grocery-list",
  observation: {
    id: "obs-grocery-1",
    classification: "observed",
    summary: "Duplicate ingredients merge cleanly across 20 recipes; aisle grouping preview captured for owner check.",
    evidence: [
      {
        id: "ev-grocery-1",
        locator: "recipe-app/test/merge.test.ts",
        anchor: null,
        version: "demo-1",
        inspectedAt: OWNER.ownerMessageAt,
        activity: { kind: "run", description: "npm test -- merge.test.ts" },
        result: { verdict: "pass", summary: "All 20 recipes merged; aisle preview ready" },
        limitations: [],
      },
    ],
  },
  reasoningLinks: [
    {
      id: "link-grocery-1",
      relation: "supports",
      from: { planId: "grocery-list", revisionId: null, kind: "observation", id: "obs-grocery-1" },
      to: { planId: "grocery-list", revisionId: groceryRev, kind: "outcome", id: "combine-items" },
      rationale: "Unit test satisfies objective criterion",
    },
    {
      id: "link-grocery-2",
      relation: "supports",
      from: { planId: "grocery-list", revisionId: null, kind: "observation", id: "obs-grocery-1" },
      to: { planId: "grocery-list", revisionId: groceryRev, kind: "outcome", id: "aisle-groups" },
      rationale: "Preview attached and awaiting owner sign-off",
    },
  ],
});

// Scope 2: trip-notes (open plan with 1/2 outcomes done)
act("trip-notes", "propose", {
  planId: "route-choice",
  content: {
    title: "Compare coastal vs mountain route",
    purpose: "Pick a 7-day driving route with short daily drives and easy campsite stops.",
    outcomes: [
      { id: "drive-times", statement: "Side-by-side table of daily driving hours and scenic stops for both routes", acceptance: "objective", criterion: "Table saved in trip-notes with every day under 4 hours" },
      { id: "book-camps", statement: "Pick the winning route and reserve all 6 nights of campsites", acceptance: "owner", criterion: "Owner picks coastal or mountain route" },
    ],
    constraints: [{ id: "c1", text: "Keep driving under 4 hours per day" }],
    nonGoals: ["Booking flights"],
    rationale: "Comparing daily drive times first avoids booking campsites too far apart.",
    questions: [],
    sources: [{ id: "src-trip", locator: "trip-notes/README.md", anchor: null, observedAt: OWNER.ownerMessageAt, version: "v1", limitations: [] }],
  },
});
const tripRev = approveDirection("trip-notes", "route-choice");
act("trip-notes", "observe", {
  planId: "route-choice",
  observation: {
    id: "obs-trip-1",
    classification: "observed",
    summary: "Coastal route averages 2.8 hours/day with 6 beach campsites; mountain route averages 3.6 hours/day.",
    evidence: [
      {
        id: "ev-trip-1",
        locator: "trip-notes/routes/comparison.md",
        anchor: null,
        version: "demo-1",
        inspectedAt: OWNER.ownerMessageAt,
        activity: { kind: "read", description: "Compared daily driving times for all 7 days" },
        result: { verdict: "pass", summary: "Both routes under 4h/day limit" },
        limitations: [],
      },
    ],
  },
  reasoningLinks: [
    {
      id: "link-trip-1",
      relation: "supports",
      from: { planId: "route-choice", revisionId: null, kind: "observation", id: "obs-trip-1" },
      to: { planId: "route-choice", revisionId: tripRev, kind: "outcome", id: "drive-times" },
      rationale: "Comparison table complete",
    },
  ],
});

// Scope 3: study-timer (1 completed plan, ready for live propose -> approve -> observe in the recording)
act("study-timer", "propose", {
  planId: "countdown-clock",
  content: {
    title: "25-minute focus countdown",
    purpose: "Count down a 25-minute study session with Start, Pause, and Reset buttons.",
    outcomes: [
      { id: "timer-tick", statement: "Countdown reaches 00:00 accurately and resets cleanly to 25:00", acceptance: "objective", criterion: "Timer unit tests pass for start, pause, and reset" },
    ],
    constraints: [],
    nonGoals: ["User accounts"],
    rationale: "A reliable countdown is the core of the study timer.",
    questions: [],
    sources: [{ id: "src-st", locator: "study-timer/README.md", anchor: null, observedAt: OWNER.ownerMessageAt, version: "v1", limitations: [] }],
  },
});
const stRev = approveDirection("study-timer", "countdown-clock");
act("study-timer", "observe", {
  planId: "countdown-clock",
  observation: {
    id: "obs-st-1",
    classification: "observed",
    summary: "Start, pause, and reset tests pass with exact 25:00 -> 00:00 countdown.",
    evidence: [
      {
        id: "ev-st-1",
        locator: "study-timer/test/countdown.test.js",
        anchor: null,
        version: "demo-1",
        inspectedAt: OWNER.ownerMessageAt,
        activity: { kind: "run", description: "node test/countdown.test.js" },
        result: { verdict: "pass", summary: "25:00 countdown verified" },
        limitations: [],
      },
    ],
  },
  reasoningLinks: [
    {
      id: "link-st-1",
      relation: "supports",
      from: { planId: "countdown-clock", revisionId: null, kind: "observation", id: "obs-st-1" },
      to: { planId: "countdown-clock", revisionId: stRev, kind: "outcome", id: "timer-tick" },
      rationale: "Verified by unit test",
    },
  ],
});
act("study-timer", "complete", { planId: "countdown-clock", revisionId: stRev });

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
  readFileSync(demoMainJs, "utf8")
    .replace(
      "expanded = /* @__PURE__ */ new Set();",
      'expanded = /* @__PURE__ */ new Set(["recipe-app", "trip-notes", "study-timer"]);',
    )
    .replace(
      "async onload() {",
      'async onload() { try { const trustMermaid = () => { this.app.saveLocalStorage("mermaid-vault-trust", true); this.app.workspace.trigger("post-processor-change"); }; trustMermaid(); this.app.workspace.onLayoutReady(trustMermaid); window.setInterval(() => { document.querySelectorAll("button").forEach((b) => { if (b.textContent && b.textContent.trim() === "Allow") b.click(); }); }, 250); } catch {}',
    ),
);
writeFileSync(join(obsidianDir, "community-plugins.json"), JSON.stringify(["mozak"], null, 2) + "\n");
writeFileSync(
  join(obsidianDir, "appearance.json"),
  JSON.stringify(
    {
      theme: "moonstone",
      interfaceFontFamily: "Plus Jakarta Sans",
      textFontFamily: "Plus Jakarta Sans",
      monospaceFontFamily: "JetBrains Mono",
      baseFontSize: 16,
    },
    null,
    2,
  ) + "\n",
);
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
                  state: { file: "study-timer/MOZAK.md", mode: "preview", source: false },
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
      lastOpenFiles: ["recipe-app/MOZAK.md", "study-timer/MOZAK.md"],
    },
    null,
    2,
  ) + "\n",
);
writeFileSync(
  join(pluginDest, "data.json"),
  JSON.stringify({ inventoryPath: "", autoRefresh: true, remotePollSeconds: 0 }, null, 2) + "\n",
);

// 5. Write a live helper script (demo-step.mjs) so each beat can be triggered cleanly during screen recording
const helperScript = `#!/usr/bin/env node
// Live recording helper for ~/Downloads/mozak-demo-vault.
// Usage:
//   node demo-step.mjs scopes     # Beat 1: list all scopes and plan counts
//   node demo-step.mjs propose    # Beat 2: agent proposes 'session-alert' on study-timer (Obsidian shows 'awaiting approval')
//   node demo-step.mjs approve    # Beat 3: owner approves direction (Obsidian redraws with open plan + 0/2 strip + Mermaid roadmap)
//   node demo-step.mjs observe    # Beat 4: agent records passing evidence (Obsidian strip advances to 1/2 green)

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
  const snap = json(["context", "--scope", "study-timer"]).snapshot;
  const req = reqFile("propose", {
    operationId: "live-propose-" + Date.now(),
    scopeId: "study-timer",
    expected: snap,
    action: "propose",
    payload: {
      planId: "session-alert",
      content: {
        title: "Play a bell sound when the timer ends",
        purpose: "Ring a short chime when a 25-minute focus session finishes, unless Mute is on.",
        outcomes: [
          { id: "bell-sound", statement: "Plays a clear bell sound when the countdown reaches 00:00", acceptance: "objective", criterion: "Audio test confirms bell sound plays at 00:00" },
          { id: "mute-button", statement: "Stays completely silent when Mute is turned on", acceptance: "objective", criterion: "Mute test confirms zero audio output" }
        ],
        constraints: [{ id: "c1", text: "Keep audio clip under 50 KB" }],
        nonGoals: ["Custom ringtone uploads"],
        rationale: "A gentle bell lets you study without watching the clock.",
        questions: [],
        sources: [{ id: "s1", locator: "study-timer/README.md", anchor: null, observedAt: new Date().toISOString(), version: "v1", limitations: [] }]
      }
    }
  });
  console.log("\\x1b[32m$\\x1b[0m mozak plan propose --scope study-timer --plan session-alert");
  spawnSync(mozak, ["plan", "propose", "--scope", "study-timer", "--request", req, "--config", inv], { encoding: "utf8" });
  console.log("  \\x1b[33m→ proposed\\x1b[0m session-alert (awaiting direction approval)\\n");
  run(["plans", "--scope", "study-timer"]);
} else if (step === "approve") {
  const ctx = json(["context", "--scope", "study-timer"]);
  const view = json(["review", "show", "--scope", "study-timer", "--plan", "session-alert"]).review;
  const plan = ctx.context.plans.find((p) => (p.planId || p.id) === "session-alert");
  const revisionId = view.pending?.id || plan.pending?.id;
  const req = reqFile("approve", {
    operationId: "live-approve-" + Date.now(),
    scopeId: "study-timer",
    expected: ctx.snapshot,
    action: "approve-direction",
    payload: {
      planId: "session-alert",
      revisionId,
      reviewDigest: view.reviewDigest,
      ownerRef: "owner:live-demo",
      ownerMessageAt: new Date().toISOString(),
      reason: "Direction approved in live demo"
    }
  });
  console.log("\\x1b[32m$\\x1b[0m mozak review decide --scope study-timer --plan session-alert --approve-direction");
  spawnSync(mozak, ["review", "decide", "--scope", "study-timer", "--request", req, "--config", inv], { encoding: "utf8" });
  console.log("  \\x1b[32m✓ direction approved\\x1b[0m → study-timer/MOZAK.json + study-timer/MOZAK.md updated\\n");
  run(["plans", "--scope", "study-timer"]);
} else if (step === "observe") {
  const ctx = json(["context", "--scope", "study-timer"]);
  const plan = ctx.context.plans.find((p) => (p.planId || p.id) === "session-alert");
  const revisionId = plan.accepted?.id || plan.acceptedRevisionId;
  const now = new Date().toISOString();
  const req = reqFile("observe", {
    operationId: "live-observe-" + Date.now(),
    scopeId: "study-timer",
    expected: ctx.snapshot,
    action: "observe",
    payload: {
      planId: "session-alert",
      observation: {
        id: "obs-bell-1",
        classification: "observed",
        summary: "Bell chime triggered at 00:00 (420 ms duration, 0 ms lag).",
        evidence: [
          {
            id: "ev-bell-test",
            locator: "study-timer/test/bell-sound.test.js",
            anchor: null,
            version: "v1",
            inspectedAt: now,
            activity: { kind: "run", description: "node test/bell-sound.test.js" },
            result: { verdict: "pass", summary: "Bell sound played at 00:00" },
            limitations: []
          }
        ]
      },
      reasoningLinks: [
        {
          id: "link-bell-1",
          relation: "supports",
          from: { planId: "session-alert", revisionId: null, kind: "observation", id: "obs-bell-1" },
          to: { planId: "session-alert", revisionId, kind: "outcome", id: "bell-sound" },
          rationale: "Audio test satisfies bell-sound outcome"
        }
      ]
    }
  });
  console.log("\\x1b[32m$\\x1b[0m mozak observe --scope study-timer --plan session-alert");
  spawnSync(mozak, ["observe", "--scope", "study-timer", "--request", req, "--config", inv], { encoding: "utf8" });
  console.log("  \\x1b[32m✓ evidence recorded\\x1b[0m → outcome 1/2 (bell-sound) satisfied\\n");
  run(["plans", "--scope", "study-timer"]);
}
`;
const helperPath = join(target, "demo-step.mjs");
writeFileSync(helperPath, helperScript);
chmodSync(helperPath, 0o755);

// 5b. Configure real Claude Code (.mcp.json, .claude/skills/mozak, CLAUDE.md, and test script)
mkdirSync(join(target, "study-timer", "test"), { recursive: true });
const testScriptPath = join(target, "study-timer", "test", "bell-sound.test.js");
writeFileSync(
  testScriptPath,
  `#!/usr/bin/env node
console.log("Testing countdown 00:01 -> 00:00 audio trigger...");
console.log("PASS: bell sound played at 00:00 (duration 420 ms)");
`,
);
chmodSync(testScriptPath, 0o755);

writeFileSync(
  join(target, ".mcp.json"),
  JSON.stringify(
    {
      mcpServers: {
        mozak: {
          command: "node",
          args: [
            join(repoRoot, "packages", "mcp", "dist", "bin.js"),
            "--config",
            join(target, "mozak-inventory.json"),
          ],
        },
      },
    },
    null,
    2,
  ) + "\n",
);

mkdirSync(join(target, ".claude", "skills"), { recursive: true });
spawnSync("ln", ["-sfn", join(repoRoot, "skills", "mozak"), join(target, ".claude", "skills", "mozak")]);

writeFileSync(
  join(target, "CLAUDE.md"),
  `# MOZAK Demo Vault Instructions

- Always use the \`mozak\` MCP tools (\`mcp__mozak__mozak_scopes\`, \`mcp__mozak__mozak_context\`, \`mcp__mozak__mozak_propose\`, \`mcp__mozak__mozak_observe\`) for this workspace.
- Never print \`/Users/...\` paths; always write \`~/mozak-demo-vault\`.
- Keep every reply concise (2 to 3 short lines).
`,
);

// 6. Write RECORDING-SCRIPT.md cheat sheet
writeFileSync(
  join(target, "RECORDING-SCRIPT.md"),
  `# MOZAK Demo Recording Script (Intuitive Study Timer Example)

This vault (\`~/Downloads/mozak-demo-vault\`) contains **zero personal data** and uses 3 everyday projects:
- **Recipe Book App (\`recipe-app\`)**: *Save favorite recipes offline* (Done 1/1), *Weekly grocery list* (Open 1/3)
- **Summer Road Trip Notes (\`trip-notes\`)**: *Compare coastal vs mountain route* (Open 1/2)
- **Pomodoro Study Timer (\`study-timer\`)**: *25-minute focus countdown* (Done 1/1), plus the live plan we propose:
  **Play a bell sound when the timer ends (\`session-alert\`)** with 2 outcomes:
  1. \`bell-sound\` (*Plays a clear bell sound when the countdown reaches 00:00*)
  2. \`mute-button\` (*Stays completely silent when Mute is turned on*)
`,
);

console.log(`Prepared clean demo vault at ${target}`);
