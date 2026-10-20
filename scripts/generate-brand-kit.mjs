#!/usr/bin/env node
/**
 * scripts/generate-brand-kit.mjs
 *
 * Generates the official MOZAK Brand & Icon Kit in `docs/assets/brand/`:
 *   - mozak-icon.svg              (1024x1024 squircle app/repo icon with semantic SVG IDs)
 *   - mozak-icon-1024.png         (1024x1024 PNG rendered via AppKit)
 *   - mozak-icon-512.png          (512x512 PNG)
 *   - mozak-mark-transparent.svg  (512x512 transparent background brain-circuit graph mark)
 *   - mozak-mark-transparent.png  (512x512 transparent PNG for video overlays)
 *   - mozak-lockup-dark.svg       (1600x480 horizontal brand lockup for README & video title cards)
 *   - mozak-lockup-dark.png       (1600x480 PNG)
 *   - brand-tokens.json           (Palette, typography, semantic state colors, and motion tokens)
 *   - BRAND.md                    (Guide for agents & designers using the MOZAK brand kit)
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const brandDir = join(repoRoot, "docs", "assets", "brand");
mkdirSync(brandDir, { recursive: true });

// 1. Official MOZAK App / Repo Icon (1024x1024 squircle)
// Combines a geometric brain silhouette + "M" circuit topology + the 3 MOZAK state nodes:
//   - Left hemisphere node: Gold (#d8b35a) — Propose / Awaiting Owner Approval
//   - Central cortex node:  Purple (#9a8ce8) — Approved Direction / Current Stop
//   - Right hemisphere node: Green (#5cbf8a) — Verified Outcome with Evidence (checkmark)
//   - Bottom bar: The signature 3-segment MOZAK progress strip
const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <defs>
    <linearGradient id="bg-grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#171b2a"/>
      <stop offset="55%" stop-color="#111420"/>
      <stop offset="100%" stop-color="#0b0d14"/>
    </linearGradient>
    <radialGradient id="purple-glow" cx="50%" cy="42%" r="48%">
      <stop offset="0%" stop-color="#9a8ce8" stop-opacity="0.22"/>
      <stop offset="60%" stop-color="#d8b35a" stop-opacity="0.06"/>
      <stop offset="100%" stop-color="#0b0d14" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="trace-gold-purple" x1="0%" y1="50%" x2="100%" y2="50%">
      <stop offset="0%" stop-color="#d8b35a"/>
      <stop offset="100%" stop-color="#9a8ce8"/>
    </linearGradient>
    <linearGradient id="trace-purple-green" x1="0%" y1="50%" x2="100%" y2="50%">
      <stop offset="0%" stop-color="#9a8ce8"/>
      <stop offset="100%" stop-color="#5cbf8a"/>
    </linearGradient>
  </defs>

  <!-- Squircle Container -->
  <g id="icon-container">
    <rect x="32" y="32" width="960" height="960" rx="216" fill="url(#bg-grad)" stroke="#2e344d" stroke-width="10"/>
    <rect x="48" y="48" width="928" height="928" rx="202" fill="url(#purple-glow)" stroke="#9a8ce8" stroke-opacity="0.16" stroke-width="3"/>
  </g>

  <!-- Subtle Brain Hemisphere Silhouette & Neural Grid -->
  <g id="brain-hemispheres" opacity="0.88">
    <!-- Left Hemisphere Outer Fold -->
    <path d="M 484 212
             C 330 212, 206 310, 206 456
             C 206 520, 236 575, 278 612
             C 262 666, 304 724, 378 736
             L 484 736"
          fill="none" stroke="#2c3350" stroke-width="18" stroke-linecap="round"/>
    <!-- Right Hemisphere Outer Fold -->
    <path d="M 540 212
             C 694 212, 818 310, 818 456
             C 818 520, 788 575, 746 612
             C 762 666, 720 724, 646 736
             L 540 736"
          fill="none" stroke="#2c3350" stroke-width="18" stroke-linecap="round"/>
    <!-- Central Longitudinal Fissure -->
    <line x1="512" y1="188" x2="512" y2="754" stroke="#252b42" stroke-width="8" stroke-dasharray="14 14" stroke-linecap="round"/>
  </g>

  <!-- Secondary Neural Circuit Branches -->
  <g id="secondary-circuit-traces" fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="M 304 490 L 382 332 L 512 448 L 642 332 L 720 490"
          stroke="#323956" stroke-width="16"/>
    <path d="M 382 332 L 382 644 L 512 560 L 642 644 L 642 332"
          stroke="#262c44" stroke-width="12"/>
    <circle cx="382" cy="332" r="16" fill="#171b2a" stroke="#d8b35a" stroke-width="7"/>
    <circle cx="642" cy="332" r="16" fill="#171b2a" stroke="#5cbf8a" stroke-width="7"/>
    <circle cx="382" cy="644" r="14" fill="#171b2a" stroke="#9a8ce8" stroke-width="6"/>
    <circle cx="642" cy="644" r="14" fill="#171b2a" stroke="#5cbf8a" stroke-width="6"/>
  </g>

  <!-- Primary Directed Roadmap Graph ("M" Brain-Circuit Path: Gold -> Purple -> Green) -->
  <g id="mozak-traces" fill="none" stroke-linecap="round" stroke-linejoin="round">
    <!-- Trace 1: Gold (Propose) -> Purple (Approved Direction) -->
    <path id="trace-propose-to-active"
          d="M 304 490 C 304 378, 412 448, 512 448"
          stroke="url(#trace-gold-purple)" stroke-width="26"/>
    <!-- Trace 2: Purple (Approved Direction) -> Green (Verified Evidence) -->
    <path id="trace-active-to-verified"
          d="M 512 448 C 612 448, 720 378, 720 490"
          stroke="url(#trace-purple-green)" stroke-width="26"/>
  </g>

  <!-- Node 1: Propose / Owner Gate (Gold #d8b35a) -->
  <g id="node-gold-propose" transform="translate(304, 490)">
    <circle r="76" fill="#d8b35a" fill-opacity="0.14"/>
    <circle r="54" fill="#141826" stroke="#d8b35a" stroke-width="14"/>
    <circle r="20" fill="#d8b35a"/>
  </g>

  <!-- Node 2: Active Direction / Current Stop (Purple #9a8ce8) -->
  <g id="node-purple-active" transform="translate(512, 448)">
    <circle r="88" fill="#9a8ce8" fill-opacity="0.18"/>
    <circle r="62" fill="#141826" stroke="#9a8ce8" stroke-width="15"/>
    <!-- Forward direction chevron / pulse -->
    <path d="M -12 -18 L 16 0 L -12 18" fill="none" stroke="#9a8ce8" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>
  </g>

  <!-- Node 3: Verified Outcome / Evidence Pass (Green #5cbf8a) -->
  <g id="node-green-done" transform="translate(720, 490)">
    <circle r="76" fill="#5cbf8a" fill-opacity="0.16"/>
    <circle r="54" fill="#141826" stroke="#5cbf8a" stroke-width="14"/>
    <path d="M -20 2 L -5 18 L 22 -14" fill="none" stroke="#5cbf8a" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/>
  </g>

  <!-- Signature MOZAK 3-Segment Outcome Strip at Base -->
  <g id="outcome-strip" transform="translate(232, 824)">
    <rect x="0" y="0" width="172" height="32" rx="16" fill="#5cbf8a"/>
    <rect x="194" y="0" width="172" height="32" rx="16" fill="#d8b35a"/>
    <rect x="388" y="0" width="172" height="32" rx="16" fill="#9a8ce8"/>
  </g>
</svg>
`;

writeFileSync(join(brandDir, "mozak-icon.svg"), iconSvg);

// 2. Transparent Background Mark (`mozak-mark-transparent.svg`) for video overlays & corners
const transparentMarkSvg = iconSvg
  .replace(/<g id="icon-container">[\s\S]*?<\/g>/, "<!-- transparent background -->");
writeFileSync(join(brandDir, "mozak-mark-transparent.svg"), transparentMarkSvg);

// 3. Horizontal Hero Lockup (`mozak-lockup-dark.svg` — 1600x480) for intro/outro title cards & README
const lockupSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 480" width="1600" height="480">
  <defs>
    <linearGradient id="banner-bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#151928"/>
      <stop offset="60%" stop-color="#0f111a"/>
      <stop offset="100%" stop-color="#0b0d14"/>
    </linearGradient>
    <linearGradient id="icon-bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1b2034"/>
      <stop offset="100%" stop-color="#10131f"/>
    </linearGradient>
    <linearGradient id="trace-gp" x1="0%" y1="50%" x2="100%" y2="50%">
      <stop offset="0%" stop-color="#d8b35a"/>
      <stop offset="100%" stop-color="#9a8ce8"/>
    </linearGradient>
    <linearGradient id="trace-pg" x1="0%" y1="50%" x2="100%" y2="50%">
      <stop offset="0%" stop-color="#9a8ce8"/>
      <stop offset="100%" stop-color="#5cbf8a"/>
    </linearGradient>
  </defs>

  <!-- Outer Card -->
  <rect x="8" y="8" width="1584" height="464" rx="36" fill="url(#banner-bg)" stroke="#2e344d" stroke-width="3"/>

  <!-- Left: MOZAK Icon Badge (scaled to 320x320 at x=80, y=80) -->
  <g id="brand-mark" transform="translate(80, 80) scale(0.3125)">
    <rect x="0" y="0" width="1024" height="1024" rx="224" fill="url(#icon-bg)" stroke="#343b59" stroke-width="12"/>
    <path d="M 484 212 C 330 212, 206 310, 206 456 C 206 520, 236 575, 278 612 C 262 666, 304 724, 378 736 L 484 736"
          fill="none" stroke="#2c3350" stroke-width="20" stroke-linecap="round"/>
    <path d="M 540 212 C 694 212, 818 310, 818 456 C 818 520, 788 575, 746 612 C 762 666, 720 724, 646 736 L 540 736"
          fill="none" stroke="#2c3350" stroke-width="20" stroke-linecap="round"/>
    <path d="M 304 490 L 382 332 L 512 448 L 642 332 L 720 490" fill="none" stroke="#323956" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M 304 490 C 304 378, 412 448, 512 448" fill="none" stroke="url(#trace-gp)" stroke-width="28" stroke-linecap="round"/>
    <path d="M 512 448 C 612 448, 720 378, 720 490" fill="none" stroke="url(#trace-pg)" stroke-width="28" stroke-linecap="round"/>
    <g transform="translate(304, 490)">
      <circle r="56" fill="#141826" stroke="#d8b35a" stroke-width="16"/>
      <circle r="22" fill="#d8b35a"/>
    </g>
    <g transform="translate(512, 448)">
      <circle r="64" fill="#141826" stroke="#9a8ce8" stroke-width="16"/>
      <path d="M -12 -18 L 16 0 L -12 18" fill="none" stroke="#9a8ce8" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/>
    </g>
    <g transform="translate(720, 490)">
      <circle r="56" fill="#141826" stroke="#5cbf8a" stroke-width="16"/>
      <path d="M -20 2 L -5 18 L 22 -14" fill="none" stroke="#5cbf8a" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/>
    </g>
    <g transform="translate(232, 824)">
      <rect x="0" y="0" width="172" height="34" rx="17" fill="#5cbf8a"/>
      <rect x="194" y="0" width="172" height="34" rx="17" fill="#d8b35a"/>
      <rect x="388" y="0" width="172" height="34" rx="17" fill="#9a8ce8"/>
    </g>
  </g>

  <!-- Right: Wordmark, Version Pill, Tagline, and 3 State Pills -->
  <g id="brand-typography" font-family="'Plus Jakarta Sans', 'Space Grotesk', -apple-system, BlinkMacSystemFont, sans-serif">
    <text x="456" y="192" font-family="'Space Grotesk', 'Plus Jakarta Sans', sans-serif" font-size="104" font-weight="700" letter-spacing="6" fill="#eceff7">MOZAK</text>

    <!-- Version Badge -->
    <rect x="910" y="128" width="126" height="46" rx="23" fill="#9a8ce8" fill-opacity="0.16" stroke="#9a8ce8" stroke-width="2"/>
    <text x="973" y="158" text-anchor="middle" font-family="'JetBrains Mono', 'SF Mono', monospace" font-size="22" font-weight="700" fill="#9a8ce8">v0.3.0</text>

    <!-- Tagline -->
    <text x="460" y="258" font-family="'Plus Jakarta Sans', sans-serif" font-size="31" font-weight="600" fill="#a5aec7">
      Shared project memory in plain files — your agent writes, Obsidian renders.
    </text>

    <!-- 3 Signature Workflow Pills -->
    <g transform="translate(460, 308)" font-family="'JetBrains Mono', 'SF Mono', monospace" font-size="20" font-weight="600">
      <!-- Gold Pill -->
      <rect x="0" y="0" width="310" height="54" rx="14" fill="#d8b35a" fill-opacity="0.12" stroke="#d8b35a" stroke-width="2"/>
      <circle cx="30" cy="27" r="9" fill="#d8b35a"/>
      <text x="52" y="34" fill="#eceff7">1. Propose &amp; Gate</text>

      <!-- Purple Pill -->
      <rect x="334" y="0" width="340" height="54" rx="14" fill="#9a8ce8" fill-opacity="0.14" stroke="#9a8ce8" stroke-width="2"/>
      <circle cx="364" cy="27" r="9" fill="#9a8ce8"/>
      <text x="386" y="34" fill="#eceff7">2. Approve Direction</text>

      <!-- Green Pill -->
      <rect x="698" y="0" width="336" height="54" rx="14" fill="#5cbf8a" fill-opacity="0.14" stroke="#5cbf8a" stroke-width="2"/>
      <circle cx="728" cy="27" r="9" fill="#5cbf8a"/>
      <text x="750" y="34" fill="#eceff7">3. Verify Evidence</text>
    </g>
  </g>
</svg>
`;
writeFileSync(join(brandDir, "mozak-lockup-dark.svg"), lockupSvg);

// 4. Write brand-tokens.json and BRAND.md for the motion agent
const brandTokens = {
  name: "MOZAK",
  meaning: "Croatian for 'brain' — git-native project memory for humans and AI agents",
  version: "0.3.0",
  tagline: "Shared project memory in plain files — your agent writes, Obsidian renders.",
  colors: {
    canvasDark: "#0b0d14",
    backgroundPrimary: "#0f111a",
    surfaceCard: "#171a26",
    surfaceElevated: "#1e2233",
    borderSubtle: "#2e344d",
    textPrimary: "#eceff7",
    textSecondary: "#9aa3bc",
    semantic: {
      proposeGold: {
        hex: "#d8b35a",
        rgb: [216, 179, 90],
        meaning: "Agent proposal drafted / Awaiting owner direction approval OR evidence awaiting owner acceptance",
      },
      directionPurple: {
        hex: "#9a8ce8",
        rgb: [154, 140, 232],
        meaning: "Owner direction approved / Open plan / Current active stop on the Mermaid roadmap",
      },
      verifiedGreen: {
        hex: "#5cbf8a",
        rgb: [92, 191, 138],
        meaning: "Outcome verified with recorded test/observation evidence (Done)",
      },
    },
  },
  typography: {
    display: "'Space Grotesk', 'Plus Jakarta Sans', 'Outfit', sans-serif",
    sans: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif",
    mono: "'JetBrains Mono', 'SF Mono', Menlo, monospace",
    license: "SIL Open Font License 1.1 (100% free & open-source, bundled in brand/fonts/)",
    bundledFiles: [
      "brand/fonts/SpaceGrotesk-Medium.ttf",
      "brand/fonts/SpaceGrotesk-Bold.ttf",
      "brand/fonts/SpaceGrotesk-Medium.woff2",
      "brand/fonts/SpaceGrotesk-Bold.woff2",
      "brand/fonts/PlusJakartaSans-Regular.ttf",
      "brand/fonts/PlusJakartaSans-Medium.ttf",
      "brand/fonts/PlusJakartaSans-SemiBold.ttf",
      "brand/fonts/PlusJakartaSans-Bold.ttf",
      "brand/fonts/PlusJakartaSans-Regular.woff2",
      "brand/fonts/PlusJakartaSans-SemiBold.woff2",
      "brand/fonts/PlusJakartaSans-Bold.woff2",
      "brand/fonts/JetBrainsMono-Regular.ttf",
      "brand/fonts/JetBrainsMono-Medium.ttf",
      "brand/fonts/JetBrainsMono-SemiBold.ttf",
      "brand/fonts/JetBrainsMono-Bold.ttf",
      "brand/fonts/JetBrainsMono-Regular.woff2",
      "brand/fonts/JetBrainsMono-Medium.woff2",
      "brand/fonts/JetBrainsMono-Bold.woff2",
      "brand/fonts/Outfit-SemiBold.ttf",
      "brand/fonts/Outfit-Bold.ttf",
      "brand/fonts/Outfit-SemiBold.woff2",
      "brand/fonts/Outfit-Bold.woff2",
    ],
  },
  assets: {
    iconSvg: "brand/mozak-icon.svg",
    icon1024Png: "brand/mozak-icon-1024.png",
    icon512Png: "brand/mozak-icon-512.png",
    markTransparentSvg: "brand/mozak-mark-transparent.svg",
    markTransparentPng: "brand/mozak-mark-transparent.png",
    lockupDarkSvg: "brand/mozak-lockup-dark.svg",
    lockupDarkPng: "brand/mozak-lockup-dark.png",
  },
  svgLayerIds: {
    container: "#icon-container",
    hemispheres: "#brain-hemispheres",
    traces: "#mozak-traces",
    traceGoldToPurple: "#trace-propose-to-active",
    tracePurpleToGreen: "#trace-active-to-verified",
    nodeGold: "#node-gold-propose",
    nodePurple: "#node-purple-active",
    nodeGreen: "#node-green-done",
    outcomeStrip: "#outcome-strip",
  },
};
writeFileSync(join(brandDir, "brand-tokens.json"), JSON.stringify(brandTokens, null, 2) + "\n");

writeFileSync(
  join(brandDir, "BRAND.md"),
  `# MOZAK Brand & Icon Kit (\`v0.3.0\`)

**MOZAK** (*"brain"* in Croatian) is git-native project memory for humans and AI agents.

## Visual Metaphor

The MOZAK mark combines:
1. **Two Brain Hemispheres** — representing shared understanding between **you** and **your coding agent**.
2. **A 3-Node Directed Roadmap Circuit (\`M\` silhouette)** — representing MOZAK's 3-step loop:
   - **Gold Node (\`#d8b35a\` — \`#node-gold-propose\`)**: Agent drafts a plan & pauses at the owner gate (*awaiting approval*).
   - **Purple Node (\`#9a8ce8\` — \`#node-purple-active\`)**: Owner approves direction; the plan opens and lights up the active roadmap stop (*current*).
   - **Green Node (\`#5cbf8a\` — \`#node-green-done\`)**: Agent runs tests and records proof; the outcome turns green (*done*).
3. **The 3-Segment Outcome Strip (\`#outcome-strip\`)** — matching the live progress bar in the Obsidian Scopes sidebar.

## Included Files

| File | Resolution | Best For |
| --- | --- | --- |
| \`mozak-icon.svg\` | Vector (\`1024×1024\`) | Animating individual SVG nodes/traces in Remotion, Motion Canvas, or After Effects |
| \`mozak-icon-1024.png\` | \`1024×1024\` PNG | High-res app icon, title cards, avatars |
| \`mozak-icon-512.png\` | \`512×512\` PNG | README badges, corner watermarks |
| \`mozak-mark-transparent.svg\` / \`.png\` | \`512×512\` | Transparent background brain-circuit mark (no squircle box) for floating overlays |
| \`mozak-lockup-dark.svg\` / \`.png\` | \`1600×480\` | Intro/outro hero title card with icon + \`MOZAK v0.3.0\` wordmark + 3 workflow pills |
| \`brand-tokens.json\` | JSON | Machine-readable hex/RGB palette, fonts, and SVG element IDs |
`,
);

// 5. Render crisp PNGs from the SVGs using macOS AppKit NSImage -> NSBitmapImageRep at exact pixel dimensions
const swiftRender = `
import AppKit
import Foundation

func renderSvg(_ svgPath: String, _ pngPath: String, _ w: Int, _ h: Int) {
  guard let img = NSImage(contentsOfFile: svgPath) else {
    fatalError("Could not load SVG: \\(svgPath)")
  }
  let rep = NSBitmapImageRep(
    bitmapDataPlanes: nil,
    pixelsWide: w,
    pixelsHigh: h,
    bitsPerSample: 8,
    samplesPerPixel: 4,
    hasAlpha: true,
    isPlanar: false,
    colorSpaceName: .deviceRGB,
    bytesPerRow: w * 4,
    bitsPerPixel: 32
  )!
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
  NSGraphicsContext.current?.imageInterpolation = .high
  img.draw(in: NSRect(x: 0, y: 0, width: w, height: h), from: .zero, operation: .copy, fraction: 1.0)
  NSGraphicsContext.restoreGraphicsState()
  let data = rep.representation(using: .png, properties: [:])!
  try! data.write(to: URL(fileURLWithPath: pngPath))
}

let dir = CommandLine.arguments[1]
renderSvg(dir + "/mozak-icon.svg", dir + "/mozak-icon-1024.png", 1024, 1024)
renderSvg(dir + "/mozak-icon.svg", dir + "/mozak-icon-512.png", 512, 512)
renderSvg(dir + "/mozak-mark-transparent.svg", dir + "/mozak-mark-transparent.png", 512, 512)
renderSvg(dir + "/mozak-lockup-dark.svg", dir + "/mozak-lockup-dark.png", 1600, 480)
print("Rendered MOZAK brand PNGs in " + dir)
`;

const r = spawnSync("swift", ["-e", swiftRender, brandDir], { stdio: "inherit" });
if (r.status !== 0) process.exit(r.status || 1);
