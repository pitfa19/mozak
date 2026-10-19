#!/usr/bin/env node
/**
 * scripts/record-agent-chat-video.mjs
 *
 * Renders the Owner <-> AI Agent terminal-chat walkthrough (`mozak-agent-chat.mp4` +
 * `mozak-agent-chat.gif`) side-by-side with the live Obsidian `mozak-demo-vault` IDE.
 *
 * Shows the conversational `/mozak` flow:
 *   Beat 1 (0–8s):   You ask `/mozak field-kit ...` -> Agent calls `mozak_scopes` & `mozak_context`,
 *                    summarizes state in 2 lines, and asks 1 focused clarifying question.
 *   Beat 2 (8–16s):  You answer -> Agent calls `mozak_propose` and pauses at the direction approval gate
 *                    while Obsidian cross-dissolves to `Awaiting first approval`.
 *   Beat 3 (16–24s): You approve direction -> `mozak review decide --approve-direction` runs
 *                    while Obsidian cross-dissolves to `Open • 0/2 done` and lights up the purple node.
 *   Beat 4 (24–32s): You ask to run the bench test -> Agent runs the check + `mozak_observe`
 *                    while Obsidian cross-dissolves to `Open • 1/2 done` (green).
 */

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const scratchBase = process.env.JCODE_SCRATCH_DIR || tmpdir();
const obsDir = join(scratchBase, "mozak-demo-recording", "obs");
const workDir = join(scratchBase, "mozak-agent-chat-recording");
const framesDir = join(workDir, "frames");

const outMp4Repo = join(repoRoot, "docs", "assets", "mozak-agent-chat.mp4");
const outMp4Downloads = join(homedir(), "Downloads", "mozak-agent-chat.mp4");
const outGifRepo = join(repoRoot, "docs", "assets", "mozak-agent-chat.gif");

rmSync(workDir, { recursive: true, force: true });
mkdirSync(framesDir, { recursive: true });

// Ensure raw Obsidian Retina captures exist (if not, run record-demo-video.mjs first)
if (
  !existsSync(join(obsDir, "beat1a.png")) ||
  !existsSync(join(obsDir, "beat2.png")) ||
  !existsSync(join(obsDir, "beat3.png")) ||
  !existsSync(join(obsDir, "beat4.png")) ||
  process.argv.includes("--recapture")
) {
  console.log("Capturing live Obsidian states via record-demo-video.mjs...");
  const r = spawnSync("node", [join(__dirname, "record-demo-video.mjs")], { stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status || 1);
}

console.log("1. Rendering 384 Retina HD frames (1920x1080 @ 12fps) for Agent Chat + Obsidian...");

const swiftCompositor = `
import AppKit
import CoreGraphics
import Foundation

let obsDir = ${JSON.stringify(obsDir)}
let framesDir = ${JSON.stringify(framesDir)}

func loadCGImage(_ path: String) -> CGImage {
  guard let nsImg = NSImage(contentsOfFile: path),
        let cg = nsImg.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    fatalError("Failed to load image: \\(path)")
  }
  return cg
}

let img1 = loadCGImage(obsDir + "/beat1a.png")
let img2 = loadCGImage(obsDir + "/beat2.png")
let img3 = loadCGImage(obsDir + "/beat3.png")
let img4 = loadCGImage(obsDir + "/beat4.png")

let width = 1920
let height = 1080
let fps = 12.0
let totalSeconds = 32.0
let totalFrames = Int(fps * totalSeconds)

// MOZAK Palette
let bgCol = NSColor(calibratedRed: 0.059, green: 0.067, blue: 0.102, alpha: 1.0)       // #0f111a
let panelBg = NSColor(calibratedRed: 0.090, green: 0.102, blue: 0.149, alpha: 1.0)    // #171a26
let headerBg = NSColor(calibratedRed: 0.118, green: 0.133, blue: 0.192, alpha: 1.0)   // #1e2231
let userCardBg = NSColor(calibratedRed: 0.135, green: 0.145, blue: 0.220, alpha: 1.0) // subtle purple-tinted card
let agentCardBg = NSColor(calibratedRed: 0.110, green: 0.125, blue: 0.180, alpha: 1.0)
let toolPillBg = NSColor(calibratedRed: 0.075, green: 0.086, blue: 0.129, alpha: 1.0)
let borderCol = NSColor(calibratedRed: 0.180, green: 0.204, blue: 0.302, alpha: 1.0)  // #2e344d
let goldCol = NSColor(calibratedRed: 0.847, green: 0.702, blue: 0.353, alpha: 1.0)    // #d8b35a
let purpleCol = NSColor(calibratedRed: 0.604, green: 0.549, blue: 0.910, alpha: 1.0)  // #9a8ce8
let greenCol = NSColor(calibratedRed: 0.361, green: 0.749, blue: 0.541, alpha: 1.0)   // #5cbf8a
let textCol = NSColor(calibratedRed: 0.925, green: 0.937, blue: 0.969, alpha: 1.0)    // #eceff7
let mutedCol = NSColor(calibratedRed: 0.604, green: 0.639, blue: 0.737, alpha: 1.0)   // #9aa3bc

let fontMono = NSFont.monospacedSystemFont(ofSize: 13.0, weight: .medium)
let fontMonoBold = NSFont.monospacedSystemFont(ofSize: 13.5, weight: .bold)
let fontMonoSmall = NSFont.monospacedSystemFont(ofSize: 12.0, weight: .semibold)
let fontBody = NSFont.systemFont(ofSize: 14.0, weight: .regular)
let fontBodyBold = NSFont.systemFont(ofSize: 14.0, weight: .semibold)
let fontTitle = NSFont.systemFont(ofSize: 15.5, weight: .bold)
let fontBadge = NSFont.systemFont(ofSize: 12.5, weight: .bold)
let fontCaption = NSFont.systemFont(ofSize: 14.5, weight: .medium)

func fillRoundRect(_ ctx: CGContext, x: CGFloat, yTop: CGFloat, w: CGFloat, h: CGFloat, r: CGFloat, fill: NSColor, stroke: NSColor? = nil, lineWidth: CGFloat = 1.5) {
  let rect = CGRect(x: x, y: CGFloat(height) - yTop - h, width: w, height: h)
  let path = CGPath(roundedRect: rect, cornerWidth: r, cornerHeight: r, transform: nil)
  ctx.saveGState()
  ctx.addPath(path)
  ctx.setFillColor(fill.cgColor)
  ctx.fillPath()
  if let s = stroke {
    ctx.addPath(path)
    ctx.setStrokeColor(s.cgColor)
    ctx.setLineWidth(lineWidth)
    ctx.strokePath()
  }
  ctx.restoreGState()
}

func drawText(_ str: String, x: CGFloat, yTop: CGFloat, font: NSFont, col: NSColor) {
  let attrs: [NSAttributedString.Key: Any] = [
    .font: font,
    .foregroundColor: col
  ]
  let ns = NSAttributedString(string: str, attributes: attrs)
  let size = ns.size()
  let pt = NSPoint(x: x, y: CGFloat(height) - yTop - size.height)
  ns.draw(at: pt)
}

struct ToolChip {
  let appearAt: Double
  let col: NSColor
  let text: String
}

struct BeatSpec {
  let index: Int
  let badge: String
  let start: Double
  let end: Double
  let headerTitle: String
  let accent: NSColor
  let obsStart: CGImage
  let obsEnd: CGImage
  let transitionAt: Double
  let userLines: [String]
  let userTypeStart: Double
  let userTypeEnd: Double
  let tools: [ToolChip]
  let agentAppearAt: Double
  let agentTitle: String
  let agentLines: [(String, NSColor, Bool)]
  let highlight: (appearAt: Double, x: CGFloat, yTop: CGFloat, w: CGFloat, h: CGFloat, col: NSColor, label: String)
  let caption: String
}

let beats: [BeatSpec] = [
  BeatSpec(
    index: 1,
    badge: "BEAT 1 / 4",
    start: 0.0,
    end: 8.0,
    headerTitle: "You talk in the terminal → Agent reads MOZAK state & asks 1 focused question",
    accent: goldCol,
    obsStart: img1,
    obsEnd: img1,
    transitionAt: 99.0,
    userLines: [
      "/mozak field-kit — plan the 30-day deep-sleep power budget",
      "(< 45 uA sleep current, -10 C cold soak)."
    ],
    userTypeStart: 0.2,
    userTypeEnd: 1.9,
    tools: [
      ToolChip(appearAt: 2.2, col: goldCol, text: "⚙ MCP: mozak_scopes  →  3 scopes (atlas-engine, field-kit, routing-notes)"),
      ToolChip(appearAt: 2.7, col: goldCol, text: "⚙ MCP: mozak_context (field-kit)  →  1 completed, 0 open, 0 awaiting")
    ],
    agentAppearAt: 3.3,
    agentTitle: "Agent • /mozak (Overview & Focused Clarification)",
    agentLines: [
      ("Field Sensor Kit (field-kit) has 1 completed plan (telemetry-schema) and 0 open.", textCol, false),
      ("", textCol, false),
      ("Before I draft battery-budget, one focused question:", mutedCol, false),
      ("Q1: Should both outcomes (sleep-draw < 45 uA and cold-soak at -10 C)", goldCol, true),
      ("    be objective test checks, or owner sign-off?", goldCol, true)
    ],
    highlight: (2.4, 1536, 150, 345, 315, goldCol, "3 scopes in shared inventory"),
    caption: "The /mozak skill reads MOZAK.json via MCP, summarizes the project in 2 lines, and asks 1 focused question."
  ),
  BeatSpec(
    index: 2,
    badge: "BEAT 2 / 4",
    start: 8.0,
    end: 16.0,
    headerTitle: "Agent proposes the plan → pauses at the owner direction-approval gate",
    accent: goldCol,
    obsStart: img1,
    obsEnd: img2,
    transitionAt: 10.5,
    userLines: [
      "Both objective — bench ammeter trace for sleep-draw,",
      "chamber log for cold-soak."
    ],
    userTypeStart: 8.2,
    userTypeEnd: 9.7,
    tools: [
      ToolChip(appearAt: 10.0, col: goldCol, text: "⚙ MCP: mozak_propose (field-kit / battery-budget)  →  awaiting approval")
    ],
    agentAppearAt: 10.8,
    agentTitle: "Agent • /mozak (Draft Proposed — Waiting at Owner Gate)",
    agentLines: [
      ("Proposed battery-budget (30-day deep-sleep power budget) with 2 outcomes:", textCol, false),
      ("  1. sleep-draw — Deep-sleep current stays under 45 uA with RTC alarm", mutedCol, false),
      ("  2. cold-soak  — 30-day projected capacity holds at -10 C", mutedCol, false),
      ("", textCol, false),
      ("⏸ Paused for direction approval.", goldCol, true),
      ("Check field-kit/MOZAK.md in Obsidian and reply to approve direction.", textCol, false)
    ],
    highlight: (10.9, 1536, 302, 345, 44, goldCol, "Awaiting owner approval"),
    caption: "Agents cannot self-approve: mozak_propose writes a pending draft, and Obsidian immediately shows 'awaiting approval'."
  ),
  BeatSpec(
    index: 3,
    badge: "BEAT 3 / 4",
    start: 16.0,
    end: 24.0,
    headerTitle: "Owner approves direction in chat → Obsidian roadmap & status table light up",
    accent: purpleCol,
    obsStart: img2,
    obsEnd: img3,
    transitionAt: 18.4,
    userLines: [
      "Looks right — approve direction for battery-budget."
    ],
    userTypeStart: 16.2,
    userTypeEnd: 17.5,
    tools: [
      ToolChip(appearAt: 17.9, col: purpleCol, text: "✓ mozak review decide --scope field-kit --plan battery-budget --approve-direction")
    ],
    agentAppearAt: 18.7,
    agentTitle: "Agent • /mozak (Direction Approved → Open 0/2)",
    agentLines: [
      ("Direction approved! field-kit/MOZAK.json and field-kit/MOZAK.md updated.", textCol, false),
      ("", textCol, false),
      ("• Plan status: Open (0/2 outcomes done)", purpleCol, true),
      ("• Active roadmap stop: #1 sleep-draw (< 45 uA over 1 hour)", purpleCol, true),
      ("• Obsidian roadmap & sidebar progress strip updated live.", mutedCol, false)
    ],
    highlight: (18.8, 836, 750, 340, 96, purpleCol, "Current stop lights up purple"),
    caption: "Only the owner's explicit decision unlocks the plan. Obsidian redraws the 0/2 strip and highlights the active Mermaid node."
  ),
  BeatSpec(
    index: 4,
    badge: "BEAT 4 / 4",
    start: 24.0,
    end: 32.0,
    headerTitle: "Agent runs verification & records evidence → Outcome 1/2 turns green",
    accent: greenCol,
    obsStart: img3,
    obsEnd: img4,
    transitionAt: 26.5,
    userLines: [
      "Run the 1-hour bench ammeter trace and record the observation."
    ],
    userTypeStart: 24.2,
    userTypeEnd: 25.5,
    tools: [
      ToolChip(appearAt: 25.8, col: greenCol, text: "⚙ bash: node firmware/bench-ammeter.mjs  →  PASS (avg 38.4 uA < 45 uA)"),
      ToolChip(appearAt: 26.3, col: greenCol, text: "⚙ MCP: mozak_observe (battery-budget / sleep-draw  →  pass)")
    ],
    agentAppearAt: 26.9,
    agentTitle: "Agent • /mozak (Evidence Recorded → Outcome 1/2 Done)",
    agentLines: [
      ("Recorded passing evidence (ev-sleep-draw-bench: 38.4 uA avg < 45 uA).", textCol, false),
      ("", textCol, false),
      ("✓ Outcome 1/2 (sleep-draw): done — green in sidebar & Mermaid roadmap", greenCol, true),
      ("→ Next roadmap stop: #2 cold-soak (-10 C chamber log)", purpleCol, false),
      ("Saved in git & Obsidian so any future agent session resumes here.", mutedCol, false)
    ],
    highlight: (27.0, 836, 750, 340, 96, greenCol, "Outcome 1/2 verified & green"),
    caption: "Generative UI from plain files: you talk in the terminal, and Obsidian renders the live project IDE."
  )
]

for f in 0..<totalFrames {
  autoreleasepool {
    let t = Double(f) / fps
    let beat = beats.first(where: { t >= $0.start && t < $0.end }) ?? beats.last!

    let colorSpace = CGColorSpaceCreateDeviceRGB()
    guard let ctx = CGContext(
      data: nil,
      width: width,
      height: height,
      bitsPerComponent: 8,
      bytesPerRow: width * 4,
      space: colorSpace,
      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ) else { fatalError("CGContext failed") }

    let nsCtx = NSGraphicsContext(cgContext: ctx, flipped: false)
    NSGraphicsContext.current = nsCtx

    // 1. Background
    ctx.setFillColor(bgCol.cgColor)
    ctx.fill(CGRect(x: 0, y: 0, width: width, height: height))

    // 2. Top Header Bar
    fillRoundRect(ctx, x: 24, yTop: 16, w: 1872, h: 46, r: 10, fill: panelBg, stroke: borderCol)
    fillRoundRect(ctx, x: 38, yTop: 26, w: 104, h: 26, r: 6, fill: beat.accent.withAlphaComponent(0.18), stroke: beat.accent)
    drawText(beat.badge, x: 52, yTop: 30, font: fontBadge, col: beat.accent)
    drawText(beat.headerTitle, x: 158, yTop: 28, font: fontTitle, col: textCol)
    drawText("MOZAK v0.3.0 • Agent Chat + Obsidian IDE", x: 1545, yTop: 30, font: fontBadge, col: mutedCol)

    // 3. Left Pane: Agent Chat TUI (x: 24, yTop: 76, w: 720, h: 928)
    fillRoundRect(ctx, x: 24, yTop: 76, w: 720, h: 928, r: 12, fill: panelBg, stroke: borderCol)
    fillRoundRect(ctx, x: 25, yTop: 77, w: 718, h: 38, r: 11, fill: headerBg)
    fillRoundRect(ctx, x: 42, yTop: 90, w: 12, h: 12, r: 6, fill: NSColor(calibratedRed: 0.95, green: 0.35, blue: 0.35, alpha: 1))
    fillRoundRect(ctx, x: 62, yTop: 90, w: 12, h: 12, r: 6, fill: NSColor(calibratedRed: 0.95, green: 0.75, blue: 0.25, alpha: 1))
    fillRoundRect(ctx, x: 82, yTop: 90, w: 12, h: 12, r: 6, fill: NSColor(calibratedRed: 0.35, green: 0.80, blue: 0.45, alpha: 1))
    drawText("agent-chat — /mozak (~/mozak-demo-vault)", x: 230, yTop: 88, font: fontMonoSmall, col: mutedCol)

    // 4-step workflow bar inside the Agent TUI
    let stepLabels = ["1. Overview", "2. Propose", "3. Approve", "4. Observe"]
    for i in 0..<4 {
      let sx = CGFloat(44 + i * 172)
      let isCurrent = (i + 1) == beat.index
      let isDone = (i + 1) < beat.index
      let pillCol = isCurrent ? beat.accent : (isDone ? greenCol : borderCol)
      let fillAlpha: CGFloat = isCurrent ? 0.20 : (isDone ? 0.12 : 0.04)
      fillRoundRect(ctx, x: sx, yTop: 128, w: 160, h: 28, r: 6, fill: pillCol.withAlphaComponent(fillAlpha), stroke: pillCol, lineWidth: isCurrent ? 1.8 : 1.0)
      drawText(stepLabels[i], x: sx + 32, yTop: 134, font: fontBadge, col: isCurrent ? beat.accent : (isDone ? greenCol : mutedCol))
    }

    // Previous completed beat summary strip (context continuity)
    var curY: CGFloat = 174
    if beat.index > 1 {
      fillRoundRect(ctx, x: 44, yTop: curY, w: 680, h: 36, r: 8, fill: toolPillBg, stroke: borderCol, lineWidth: 1.0)
      let prevSummary: String
      if beat.index == 2 {
        prevSummary = "✓ Beat 1: /mozak read field-kit (1 completed, 0 open) and asked Q1 on outcome acceptance"
      } else if beat.index == 3 {
        prevSummary = "✓ Beat 2: mozak_propose created battery-budget (awaiting owner direction approval)"
      } else {
        prevSummary = "✓ Beat 3: Owner approved direction → battery-budget is Open (0/2 outcomes done)"
      }
      drawText(prevSummary, x: 58, yTop: curY + 10, font: fontMonoSmall, col: mutedCol)
      curY += 52
    }

    // User Message Card ("You")
    let userCardH: CGFloat = CGFloat(54 + beat.userLines.count * 24)
    fillRoundRect(ctx, x: 44, yTop: curY, w: 680, h: userCardH, r: 10, fill: userCardBg, stroke: purpleCol.withAlphaComponent(0.75), lineWidth: 1.5)
    fillRoundRect(ctx, x: 58, yTop: curY + 12, w: 54, h: 22, r: 5, fill: purpleCol.withAlphaComponent(0.25), stroke: purpleCol, lineWidth: 1.0)
    drawText("You", x: 72, yTop: curY + 15, font: fontBadge, col: purpleCol)
    drawText("terminal prompt", x: 124, yTop: curY + 15, font: fontMonoSmall, col: mutedCol)

    let fullPrompt = beat.userLines.joined(separator: "\\n")
    let typeFrac = max(0.0, min(1.0, (t - beat.userTypeStart) / max(0.01, beat.userTypeEnd - beat.userTypeStart)))
    let charLimit = Int(Double(fullPrompt.count) * typeFrac)
    var remaining = charLimit
    for (idx, line) in beat.userLines.enumerated() {
      let ly = curY + 44 + CGFloat(idx * 24)
      if remaining <= 0 { break }
      let take = min(line.count, remaining)
      let sub = String(line.prefix(take))
      let cursor = (take < line.count || (idx == beat.userLines.count - 1 && typeFrac < 1.0)) ? "▋" : ""
      drawText("> " + sub + cursor, x: 60, yTop: ly, font: fontMonoBold, col: textCol)
      remaining -= (line.count + 1)
    }
    curY += userCardH + 18

    // MCP / CLI Tool Call Chips
    for tool in beat.tools {
      if t >= tool.appearAt {
        fillRoundRect(ctx, x: 44, yTop: curY, w: 680, h: 38, r: 8, fill: toolPillBg, stroke: tool.col.withAlphaComponent(0.85), lineWidth: 1.5)
        drawText(tool.text, x: 60, yTop: curY + 10, font: fontMonoSmall, col: tool.col)
        curY += 48
      }
    }

    // Agent Reply Card
    if t >= beat.agentAppearAt {
      curY += 6
      let agentCardH: CGFloat = CGFloat(64 + beat.agentLines.count * 26)
      fillRoundRect(ctx, x: 44, yTop: curY, w: 680, h: agentCardH, r: 10, fill: agentCardBg, stroke: beat.accent.withAlphaComponent(0.85), lineWidth: 1.6)
      fillRoundRect(ctx, x: 58, yTop: curY + 14, w: 390, h: 24, r: 5, fill: beat.accent.withAlphaComponent(0.18), stroke: beat.accent, lineWidth: 1.0)
      drawText(beat.agentTitle, x: 70, yTop: curY + 18, font: fontBadge, col: beat.accent)

      var ay = curY + 50
      for (lineText, lineCol, isBold) in beat.agentLines {
        if !lineText.isEmpty {
          drawText(lineText, x: 60, yTop: ay, font: isBold ? fontBodyBold : fontBody, col: lineCol)
        }
        ay += 25
      }
    }

    // Footer status inside Agent TUI
    fillRoundRect(ctx, x: 44, yTop: 948, w: 680, h: 38, r: 8, fill: toolPillBg, stroke: borderCol, lineWidth: 1.0)
    drawText("MCP: mozak-mcp (connected)  •  Skill: /mozak  •  Vault: ~/mozak-demo-vault", x: 58, yTop: 959, font: fontMonoSmall, col: mutedCol)

    // 4. Right Pane: Live Obsidian Window with smooth cross-dissolve (x: 760, yTop: 76, w: 1136, h: 928)
    fillRoundRect(ctx, x: 760, yTop: 76, w: 1136, h: 928, r: 12, fill: panelBg, stroke: borderCol)
    let obsRect = CGRect(x: 764, y: CGFloat(height) - 76 - 928 + 4, width: 1128, height: 920)
    ctx.saveGState()
    let clipPath = CGPath(roundedRect: obsRect, cornerWidth: 10, cornerHeight: 10, transform: nil)
    ctx.addPath(clipPath)
    ctx.clip()

    let imgAspect = CGFloat(beat.obsStart.width) / CGFloat(beat.obsStart.height)
    let boxAspect = obsRect.width / obsRect.height
    var drawW = obsRect.width
    var drawH = obsRect.height
    if imgAspect > boxAspect {
      drawH = drawW / imgAspect
    } else {
      drawW = drawH * imgAspect
    }
    let drawX = obsRect.origin.x + (obsRect.width - drawW) / 2.0
    let drawY = obsRect.origin.y + (obsRect.height - drawH) / 2.0
    let imgRect = CGRect(x: drawX, y: drawY, width: drawW, height: drawH)

    if t < beat.transitionAt {
      ctx.draw(beat.obsStart, in: imgRect)
    } else {
      let blend = min(1.0, max(0.0, (t - beat.transitionAt) / 0.40))
      if blend < 1.0 {
        ctx.draw(beat.obsStart, in: imgRect)
        ctx.saveGState()
        ctx.setAlpha( CGFloat(blend) )
        ctx.draw(beat.obsEnd, in: imgRect)
        ctx.restoreGState()
      } else {
        ctx.draw(beat.obsEnd, in: imgRect)
      }
    }
    ctx.restoreGState()

    // Highlight callout on the Obsidian window
    let hb = beat.highlight
    if t >= hb.appearAt {
      fillRoundRect(ctx, x: hb.x, yTop: hb.yTop, w: hb.w, h: hb.h, r: 8, fill: hb.col.withAlphaComponent(0.08), stroke: hb.col, lineWidth: 2.5)
      let tagW = CGFloat(hb.label.count) * 8.2 + 24
      let tagX = (hb.x < 1200) ? (hb.x + hb.w + 12) : hb.x
      let tagY = (hb.x < 1200) ? (hb.yTop + (hb.h - 24) / 2.0) : (hb.yTop - 28)
      fillRoundRect(ctx, x: tagX, yTop: tagY, w: tagW, h: 24, r: 6, fill: panelBg, stroke: hb.col, lineWidth: 1.5)
      drawText(hb.label, x: tagX + 10, yTop: tagY + 4, font: fontMonoSmall, col: hb.col)
    }

    // 5. Bottom Caption Bar
    fillRoundRect(ctx, x: 24, yTop: 1018, w: 1872, h: 46, r: 10, fill: panelBg, stroke: borderCol)
    fillRoundRect(ctx, x: 40, yTop: 1035, w: 12, h: 12, r: 6, fill: beat.accent)
    drawText(beat.caption, x: 64, yTop: 1031, font: fontCaption, col: textCol)

    // Save frame PNG
    guard let outCg = ctx.makeImage() else { fatalError("makeImage failed") }
    let rep = NSBitmapImageRep(cgImage: outCg)
    guard let pngData = rep.representation(using: .png, properties: [:]) else { fatalError("PNG encode failed") }
    let framePath = String(format: "%@/frame-%04d.png", framesDir, f)
    try! pngData.write(to: URL(fileURLWithPath: framePath))
  }
}
print("Rendered \\(totalFrames) frames.")
`;

const swiftFile = join(workDir, "compositor.swift");
writeFileSync(swiftFile, swiftCompositor);
const compRes = spawnSync("swift", [swiftFile], { stdio: "inherit" });
if (compRes.status !== 0) {
  throw new Error("Swift compositor failed");
}

console.log("2. Encoding MP4 (H.264 1920x1080) and README GIF (1280x720)...");
const mp4Res = spawnSync(
  "ffmpeg",
  [
    "-y",
    "-framerate",
    "12",
    "-i",
    join(framesDir, "frame-%04d.png"),
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-crf",
    "18",
    "-movflags",
    "+faststart",
    outMp4Repo,
  ],
  { stdio: "inherit" },
);
if (mp4Res.status !== 0) throw new Error("ffmpeg MP4 encode failed");

copyFileSync(outMp4Repo, outMp4Downloads);

const gifRes = spawnSync(
  "ffmpeg",
  [
    "-y",
    "-framerate",
    "12",
    "-i",
    join(framesDir, "frame-%04d.png"),
    "-vf",
    "fps=8,scale=1280:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5",
    outGifRepo,
  ],
  { stdio: "inherit" },
);
if (gifRes.status !== 0) throw new Error("ffmpeg GIF encode failed");

console.log("Done! Saved:");
console.log(`  - ${outMp4Repo}`);
console.log(`  - ${outMp4Downloads}`);
console.log(`  - ${outGifRepo}`);
