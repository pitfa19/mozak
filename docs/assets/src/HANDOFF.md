# mozak v0.3.0 — Video Production Handoff & Brand Kit

This bundle contains all raw Retina captures, transcripts, brand/icon assets, composited keyframes, and reference videos needed to produce a polished showcase video for **mozak (`v0.3.0`)**.

---

## 1. Core Hook & Everyday Storyline (Zero Jargon)

> **"Use Obsidian as your IDE."**
>
> You work in ideas and plans, not code. Agents build in parallel, and you orchestrate them from your notes.
>
> **mozak** gives every project one shared plan (`MOZAK.json` + `MOZAK.md`) inside the folder or git repo. It does two jobs: every agent understands your work by reading the same plan, and you track all the parallel work in **Obsidian** (sidebar progress across projects + a live Mermaid roadmap in each note). Nothing becomes the plan until you say yes.
>
> Use this exact headline on the opening title card. The paradigm line can be the subtitle.

To make the video immediately intuitive to any viewer in < 3 seconds, the demo uses **three everyday projects** instead of domain jargon:

1. **`recipe-app` — Recipe Book App** (`[project]`, 2 plans: *Save favorite recipes offline* `Completed 1/1`, *Weekly grocery list* `Open 1/3` with 1 green done segment, 1 gold awaiting-owner-review segment, and 1 purple next segment)
2. **`trip-notes` — Summer Road Trip Notes** (`[topic]`, 1 plan: *Compare coastal vs mountain route* `Open 1/2`)
3. **`study-timer` — Pomodoro Study Timer** (`[project]`, 1 completed plan *25-minute focus countdown* `1/1`, plus the live 4-beat demo plan **`session-alert` — *Play a bell sound when the timer ends***)

---

## 2. The 4-Beat Visual Story (`32s` total, `8s` per beat)

> **Light mode.** All Obsidian captures, keyframes and both videos are light mode (Obsidian's light theme, light video backgrounds). On light backgrounds the brand accents are darkened for contrast: gold `#b0841c`, purple `#6e5bd6`, green `#1e8a52`, text `#1a1e28`. The dark brand assets in `brand/` (icon, lockup, generated wordmark) are unchanged. Use them on a dark title card, or ask for light variants.
>
> **Pitch line: decided.** Headline "Use Obsidian as your IDE." (see section 1). The current `brand/mozak-lockup-dark` still carries the old tagline. Use the generated wordmark or the plain icon on the title card instead.

Every beat shows **Left = Terminal Agent Chat (`/mozak`)** and **Right = Live Obsidian IDE (`study-timer/MOZAK.md` + `mozak` sidebar)**:

| Beat | Time | Left Pane (Agent Chat / CLI) | Right Pane (Obsidian Live Capture) | Key Visual Accent |
|---|---|---|---|---|
| **Beat 1: Overview & Clarify** | `0s – 8s` | User types: `/mozak study-timer — play a bell sound when the 25-minute countdown ends.`<br>Agent calls `mozak_scopes` + `mozak_context`, sees `25-minute focus countdown` (`1/1` done), and asks **1 focused question**: *"Should we also include a Mute button for quiet study spaces?"* | `obsidian-captures/beat1a.png` (`2240×1672`):<br>• Main note: `study-timer/MOZAK.md` (*Pomodoro Study Timer*) with `25-minute focus countdown` (`1/1`)<br>• Right sidebar: `All 4 · Open 2 · Done 2` across *Recipe Book App*, *Summer Road Trip Notes*, and *Pomodoro Study Timer* | Neutral slate + existing green (`1/1`) & 3-color (`1/3`) strips in sidebar |
| **Beat 2: Propose & Owner Gate** | `8s – 16s` | User replies: `"Yes — two outcomes: play the bell at 00:00, and stay silent when Mute is on."`<br>Agent calls `mozak_plan_propose` (`session-alert`, 2 outcomes: `bell-sound` → `mute-button`) and **stops at the owner gate**, asking for direction approval (`reviewDigest: b9e3bf55fc51...`). | `obsidian-captures/beat2.png` (`2240×1672`):<br>• Sidebar jumps to `All 5 · Open 3` and shows **gold `awaiting approval`** badge under *Pomodoro Study Timer*<br>• `study-timer/MOZAK.md` renders the new section `Play a bell sound when the timer ends · session-alert`, **Awaiting first approval · 0/2 done**, and the live **Mermaid roadmap** (`Bell sound` → `Mute button`) | **Gold (`#d8b35a`)** — proposed & waiting at the human gate |
| **Beat 3: Approve Direction** | `16s – 24s` | User replies: `"Approved direction."`<br>Agent calls `mozak_review_decide` (`decision: "approve-direction"`, bound to the exact `reviewDigest` + user quote). Direction is locked in; coding is still a separate gate. | `obsidian-captures/beat3.png` (`2240×1672`):<br>• Sidebar badge flips from `awaiting approval` to **`▱▱ 0/2`** (first segment outlined in purple)<br>• Note status flips to **`Open · 0/2 done`**<br>• Mermaid roadmap node **`📍 Bell sound`** lights up in **purple (`#8b5cf6`)** as the active next outcome (`⚪ todo · 📍 next`) | **Purple (`#9a8ce8` / `#8b5cf6`)** — approved direction, current outcome |
| **Beat 4: Verified Evidence** | `24s – 32s` | User says: `"Audio test passed — record that the bell plays at 00:00."`<br>Agent runs `npm test -- bell-audio.test.ts` (`PASS`) and calls `mozak_observe` (`bell-sound`, `kind: "verified"`). Since `acceptedBy` is `objective`, outcome 1/2 auto-completes! | `obsidian-captures/beat4.png` (`2240×1672`):<br>• Sidebar progress strip advances to **`▰▱ 1/2`** (segment 1 solid green, segment 2 purple outline)<br>• Note header reads **`Open · 1/2 done`**<br>• Mermaid roadmap node **`✅ Bell sound`** turns **solid green (`#22a55b`)** and **`📍 Mute button`** advances to **purple (`#8b5cf6`)** | **Green (`#5cbf8a` / `#22a55b`)** — verified evidence recorded |

---

## 3. Official mozak Brand & Icon Kit (`brand/`)

All official logos, icons, and design tokens live in `brand/` (and in the repo at `docs/assets/brand/`):

| File | Dimensions | Usage in Video / Motion Graphics |
|---|---|---|
| `brand/mozak-icon.svg` | Vector (`1024×1024`) | Primary app icon: dark rounded squircle (`#14161b`) with dual brain hemispheres (*"mozak" = brain in Croatian*), the **3-node directed "M" circuit** (**Gold `#d8b35a` Propose** → **Purple `#9a8ce8` Approve** → **Green `#5cbf8a` Verified**), and the **3-segment outcome progress strip** at the base. Every SVG group has semantic `id`s (`#hemisphere-left`, `#hemisphere-right`, `#m-circuit-path`, `#node-propose-gold`, `#node-approve-purple`, `#node-done-green`, `#outcome-strip`) for path-trim / glow animation in Remotion or After Effects. |
| `brand/mozak-icon-1024.png` | `1024×1024` RGBA | Rasterized master icon for video intros/outros and thumbnails. |
| `brand/mozak-icon-512.png` | `512×512` RGBA | Standard 2x badge icon. |
| `brand/mozak-mark-transparent.svg` / `.png` | `512×512` RGBA | Transparent-background brain + circuit mark (no squircle) for corner watermarks, lower-thirds, and callout badges. |
| `brand/mozak-lockup-dark.svg` / `.png` | `1600×480` RGBA | Horizontal hero banner with icon + `mozak v0.3.0` wordmark + tagline (*"You own the plan. The agent does the work."*) + 3 workflow pills. Ready for intro/outro title cards. |
| `brand/brand-tokens.json` | JSON | Machine-readable color palette (`#14161b` obsidian dark, `#d8b35a` gold, `#9a8ce8` purple, `#5cbf8a` green), typography stack, and semantic state meanings. |
| `brand/fonts/` | `.ttf` + `.woff2` | Bundled 100% free & open-source (SIL OFL) fonts used across the captures and videos:<br>• **Space Grotesk** (`Medium`, `Bold`) — Display headings & `mozak` wordmark<br>• **Plus Jakarta Sans** (`Regular`, `Medium`, `SemiBold`, `Bold`) — UI, captions & Obsidian note body<br>• **JetBrains Mono** (`Regular`, `Medium`, `SemiBold`, `Bold`) — Terminal chat, CLI commands & MCP tool chips<br>• **Outfit** (`SemiBold`, `Bold`) — Rounded geometric display alternative |
| `brand/BRAND.md` | Markdown | Full visual identity guide and animation notes for the SVG layers. |
| `brand/hero.svg` / `brand/hero-pixel.gif` | Vector / Pixel GIF | README pixel-art brain mark for retro/terminal accent overlays. |

---

## 4. Directory Inventory in This Bundle

- **`brand/`** — Official mozak icon, transparent mark, horizontal lockup, `brand-tokens.json`, `BRAND.md`, `hero.svg`, and `hero-pixel.gif`.
- **`obsidian-captures/`** — Raw `2240×1672` Retina macOS window captures of Obsidian (`beat1a.png`, `beat2.png`, `beat3.png`, `beat4.png`) showing the live `study-timer / session-alert` transitions, Mermaid roadmap, and `mozak` sidebar.
- **`transcripts/`**
  - `AGENT-CHAT-SCRIPT.md` — Human-readable 4-beat storyboard and dialogue.
  - `agent-chat-flow.json` — Structured JSON data driving the 4-beat Agent Chat animation (prompts, MCP tool calls, responses, captions, and frame timings).
  - `cli-timeline.json` — Exact CLI commands and real stdout captured from `mozak` (`v0.3.0`) against the demo vault.
  - `under-the-hood.svg` — Self-contained looping SVG architecture animation (`920×340`) showing `mozak-inventory.json` → `Owner Gate` → `study-timer/MOZAK.json + MOZAK.md` → `Obsidian Redraws`.
- **`composited-keyframes/`**
  - `agent-chat-beat1.png` .. `agent-chat-beat4.png` (`1920×1080` HD keyframes of Agent Chat + Obsidian)
  - `cli-demo-beat1.png` .. `cli-demo-beat4.png` (`1920×1080` HD keyframes of CLI + Obsidian)
- **`videos/`**
  - `mozak-agent-chat.mp4` (`1920×1080` H.264 MP4, 32s @ 12fps) & `mozak-agent-chat.gif` (`1280×720`)
  - `mozak-demo.mp4` (`1920×1080` H.264 MP4, 32s @ 12fps) & `mozak-demo.gif` (`1280×720`)
- **`demo-vault-template/`** — Clean 3-scope demo vault (`mozak-inventory.json`, `recipe-app/`, `trip-notes/`, `study-timer/`, `demo-step.mjs`, `RECORDING-SCRIPT.md`).
- **`scripts/`** — Reproducible generator scripts (`setup-demo-vault.mjs`, `record-demo-video.mjs`, `record-agent-chat-video.mjs`, `render-under-the-hood.mjs`, `generate-brand-kit.mjs`, `package-demo-kit.mjs`).

---

## 5. Privacy & Cleanliness Guarantee

All captures, JSON payloads, SVG diagrams, and video frames have been verified via Apple Vision OCR:
- Zero personal names, usernames, hostnames, or private vault paths (`~/mozak-demo-vault` is used everywhere).
- Zero domain jargon (`Pomodoro Study Timer`, `Recipe Book App`, and `Summer Road Trip Notes` are used throughout).
