# CLI routes for this skill

Every command uses the full built path. Never the bare `mozak` command:

```
node {{MOZAK_CLI}} <route> --config INVENTORY --scope ID [flags]
```

Run `node {{MOZAK_CLI}} --help` at session start. If a route is missing, stop.

## Read

| Command | Use |
|---|---|
| `node {{MOZAK_CLI}} context --config INVENTORY --scope ID --brief --json` | Session-start overview: plan IDs, titles, lifecycle, revision IDs, pending review state, handoff blockers, next action, full CAS `snapshot`; no content/evidence/history/bounds |
| `node {{MOZAK_CLI}} context --config INVENTORY --scope ID --plan PLAN --json` | Exact plan's full recovery context and bounds; use before work and after stale conflicts |
| `node {{MOZAK_CLI}} context --config INVENTORY --scope ID --json` | Backward-compatible full context for all plans, including history |
| `node {{MOZAK_CLI}} plans --config INVENTORY --scope ID --json` | Plan list |
| `node {{MOZAK_CLI}} review show --config INVENTORY --scope ID --plan PLAN [--purpose P] [--outcome ID] --json` | Review subject for one decision |
| `node {{MOZAK_CLI}} check --config INVENTORY --scope ID --json` | Findings. Never repairs. |

`review show` purposes:
- Pending direction: `--purpose` may be omitted (defaults to `approve-direction`).
- Accepted-only plan: `--purpose` is required, or the call returns `invalid-payload`.
- Values: `approve-direction`, `reject-pending`, `reconsider`, `pause`, `resume`, `approve-implementation`, `revoke-implementation`, `accept-outcome` (needs `--outcome`).

## Agent writes (advisory, grant nothing)

Request file, written as data. Envelope:

```json
{ "operationId": "unique-id", "scopeId": "ID", "expected": { "revision": "...", "graphHash": "...", "bridge": { "exists": true, "sha256": "..." } }, "action": "ACTION", "payload": { } }
```

`expected` is the `snapshot` of a fresh context read (every form returns the same whole-scope snapshot). `--brief --plan PLAN` returns one plan's summary (not enough to start execution: read `--plan PLAN` for bounds). Unknown plan IDs return `plan-not-found`.

| Command | Action |
|---|---|
| `node {{MOZAK_CLI}} plan propose --config INVENTORY --scope ID --request FILE` | `propose` (optional `distinctFromPlanIds` when owner confirmed a separate plan despite overlap) |
| `node {{MOZAK_CLI}} plan revise --config INVENTORY --scope ID --request FILE` | `revise` (optional `mergeFromPlanId` to fold a duplicate non-completed plan into `planId` on `approve-direction`) |
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

`node {{MOZAK_CLI}} review decide --config INVENTORY --scope ID --request FILE`

Payload for every decision: `planId`, `revisionId`, `reviewDigest`, `ownerRef`, `ownerMessageAt`, `reason`.
- `revisionId` and `reviewDigest` come from `review show` for the same purpose, read just before the decision.
- Action values: `approve-direction`, `pause`, `resume`, `approve-implementation`, `revoke-implementation`, `reject-pending`, `reconsider`, `accept-outcome`.
- `approve-implementation` also needs `specificationId`. `revoke-implementation` needs `authorizationId`.

### Deleting plans (owner)

`node {{MOZAK_CLI}} plan delete --config INVENTORY --scope ID --request FILE`

Removes plans so they no longer exist in `mozak.json` or `mozak.md`. Use it only when the owner asks, in their own message, to delete named plans. Request (not the mutation envelope):

```json
{ "operationId": "unique-id", "scopeId": "ID", "expected": { "...": "fresh snapshot" }, "planIds": ["plan-a"], "reason": "why", "ownerRef": "owner message provenance", "ownerMessageAt": "2026-01-01T00:00:00.000Z" }
```

- Optional `"allowCompleted": true` is needed to delete a completed plan. Never add it unless the owner says the completed plan should go too.
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

## Review digest and CAS: what can be reused

Receipt replay runs before the CAS check. An identical retry returns the committed result. A same-operation ID with different input is refused with `operation-conflict` (exit 3).

After `stale-input` (exit 3), reread with `node {{MOZAK_CLI}} context --config INVENTORY --scope ID --plan PLAN --json` and decide:
- Same subject: scope, plan, purpose, relevant revision and content digest, specification and bounds digest, and authorization identity all match, and `reviewDigest` and `revisionId` match the displayed subject. The owner's still-unconsumed confirmation for that exact subject may be reused with a fresh `expected` block and a new `operationId`. Storage revision and projection bytes are not part of the subject.
- Changed subject or purpose: redisplay and get fresh owner confirmation. Never retarget with an old "yes".

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
