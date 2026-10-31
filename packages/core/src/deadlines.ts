// Deadlines from plan prose. Deterministic and advisory: an inferred deadline never changes a plan, and several dates
// are only candidates for the owner to pick with one `annotate` item.
//
// Rule: a date counts only when it directly follows a cue (before, by, deadline, deadline is, due, until, rok,
// rok je, do, prije), optionally after a weekday. An optional colon after the cue is allowed ("Deadline: ...").
// Formats: YYYY-MM-DD, D Mon YYYY, D. M. YYYY., D. <Croatian month> YYYY. A date without a year is not a date.
// Past dates and text of completed outcomes are dropped. One future date left is an inferred deadline.

import { isCalendarDate, planContent, type AnnotationsDoc } from "./annotations.ts";
import { outcomeStatus } from "./review.ts";
import type { Plan, ScopeState } from "./understanding.ts";

const CUE = "(?:deadline\\s+is|deadline|rok\\s+je|rok|before|by|due|until|do|prije)";
const WEEKDAYS = [
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "mon", "tue", "tues", "wed", "thu", "thur", "thurs", "fri", "sat", "sun",
  "ponedjeljak", "ponedjeljka", "utorak", "utorka", "srijeda", "srijedu", "srijede", "četvrtak", "četvrtka",
  "petak", "petka", "subota", "subotu", "subote", "nedjelja", "nedjelju", "nedjelje",
];
const EN_MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};
const HR_MONTHS: Record<string, number> = {
  siječnja: 1, siječanj: 1, veljače: 2, veljača: 2, ožujka: 3, ožujak: 3, travnja: 4, travanj: 4,
  svibnja: 5, svibanj: 5, lipnja: 6, lipanj: 6, srpnja: 7, srpanj: 7, kolovoza: 8, kolovoz: 8, rujna: 9, rujan: 9,
  listopada: 10, listopad: 10, studenoga: 11, studenog: 11, studeni: 11, prosinca: 12, prosinac: 12,
};
const alt = (words: string[]) => [...words].sort((a, b) => b.length - a.length).join("|");
const WD = `(?:(?:${alt(WEEKDAYS)})\\.?,?\\s+)?`;
const DATE = [
  "(\\d{4})-(\\d{2})-(\\d{2})",
  `(\\d{1,2})\\s+(${alt(Object.keys(EN_MONTHS))})\\.?,?\\s+(\\d{4})`,
  "(\\d{1,2})\\.\\s*(\\d{1,2})\\.\\s*(\\d{4})\\.?",
  `(\\d{1,2})\\.\\s+(${alt(Object.keys(HR_MONTHS))})\\s+(\\d{4})\\.?`,
].join("|");
const PATTERN = new RegExp(`(?<![\\p{L}\\p{N}])(${CUE}):?\\s+${WD}(?:${DATE})(?![\\p{L}\\p{N}-])`, "giu");

const pad = (n: number) => String(n).padStart(2, "0");
function iso(y: number, m: number, d: number): string | null {
  const s = `${y}-${pad(m)}-${pad(d)}`;
  return isCalendarDate(s) ? s : null;
}

export interface DateHit { date: string; cue: string; match: string }

/** Every cued date in a text, in order. Pure. Does not drop past dates. */
export function cuedDates(text: string): DateHit[] {
  const hits: DateHit[] = [];
  for (const m of text.matchAll(PATTERN)) {
    const g = m.slice(2).map((x) => x);
    let date: string | null = null;
    if (g[0]) date = iso(Number(g[0]), Number(g[1]), Number(g[2]));
    else if (g[3]) date = iso(Number(g[5]), EN_MONTHS[g[4]!.toLowerCase()]!, Number(g[3]));
    else if (g[6]) date = iso(Number(g[8]), Number(g[7]), Number(g[6]));
    else if (g[9]) date = iso(Number(g[11]), HR_MONTHS[g[10]!.toLowerCase()]!, Number(g[9]));
    if (date) hits.push({ date, cue: m[1]!.toLowerCase().replace(/\s+/g, " "), match: m[0] });
  }
  return hits;
}

/** Split prose into sentences without breaking Croatian dates like "1. 11. 2026." or "1. studenoga 2026.". */
export function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+(?=[\p{Lu}"'(])/u).map((s) => s.trim()).filter(Boolean);
}

export interface DeadlineCandidate { date: string; field: string; sentence: string }
export type PlanDeadline =
  | { status: "owner"; date: string; evidence: string }
  | { status: "inferred"; date: string; evidence: string; field: string }
  | { status: "candidates"; candidates: DeadlineCandidate[] }
  | { status: "none" };

/** Local calendar day, YYYY-MM-DD. */
export function today(now = new Date()): string { return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`; }

/** Future cued dates in the prose of a plan that still counts: title, purpose, rationale, constraints, open outcomes. */
export function deadlineCandidates(state: ScopeState, plan: Plan, day: string): DeadlineCandidate[] {
  if (plan.lifecycle.state === "completed") return [];
  const content = planContent(plan);
  if (!content) return [];
  const fields: [string, string][] = [["title", content.title], ["purpose", content.purpose], ["rationale", content.rationale]];
  for (const c of content.constraints) fields.push([`constraint:${c.id}`, c.text]);
  for (const o of content.outcomes) {
    if (plan.accepted && outcomeStatus(state, plan, o.id) === "done") continue;
    fields.push([`outcome:${o.id}`, `${o.statement}`], [`outcome:${o.id}:criterion`, o.criterion]);
  }
  const out: DeadlineCandidate[] = [];
  const seen = new Set<string>();
  for (const [field, value] of fields) {
    for (const sentence of sentences(value)) {
      for (const hit of cuedDates(sentence)) {
        if (hit.date < day || seen.has(hit.date)) continue;
        seen.add(hit.date);
        out.push({ date: hit.date, field, sentence: sentence.length > 300 ? `${sentence.slice(0, 297)}...` : sentence });
      }
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Owner override first, else one inferred future date, else candidates for the owner. */
export function planDeadline(state: ScopeState, plan: Plan, annotations: AnnotationsDoc | null, day = today()): PlanDeadline {
  const override = annotations?.plans[plan.id]?.deadline;
  if (override) return { status: "owner", date: override.date, evidence: override.evidence };
  const candidates = deadlineCandidates(state, plan, day);
  if (candidates.length === 1) return { status: "inferred", date: candidates[0]!.date, evidence: candidates[0]!.sentence, field: candidates[0]!.field };
  if (candidates.length > 1) return { status: "candidates", candidates };
  return { status: "none" };
}

/** Date used for sorting: owner or inferred. Candidates and none sort last. */
export function effectiveDeadline(d: PlanDeadline): string | null {
  return d.status === "owner" || d.status === "inferred" ? d.date : null;
}
