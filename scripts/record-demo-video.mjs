#!/usr/bin/env node
// Records the live MOZAK demo video (Terminal + Obsidian side-by-side) against
// ~/Downloads/mozak-demo-vault with zero personal data.
//
// How it works:
// 1. Resets ~/Downloads/mozak-demo-vault and launches Obsidian on that vault window.
// 2. Runs the 4 live beats (scopes -> propose -> approve -> observe) on disk while
//    capturing the real Obsidian window via `screencapture -l <windowID> -o -x` as
//    Obsidian's file watcher and Mermaid renderer redraw MOZAK.md and the Scopes sidebar.
// 3. Composites the live Terminal typing + stdout on the left and the live Obsidian
//    window capture on the right onto a 1920x1080 canvas at 12 fps, then encodes
//    docs/assets/mozak-demo.mp4, ~/Downloads/mozak-demo.mp4, and docs/assets/mozak-demo.gif.

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const demoVault = join(homedir(), "Downloads", "mozak-demo-vault");
const workDir = join(tmpdir(), "mozak-demo-recording");

if (existsSync(workDir)) rmSync(workDir, { recursive: true, force: true });
mkdirSync(workDir, { recursive: true });
mkdirSync(join(workDir, "obs"), { recursive: true });
mkdirSync(join(workDir, "frames"), { recursive: true });

function sleep(ms) {
  spawnSync("sleep", [String(ms / 1000)]);
}

function getDemoWindowId() {
  const r = spawnSync(
    "swift",
    [
      "-e",
      `
import CoreGraphics
if let list = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]] {
  for w in list {
    let owner = w[kCGWindowOwnerName as String] as? String ?? ""
    let name = w[kCGWindowName as String] as? String ?? ""
    let id = w[kCGWindowNumber as String] as? Int ?? 0
    if owner == "Obsidian" && name.contains("mozak-demo-vault") {
      print(id)
      break
    }
  }
}
`,
    ],
    { encoding: "utf8" },
  );
  return (r.stdout || "").trim();
}

function captureObsidian(wid, outPath) {
  const r = spawnSync("screencapture", ["-l", String(wid), "-o", "-x", outPath]);
  if (r.status !== 0) {
    throw new Error(`screencapture failed for window ${wid}`);
  }
}

function stripAnsi(s) {
  return s
    .replace(/\x1b\[[0-9;]*m/g, "")
    .replaceAll(demoVault, "~/mozak-demo-vault")
    .replaceAll(homedir(), "~");
}

function runDemoStep(step) {
  const r = spawnSync("node", [join(demoVault, "demo-step.mjs"), step], {
    cwd: demoVault,
    encoding: "utf8",
  });
  return stripAnsi(r.stdout || "");
}

console.log("1. Resetting clean demo vault and launching Obsidian...");
spawnSync("killall", ["Obsidian"]);
sleep(1000);
spawnSync("node", [join(repoRoot, "scripts", "setup-demo-vault.mjs")], { stdio: "inherit" });

const obsWinCfg = join(homedir(), "Library", "Application Support", "obsidian", "cee2fe55be9fff82.json");
if (existsSync(dirname(obsWinCfg))) {
  writeFileSync(
    obsWinCfg,
    JSON.stringify({ isMaximized: false, devTools: false, zoom: 0, x: 350, y: 33, width: 1120, height: 880 }),
  );
}

spawnSync("open", ["obsidian://open?vault=mozak-demo-vault"]);
sleep(4500); // wait for Obsidian to finish loading

const wid = getDemoWindowId();
if (!wid) throw new Error("Could not find Obsidian window for mozak-demo-vault");
console.log(`   Found mozak-demo-vault Obsidian window ID: ${wid}`);

// Capture Beat 1: field-kit/MOZAK.md open with all 3 scopes expanded in sidebar
const obsBeat1a = join(workDir, "obs", "beat1a.png");
captureObsidian(wid, obsBeat1a);
const obsBeat1b = obsBeat1a;
console.log("   Captured Beat 1 (field-kit/MOZAK.md + 3 scopes in sidebar, zero toast)");

// Run Beat 1 CLI (`mozak scopes`)
const outScopes = runDemoStep("scopes");

// Beat 2: Run live `propose` and capture Obsidian window as it auto-refreshes
const outPropose = runDemoStep("propose");
sleep(1800);
const obsBeat2 = join(workDir, "obs", "beat2.png");
captureObsidian(wid, obsBeat2);
console.log("   Captured Beat 2 (after propose -> awaiting approval + Mermaid roadmap)");

// Beat 3: Run live `approve` and capture Obsidian window as it auto-refreshes
const outApprove = runDemoStep("approve");
sleep(1800);
const obsBeat3 = join(workDir, "obs", "beat3.png");
captureObsidian(wid, obsBeat3);
console.log("   Captured Beat 3 (after approve-direction -> Open 0/2 + purple current outcome)");

// Beat 4: Run live `observe` and capture Obsidian window as it auto-refreshes
const outObserve = runDemoStep("observe");
sleep(1800);
const obsBeat4 = join(workDir, "obs", "beat4.png");
captureObsidian(wid, obsBeat4);
console.log("   Captured Beat 4 (after observe -> Open 1/2 green segment + Mermaid done node)");

// Prepare timeline specification for Swift CoreGraphics frame compositor (12 fps * 32s = 384 frames)
const FPS = 12;
const specPath = join(workDir, "timeline.json");
writeFileSync(
  specPath,
  JSON.stringify(
    {
      fps: FPS,
      framesDir: join(workDir, "frames"),
      obsImages: {
        beat1a: obsBeat1a,
        beat1b: obsBeat1b,
        beat2: obsBeat2,
        beat3: obsBeat3,
        beat4: obsBeat4,
      },
      outputs: {
        scopes: outScopes.trim().split("\n").slice(1).join("\n"),
        propose: outPropose.trim().split("\n").slice(1).join("\n"),
        approve: outApprove.trim().split("\n").slice(1).join("\n"),
        observe: outObserve.trim().split("\n").slice(1).join("\n"),
      },
    },
    null,
    2,
  ),
);

const swiftCompositor = join(workDir, "composite.swift");
writeFileSync(
  swiftCompositor,
  `
import AppKit
import CoreGraphics
import Foundation

struct TimelineSpec: Decodable {
  let fps: Int
  let framesDir: String
  let obsImages: [String: String]
  let outputs: [String: String]
}

let specData = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
let spec = try JSONDecoder().decode(TimelineSpec.self, from: specData)

func loadCG(_ path: String) -> CGImage {
  guard let ns = NSImage(contentsOfFile: path),
        let cg = ns.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    fatalError("Failed to load image: \\(path)")
  }
  return cg
}

let img1a = loadCG(spec.obsImages["beat1a"]!)
let img1b = loadCG(spec.obsImages["beat1b"]!)
let img2  = loadCG(spec.obsImages["beat2"]!)
let img3  = loadCG(spec.obsImages["beat3"]!)
let img4  = loadCG(spec.obsImages["beat4"]!)

let W = 1920
let H = 1080
let totalSeconds = 32.0
let totalFrames = Int(totalSeconds * Double(spec.fps))

func color(_ r: CGFloat, _ g: CGFloat, _ b: CGFloat, _ a: CGFloat = 1.0) -> NSColor {
  return NSColor(srgbRed: r / 255.0, green: g / 255.0, blue: b / 255.0, alpha: a)
}

let bgDark      = color(11, 13, 19)
let panelBg     = color(18, 21, 30)
let termBg      = color(15, 17, 23)
let termHeader  = color(26, 30, 40)
let borderCol   = color(48, 54, 72)
let goldCol     = color(216, 179, 90)
let purpleCol   = color(154, 140, 232)
let greenCol    = color(92, 191, 138)
let textMain    = color(232, 236, 244)
let textMuted   = color(148, 156, 176)
let promptCol   = color(92, 191, 138)
let cmdCol      = color(242, 245, 250)

let fontMonoBold = NSFont.monospacedSystemFont(ofSize: 14.5, weight: .semibold)
let fontMono     = NSFont.monospacedSystemFont(ofSize: 13.5, weight: .regular)
let fontTitle    = NSFont.systemFont(ofSize: 16, weight: .bold)
let fontStep     = NSFont.systemFont(ofSize: 15, weight: .semibold)
let fontCaption  = NSFont.systemFont(ofSize: 15, weight: .medium)
let fontSmall    = NSFont.monospacedSystemFont(ofSize: 12.5, weight: .medium)

func drawText(_ str: String, x: CGFloat, yTop: CGFloat, font: NSFont, col: NSColor) {
  let attrs: [NSAttributedString.Key: Any] = [
    .font: font,
    .foregroundColor: col
  ]
  let nsStr = str as NSString
  let size = nsStr.size(withAttributes: attrs)
  nsStr.draw(at: NSPoint(x: x, y: CGFloat(H) - yTop - size.height), withAttributes: attrs)
}

func fillRoundRect(_ ctx: CGContext, x: CGFloat, yTop: CGFloat, w: CGFloat, h: CGFloat, r: CGFloat, fill: NSColor, stroke: NSColor? = nil, lineWidth: CGFloat = 1.0) {
  let rect = CGRect(x: x, y: CGFloat(H) - yTop - h, width: w, height: h)
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

let cmd1 = "mozak scopes"
let cmd2 = "mozak plan propose --scope field-kit --plan battery-budget"
let cmd3 = "mozak review decide --scope field-kit --plan battery-budget --approve-direction"
let cmd4 = "mozak observe --scope field-kit --plan battery-budget"

for f in 0..<totalFrames {
  autoreleasepool {
    let t = Double(f) / Double(spec.fps)
    let rep = NSBitmapImageRep(
      bitmapDataPlanes: nil,
      pixelsWide: W,
      pixelsHigh: H,
      bitsPerSample: 8,
      samplesPerPixel: 4,
      hasAlpha: true,
      isPlanar: false,
      colorSpaceName: .deviceRGB,
      bytesPerRow: W * 4,
      bitsPerPixel: 32
    )!
    NSGraphicsContext.saveGraphicsState()
    let nsCtx = NSGraphicsContext(bitmapImageRep: rep)!
    NSGraphicsContext.current = nsCtx
    let ctx = nsCtx.cgContext

    // 1. Background
    ctx.setFillColor(bgDark.cgColor)
    ctx.fill(CGRect(x: 0, y: 0, width: W, height: H))

    // Determine current beat, step banner, active Obsidian screenshot, and highlight box
    var stepBadge = "STEP 1 / 4"
    var stepTitle = "One inventory across code repos & research notes"
    var stepAccent = goldCol
    var obsImg = img1a
    var captionText = "Agent & Obsidian share mozak-inventory.json — zero personal notes or cloud sync required."
    var highlightBox: (x: CGFloat, yTop: CGFloat, w: CGFloat, h: CGFloat, col: NSColor, label: String)? = nil

    if t < 8.0 {
      obsImg = img1a
      if t >= 1.4 {
        highlightBox = (1536, 150, 345, 315, goldCol, "3 scopes auto-discovered")
      }
    } else if t < 16.0 {
      stepBadge = "STEP 2 / 4"
      stepTitle = "Agent proposes a plan → pauses at owner approval gate"
      stepAccent = goldCol
      obsImg = (t < 10.2) ? img1b : img2
      captionText = "Agent runs mozak plan propose. It cannot self-approve: Obsidian immediately shows 'awaiting approval'."
      if t >= 10.4 {
        highlightBox = (1536, 302, 345, 44, goldCol, "Awaiting owner approval")
      }
    } else if t < 24.0 {
      stepBadge = "STEP 3 / 4"
      stepTitle = "Owner approves direction → MOZAK.json + MOZAK.md update"
      stepAccent = purpleCol
      obsImg = (t < 18.2) ? img2 : img3
      captionText = "Owner approves direction. Obsidian redraws the 0/2 outcome strip and lights up the current Mermaid node."
      if t >= 18.4 {
        highlightBox = (836, 750, 340, 96, purpleCol, "Mermaid roadmap redraws live")
      }
    } else {
      stepBadge = "STEP 4 / 4"
      stepTitle = "Agent records test evidence → outcome strip & roadmap turn green"
      stepAccent = greenCol
      obsImg = (t < 26.0) ? img3 : img4
      captionText = "Generative UI without UI code: the agent writes plain files; Obsidian renders the live UI."
      if t >= 26.2 {
        highlightBox = (836, 750, 340, 96, greenCol, "Outcome 1/2 verified & green")
      }
    }

    // 2. Top Header Bar
    fillRoundRect(ctx, x: 24, yTop: 16, w: 1872, h: 46, r: 10, fill: panelBg, stroke: borderCol)
    fillRoundRect(ctx, x: 36, yTop: 24, w: 112, h: 30, r: 6, fill: stepAccent.withAlphaComponent(0.18), stroke: stepAccent, lineWidth: 1.5)
    drawText(stepBadge, x: 50, yTop: 30, font: fontSmall, col: stepAccent)
    drawText(stepTitle, x: 164, yTop: 29, font: fontStep, col: textMain)
    drawText("MOZAK v0.3.0 · Terminal + Obsidian", x: 1610, yTop: 30, font: fontSmall, col: textMuted)

    // 3. Left Window: Terminal (x=24, yTop=74, w=724, h=932)
    let tx: CGFloat = 24
    let ty: CGFloat = 74
    let tw: CGFloat = 724
    let th: CGFloat = 932
    fillRoundRect(ctx, x: tx, yTop: ty, w: tw, h: th, r: 12, fill: termBg, stroke: borderCol, lineWidth: 1.5)
    fillRoundRect(ctx, x: tx, yTop: ty, w: tw, h: 38, r: 12, fill: termHeader)
    // Traffic lights
    let lights: [(CGFloat, NSColor)] = [(tx + 18, color(255, 95, 86)), (tx + 38, color(255, 189, 46)), (tx + 58, color(39, 201, 63))]
    for (lx, lc) in lights {
      ctx.setFillColor(lc.cgColor)
      ctx.fillEllipse(in: CGRect(x: lx, y: CGFloat(H) - (ty + 25), width: 12, height: 12))
    }
    drawText("mozak-demo-vault — zsh", x: tx + 275, yTop: ty + 11, font: fontSmall, col: textMuted)

    // Render terminal lines progressively
    var cursorY: CGFloat = ty + 54
    let leftX: CGFloat = tx + 20
    let lineH: CGFloat = 20

    func renderBlock(startT: Double, typeDur: Double, cmd: String, output: String) {
      if t < startT { return }
      let elapsed = t - startT
      let frac = min(1.0, max(0.0, elapsed / typeDur))
      let charCount = Int(Double(cmd.count) * frac)
      let typed = String(cmd.prefix(charCount))
      let cursor = (elapsed < typeDur) ? "▋" : ""
      drawText("$ ", x: leftX, yTop: cursorY, font: fontMonoBold, col: promptCol)
      drawText(typed + cursor, x: leftX + 18, yTop: cursorY, font: fontMonoBold, col: cmdCol)
      cursorY += lineH + 2
      if elapsed >= typeDur {
        for rawLine in output.split(separator: "\\n", omittingEmptySubsequences: false) {
          let line = String(rawLine)
          if cursorY > ty + th - 28 { break }
          var lineCol = textMuted
          if line.contains("✓") || line.contains("status: ok") {
            lineCol = greenCol
          } else if line.contains("→ proposed") || line.contains("awaiting") {
            lineCol = goldCol
          } else if line.contains("[atlas-engine]") || line.contains("[routing-notes]") || line.contains("[field-kit]") || line.contains("[battery-budget]") {
            lineCol = textMain
          }
          drawText(line, x: leftX + 6, yTop: cursorY, font: fontMono, col: lineCol)
          cursorY += lineH - 1
        }
        cursorY += 12
      }
    }

    // In Steps 1-2 show Beat 1 + Beat 2; in Steps 3-4 scroll smoothly so all 4 beats fit cleanly
    if t < 16.0 {
      renderBlock(startT: 0.3, typeDur: 1.0, cmd: cmd1, output: spec.outputs["scopes"]!)
      renderBlock(startT: 8.2, typeDur: 1.8, cmd: cmd2, output: spec.outputs["propose"]!)
    } else {
      renderBlock(startT: 8.2, typeDur: 0.01, cmd: cmd2, output: spec.outputs["propose"]!)
      renderBlock(startT: 16.2, typeDur: 1.8, cmd: cmd3, output: spec.outputs["approve"]!)
      renderBlock(startT: 24.2, typeDur: 1.6, cmd: cmd4, output: spec.outputs["observe"]!)
    }

    // 4. Right Window: Live Obsidian Window Capture (x=768, yTop=74, w=1128, h=932)
    let ox: CGFloat = 768
    let oy: CGFloat = 74
    let ow: CGFloat = 1128
    let oh: CGFloat = 932
    fillRoundRect(ctx, x: ox, yTop: oy, w: ow, h: oh, r: 12, fill: panelBg, stroke: borderCol, lineWidth: 1.5)
    let imgRect = CGRect(x: ox + 2, y: CGFloat(H) - oy - oh + 2, width: ow - 4, height: oh - 4)
    ctx.saveGState()
    let clipPath = CGPath(roundedRect: imgRect, cornerWidth: 10, cornerHeight: 10, transform: nil)
    ctx.addPath(clipPath)
    ctx.clip()
    ctx.interpolationQuality = .high
    ctx.draw(obsImg, in: imgRect)
    ctx.restoreGState()

    // Optional callout highlight on the Obsidian window
    if let hb = highlightBox {
      fillRoundRect(ctx, x: hb.x, yTop: hb.yTop, w: hb.w, h: hb.h, r: 8, fill: hb.col.withAlphaComponent(0.08), stroke: hb.col, lineWidth: 2.5)
      let tagW = CGFloat(hb.label.count) * 8.2 + 24
      let tagX = (hb.x < 1200) ? (hb.x + hb.w + 12) : hb.x
      let tagY = (hb.x < 1200) ? (hb.yTop + (hb.h - 24) / 2.0) : (hb.yTop - 28)
      fillRoundRect(ctx, x: tagX, yTop: tagY, w: tagW, h: 24, r: 6, fill: panelBg, stroke: hb.col, lineWidth: 1.5)
      drawText(hb.label, x: tagX + 10, yTop: tagY + 4, font: fontSmall, col: hb.col)
    }

    // 5. Bottom Generative-UI Caption Bar
    fillRoundRect(ctx, x: 24, yTop: 1018, w: 1872, h: 46, r: 10, fill: panelBg, stroke: borderCol)
    ctx.setFillColor(stepAccent.cgColor)
    ctx.fillEllipse(in: CGRect(x: 44, y: CGFloat(H) - 1047, width: 10, height: 10))
    drawText(captionText, x: 66, yTop: 1031, font: fontCaption, col: textMain)

    // Progress bar along bottom edge of caption bar
    let progW = 1868.0 * CGFloat(t / totalSeconds)
    ctx.setFillColor(stepAccent.cgColor)
    ctx.fill(CGRect(x: 26, y: CGFloat(H) - 1063, width: progW, height: 3))

    NSGraphicsContext.restoreGraphicsState()

    let pngData = rep.representation(using: .png, properties: [:])!
    let framePath = String(format: "%@/frame-%04d.png", spec.framesDir, f)
    try! pngData.write(to: URL(fileURLWithPath: framePath))
  }
}
print("Rendered \\(totalFrames) frames.")
`,
);

console.log("2. Compositing 384 Retina HD frames (1920x1080 @ 12fps)...");
const compRes = spawnSync("swift", [swiftCompositor, specPath], { stdio: "inherit" });
if (compRes.status !== 0) throw new Error("Swift compositor failed");

const mp4Repo = join(repoRoot, "docs", "assets", "mozak-demo.mp4");
const mp4Downloads = join(homedir(), "Downloads", "mozak-demo.mp4");
const gifRepo = join(repoRoot, "docs", "assets", "mozak-demo.gif");

console.log("3. Encoding MP4 (H.264 1920x1080) and README GIF...");
const ffMp4 = spawnSync(
  "ffmpeg",
  [
    "-y",
    "-framerate",
    String(FPS),
    "-i",
    join(workDir, "frames", "frame-%04d.png"),
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-crf",
    "18",
    "-preset",
    "slow",
    "-movflags",
    "+faststart",
    mp4Repo,
  ],
  { stdio: "inherit" },
);
if (ffMp4.status !== 0) throw new Error("ffmpeg MP4 encoding failed");
cpSync(mp4Repo, mp4Downloads);

const ffGif = spawnSync(
  "ffmpeg",
  [
    "-y",
    "-framerate",
    String(FPS),
    "-i",
    join(workDir, "frames", "frame-%04d.png"),
    "-vf",
    "fps=8,scale=1280:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle",
    gifRepo,
  ],
  { stdio: "inherit" },
);
if (ffGif.status !== 0) throw new Error("ffmpeg GIF encoding failed");

// Reset demo vault back to clean Beat 1 state and reopen user's paper-and-applications vault too
spawnSync("node", [join(repoRoot, "scripts", "setup-demo-vault.mjs")]);
console.log(`Done! Saved:\n  - ${mp4Repo}\n  - ${mp4Downloads}\n  - ${gifRepo}`);
