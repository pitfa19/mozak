// Deadline-from-prose rule (D3 Q19). Synthetic sentences only. Precision target: at least 0.9 on multi-date text.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { cuedDates, deadlineCandidates, planDeadline, sentences } from "../src/deadlines.ts";
import { readScope } from "../src/scope-store.ts";
import { readAnnotations } from "../src/annotations.ts";
import { cleanup, world } from "./annotations-fixture.ts";

after(cleanup);
const DAY = "2026-10-21";

test("formats: ISO, D Mon YYYY, D. M. YYYY., D. <Croatian month> YYYY., with optional weekday and colon", () => {
  const cases: [string, string[]][] = [
    ["Submit by 2026-11-01.", ["2026-11-01"]],
    ["Deadline is 1 Nov 2026 for the form.", ["2026-11-01"]],
    ["Deadline: 3 December 2026.", ["2026-12-03"]],
    ["Due Friday, 6 Nov 2026.", ["2026-11-06"]],
    ["Rok je 1. 11. 2026. za prijavu.", ["2026-11-01"]],
    ["Prijava do petka, 6. studenoga 2026.", ["2026-11-06"]],
    ["Predati prije 15. siječnja 2027.", ["2027-01-15"]],
    ["Rok: 2.3.2027.", ["2027-03-02"]],
    ["Until Mon 30 Nov 2026 only.", ["2026-11-30"]],
    ["Finish before 31 Mar 2027 and by 2027-04-15.", ["2027-03-31", "2027-04-15"]],
  ];
  for (const [text, dates] of cases) assert.deepEqual(cuedDates(text).map((h) => h.date), dates, text);
});

test("no cue, no year, impossible days and glued words give no date", () => {
  for (const text of [
    "Meeting on 2026-11-01 with the team.",
    "Started 1 Nov 2026.",
    "Submit by 1 Nov.",
    "Rok je 1. 11.",
    "Due 2026-02-30.",
    "Nearby 2026-11-01 records.",
    "Sastanak 5. studenoga 2026.",
    "Deadline is soon, maybe 2026-12-01.",
    "Odobreno 2026-11-01, rok uskoro.",
  ]) assert.deepEqual(cuedDates(text), [], text);
});

test("sentences keep Croatian dates whole", () => {
  assert.deepEqual(sentences("Rok je 1. 11. 2026. Druga rečenica do 3. studenoga 2026. Kraj."), ["Rok je 1. 11. 2026.", "Druga rečenica do 3. studenoga 2026.", "Kraj."]);
});

/** Each sentence holds at least two dates. Gold lists the dates a careful reader would call a deadline. */
const LABELED: [string, string[]][] = [
  ["Kickoff was on 2026-09-01; the report is due 2026-11-15.", ["2026-11-15"]],
  ["We met on 12 Oct 2026 and agreed to submit by 1 Nov 2026.", ["2026-11-01"]],
  ["Data from 2026-01-01 to 2026-06-30 is in scope; deadline is 2026-12-01.", ["2026-12-01"]],
  ["The call opened 1 Oct 2026 and closes, deadline 21 Oct 2026, with results on 15 Dec 2026.", ["2026-10-21"]],
  ["Draft by 2026-11-10, final by 2026-11-30.", ["2026-11-10", "2026-11-30"]],
  ["Interview scheduled 2026-11-03; references due 2026-11-01.", ["2026-11-01"]],
  ["Natječaj je otvoren od 1. 10. 2026., rok je 31. 10. 2026.", ["2026-10-31"]],
  ["Sastanak je bio 5. listopada 2026., prijavu predati do 20. studenoga 2026.", ["2026-11-20"]],
  ["Prijave prije 1. prosinca 2026., rezultati 15. siječnja 2027.", ["2026-12-01"]],
  ["Ugovor potpisan 2026-03-01, rok je 2026-12-31.", ["2026-12-31"]],
  ["Version 1 shipped 3 Mar 2026; version 2 is due 3 Mar 2027.", ["2027-03-03"]],
  ["Funding starts 2027-01-01 if we apply before 2026-11-20.", ["2026-11-20"]],
  ["The grant runs 2027-01-01 to 2027-12-31; apply by 2026-11-01.", ["2026-11-01"]],
  ["Trip on 4 Dec 2026, book tickets by 20 Nov 2026.", ["2026-11-20"]],
  ["Registered 2026-02-02, renewal due 2027-02-02.", ["2027-02-02"]],
  ["Do 15. 11. 2026. poslati sažetak, konferencija je 10. 12. 2026.", ["2026-11-15"]],
  ["Rok je petak, 13. 11. 2026.; obrana 4. 12. 2026.", ["2026-11-13"]],
  ["Recorded 2026-05-05 and 2026-06-06; nothing is due.", []],
  ["Exam on 2027-01-20, register until 2027-01-10.", ["2027-01-10"]],
  ["The review was moved from 2026-11-02 to 2026-11-09, slides due 2026-11-05.", ["2026-11-05"]],
  ["Papers accepted 1 Feb 2027 will be presented 1 Jun 2027; camera ready by 1 Mar 2027.", ["2027-03-01"]],
  ["Applications open 2026-11-01; deadline is Monday, 30 Nov 2026.", ["2026-11-30"]],
  ["Beta 2026-12-01, GA 2027-02-01, freeze before 2027-01-15.", ["2027-01-15"]],
  ["The offer letter dated 2026-10-01 must be signed by 2026-10-30.", ["2026-10-30"]],
  ["Termin 3. studenoga 2026., materijali prije 1. studenoga 2026.", ["2026-11-01"]],
  ["Projekt traje od 1. 1. 2027. do 31. 12. 2027.", ["2027-12-31"]],
  ["Data collected until 2026-11-15 is used; submit by 2026-12-01.", ["2026-12-01"]],
  ["Hearing on 9 Nov 2026, written answer due 2 Nov 2026.", ["2026-11-02"]],
  ["Paid 2026-07-01, next invoice due 2026-12-01.", ["2026-12-01"]],
  ["Phase one ended 2026-06-30; phase two must finish by 2027-06-30.", ["2027-06-30"]],
];

test("deadline rule precision on synthetic multi-date sentences is at least 0.9", (t) => {
  let extracted = 0, correct = 0, gold = 0, found = 0;
  for (const [text, labels] of LABELED) {
    const dates = [...new Set(cuedDates(text).map((h) => h.date))];
    extracted += dates.length;
    correct += dates.filter((d) => labels.includes(d)).length;
    gold += labels.length;
    found += labels.filter((d) => dates.includes(d)).length;
  }
  const precision = correct / extracted, recall = found / gold;
  t.diagnostic(`deadline rule: ${LABELED.length} sentences, extracted ${extracted}, correct ${correct}, precision ${precision.toFixed(3)}, recall ${recall.toFixed(3)}`);
  assert.ok(precision >= 0.9, `precision ${precision}`);
});

test("plan deadlines: one future date is inferred, several are candidates, past dates and done outcomes drop, owner wins", (t) => {
  const w = world();
  w.propose("alpha", "single", { purpose: "Submit the synthetic application by 2026-11-01. It was drafted on 2026-09-01." });
  w.propose("alpha", "several", { purpose: "Synthetic call, deadline 21 Oct 2026.", constraints: ["The second round is due 31 Mar 2027."] });
  w.propose("alpha", "past", { purpose: "Synthetic form was due 2026-01-10, and the next one is due 2026-12-05." });
  w.propose("alpha", "doneout", { outcomes: [{ id: "first", statement: "Send the synthetic draft by 2026-11-10." }, { id: "second", statement: "Send the synthetic final by 2026-12-10." }] });
  w.propose("alpha", "owner", { purpose: "Synthetic options: by 2026-11-11 or by 2026-12-12." });
  w.pass("alpha", "doneout", "first");
  assert.equal(w.annotate("alpha", [{ kind: "deadline", planId: "owner", date: "2026-12-12", evidence: "Owner picked 12 Dec 2026." }]).exitCode, 0);
  const state = readScope(w.entries.alpha).state;
  const doc = readAnnotations(w.entries.alpha.root, "alpha").doc;
  const of = (id: string) => planDeadline(state, state.plans.find((p) => p.id === id)!, doc, DAY);
  assert.deepEqual(of("single"), { status: "inferred", date: "2026-11-01", evidence: "Submit the synthetic application by 2026-11-01.", field: "purpose" });
  const several = of("several");
  assert.equal(several.status, "candidates");
  assert.deepEqual(several.status === "candidates" && several.candidates.map((c) => c.date), ["2026-10-21", "2027-03-31"]);
  assert.equal(of("past").status, "inferred");
  assert.equal((of("past") as { date: string }).date, "2026-12-05");
  assert.equal((of("doneout") as { date: string }).date, "2026-12-10");
  assert.deepEqual(of("owner"), { status: "owner", date: "2026-12-12", evidence: "Owner picked 12 Dec 2026." });
  w.complete("alpha", "single");
  const after = readScope(w.entries.alpha).state;
  assert.deepEqual(deadlineCandidates(after, after.plans.find((p) => p.id === "single")!, DAY), []);
  const plans = state.plans.filter((p) => p.id !== "owner");
  const sent = plans.filter((p) => planDeadline(state, p, null, DAY).status === "candidates").length;
  t.diagnostic(`plans with dates: ${plans.length}, sent to owner as candidates: ${sent}`);
});

test("plans --sort deadline orders rows by owner or inferred deadline and adds deadline fields", () => {
  const w = world();
  w.propose("alpha", "none");
  w.propose("alpha", "later", { purpose: "Synthetic, due 2099-06-01." });
  w.propose("alpha", "sooner", { purpose: "Synthetic, due 2099-02-01." });
  const sorted = w.op("plans", { scope: "alpha", sort: "deadline", limit: 2 });
  assert.equal(sorted.exitCode, 0);
  const open = (sorted.data.groups as Record<string, { rows: { planId: string; deadline: string | null }[]; continuation: string | null }>).open;
  assert.deepEqual(open.rows.map((r) => [r.planId, r.deadline]), [["sooner", "2099-02-01"], ["later", "2099-06-01"]]);
  const next = w.op("plans", { continuation: open.continuation });
  assert.equal(next.exitCode, 0);
  assert.deepEqual((next.data.groups as Record<string, { rows: { planId: string }[] }>).open.rows.map((r) => r.planId), ["none"]);
  const plain = w.op("plans", { scope: "alpha" });
  assert.equal("deadline" in (plain.data.groups as Record<string, { rows: object[] }>).open.rows[0]!, false);
  assert.equal(w.op("plans", { scope: "alpha", sort: "title" }).exitCode, 2);
});
