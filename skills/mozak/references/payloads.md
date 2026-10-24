# Request payloads (propose, revise, attach-spec, complete)

Decisions, deletes and observations need no request file: use the flag forms in `references/routes.md`. For the rest, every request is a closed JSON object `{operationId, scopeId, expected, action, payload}`. Copy an example and build it:

```
python3 {{MOZAK_SKILL}}/scripts/make_request.py <action> {{MOZAK_SKILL}}/examples/<action>.json --config INVENTORY --scope ID
node {{MOZAK_CLI}} <route> --config INVENTORY --scope ID --request <printed path>
```

`make_request.py` reads a fresh snapshot and makes a new `operationId`. Never hand-write `expected`.

| action | route | payload keys (all required unless marked) | example |
|---|---|---|---|
| propose | `mozak plan propose` | planId, content (+ optional distinctFromPlanIds) | `examples/propose.json` |
| revise | `mozak plan revise` | planId, pendingRevisionId, acceptedRevisionId, content (+ optional mergeFromPlanId) | content as in propose |
| attach-spec | `mozak spec attach` | planId, acceptedRevisionId, path, bounds{summary, limitations, allowedPaths, outcomeChecks[{outcomeId, criterion}] for every outcome, excludedActions}, discussionDigest | `examples/attach-spec.json` |
| complete | `mozak plan complete` | planId, revisionId (+ optional limitations) | |
| observe (rare: several evidence items) | `mozak observe --request` | planId, observation (+ optional reasoningLinks) | `examples/observe.json` |

`content` keys: title, purpose, outcomes[{id, statement, acceptance: objective|owner, criterion}], constraints[{id, text}], nonGoals[strings], rationale, questions[{id, text}], sources[{id, locator, anchor, observedAt, version, limitations}].

## Gotchas
- `stale-input`: rebuild with `make_request.py` and retry once. Resending the same request only replays its receipt.
- Several subagents writing to one scope race on the snapshot. Let only the parent write.
- `revise` output may carry `warnings`: accepted outcomes that need relinking and owner re-acceptance after approval. Tell the owner before asking for the approval.
- Approvals need Fabijan's own message. Never build one from a proposal.
