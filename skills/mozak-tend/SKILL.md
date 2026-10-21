---
name: mozak-tend
description: Monthly mozak health report and at most 3 small patches to agent guidance files, proposed as one plan in a mozak-meta scope. Proposal only.
status: proposal
---

# mozak-tend (proposal)

Status: proposal. This skill is not installed, is not rendered by the installer, and nothing runs it on a schedule. There is no cron entry, no background job and no CLI route for it yet. The pure helpers exist in core (`tendReport`, `checkTendSurface`, `checkTendSizeBudget`, `measureTendPatch`, `countTendOwnerYes`, `tendKillState`, `tendReproposalBlock`, `renderTendReport` in `packages/core/src/tend.ts`). Tests are not owner approval.

Honest framing: at today's volumes this is mostly a health report. Most metrics will read "not measurable" for months.

## When it runs

- Only when the owner asks for it in a live session, at most once a month ("run tend", "tend report for 2026-11").
- Never from a scheduler, a hook or another skill. Never as a loop.
- It uses the `mozak` skill for every plan read and write. This skill adds no route and no grant.

## Inputs (read only)

1. The monthly usage aggregates: `<personal vault root>/.mozak-usage/<host>-<yyyy-mm>.json`. Counts only, one file per host per month, never in a shared vault. If a month has no file, that month has 0 events.
2. Previous tend plans in the `mozak-meta` scope: applied patches, their metric, the month they landed, rejections and owner decisions.
3. For each candidate file: its path relative to its repo root, the repo's remote visibility, and its byte size before and after the patch.
4. Optional samples the host can count without a model: `check` findings per scope, the eval dev score if the eval was run, owner edits to agent proposals (revisions after an agent proposal).

Never read prompts, transcripts, plan text or note bodies into the report. The report holds counts and file paths only.

## Steps

1. Build the report with `tendReport(aggregates, proposals, { month, now, applied, history, rejections, decisions, pending })`. Pass `now` explicitly.
2. Show the owner the rendered report (`renderTendReport`):
   - health: calls, writes, stale refusals per 100 writes, context bytes per session, hosts;
   - the patch outcome table for last month's patches: before window, after window, outcome;
   - burden: owner yeses this month (limit 2) and items pending over 7 days;
   - kill rule state and mode (`patch` or `report-only`).
3. If the mode is `report-only`, or there is no candidate patch, stop after the report.
4. Otherwise draft at most 3 patches. Each patch is a small delta to one surface, never a whole-file rewrite, and names exactly one metric.
5. Run the report again with the drafted patches. Drop every patch the report refuses. If `plan.allowed` is false, show the refusal codes and stop.
6. Propose one plan in the `mozak-meta` scope through the `mozak` skill, with at most 3 outcomes (one per patch). Each outcome states the file, the heading, the metric and the window rule.
7. The owner approves direction, then implementation: 2 yeses. That is the monthly budget. Apply the patches only after `executionEligible` is true, in the first week of the month, so the windows stay clean.
8. Record each applied patch with `observe`: file, heading, byte sizes, metric, the month it landed. Next month's report measures it.

## Surface list

Tend may patch only:

- the root `AGENTS.md` of a vault repo,
- a scope's `AGENTS.md` (the file sits directly in a scope root),
- folder index notes (`index.md`, `INDEX.md`, or a note the owner declared as the folder index),
- annotation proposals in a scope's `mozak.annotations.json`, through the owner annotation route.

Refusals (checked in this order, codes from `checkTendSurface`):

| Code | Rule |
|---|---|
| `surface-unsafe-path` | Absolute paths, `.` or `..` parts, backslashes. |
| `surface-public-remote` | Never files in a repo with a public remote. The public `mozak` skill and this repo are never tend surfaces. |
| `surface-remote-unknown` | Visibility unknown: refused until the owner declares the repo private. |
| `surface-eval-folder` | Never the eval folder (`.mozak-eval/` and any declared eval folder). |
| `surface-prose-note` | Never prose notes. |
| `surface-not-listed` | Anything else: `mozak.json`, `mozak.md`, scripts, an `AGENTS.md` that is not at a scope or repo root. |

## Size budgets

| Surface | Budget |
|---|---|
| Scope `AGENTS.md` | 4 KB (4096 bytes) |
| Root `AGENTS.md` | 8 KB (8192 bytes) |
| Folder index note | 2 KB (2048 bytes) |

Sizes are UTF-8 bytes after the patch. A file over budget may still be patched only if the patch deletes as much as it adds (`size-over-budget` otherwise).

## Metric per patch

Each patch names one metric:

- `context-bytes-per-session` (from the aggregates; context calls stand in for sessions),
- `stale-per-100-writes` (from the aggregates; committed writes are the events),
- `check-findings`, `eval-dev-score`, `owner-edits` (explicit samples).

Window rule: the before window is the month before the patch landed, the after window is the month it landed. A window is one calendar month because the aggregates are monthly; D3's 4 weeks is approximated. A patch is measured only if both windows have at least 30 events. Otherwise its outcome is "not measurable". A change under 10% of the before value is "no change". Lower is better except for the eval dev score.

Limits: aggregates hold no scope ids, so a patch to one scope is measured against traffic of all scopes. Say so in the report.

## Kill rule

After 3 monthly reports in a row with no measured improvement, tend stops patching and only reports. "Not measurable" counts as no measured improvement. Only the owner can reset it (the `resetMonth` option), by an explicit message.

## Re-proposal block

A rejected patch blocks the same file and heading for 90 days (`reproposal-blocked`). Headings compare without `#` marks, case or extra spaces.

## Owner burden (V-burden)

- At most 2 owner yeses per month in `mozak-meta` (direction and implementation of the one plan). Rejections and pauses are not yeses.
- If a yes was already used this month, the plan is refused (`owner-yes-budget`) and the report waits for next month.
- The report shows items pending over 7 days.

## Harness2 experiment

At most one offline experiment on one scope, after the eval exists: replay the same task set against the scope with and without the patch, in scratch copies, and compare. Not a loop. Never against the real vault.

## Boundaries

- No model call in core. The host may draft patch text; core only checks and measures.
- Never create the `mozak-meta` scope or a plan without the owner asking for it.
- Never approve, accept or complete anything. The owner decides.
- Never commit to a repo with a public remote.
