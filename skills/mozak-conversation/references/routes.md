# CLI routes for this skill

Every command uses the full built path. Never the bare `mozak` command:

```
node /home/pitfa/Documents/mozak-v1/packages/cli/dist/index.js <route> --config INVENTORY --scope ID [flags]
```

Run `node /home/pitfa/Documents/mozak-v1/packages/cli/dist/index.js --help` first. If a route is missing, stop.

## Read

| Command | Use |
|---|---|
| `node /home/pitfa/Documents/mozak-v1/packages/cli/dist/index.js context --config INVENTORY --scope ID --json` | Direction, lifecycle, handoff, `permittedNextAction` |
| `node /home/pitfa/Documents/mozak-v1/packages/cli/dist/index.js plans --config INVENTORY --scope ID --json` | Plan list |
| `node /home/pitfa/Documents/mozak-v1/packages/cli/dist/index.js review show --config INVENTORY --scope ID --plan PLAN [--purpose P] [--outcome ID] --json` | Review subject for one decision |
| `node /home/pitfa/Documents/mozak-v1/packages/cli/dist/index.js check --config INVENTORY --scope ID --json` | Findings. Never repairs. |

`review show` purpose rules, checked on the built CLI:
- Pending direction: `--purpose` may be omitted (defaults to `approve-direction`).
- Accepted-only plan: `--purpose` is required, or the call returns `invalid-payload`.
- Purposes: `approve-direction`, `reject-pending`, `reconsider`, `pause`, `resume`, `approve-implementation`, `revoke-implementation`, `accept-outcome` (needs `--outcome`).

## Agent writes (advisory, grant nothing)

Request file, written as data (not inline JSON):

```json
{ "operationId": "unique-id", "scopeId": "ID", "expected": { ...from context snapshot... }, "action": "ACTION", "payload": { ... } }
```

| Command | Action | Effect |
|---|---|---|
| `node /home/pitfa/Documents/mozak-v1/packages/cli/dist/index.js discussion save --config INVENTORY --scope ID --request FILE` | `save-discussion` | Clarification checkpoint |
| `node /home/pitfa/Documents/mozak-v1/packages/cli/dist/index.js spec attach --config INVENTORY --scope ID --request FILE` | `attach-spec` | Spec file descriptor |

## Owner decisions (host persists only after a real owner message)

`node /home/pitfa/Documents/mozak-v1/packages/cli/dist/index.js review decide --config INVENTORY --scope ID --request FILE`

Payload for every decision: `planId`, `revisionId`, `reviewDigest`, `ownerRef`, `ownerMessageAt`, `reason`.
- `revisionId` and `reviewDigest` come from `review show` for that same purpose, read just before the decision.
- `action` is one of: `approve-direction`, `pause`, `resume`, `approve-implementation`, `revoke-implementation`, and others from the `review show` list.
- Implementation approval also needs `specificationId`. Revocation needs `authorizationId`.
- `ownerRef` and `ownerMessageAt` are the real owner message reference and time. Never invent them.

Synthetic automated command smoke test (scratch scope `/home/pitfa/.jcode/scratch/p2-verify`, fixture owner ref `scratch-verification-fixture`, not a real owner): `review decide` with action `pause` committed. A fresh `context` then showed `lifecycle.state: paused`, `permittedNextAction: owner-resume`, and `executionEligible: false`. This is CLI mechanics only. It is not a live owner pass for B08 or B14.

## Stale input: how to recover

`stale-input` (exit 3) means the request `expected` block (revision, graphHash, or bridge sha256) no longer matches the store. Synthetic smoke test: the write is refused and nothing commits.

Rules after a conflict:
- Reread `context --json`, rebuild `expected` from its `snapshot`, rebuild the review subject, then show the owner the current state.
- Do not resubmit the old request. Do not reuse its `operationId`.
- An owner decision (`review decide`) needs a fresh owner message that answers the newly displayed review. An earlier "yes" given against the old subject is not consent to the new one. Ask again.
- Agent writes (`discussion save`, `spec attach`) may be resubmitted with a new `operationId` only after the reread, and only if the content still reflects the current state.

## Plan completion

`plan complete`, request `action: "complete"`, payload `{ planId, revisionId }`. `revisionId` must be the accepted revision.
- Synthetic smoke test (scratch, fixture owner ref): on a paused plan, refused with `invalid-lifecycle` (exit 3). Resume first, with owner confirmation.
- Code-read only, not run live: an awaiting pending revision is refused with `owner-review-required`, and an open plan with the accepted revision is expected to commit. Do not claim either until a live run confirms it.

## Question IDs and history

Synthetic smoke test in scratch with a fixture question (not an owner conversation):
1. A new question with `"id": null` is saved. Core assigns the ID, returned in `result.discussion.questions[].id`.
2. Reuse that returned ID to add an answer. The question ID stays the same, the answer is appended, and `reopenings` stays empty.
3. Never invent a question ID. A string ID must match an existing question.
4. A settled question moved back to open needs a non-empty `reopenReason`. Core then appends a reopening record and keeps prior answers.

## Exit codes

| Code | Meaning | Host action |
|---|---|---|
| 0 | Success | Continue |
| 2 | Invalid or unavailable | Report cause, stop that step |
| 3 | Stale, conflict, or owner review needed | Reread, rebuild the request, then ask the owner if still needed |
| 4 | Busy or recovery | Retry once after rereading, then report |
| 5 | Committed with unfinished projection or cleanup | Report as committed. Do not ask for duplicate approval |
| 6 | Partial all-scope coverage | Say which scopes were not covered |

## Pause: when to report "not saved"

Report **stopped here, pause not saved** only if `review decide` with action `pause` returns a real failure (exit 2, 3 after a reread still fails, or the owner ref/time cannot be established). Name the exact issue and the fix.
