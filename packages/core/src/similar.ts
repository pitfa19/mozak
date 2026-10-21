// `mozak similar` (D3 goal 1): an on-demand report of similar plans across one scope or every scope. No stored state,
// no model. It runs the propose guard's own rules (review.ts similarityMatch, the rules behind findSimilarPlans) on a
// pool of every plan, with Croatian diacritics folded, then drops templated siblings and labels what is left.
// Completed and rejected plans are in the pool, but a pair is reported only when at least one side is live (open,
// paused or awaiting): two finished or two rejected plans leave nothing to decide.
//
// Template filter: two plans with the same outcome-id list and fewer than 2 shared title tokens are siblings made
// from one template (two papers with the same outcomes), never a match.
// Labels: duplicate (same content, or most body words shared and every title word of each plan found in the other),
// supersedes-candidate (the newer plan names the older one, or the older one was rejected), overlap (anything else).
// Rejects whose reason says "moved to" are listed apart: those are moves between scopes, not duplicates.

import { foldText, foldKey } from "./fold.ts";
import { planDisplayState, type PlanDisplayState } from "./bridge.ts";
import { similarityMatch, similarityProfile, type SimilarityProfile } from "./review.ts";
import type { Plan, PlanContent, ScopeState } from "./understanding.ts";

export type SimilarLabel = "duplicate" | "supersedes-candidate" | "overlap";

export interface SimilarPlanRef {
  scope: string;
  planId: string;
  title: string;
  state: PlanDisplayState;
  createdAt: string;
}

export interface SimilarPair {
  label: SimilarLabel;
  /** For supersedes-candidate: the newer plan. Otherwise the first in scope/plan order. */
  a: SimilarPlanRef;
  /** For supersedes-candidate: the older plan it may replace. */
  b: SimilarPlanRef;
  rule: "same-content" | "title" | "id-and-title" | "id-and-body";
  /** Why the label was chosen, in one short sentence. */
  why: string;
  titleShared: string[];
  bodyShared: string[];
  titleJaccard: number;
  bodyJaccard: number;
  sameContent: boolean;
  crossScope: boolean;
}

export interface MovedReject extends SimilarPlanRef {
  reason: string;
}

export interface SimilarReport {
  plans: number;
  comparedPairs: number;
  templateFiltered: number;
  pairs: SimilarPair[];
  moved: MovedReject[];
}

interface Pooled {
  ref: SimilarPlanRef;
  content: PlanContent;
  digest: string;
  profile: SimilarityProfile;
  outcomeIds: string;
  /** Folded, lowercased text of the plan's own words and sources, for id mentions. */
  mentionText: string;
}

const DUPLICATE_BODY = 0.6;
const live = (s: PlanDisplayState) => s === "open" || s === "paused" || s === "awaiting";

function jaccard(a: string[], b: string[]): number {
  if (!a.length && !b.length) return 1;
  const sb = new Set(b);
  const shared = a.filter((t) => sb.has(t)).length;
  return shared / (new Set([...a, ...b]).size || 1);
}

function contentOf(plan: Plan): { content: PlanContent; digest: string } | null {
  const rev = plan.accepted ?? plan.pending;
  return rev ? { content: rev.content, digest: rev.contentDigest } : null;
}

function mentions(text: string, planId: string): boolean {
  const id = foldKey(planId);
  if (id.length < 4) return false;
  const re = new RegExp(`(^|[^a-z0-9_-])${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9_-])`);
  return re.test(text);
}

function pool(scopes: { id: string; state: ScopeState }[]): { pooled: Pooled[]; moved: MovedReject[] } {
  const pooled: Pooled[] = [];
  const moved: MovedReject[] = [];
  for (const { id: scope, state } of scopes) {
    for (const plan of state.plans) {
      const c = contentOf(plan);
      if (!c) continue;
      const ref: SimilarPlanRef = { scope, planId: plan.id, title: c.content.title, state: planDisplayState(plan), createdAt: plan.createdAt };
      if (ref.state === "rejected") {
        const decision = plan.decisions.find((d) => d.id === plan.pending?.rejectionDecisionId);
        if (decision && /\bmoved to\b/.test(foldKey(decision.reason))) moved.push({ ...ref, reason: decision.reason });
      }
      const t = c.content;
      pooled.push({
        ref,
        content: t,
        digest: c.digest,
        profile: similarityProfile(plan.id, t, foldText),
        outcomeIds: JSON.stringify(t.outcomes.map((o) => o.id).sort()),
        mentionText: foldKey([t.purpose, t.rationale, ...t.sources.map((s) => `${s.locator} ${s.anchor ?? ""}`), ...t.constraints.map((x) => x.text)].join("\n")),
      });
    }
  }
  return { pooled, moved };
}

const order = (x: SimilarPlanRef, y: SimilarPlanRef) => x.scope.localeCompare(y.scope) || x.planId.localeCompare(y.planId);

/** Every title word of each plan appears somewhere in the other plan. A template sibling fails this on its subject name. */
function titlesCovered(p: SimilarityProfile, q: SimilarityProfile): boolean {
  const pb = new Set(p.body);
  const qb = new Set(q.body);
  return p.title.every((t) => qb.has(t)) && q.title.every((t) => pb.has(t));
}

function label(p: Pooled, q: Pooled, bodyJ: number): { label: SimilarLabel; a: Pooled; b: Pooled; why: string } {
  const [first, second] = order(p.ref, q.ref) <= 0 ? [p, q] : [q, p];
  if (p.digest === q.digest) return { label: "duplicate", a: first, b: second, why: "same content" };
  if (bodyJ >= DUPLICATE_BODY && titlesCovered(p.profile, q.profile)) return { label: "duplicate", a: first, b: second, why: `nearly the same words (body ${bodyJ.toFixed(2)}), each title found in the other plan` };
  const newerFirst = Date.parse(p.ref.createdAt) >= Date.parse(q.ref.createdAt) ? [p, q] : [q, p];
  const [newer, older] = newerFirst as [Pooled, Pooled];
  if (mentions(newer.mentionText, older.ref.planId)) return { label: "supersedes-candidate", a: newer, b: older, why: `${newer.ref.planId} names ${older.ref.planId}` };
  if (older.ref.state === "rejected" && newer.ref.state !== "rejected") return { label: "supersedes-candidate", a: newer, b: older, why: `${older.ref.planId} was rejected and ${newer.ref.planId} is newer` };
  return { label: "overlap", a: first, b: second, why: "shared words, not the same plan" };
}

/** Pool every plan of the given scopes and report similar pairs. Pure: the caller reads the scopes. */
export function similarReport(scopes: { id: string; state: ScopeState }[]): SimilarReport {
  const { pooled, moved } = pool(scopes);
  const pairs: SimilarPair[] = [];
  let compared = 0;
  let templateFiltered = 0;
  for (let i = 0; i < pooled.length; i++) {
    for (let j = i + 1; j < pooled.length; j++) {
      const p = pooled[i];
      const q = pooled[j];
      if (!live(p.ref.state) && !live(q.ref.state)) continue;
      compared++;
      const sameContent = p.digest === q.digest;
      const match = similarityMatch(p.profile, q.profile);
      if (!match && !sameContent) continue;
      if (!sameContent && match && p.outcomeIds === q.outcomeIds && match.titleShared.length < 2) { templateFiltered++; continue; }
      const titleJ = jaccard(p.profile.title, q.profile.title);
      const bodyJ = jaccard(p.profile.body, q.profile.body);
      const l = label(p, q, bodyJ);
      pairs.push({
        label: l.label,
        a: l.a.ref,
        b: l.b.ref,
        rule: sameContent ? "same-content" : match!.rule,
        why: l.why,
        titleShared: match?.titleShared ?? p.profile.title,
        bodyShared: match?.bodyShared ?? p.profile.body,
        titleJaccard: Math.round(titleJ * 100) / 100,
        bodyJaccard: Math.round(bodyJ * 100) / 100,
        sameContent,
        crossScope: p.ref.scope !== q.ref.scope,
      });
    }
  }
  const rank: Record<SimilarLabel, number> = { duplicate: 0, "supersedes-candidate": 1, overlap: 2 };
  pairs.sort((x, y) => rank[x.label] - rank[y.label] || order(x.a, y.a) || order(x.b, y.b));
  moved.sort(order);
  return { plans: pooled.length, comparedPairs: compared, templateFiltered, pairs, moved };
}

/** Raw pooled lexical detector on every plan, without folding, live filter, template filter or labels: the baseline. */
export function rawPooledPairs(scopes: { id: string; state: ScopeState }[]): number {
  const all: { id: string; profile: SimilarityProfile }[] = [];
  for (const { state } of scopes) for (const plan of state.plans) {
    const c = contentOf(plan);
    if (c) all.push({ id: plan.id, profile: similarityProfile(plan.id, c.content) });
  }
  let n = 0;
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) if (similarityMatch(all[i].profile, all[j].profile)) n++;
  return n;
}

