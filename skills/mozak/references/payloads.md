# Request payloads that work (tested on 0.3.0 and 0.4.1 schemas, 2026-10-21)

Every request is a closed JSON object: `{operationId, scopeId, expected, action, payload}`. An unknown key or a missing one is refused. Do not read `@mozak/core` source to learn shapes. Copy an example and build the request:

```
python3 {{MOZAK_SKILL}}/scripts/make_request.py <action> {{MOZAK_SKILL}}/examples/<action>.json --config INVENTORY --scope ID
node {{MOZAK_CLI}} <route> --config INVENTORY --scope ID --request <printed path>
```

`make_request.py` reads a fresh snapshot (`mozak context --json`, field `snapshot` = `{revision, graphHash, bridge}`) and makes a new `operationId`. Hand-writing `expected` was the main source of failed calls.

| action | route | payload keys (all required unless marked) | example |
|---|---|---|---|
| propose | `mozak plan propose` | planId, content (+ optional distinctFromPlanIds) | `examples/propose.json` |
| revise | `mozak plan revise` | planId, pendingRevisionId, acceptedRevisionId, content (+ optional mergeFromPlanId) | content as in propose |
| observe | `mozak observe` | planId, observation (+ optional reasoningLinks) | `examples/observe.json` |
| attach-spec | `mozak spec attach` | planId, acceptedRevisionId, path, bounds{summary, limitations, allowedPaths, outcomeChecks[{outcomeId, criterion}], excludedActions}, discussionDigest | `examples/attach-spec.json` |
| complete | `mozak plan complete` | planId, revisionId (+ optional limitations) | |

`content` keys: title, purpose, outcomes[{id, statement, acceptance: objective|owner, criterion}], constraints[{id, text}], nonGoals[strings], rationale, questions[{id, text}], sources[{id, locator, anchor, observedAt, version, limitations}].

## Gotchas (each one cost real sessions)
- `observation` is singular. `observations` is refused: `payload has unknown field "observations"`.
- Every `id` inside a plan must be unique across the plan, including evidence ids. Reusing `ev-1` in a second observation gives `duplicate-id`.
- An observed claim needs at least one evidence item. evidence needs all 8 keys: id, locator, anchor, version, inspectedAt, activity{kind: read|run, description}, result{verdict: pass|fail|not-assessed, summary}, limitations.
- A reasoning link to an outcome needs the plan's **accepted** revision id: `context.plans[].accepted.id`. Before the owner approves direction there is no accepted revision, so record the observation without `reasoningLinks` and link later.
- `stale-input` ("snapshot changed; reread before submitting a new operation"): rebuild with `make_request.py` (fresh snapshot, new operationId) and retry once. Sending the exact same request again only replays its receipt (`replayed`), it does not write twice.
- Several subagents writing to one scope race on the snapshot. Let only the parent write. Subagents return evidence text, the parent records it.
- For one plan read `mozak plans --scope ID --json` or `mozak review show --plan ID --json`. Full `mozak context` is about 40 KB on busy scopes and overflows tool output.
- Approvals (review decide) need Fabijan's own message. Never build one from a proposal.
