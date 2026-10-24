# CLI routes for this skill

Every command uses the full built path. Never the bare `mozak` command:

```
node {{MOZAK_CLI}} <route> --config INVENTORY --scope ID [flags]
```

Run `node {{MOZAK_CLI}} --help` at session start. If a route is missing, stop.

## Read

| Command | Use |
|---|---|
| `node {{MOZAK_CLI}} plan show --config INVENTORY --scope ID --plan PLAN [--json]` | One plan in about 1 KB: lifecycle, `executionEligible` + reasons, authorizations, outcomes (status, supports, challenges, owner accepted), spec path and health, `permittedNextAction` |
| `node {{MOZAK_CLI}} context --config INVENTORY --scope ID --brief --json` | Session-start overview: plan IDs, titles, lifecycle, review state, blockers, next action, CAS `snapshot`; no bodies |
| `node {{MOZAK_CLI}} context --config INVENTORY --scope ID --plan PLAN --json` | Exact plan's full recovery context and bounds; use before work and after stale conflicts |
| `node {{MOZAK_CLI}} context --config INVENTORY --scope ID --json` | Backward-compatible full context for all plans, including history |
| `node {{MOZAK_CLI}} plans --config INVENTORY --scope ID --json` | Plan list |
| `node {{MOZAK_CLI}} review show --config INVENTORY --scope ID --plan PLAN [--purpose P] [--outcome ID] --json` | Review subject for one decision |
| `node {{MOZAK_CLI}} check --config INVENTORY --scope ID --json` | Findings. Never repairs. |

Purposes (`review show`, `review decide`): `approve-direction` (default for a pending direction), `reject-pending`, `reconsider`, `pause`, `resume`, `approve-implementation`, `revoke-implementation`, `accept-outcome` (needs `--outcome`).

## Agent writes (advisory, grant nothing)

Observe with flags (fresh snapshot, generated ids, up to 3 attempts on stale-input):

```
node {{MOZAK_CLI}} observe --config INVENTORY --scope ID --plan PLAN --summary TEXT --locator WHERE [--outcome O] [--verdict pass|fail|not-assessed] [--activity TEXT] [--activity-kind read|run] [--relation supports|challenges] [--classification observed|inferred|unverified] [--anchor A] [--version V] [--limitation TEXT] [--dry-run]
```

`--outcome` links to the accepted revision. Before direction approval it is refused: record without it. `--verdict fail` defaults to `--relation challenges`. Several evidence items: `observe --scope ID --payload FILE` with the `payload` of `examples/observe.json` (same fresh snapshot and retries).

Other writes use a request file, written as data. Envelope:

```json
{ "operationId": "unique-id", "scopeId": "ID", "expected": { "revision": "...", "graphHash": "...", "bridge": { "exists": true, "sha256": "..." } }, "action": "ACTION", "payload": { } }
```

`expected` is the `snapshot` of a fresh context read (every form returns the same whole-scope snapshot). `--brief --plan PLAN` returns one plan's summary (not enough to start execution: read `--plan PLAN` for bounds). Unknown plan IDs return `plan-not-found`.

| Command | Action |
|---|---|
| `node {{MOZAK_CLI}} plan propose --config INVENTORY --scope ID --request FILE` | `propose` (optional `distinctFromPlanIds` when owner confirmed a separate plan despite overlap) |
| `node {{MOZAK_CLI}} plan revise --config INVENTORY --scope ID --request FILE` | `revise` (optional `mergeFromPlanId`). Output `warnings` list outcomes and grants that need the owner again after approval |
| `node {{MOZAK_CLI}} discussion save --config INVENTORY --scope ID --request FILE` | `save-discussion` |
| `node {{MOZAK_CLI}} spec attach --config INVENTORY --scope ID --request FILE` | `attach-spec` |
| `node {{MOZAK_CLI}} plan complete --config INVENTORY --scope ID --request FILE` | `complete` |

### Question IDs and history

1. A new question with `"id": null` is saved. Core assigns the ID, returned in `result.discussion.questions[].id`.
2. Reuse that returned ID to answer it. The ID stays the same, the answer is appended, and `reopenings` stays empty.
3. Never invent a question ID. A string ID must name an existing question.
4. Existing questions cannot be dropped. A save that omits one is refused with `invalid-payload`.
5. Moving a settled question back to open needs a non-empty `reopenReason`. Core appends a reopening and keeps prior answers.

## Owner decisions

```
node {{MOZAK_CLI}} review decide --config INVENTORY --scope ID --plan PLAN --purpose P [--outcome O] [--spec SPEC] --owner-ref REF --owner-message-at ISO --reason TEXT [--dry-run] [--json]
```

Reads the fresh `review show` subject and snapshot, builds the request (new `operationId`, `revisionId`, `reviewDigest`, `specificationId`/`authorizationId`/`outcomeId` as the purpose needs) and submits as owner. On stale-input it rereads once and retries only if the subject is unchanged, else `subject-changed` (exit 3). `--spec` refuses if the current candidate differs. Prints a short summary, plus `warning` lines with the exact next command. `--json` gives the full envelope.

Request-file form still works: `--request FILE` with payload `planId, revisionId, reviewDigest, ownerRef, ownerMessageAt, reason` (+ `specificationId`, `authorizationId` or `outcomeId`). It cannot be mixed with the flags.

### Deleting plans (owner)

`node {{MOZAK_CLI}} plan delete --config INVENTORY --scope ID --plans A,B --owner-ref REF --owner-message-at ISO --reason TEXT [--allow-completed] [--dry-run]`

Removes plans so they no longer exist in `mozak.json` or `mozak.md`. Use it only when the owner asks, in their own message, to delete named plans. `--request FILE` (`operationId, scopeId, expected, planIds, reason, ownerRef, ownerMessageAt`) still works.

- `--allow-completed` is needed to delete a completed plan. Never add it unless the owner says the completed plan should go too.
- Refused with `delete-referenced` while another plan still points at it (a pending merge or a reasoning link). Delete both together or merge instead.
- The receipt `{ "action": "delete-plans", "ids": [...] }` stays in `mozak.json` as the record, and the deleted id cannot be proposed again.
- Prefer a merge when two plans in one scope overlap: approval folds the source into the target and removes it. Use delete for a plan superseded by one in another scope, or a plan the owner no longer wants.

### Provenance (`ownerRef`, `ownerMessageAt`)

- Preferred: a genuine owner message ID from the host.
- Permitted fallback, labelled a host assertion and not a native message ID or authentication: the actual session ID, the actual user-message timestamp, and the digest of the actual response, joined into one reference.
- Never fabricate a locator. Never infer a time from file modification times.
- If provenance cannot be established, redisplay the subject and ask again.

### Pause (restrictive exception, spec section 7)

An unambiguous pause instruction stops host work first. The host may then persist it using the current pause subject, with the real provenance. The provenance record states that the instruction preceded this generated review. This covers stopping only. It never covers approval, resume, or broadening.

## Review digest and CAS

The flag forms apply these rules. An identical retry replays its receipt. A reused `operationId` with different input is `operation-conflict` (exit 3). After `stale-input`, an unchanged subject (scope, plan, purpose, revision and content digest, spec and bounds digest, authorization, `reviewDigest`) may reuse the unconsumed owner confirmation with a fresh `expected` and new `operationId`. A changed subject needs redisplay and a fresh "yes".

## Plan completion

`plan complete` (`action: "complete"`, payload `{ planId, revisionId }`), with `revisionId` the accepted revision. Core requires:
- An open lifecycle. A paused plan is refused with `invalid-lifecycle` (exit 3).
- No awaiting pending revision (`owner-review-required`).
- For each outcome: at least one observed supporting pass (`insufficient-evidence` otherwise), and a bound owner acceptance when the outcome's acceptance is `owner` or it has challenges (`owner-review-required` otherwise).

Do not claim a plan will complete because it is open. Run the package 1 outcome checks first.

## Exit codes and what the host does

| Code | Meaning | Host action |
|---|---|---|
| 0 | Success, or replayed committed result | Continue. Confirm with `context` |
| 2 | Invalid or unavailable | Report cause. Stop that step |
| 3 | Stale, conflict, owner review needed, invalid lifecycle | Reread. Apply the CAS rules above. Ask the owner if the subject changed |
| 4 | Busy or recovery | Reread and retry once. If still busy, report not confirmed |
| 5 | Committed, projection or cleanup unfinished | Inspect the receipt and `context`. Report saved if committed, with repair pending. Do not call it unsaved. Repair only through the owner path |
| 6 | Partial all-scope coverage | Say which scopes were not covered |

## Pause: reporting

- Exit 0, or a replayed committed result, with `context` showing `paused`: saved.
- Exit 2, exit 3 after a reread still fails, or provenance cannot be established: **stopped here, pause not saved**, with the exact issue and fix. Keep this host stopped.
- Exit 4 after a retry: pause not confirmed. Keep this host stopped and inspect the operation before any other claim.
- Exit 5: the pause may already be committed. Check the receipt and `context`. If paused, report **saved, repair pending**, not unsaved.
