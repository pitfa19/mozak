// Pure clarification history rules. No IO and no authority is derived from answers.
import { randomUUID } from "node:crypto";
import { DomainError } from "./errors.ts";
import { canonical, discussionDigest, validateDiscussion, validateEvidence, isUtcTimestamp } from "./understanding.ts";
import type { AnswerInput, Discussion, Plan, Question, QuestionInput } from "./understanding.ts";

const invalid = (message: string) => new DomainError("invalid-payload", message, 2);
const stale = (message: string) => new DomainError("stale-reference", message, 3);
function closed(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid("discussion input must be an object");
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some(k => !keys.includes(k)) || keys.some(k => !(k in v))) throw invalid("unknown or missing discussion input field");
  return v;
}
function text(v: unknown): asserts v is string {
  if (typeof v !== "string" || !v.trim() || Buffer.byteLength(v) > 2000) throw invalid("discussion text must be nonempty and at most 2000 UTF-8 bytes");
}
export function checkQuestionInputs(value: unknown): asserts value is QuestionInput[] {
  if (!Array.isArray(value) || value.length > 32) throw invalid("questions must be an array of at most 32 questions");
  for (const raw of value) {
    const q = closed(raw, ["id", "text", "status", "answers", "reopenReason"]);
    if (q.id !== null) text(q.id);
    text(q.text);
    if (!["open", "answered", "deferred"].includes(q.status as string)) throw invalid("invalid question status");
    if (q.reopenReason !== null) text(q.reopenReason);
    if (!Array.isArray(q.answers) || q.answers.length > 16) throw invalid("at most 16 answers per question");
    for (const rawAnswer of q.answers) {
      const a = closed(rawAnswer, ["summary", "basis", "ownerRef", "ownerMessageAt", "evidence"]);
      text(a.summary);
      if (!Array.isArray(a.evidence)) throw invalid("answer evidence must be an array");
      try { a.evidence.forEach(e => validateEvidence(e)); } catch (e) { throw invalid((e as Error).message); }
      if (a.basis === "owner") { text(a.ownerRef); if (!isUtcTimestamp(a.ownerMessageAt)) throw invalid("owner answer needs UTC message time"); }
      else if (a.basis === "inspection") { if (!a.evidence.length || a.ownerRef !== null || a.ownerMessageAt !== null) throw invalid("inspection answer needs evidence and null owner fields"); }
      else throw invalid("invalid answer basis");
    }
  }
}
export function discussionCurrent(plan: Plan): boolean {
  return !!plan.discussion && plan.discussion.acceptedRevisionId === (plan.accepted?.id ?? null) && plan.discussion.pendingRevisionId === (plan.pending?.id ?? null);
}
const inputOf = ({ recordedAt: _time, ...answer }: Question["answers"][number]): AnswerInput => answer;
export function saveDiscussion(plan: Plan, payload: Record<string, unknown>, now: string): Discussion {
  if (payload.acceptedRevisionId !== (plan.accepted?.id ?? null) || payload.pendingRevisionId !== (plan.pending?.id ?? null)) throw stale("discussion revision binding changed");
  text(payload.summary);
  if (payload.stage !== "clarifying" && payload.stage !== "ready-for-spec") throw invalid("invalid discussion stage");
  checkQuestionInputs(payload.questions);
  const prior = plan.discussion;
  const seen = new Set<string>();
  const questions = payload.questions.map(q => {
    const old = q.id === null ? undefined : prior?.questions.find(old => old.id === q.id);
    if (q.id !== null && !old) throw stale("question ID must name a retained question");
    if (old && seen.has(old.id)) throw invalid("duplicate question ID");
    if (old) seen.add(old.id);
    if (old && old.text !== q.text) throw invalid("existing question text is immutable");
    if (old && (q.answers.length < old.answers.length || old.answers.some((a, i) => canonical(inputOf(a)) !== canonical(q.answers[i])))) throw invalid("answer history must retain its exact prefix");
    const reopening = old && old.status !== "open" && q.status === "open";
    if (reopening ? q.reopenReason === null : q.reopenReason !== null) throw invalid("reopenReason required only for settled-to-open transition");
    if (q.status !== "open" && (!q.answers.length || (old?.status === "open" && q.answers.length <= old.answers.length))) throw invalid("settling an open question requires an additional answer");
    if (!old && q.status === "open" && q.answers.length) throw invalid("new open question cannot have effective answers");
    const reopenings = [...(old?.reopenings ?? []), ...(reopening ? [{ reason: q.reopenReason!, recordedAt: now }] : [])];
    if (reopenings.length > 16) throw invalid("at most 16 reopening records per question");
    return { id: old?.id ?? randomUUID(), text: q.text, status: q.status, answers: q.answers.map((a, i) => old?.answers[i] ?? { ...a, recordedAt: now }), reopenings };
  });
  if (prior?.questions.some(q => !seen.has(q.id))) throw invalid("existing questions cannot be dropped");
  if (payload.stage === "ready-for-spec" && questions.some(q => q.status === "open")) throw invalid("ready-for-spec cannot contain open questions");
  const next = validateDiscussion({ id: prior?.id ?? randomUUID(), updatedAt: now, acceptedRevisionId: payload.acceptedRevisionId, pendingRevisionId: payload.pendingRevisionId, summary: payload.summary, stage: payload.stage, questions });
  if (prior && discussionDigest(prior) === discussionDigest(next)) return prior;
  return next;
}
