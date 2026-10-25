# Request payloads (propose, revise, save-discussion, attach-spec, complete)

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
| save-discussion | `mozak discussion save` | planId, acceptedRevisionId (or null), pendingRevisionId (or null), summary, stage (clarifying \| ready-for-spec), questions[{id (null for new), text, status (open \| answered \| deferred), answers[{summary, basis (owner \| inspection), ownerRef, ownerMessageAt, evidence[]}], reopenReason}] | `examples/save-discussion.json` |
| attach-spec | `mozak spec attach` | planId, acceptedRevisionId, path, bounds{summary, limitations, allowedPaths, outcomeChecks[{outcomeId, criterion}] for every outcome, excludedActions}, discussionDigest | `examples/attach-spec.json` |
| complete | `mozak plan complete` | planId, revisionId (+ optional limitations) | |
| observe (rare: several evidence items) | `mozak observe --request` | planId, observation (+ optional reasoningLinks) | `examples/observe.json` |

`content` keys: title, purpose, outcomes[{id, statement, acceptance: objective|owner, criterion}], constraints[{id, text}], nonGoals[strings], rationale, questions[{id, text}], sources[{id, locator, anchor, observedAt, version, limitations}].

### save-discussion rules
- The two revision IDs must match the plan right now (`plan show --json`), else `stale-reference`. After a revise, the pending ID changes.
- Resend every saved question each time, with the ID Core returned. Answers are append-only: keep earlier ones byte for byte.
- `owner` answers need `ownerRef` and a UTC `ownerMessageAt`. `inspection` answers need evidence (same shape as observe evidence) and null owner fields.
- `ready-for-spec` is refused while any question is `open`. `attach-spec` then needs the discussion's `discussionDigest` from `context --plan PLAN`.
- A discussion is advisory. It never approves anything.

### What `executionEligible` means
`plan show` and `context --plan` return `handoff.executionEligible`. It is true only when all of these hold: the owner approved implementation of the current accepted revision against the attached spec (`implementationAuthorized`), the plan is open (not completed or deleted), the spec file is still byte-identical to what was approved, the scope storage checked usable, and no material review is unresolved. If false, `handoff.reasons` lists why (for example `no-current-implementation-authorization`, `specification-changed`, `lifecycle-completed`). Only implement inside `handoff.bounds` when it is true.

## Write and git
A write reporting `committed` means the transaction reached `mozak.json` and `mozak.md` on disk. For a local or vault-plans scope that is not a git commit: the human output says `written ... not committed to git`. Add `--commit` to any write route to commit just those two files in the containing repo, then `pull --rebase` and push when the branch has an upstream (never forces, stops with `git-pull-conflict`, exit 5, on conflict). Repo-mode remote scopes always commit and push by themselves.

## Gotchas
- `stale-input`: rebuild with `make_request.py` and retry once. Resending the same request only replays its receipt.
- Several subagents writing to one scope race on the snapshot. Let only the parent write.
- `revise` output may carry `warnings`: accepted outcomes that need relinking and owner re-acceptance after approval. Tell the owner before asking for the approval.
- Approvals need Fabijan's own message. Never build one from a proposal.
