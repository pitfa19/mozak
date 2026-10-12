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

Verified on a scratch scope: `review decide` with action `pause` committed. A fresh `context` then showed `lifecycle.state: paused`, `permittedNextAction: owner-resume`, and `executionEligible: false`.

## Stale input: how to recover

`stale-input` means the request `expected` block (revision, graphHash, or bridge sha256) no longer matches the store. Reread `context --json`, rebuild `expected` from its `snapshot`, rebuild the review subject, then resubmit with a new `operationId`. Do not reuse the old one.

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
