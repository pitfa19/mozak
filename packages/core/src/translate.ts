import type { MozakDoc } from "./parse.ts";

export interface TranslationDraft {
  title: string;
  /** Scope id the idea comes from. */
  source: string;
  /** Scope id the idea moves into. */
  target: string;
  /** Every assumption the idea rests on in the source. The caller must list them all. */
  assumptions: string[];
}

/** A new translation starts with every assumption open. It only becomes valid when the target re-derives each one. */
export function renderTranslation(d: TranslationDraft): string {
  if (!d.title.trim()) throw new Error("translation needs a title");
  if (d.assumptions.length === 0) throw new Error("translation needs at least one assumption, otherwise nothing is being re-derived");
  const lines = [`### ${d.title.trim()}`, `- source: [[${d.source}]]`, `- target: [[${d.target}]]`];
  for (const a of d.assumptions) lines.push(`- [open] ${a.trim()}`);
  return lines.join("\n");
}

function titleOf(line: string): string | null {
  const m = /^###\s+(.+?)\s*$/.exec(line);
  return m ? m[1] : null;
}

/** Append a translation block to the end of the Translations section. Refuses a duplicate title. */
export function insertTranslation(text: string, block: string, title: string): string {
  if (!/^## Translations\s*$/m.test(text)) throw new Error('mozak.md has no "## Translations" section');
  if (text.split(/\r?\n/).some((l) => titleOf(l) === title.trim())) throw new Error(`translation "${title}" already exists`);
  return text.replace(/\s*$/, "\n") + "\n" + block + "\n";
}

/** Mark the nth (1 based) assumption of a translation as re-derived or open. */
export function setAssumption(text: string, title: string, n: number, status: "re-derived" | "open"): string {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => titleOf(l) === title.trim());
  if (start < 0) throw new Error(`no translation titled "${title}"`);
  let seen = 0;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) break;
    const m = /^(\s*[-*]\s+)\[(re-derived|open)\](.*)$/.exec(lines[i]);
    if (!m) continue;
    if (++seen === n) {
      lines[i] = `${m[1]}[${status}]${m[3]}`;
      return lines.join("\n");
    }
  }
  throw new Error(`translation "${title}" has ${seen} assumptions, no number ${n}`);
}

export interface Packet {
  idea: string;
  source: { id: string; kind: string; plan: string };
  target: { id: string; kind: string; plan: string };
  /** Existing declared relation between the two scopes, if any. */
  related: string[];
  assumptions: string[];
  draft: string;
  instructions: string[];
}

/** Everything an agent needs to move one idea: both plans, how the scopes are already linked, and the draft block. */
export function buildPacket(source: MozakDoc, target: MozakDoc, d: TranslationDraft): Packet {
  const related = [
    ...source.links.filter((l) => l.target.includes(target.id)).map((l) => `${source.id} ${l.relation} ${target.id}`),
    ...target.links.filter((l) => l.target.includes(source.id)).map((l) => `${target.id} ${l.relation} ${source.id}`),
  ];
  return {
    idea: d.title,
    source: { id: source.id, kind: source.kind, plan: source.plan },
    target: { id: target.id, kind: target.kind, plan: target.plan },
    related,
    assumptions: d.assumptions,
    draft: renderTranslation(d),
    instructions: [
      `For each assumption, check it in "${target.id}" itself. Do not carry the source's answer over.`,
      "If it holds in the target, say what you observed and mark it [re-derived].",
      "If it does not hold, replace it with the target's real assumption or drop the idea. Leave it [open].",
      "A translation with any [open] assumption is invalid. It transfers no truth and no authority.",
    ],
  };
}
