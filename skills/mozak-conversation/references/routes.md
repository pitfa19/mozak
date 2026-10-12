# CLI routes for this skill

All routes need `--config FILE`. Run `node packages/cli/dist/index.js --help` first. If a route is missing, stop.

## Read

| Route | Use |
|---|---|
| `mozak context --config FILE --scope ID [--json]` | Accepted and pending direction, decisions, next permitted action |
| `mozak plans --config FILE --scope ID [--json]` | Plan list for the overview |
| `mozak review show --config FILE --scope ID --plan ID [--purpose P] [--outcome ID] [--json]` | Review subject for one plan |
| `mozak check --config FILE --scope ID [--json]` | Findings. Never repairs. |

`--purpose` accepts `approve-implementation` and `revoke-implementation` for the grant review.

## Agent writes

Request file = mutation envelope: `{ operationId, scopeId, expected, action, payload }`. The file is data, not inline JSON.

| Route | Operation | Effect |
|---|---|---|
| `mozak discussion save --config FILE --scope ID --request FILE` | `save-discussion` | Advisory clarification checkpoint. Grants nothing. |
| `mozak spec attach --config FILE --scope ID --request FILE` | `attach-spec` | Records a spec file descriptor. Grants nothing. |

Status: these routes exist in the CLI. The core operations are still landing, so the core may refuse them. If a call refuses, report the refusal and stop. Do not retry with other flags.

## Owner-only

| Route | Notes |
|---|---|
| `mozak review decide --config FILE --scope ID --request FILE` | Owner only. This host must never run it as the owner. |

## Exit codes

| Code | Meaning | Host action |
|---|---|---|
| 0 | Success | Continue |
| 2 | Invalid or unavailable | Report cause, stop that step |
| 3 | Stale, conflict, or owner review needed | Re-read context, then ask the owner |
| 4 | Busy or recovery | Retry once after re-reading, then report |
| 5 | Committed but projection or cleanup unfinished | Report as committed. Do not ask for duplicate approval |
| 6 | Partial all-scope coverage | Say which scopes were not covered |

## Pause gap

No agent route persists a pause. `review decide` is owner-only. Until an agent pause route exists, a clear pause stops the host and is reported as **stopped here, pause not saved**.
