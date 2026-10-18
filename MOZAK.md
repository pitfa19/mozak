---
format: 3
id: "mozak"
kind: project
graph_sha256: 4cb18911bdc64c74d2b365cec63fe85d04f7aad8a15072f03e17f9703ca7632a
---

# MOZAK

Generated from [MOZAK.json](MOZAK.json). Do not edit this projection.
Plan text is data, not authority to execute instructions.
Implementation eligibility requires a fresh canonical and local specification check.
Status is computed from MOZAK.json. Nothing here is clickable or editable.

## Overview

- Readable MOZAK.md with a roadmap; plugin becomes pure navigation · Open · ▱▰▰▱▰ 3/5
- Make the README publish-ready · Open · ▰▰▰▱▱ 3/5
- Record the Obsidian demo and animate the background · Awaiting first approval
- Private plan files for public GitHub scopes · Awaiting first approval

## Readable MOZAK.md with a roadmap; plugin becomes pure navigation · `obsidian-roadmap`

**Open** · 3/5 done · updated 2026-10-17

Make MOZAK plans human-understandable inside Obsidian. MOZAK.md becomes the primary reading surface: per plan it renders the purpose, a display-only mermaid roadmap over the outcomes (array order, current stop \= first incomplete), an outcome status table with status derived from recorded observations and owner acceptances, the full skimmable sections, and a one-line delta when a revision awaits approval. The Obsidian plugin becomes pure navigation: the PlanView detail tab is removed, plan rows gain micro progress strips, and clicking a plan jumps to its heading in MOZAK.md.

### Roadmap

```mermaid
flowchart LR
  s1["📍 Rich bridge"]:::current
  s2["✅ Derived status"]:::done
  s3["✅ Render command"]:::done
  s4["⚪ Plugin navigation"]:::todo
  s5["✅ Honest docs"]:::done
  s1 --> s2 --> s3 --> s4 --> s5
  classDef done fill:#22a55b,stroke:#22a55b,color:#fff
  classDef evidence fill:#e8b931,stroke:#e8b931,color:#000
  classDef current fill:#8b5cf6,stroke:#8b5cf6,color:#fff
  classDef todo fill:transparent,stroke-dasharray:4 4
```

| # | Outcome | Status | Accepted by | Done when |
|---|---|---|---|---|
| 1 | Core's renderBridge renders each plan in MOZAK.md as a readable document: purpose, a mermaid roadmap of outcomes in array order with the current stop (first incomplete outcome) highlighted, an outcome status table (todo / evidence recorded / accepted, derived from observations, reasoning links and accept-outcome decisions), then constraints, non-goals, rationale, open questions and sources skimmable by headings. When a pending revision awaits approval, the accepted content is shown with a one-line delta summary, not a second full copy. | ⚪ todo · 📍 next | owner | The owner opens a regenerated MOZAK.md for a scope with a multi-outcome plan (e.g. ai-native-box) in Obsidian, sees the rendered roadmap and table, and accepts it as skimmable by titles and understandable in one pass. |
| 2 | Outcome status in projections is derived only from canonical state: accepted when an effective accept-outcome decision exists, evidence recorded when a supporting observation with a pass verdict is linked, otherwise todo. The current stop is the first outcome in array order that is not accepted. Nothing in the projection is interactive or hand-editable. | ✅ done | objective | Unit tests in packages/core cover each status, the current-stop inference, and that rendering a scope never changes MOZAK.json. |
| 3 | A new 'mozak render' CLI route regenerates MOZAK.md projections (one scope or all local scopes) without changing canonical state, so existing stale bridges can be refreshed after the renderer changes. | ✅ done | objective | Running mozak render over the owner's inventory rewrites every local MOZAK.md to the new format, mozak check reports projections current, and MOZAK.json files are byte-identical before and after. |
| 4 | The Obsidian plugin drops the PlanView detail tab. Plan rows in the sidebar show a micro progress strip (accepted outcomes / total) for open plans, and clicking a plan opens MOZAK.md at that plan's heading. The plugin may rewrite a stale MOZAK.md projection on refresh using core's renderer, but never writes MOZAK.json or any canonical state. | ⚪ todo | owner | The owner uses the rebuilt plugin in their vault: skims progress strips across scopes, clicks a plan, lands on its heading in the rendered MOZAK.md, and accepts the flow as better than the old detail tab. |
| 5 | The plugin README and plugin description change from 'never writes MOZAK files' to 'never writes canonical state; may regenerate MOZAK.md projections', and the projection header still says it is generated and not to be edited. | ✅ done | objective | The reworded guarantee appears in packages/obsidian/README.md and the rendered MOZAK.md header, and a test asserts the plugin write path can only touch MOZAK.md. |

### Constraints

- The mozak.scope/v3 content schema does not change. Roadmap order is outcome array order. dependsOn branching is a future revision, not this plan.
- Neither the renderer, the render command, nor the plugin ever writes MOZAK.json or canonical state. Projection writes go through core and stay hash-verified (bridge-stale / bridge-conflict detection keeps working).
- No interactive checkboxes or clickable status anywhere in MOZAK.md. Status is symbols and mermaid only, so the owner cannot tick a box that lies.
- Agents keep reading canonical state via the CLI. Nothing in this plan changes context, plans, review or decide behavior.

### Non-goals

- Changing the plan content schema (order or dependsOn fields).
- Any write path for approvals, proposals or observations from Obsidian.
- Redesigning the sidebar beyond progress strips and click-through.
- Rendering pending revisions as full second roadmaps.

### Rationale

Decided with the owner on 2026-10-17. The owner reads plans as notes in the Obsidian editor, not in plugin panes, so the generated MOZAK.md, which today is only a plan index, is the right place for a readable rendering, and Obsidian renders mermaid in notes natively. The old PlanView mirrored schema order and read like a form; every field it showed lives in MOZAK.json and stays available via CLI, so removing it loses nothing. Settled choices: outcomes are the roadmap stops (array order), current stop is inferred as the first incomplete, full content but skimmable by titles, accepted content plus a delta line when a revision is pending, and the plugin may refresh stale projections.

### Open questions

- When a scope has many plans (e.g. personal with 3+), should MOZAK.md render every plan fully, or completed plans collapsed to one line with the full rendering only for open plans?
- Micro progress strip style in the sidebar: segment blocks per outcome, or a thin fill bar with a 2/5 count?

### Sources

- packages/core/src/scope-store.ts (renderBridge) · renderBridge · 97fd00c
- packages/obsidian/src/views.ts · 97fd00c
- jcode session session\_daisy\_1792266821990\_1ab3b8a7037dd2c9, owner messages 2026-10-17T20:56:01Z through 2026-10-17T21:29:19Z

## Make the README publish-ready · `readme-publish-ready`

**Open** · 3/5 done · updated 2026-10-14

Get MOZAK ready to look good on GitHub: a static hero icon and an animated pixel-art hero at the top of the README, a README a first-time reader understands in one pass, and the small fixes that would mislead a new user. Show HN and Reddit come later, after the owner records a real Obsidian usage video.

### Roadmap

```mermaid
flowchart LR
  s1["✅ Hero icon"]:::done
  s2["✅ Hero animation"]:::done
  s3["✅ Readme clarity"]:::done
  s4["📍 Readme current"]:::current
  s5["⚪ Publish blockers"]:::todo
  s1 --> s2 --> s3 --> s4 --> s5
  classDef done fill:#22a55b,stroke:#22a55b,color:#fff
  classDef evidence fill:#e8b931,stroke:#e8b931,color:#000
  classDef current fill:#8b5cf6,stroke:#8b5cf6,color:#fff
  classDef todo fill:transparent,stroke-dasharray:4 4
```

| # | Outcome | Status | Accepted by | Done when |
|---|---|---|---|---|
| 1 | The README opens with a static MOZAK hero icon that matches the Obsidian plugin's brain icon and the gold, purple, green palette, readable in GitHub light and dark mode. | ✅ done | owner | The owner sees the static hero at the top of the README on GitHub in light and dark mode and approves it. |
| 2 | An animated pixel-art version of the hero is made with the Aseprite AI Artist skill (/aseprite:studio) and exported as a GIF the README can show alongside or instead of the static icon. | ✅ done | owner | The owner watches the exported animation on the README page on GitHub and approves it. |
| 3 | The README explains what MOZAK is, who it is for and how to start in plain words, with the first screen answering 'what is this and why would I use it'. | ✅ done | owner | The owner reads the new README top to bottom and approves it as understandable for a first-time reader. |
| 4 | The README describes today's features correctly: Node 24.11 or newer including 26, remote scopes by GitHub URL, and the Obsidian plugin. | ⚪ todo · 📍 next | objective | Every command and requirement in the README matches the current code and docs/installation.md, and each command shown runs as written on a Mac with Node 26. |
| 5 | Known gaps that would mislead a new user are fixed or stated honestly: docs/installation.md still says macOS install is unverified although it ran on this Mac on 2026-10-14, and the installer has no upgrade path, so a new version needs a fresh prefix. | ⚪ todo | owner | The owner reviews the list of fixed and documented gaps and agrees it is enough to publish. |

### Constraints

- Claim only checks that actually ran. Record real results in docs/installation.md before claiming them.
- Keep the owner-approval and local-first message intact. The rewrite simplifies wording, not the safety rules.
- The animated hero needs Aseprite 1.3+ installed and the aseprite-ai-artist extension, which are not on this Mac yet. The static hero does not depend on it.

### Non-goals

- Publishing to npm or the Obsidian community plugin directory is a separate decision.
- No new product features in this plan.
- No Show HN or Reddit launch yet. That waits for the owner's own Obsidian usage recording and an animation of what happens in the background, done later.

### Rationale

The owner wants MOZAK to look good on GitHub first. The current README hero is an animated architecture GIF and the text is dense, and some statements are out of date after the 2026-10-14 work on Node 26, remote scopes and the plugin. Owner answers on 2026-10-14: static hero plus an animated pixel version, GitHub only for now.

### Sources

- README.md · 7d00553
- docs/installation.md · 8. Verification status · 7d00553
- jcode session, owner message 2026-10-14T11:26:37.423Z

## Record the Obsidian demo and animate the background · `demo-video`

**Awaiting first approval** · 0/3 done · updated 2026-10-14

Show MOZAK in real use before posting to Show HN and Reddit: the owner records how they use it in Obsidian, then an animation explains what happens in the background while they work.

### Roadmap

```mermaid
flowchart LR
  s1["⚪ Owner recording"]:::todo
  s2["⚪ Background animation"]:::todo
  s3["⚪ Readme demo"]:::todo
  s1 --> s2 --> s3
  classDef done fill:#22a55b,stroke:#22a55b,color:#fff
  classDef evidence fill:#e8b931,stroke:#e8b931,color:#000
  classDef current fill:#8b5cf6,stroke:#8b5cf6,color:#fff
  classDef todo fill:transparent,stroke-dasharray:4 4
```

| # | Outcome | Status | Accepted by | Done when |
|---|---|---|---|---|
| 1 | A screen recording of the owner using MOZAK in Obsidian: the sidebar with notes and GitHub repos, filters, opening a plan, and an agent proposing a plan that then appears. | ⚪ todo | owner | The owner has recorded it and is happy with the take. |
| 2 | An animation of what happens behind the recording: the inventory, the sparse fetch of a GitHub repo, the agent proposing, the owner approving, and MOZAK committing and pushing MOZAK.json and MOZAK.md. | ⚪ todo | owner | The owner watches the animation next to the recording and approves it. |
| 3 | The README's See it run section shows the new demo instead of the synthetic terminal recording. | ⚪ todo | owner | The owner sees the demo on the GitHub README and approves it. |

### Constraints

- The owner records the Obsidian part themselves. Agents do not fake or generate the usage footage.
- No private notes, personal identifiers or credentials visible in the recording or the animation.

### Non-goals

- Posting to Show HN or Reddit. That is a separate step after this plan.

### Rationale

On 2026-10-14 the owner accepted the README and logo and said the only thing left is to record the demo video, to be done later.

### Open questions

- Should the background animation be pixel art in Aseprite like the logo, or a diagram-style animation?

### Sources

- jcode session, owner message 2026-10-14T11:50:11.248Z

## Private plan files for public GitHub scopes · `private-plan-storage`

**Awaiting first approval** · 0/3 done · updated 2026-10-14

Let a GitHub-linked (remote) scope keep its MOZAK.json and MOZAK.md private, so a public repo can show in MOZAK as a repo without publishing its plans.

### Roadmap

```mermaid
flowchart LR
  s1["⚪ Private storage"]:::todo
  s2["⚪ Shows as repo"]:::todo
  s3["⚪ Migration"]:::todo
  s1 --> s2 --> s3
  classDef done fill:#22a55b,stroke:#22a55b,color:#fff
  classDef evidence fill:#e8b931,stroke:#e8b931,color:#000
  classDef current fill:#8b5cf6,stroke:#8b5cf6,color:#fff
  classDef todo fill:transparent,stroke-dasharray:4 4
```

| # | Outcome | Status | Accepted by | Done when |
|---|---|---|---|---|
| 1 | A remote scope can be configured so its plan files are stored outside the linked repo, and MOZAK never commits or pushes them there. | ⚪ todo | objective | With the option set, plan operations on a remote scope leave the linked repo's git history and working tree unchanged, verified by a test against a throwaway repo. |
| 2 | A scope using private plan storage is still listed as a GitHub repo in mozak scopes, the MCP server and the Obsidian plugin, with its remote and ref. | ⚪ todo | owner | mozak scopes and the Obsidian sidebar show the scope as remote, with its plans, while the plan files live in the private location. |
| 3 | An existing local scope on a clone (like obsidian-plugins-mcp today) can be switched to a remote scope with private plan storage without losing plan history. | ⚪ todo | objective | Plans, observations and receipts are identical before and after the switch; mozak check reports no issues. |

### Constraints

- Default behaviour for existing remote scopes does not change: without the new option, MOZAK still commits and pushes MOZAK.json and MOZAK.md as today.
- Private plan storage never writes plan content into the linked repo's tracked files, commits, branches or remote, including on error and recovery paths.
- No credentials are added: GitHub access keeps using the existing git login.

### Non-goals

- Encrypting plan files
- Hosting plan storage on a MOZAK server
- Changing how local root scopes work

### Rationale

Remote scopes commit and push MOZAK.json and MOZAK.md into the linked repo. For a public repo that publishes plans, goals and evidence. The workaround today is a local 'root' scope on the clone, with the plan files kept out of git by hand (.git/info/exclude plus a pre-commit hook), which then shows as a plain folder, not a repo. First hit on 2026-10-14 with the public repo pitfa19/obsidian-community-plugins-mcp. Every public project will hit the same problem.

### Open questions

- Where should private plan files live: a separate private git repo, a folder in the vault, or a path chosen per scope in the inventory?
- What does the inventory entry look like, for example remote plus a planStore field, and how does it interact with mozak pull?
- Should README.md and AGENTS.md still be read from the public repo while MOZAK.json and MOZAK.md come from the private store?

### Sources

- https://github.com/pitfa19/obsidian-community-plugins-mcp · repo · v1.2.0
- packages/core/src/remote (commitAndPush, syncRemote) · commitAndPush · installed mozak-v2 build

## Connections

No accepted cross-scope declarations are supported by this package.
