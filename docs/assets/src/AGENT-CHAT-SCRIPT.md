# MOZAK Agent Chat Video Script (`mozak-agent-chat.mp4` / `mozak-agent-chat.gif`)

This script shows how a real user works with **MOZAK (`v0.3.0`)** inside an AI coding agent terminal chat (Claude Code, jcode, Codex) with **Obsidian open side-by-side as the live reading IDE**.

Unlike `mozak-demo.mp4` (which shows the raw CLI commands under the hood), this video shows the **human-to-agent conversation** driven by the `/mozak` skill and the `mozak-mcp` server.

---

## Storyboard (4 Beats, 32s @ 12fps, 1920×1080)

### Beat 1 (0.0s – 8.0s): Start `/mozak` → Overview & Focused Clarification
- **User types in Agent TUI:**
  > `/mozak field-kit — plan the 30-day deep-sleep power budget (< 45 uA sleep, -10 C cold soak)`
- **Agent runs MCP read tools:**
  - `⚙ mozak_scopes` → discovers 3 scopes (`atlas-engine`, `field-kit`, `routing-notes`)
  - `⚙ mozak_context (scope: "field-kit")` → reads current state
- **Agent replies (following the `/mozak` skill's Overview + 1-question rule):**
  > **Field Sensor Kit (`field-kit`)** has 1 completed plan (`telemetry-schema`) and 0 open plans.
  >
  > Before I draft `battery-budget`, one question:
  > **Q1:** Should both outcomes (`sleep-draw < 45 uA` and `cold-soak at -10 C`) be **objective** test checks, or owner sign-off?
- **Obsidian (Right Pane):** Shows `field-kit/MOZAK.md` in Reading view and the `MOZAK scopes` sidebar (`All 4 · Open 2 · Done 2`).

---

### Beat 2 (8.0s – 16.0s): User Answers → Agent Proposes & Pauses at Owner Gate
- **User replies:**
  > `Both objective — bench ammeter trace for sleep-draw, chamber log for cold-soak.`
- **Agent runs MCP mutation tool:**
  - `⚙ mozak_propose (scope: "field-kit", plan: "battery-budget")`
- **Agent replies (hard stop at direction approval gate):**
  > Drafted **`battery-budget`** (*30-day deep-sleep power budget*) with 2 objective outcomes:
  > 1. `sleep-draw` — Deep-sleep current stays under 45 uA with RTC alarm active
  > 2. `cold-soak` — 30-day projected capacity holds at -10 C
  >
  > ⏸ **Paused for direction approval.** Check `field-kit/MOZAK.md` in Obsidian and tell me if you approve this direction.
- **Obsidian (Right Pane):** Smoothly cross-dissolves as `field-kit/MOZAK.md` and the `MOZAK scopes` sidebar auto-refresh to show **`awaiting approval`** (`All 5 · Open 3 · Done 2`) and the new Mermaid roadmap (`Sleep draw --> Cold soak`).

---

### Beat 3 (16.0s – 24.0s): User Approves Direction → Roadmap Lights Up
- **User replies:**
  > `Looks right — approve direction for battery-budget.`
- **Agent runs owner-authorized CLI decision:**
  - `✓ mozak review decide --scope field-kit --plan battery-budget --approve-direction`
- **Agent replies:**
  > **Direction approved.** `field-kit/MOZAK.json` and `field-kit/MOZAK.md` are updated.
  >
  > `battery-budget` is now **Open (0/2 done)**. Current stop on the roadmap: **`#1 sleep-draw`**.
- **Obsidian (Right Pane):** Smoothly cross-dissolves to **`Open · 0/2 done`**, the `0/2` progress strip appears in the sidebar, and the `Sleep draw` Mermaid node lights up in purple (`current`).

---

### Beat 4 (24.0s – 32.0s): Agent Runs Bench Check & Records Evidence → Outcome 1/2 Green
- **User replies:**
  > `Run the 1-hour bench ammeter trace and record the observation.`
- **Agent runs test + MCP `mozak_observe`:**
  - `⚙ bash: node firmware/bench-ammeter.mjs --duration 1h` → `PASS: avg 38.4 uA, peak 41.2 uA (< 45 uA)`
  - `⚙ mozak_observe (scope: "field-kit", plan: "battery-budget", outcome: "sleep-draw" -> pass)`
- **Agent replies:**
  > Recorded passing evidence (`ev-sleep-draw-bench`: **38.4 uA avg < 45 uA**).
  >
  > Outcome **`1/2 (sleep-draw)`** is now **✓ done** in Obsidian, and the roadmap advanced to **`#2 cold-soak`**.
- **Obsidian (Right Pane):** Smoothly cross-dissolves to **`Open · 1/2 done`**, the `Sleep draw` Mermaid node and first sidebar segment turn **green (`#5cbf8a`)**, and `Cold soak` becomes the purple active node.
