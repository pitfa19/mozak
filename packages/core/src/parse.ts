export const RELATIONS = ["depends-on", "informs", "derived-from", "translates-to"] as const;
export type Relation = (typeof RELATIONS)[number];
export type ScopeKind = "project" | "topic";

export interface Link {
  relation: Relation;
  target: string;
  line: number;
}

export interface Assumption {
  text: string;
  status: "re-derived" | "open";
  line: number;
}

export interface Translation {
  title: string;
  source: string;
  target: string;
  assumptions: Assumption[];
  line: number;
}

export interface Issue {
  code: string;
  message: string;
  line?: number;
}

export interface MozakDoc {
  id: string;
  kind: ScopeKind;
  format: number;
  plan: string;
  links: Link[];
  translations: Translation[];
  issues: Issue[];
}

const SECTIONS = ["Plan", "Links", "Translations"] as const;

function splitFrontmatter(text: string): { fm: Record<string, string>; body: string[]; offset: number } | null {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return null;
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  if (end < 0) return null;
  const fm: Record<string, string> = {};
  for (const l of lines.slice(1, end)) {
    const m = /^([A-Za-z_-]+):\s*(.*?)\s*(?:#.*)?$/.exec(l);
    if (m) fm[m[1]] = m[2];
  }
  return { fm, body: lines.slice(end + 1), offset: end + 1 };
}

export function isLinkTarget(target: string): boolean {
  return /^https?:\/\/\S+$/.test(target) || /^\[\[[^\]\n]+\]\]$/.test(target);
}

export function parseMozak(text: string): MozakDoc {
  const issues: Issue[] = [];
  const doc: MozakDoc = { id: "", kind: "project", format: 0, plan: "", links: [], translations: [], issues };
  const split = splitFrontmatter(text);
  if (!split) {
    issues.push({ code: "frontmatter-missing", message: "MOZAK.md must start with a --- frontmatter block" });
    return doc;
  }
  const { fm, body, offset } = split;
  if (!fm.id) issues.push({ code: "id-missing", message: "frontmatter needs an id" });
  doc.id = fm.id ?? "";
  if (fm.kind === "project" || fm.kind === "topic") doc.kind = fm.kind;
  else issues.push({ code: "kind-invalid", message: `kind must be project or topic, got "${fm.kind ?? ""}"` });
  doc.format = Number(fm.format);
  if (doc.format !== 1) issues.push({ code: "format-unsupported", message: `format must be 1, got "${fm.format ?? ""}"` });

  const sections = new Map<string, { lines: string[]; start: number }>();
  const order: string[] = [];
  let current: string | null = null;
  body.forEach((l, i) => {
    const h = /^##\s+(.+?)\s*$/.exec(l);
    if (h) {
      current = h[1];
      if (sections.has(current)) issues.push({ code: "section-duplicate", message: `duplicate section "${current}"`, line: offset + i + 1 });
      else sections.set(current, { lines: [], start: offset + i + 1 });
      order.push(current);
    } else if (current) sections.get(current)?.lines.push(l);
  });

  for (const name of SECTIONS) {
    if (!sections.has(name)) issues.push({ code: "section-missing", message: `missing section "## ${name}"` });
  }
  for (const name of order) {
    if (!(SECTIONS as readonly string[]).includes(name)) issues.push({ code: "section-unknown", message: `unknown section "## ${name}"` });
  }
  const known = order.filter((n) => (SECTIONS as readonly string[]).includes(n));
  if (known.join() !== SECTIONS.filter((n) => known.includes(n)).join()) {
    issues.push({ code: "section-order", message: "sections must be in order: Plan, Links, Translations" });
  }

  doc.plan = (sections.get("Plan")?.lines ?? []).join("\n").trim();

  const links = sections.get("Links");
  if (links) {
    links.lines.forEach((raw, i) => {
      const line = links.start + i + 1;
      const t = raw.trim().replace(/^[-*]\s+/, "");
      if (!t) return;
      const m = /^([a-z-]+):\s*(.+)$/.exec(t);
      if (!m) return void issues.push({ code: "link-malformed", message: `expected "relation: target", got "${t}"`, line });
      if (!(RELATIONS as readonly string[]).includes(m[1])) {
        return void issues.push({ code: "link-relation", message: `unknown relation "${m[1]}" (allowed: ${RELATIONS.join(", ")})`, line });
      }
      if (!isLinkTarget(m[2])) {
        return void issues.push({ code: "link-target", message: `target must be an http(s) URL or [[wikilink]], got "${m[2]}"`, line });
      }
      doc.links.push({ relation: m[1] as Relation, target: m[2], line });
    });
  }

  const tr = sections.get("Translations");
  if (tr) {
    let cur: Translation | null = null;
    tr.lines.forEach((raw, i) => {
      const line = tr.start + i + 1;
      const h = /^###\s+(.+?)\s*$/.exec(raw);
      if (h) {
        cur = { title: h[1], source: "", target: "", assumptions: [], line };
        doc.translations.push(cur);
        return;
      }
      const t = raw.trim().replace(/^[-*]\s+/, "");
      if (!t || !cur) return;
      const f = /^(source|target):\s*(.+)$/.exec(t);
      if (f) {
        cur[f[1] as "source" | "target"] = f[2];
        return;
      }
      const a = /^\[(re-derived|open)\]\s+(.+)$/.exec(t);
      if (a) cur.assumptions.push({ status: a[1] as Assumption["status"], text: a[2], line });
    });
    for (const x of doc.translations) {
      if (!x.source || !x.target) issues.push({ code: "translation-incomplete", message: `translation "${x.title}" needs source: and target:`, line: x.line });
      if (x.assumptions.length === 0) issues.push({ code: "translation-no-assumptions", message: `translation "${x.title}" lists no assumptions`, line: x.line });
      for (const a of x.assumptions) {
        if (a.status === "open") issues.push({ code: "translation-open-assumption", message: `translation "${x.title}" has an open assumption: ${a.text}`, line: a.line });
      }
    }
  }
  return doc;
}
