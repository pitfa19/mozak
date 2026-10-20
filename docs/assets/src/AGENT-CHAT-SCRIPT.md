# mozak Agent Chat Video Script (`mozak-agent-chat.mp4` / `mozak-agent-chat.gif`)

This script shows how a real user works with **mozak (`v0.3.0`)** inside an AI coding agent terminal chat (`claude` / Claude Code) with **Obsidian open side-by-side as the live reading IDE**.

It uses an immediately intuitive, everyday example (**`Pomodoro Study Timer`** alongside **`Recipe Book App`** and **`Summer Road Trip Notes`**) so any viewer understands the plan in one glance.

---

## The 3 Sample Projects in `~/mozak-demo-vault`

1. **`recipe-app` — Recipe Book App**
   - *Save favorite recipes offline* (`Completed · 1/1`)
   - *Weekly grocery list* (`Open · 1/3` — 1 green done, 1 gold awaiting owner review, 1 purple next)
2. **`trip-notes` — Summer Road Trip Notes**
   - *Compare coastal vs mountain route* (`Open · 1/2` — 1 green done, 1 purple next)
3. **`study-timer` — Pomodoro Study Timer** *(active project in the video)*
   - *25-minute focus countdown* (`Completed · 1/1`)
   - **New plan created in the demo:** ***Play a bell sound when the timer ends*** (`session-alert`)
     - Outcome 1 (`bell-sound` → Mermaid node **`Bell sound`**): *Plays a clear bell sound when the countdown reaches 00:00*
     - Outcome 2 (`mute-button` → Mermaid node **`Mute button`**): *Stays completely silent when Mute is turned on*

---

## Storyboard (Same 4 Moves in Sequence)

### Move 1 (Beat 1): You Ask in Plain Words → Agent Reads Context & Asks 1 Question
- **You type in Claude Code:**
  > `/mozak study-timer — add a bell sound when the 25-minute timer ends, plus a mute button`
- **Agent runs MCP read tools:**
  - `⚙ mozak_scopes` → finds 3 scopes (`recipe-app`, `study-timer`, `trip-notes`)
  - `⚙ mozak_context (scope: "study-timer")` → `1 done (countdown-clock), 0 open`
- **Agent replies (2-line overview + 1 focused question):**
  > **Pomodoro Study Timer (`study-timer`)** has 1 completed plan (*25-minute focus countdown*) and 0 open plans.
  >
  > **Q1:** Can both outcomes (**`bell-sound`** at `00:00` and **`mute-button`**) be verified by automated audio tests, or do you want to sign off yourself?
- **Obsidian (Right Pane — `beat1a.png`):** Shows `study-timer/MOZAK.md` in Reading view and the `mozak scopes` sidebar (`All 4 · Open 2 · Done 2`).

---

### Move 2 (Beat 2): You Answer → Agent Drafts the Plan & Waits at the Owner Gate
- **You reply:**
  > `Automated audio tests for both.`
- **Agent runs MCP mutation tool:**
  - `⚙ mozak_propose (scope: "study-timer", plan: "session-alert")`
- **Agent replies (hard stop at direction approval gate):**
  > Drafted **`session-alert`** (*Play a bell sound when the timer ends*) with 2 objective outcomes:
  > 1. `bell-sound` — Plays a clear bell sound when the countdown reaches `00:00`
  > 2. `mute-button` — Stays completely silent when Mute is turned on
  >
  > ⏸ **Paused for your direction approval.** Check `study-timer/MOZAK.md` in Obsidian and tell me if you approve.
- **Obsidian (Right Pane — `beat2.png`):** Immediately refreshes to show **`Play a bell sound when the timer ends · Awaiting first approval`**, sidebar badge **`awaiting approval`** (`All 5 · Open 3 · Done 2`), and the new Mermaid roadmap (**`Bell sound` ➔ `Mute button`**).

---

### Move 3 (Beat 3): You Approve the Direction → Roadmap Lights Up Purple
- **You reply:**
  > `Looks good — approve direction for session-alert.`
- **Owner-authorized CLI decision runs:**
  - `✓ mozak review decide --scope study-timer --plan session-alert --approve-direction`
- **Agent replies:**
  > **Direction approved.** `study-timer/MOZAK.json` and `study-timer/MOZAK.md` are updated.
  >
  > `session-alert` is now **Open (0/2 done)**. Current stop on the roadmap: **`#1 bell-sound`**.
- **Obsidian (Right Pane — `beat3.png`):** Switches to **`Open · 0/2 done`**, the `0/2` progress strip appears in the sidebar, and **`Bell sound`** lights up in **purple (`current`)** on the Mermaid roadmap.

---

### Move 4 (Beat 4): Agent Runs the Audio Test & Saves Proof → Outcome 1/2 Turns Green
- **You reply:**
  > `Run the bell audio test and record the observation.`
- **Agent runs the test + MCP `mozak_observe`:**
  - `⚙ bash: node test/bell-sound.test.js` → `PASS: bell sound played at 00:00 (duration 420 ms)`
  - `⚙ mozak_observe (scope: "study-timer", plan: "session-alert", outcome: "bell-sound" -> pass)`
- **Agent replies:**
  > Recorded passing evidence (`ev-bell-test`: **Bell sound played at 00:00**).
  >
  > Outcome **`1/2 (bell-sound)`** is now **✓ done**, and the roadmap moved on to **`#2 mute-button`**.
- **Obsidian (Right Pane — `beat4.png`):** Updates to **`Open · 1/2 done`**, **`✓ Bell sound`** and the first sidebar segment turn **green (`#5cbf8a`)**, and **`Mute button`** becomes the purple active stop.
