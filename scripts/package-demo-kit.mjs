#!/usr/bin/env node
// Packages ~/Downloads/mozak-demo-kit and ~/Downloads/mozak-demo-kit.zip
// with the clean Pomodoro Study Timer / Recipe Book App / Summer Road Trip Notes
// demo captures, transcripts, composited keyframes, videos, and official MOZAK Brand Kit.

import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const downloads = join(homedir(), "Downloads");
const kit = join(downloads, "mozak-demo-kit");
const zipPath = join(downloads, "mozak-demo-kit.zip");

const handoffPath = join(repo, "docs/assets/src/HANDOFF.md");
const handoff = existsSync(handoffPath) ? readFileSync(handoffPath, "utf8") : "";
rmSync(kit, { recursive: true, force: true });
if (existsSync(zipPath)) rmSync(zipPath, { force: true });

for (const sub of ["brand", "obsidian-captures", "transcripts", "composited-keyframes", "videos", "scripts", "demo-vault-template"]) {
  mkdirSync(join(kit, sub), { recursive: true });
}
if (handoff) writeFileSync(join(kit, "HANDOFF.md"), handoff);

const sanitize = (s) =>
  s
    .replaceAll(join(downloads, "mozak-demo-vault"), "~/mozak-demo-vault")
    .replaceAll(homedir(), "~");

// 1. Official MOZAK Brand & Icon Kit (including brand/fonts/)
cpSync(join(repo, "docs/assets/brand"), join(kit, "brand"), { recursive: true });
copyFileSync(join(repo, "docs/assets/hero.svg"), join(kit, "brand/hero.svg"));
copyFileSync(join(repo, "docs/assets/hero-pixel.gif"), join(kit, "brand/hero-pixel.gif"));

// 2. Raw Obsidian captures (2240x1672 Retina)
const obsDir = join(homedir(), ".jcode/scratch/mozak-demo-recording/obs");
for (const f of ["beat1a.png", "beat2.png", "beat3.png", "beat4.png"]) {
  copyFileSync(join(obsDir, f), join(kit, "obsidian-captures", f));
}

// 3. Transcripts & architecture diagram
copyFileSync(join(repo, "docs/assets/src/AGENT-CHAT-SCRIPT.md"), join(kit, "transcripts/AGENT-CHAT-SCRIPT.md"));
copyFileSync(join(repo, "docs/assets/src/agent-chat-flow.json"), join(kit, "transcripts/agent-chat-flow.json"));
copyFileSync(join(repo, "docs/assets/under-the-hood.svg"), join(kit, "transcripts/under-the-hood.svg"));
writeFileSync(
  join(kit, "transcripts/cli-timeline.json"),
  sanitize(readFileSync(join(homedir(), ".jcode/scratch/mozak-demo-recording/timeline.json"), "utf8")),
);

// 4. Composited keyframes (1920x1080)
const frameMap = [
  ["frame-0070.png", "beat1.png"],
  ["frame-0160.png", "beat2.png"],
  ["frame-0260.png", "beat3.png"],
  ["frame-0360.png", "beat4.png"],
];
for (const [src, dst] of frameMap) {
  copyFileSync(
    join(homedir(), ".jcode/scratch/mozak-agent-chat-recording/frames", src),
    join(kit, "composited-keyframes", `agent-chat-${dst}`),
  );
  copyFileSync(
    join(homedir(), ".jcode/scratch/mozak-demo-recording/frames", src),
    join(kit, "composited-keyframes", `cli-demo-${dst}`),
  );
}

// 5. Rendered videos (MP4 + GIF)
for (const v of ["mozak-agent-chat.mp4", "mozak-agent-chat.gif", "mozak-demo.mp4", "mozak-demo.gif"]) {
  copyFileSync(join(repo, "docs/assets", v), join(kit, "videos", v));
}

// 6. Demo vault template (recipe-app, trip-notes, study-timer)
const vaultDir = join(downloads, "mozak-demo-vault");
for (const rootFile of ["mozak-inventory.json", "RECORDING-SCRIPT.md", "demo-step.mjs"]) {
  if (existsSync(join(vaultDir, rootFile))) {
    writeFileSync(join(kit, "demo-vault-template", rootFile), sanitize(readFileSync(join(vaultDir, rootFile), "utf8")));
  }
}
for (const scope of ["recipe-app", "trip-notes", "study-timer"]) {
  const scopeSrc = join(vaultDir, scope);
  const scopeDst = join(kit, "demo-vault-template", scope);
  mkdirSync(scopeDst, { recursive: true });
  for (const f of ["README.md", "AGENTS.md", "MOZAK.json", "MOZAK.md"]) {
    if (existsSync(join(scopeSrc, f))) {
      writeFileSync(join(scopeDst, f), sanitize(readFileSync(join(scopeSrc, f), "utf8")));
    }
  }
}

// 7. Reproducible scripts
for (const s of ["setup-demo-vault.mjs", "record-demo-video.mjs", "record-agent-chat-video.mjs", "generate-brand-kit.mjs", "package-demo-kit.mjs"]) {
  writeFileSync(join(kit, "scripts", s), sanitize(readFileSync(join(repo, "scripts", s), "utf8")));
}
copyFileSync(join(repo, "docs/assets/src/render-under-the-hood.mjs"), join(kit, "scripts/render-under-the-hood.mjs"));

// 8. Zip bundle
spawnSync("zip", ["-r", "-q", zipPath, "mozak-demo-kit"], { cwd: downloads, stdio: "inherit" });
console.log(`Packaged ${zipPath}`);
