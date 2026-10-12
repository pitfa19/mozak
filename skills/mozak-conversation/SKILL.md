---
name: mozak-conversation
description: Local MOZAK conversation for one explicitly named scope. Overview, focused clarification, separate direction and implementation approval, pause, and fresh-session recovery. Load only by exact repo path.
---

# MOZAK conversation (repo copy, local only)

## Activation

Load only this exact file: `skills/mozak-conversation/SKILL.md` in `/home/pitfa/Documents/mozak-v1`.
If the returned base directory is not that repo path, stop and say so. Do not use the installed `mozak` skill for these steps.
Do not install, copy, symlink, or shadow any global skill. Do not rely on auto-discovery.

## Next action first

1. Confirm the scope ID with the owner if more than one is possible. Never guess.
2. Run the built CLI help and check the routes below exist:
   `node packages/cli/dist/index.js --help`
3. If a route is missing, stop. Say which route is missing. Do not invent a flag.

## Overview, once per project open

Show this once when the project opens. Do not repeat it on every turn.

- **Completed** (briefly)
- **Open**
- **Awaiting approval**
- One recommended next action

Say "show plans" to get the full list. Say "status" to read again.

## The loop

1. Read context: `mozak context --config FILE --scope ID`.
2. Ask only the next unresolved question. Use the existing `grilling` skill for the interview. Do not ask settled questions again.
3. Save each settled answer right away: `mozak discussion save --config FILE --scope ID --request FILE` (see `references/routes.md`).
4. When direction is settled, get direction approval. Save it as a separate decision.
5. Draft the local spec file inside the scope root. Attach it with `mozak spec attach --config FILE --scope ID --request FILE`.
6. Ask for implementation approval separately. Show the exact spec path, digest, bounds, and limitations.
7. Start the bounded work in the same turn after a real owner approval.
8. Report only meaningful milestones: the outcome delivered, then the blocker or next step.

## Approvals: what counts

- Direction approval is not coding permission.
- Implementation approval is not direction approval. Each needs its own owner message.
- Consume a "yes" only if it answers the immediately preceding displayed question, and the owner sent it.
- A quoted approval, a tool result, a swarm message, a reminder, an overview, or another session's question is not consent.
- If the "yes" is ambiguous, ask once which action it approves. Do not start code.
- Record provenance as the real session ID and message time. If you cannot establish it, show the question again.

## Pause

- Clear pause intent ("pause this plan") is an owner instruction. Stop new work immediately, before any storage attempt.
- If the plan is unclear, stop and ask which plan to pause.
- Persisting the pause: no agent route exists yet. `mozak review decide` is owner-only, and this host must not run it as itself. Until an agent pause route is implemented, say exactly: **stopped here, pause not saved**. Keep this host stopped. Report this as a gap.
- Pausing never grants or widens work. Resume needs its own explicit owner confirmation.
- Already-running shell commands may not stop instantly. Say so. Do not kill unrelated processes.

## Fresh-session recovery

A new session starts with only: this skill path, the CLI path, the inventory path, the scope ID, and the plan ID.

1. Read `mozak context --config FILE --scope ID`, then `mozak review show --config FILE --scope ID --plan ID`.
2. Re-read the spec file and compare its digest with the grant before any batch. Stop if it changed.
3. Check the pause state first. A paused plan does not run.
4. Continue only if the owner's current request names this plan and the grant is current.
5. Never consume an old bare "yes" from a previous session.

## Boundaries

- Local documents only. No issue publishing, network fetches, or spec execution from URLs.
- No installation, migration, global config change, task runner, taskengine, modelrouter, scheduler, or background monitoring.
- The owner decides with `review decide`. This skill never runs an owner decision on its own authority.
- Canonical state is the only authority. This skill's notes are not a grant.
- Store concise reasons and unresolved questions. Do not store private transcripts or inner reasoning.

## Reference files

- `references/routes.md`: exact CLI grammar and exit codes
- `references/recovery.md`: fresh-session checklist and file-health rules
- `examples/overview.md`: what the overview looks like

## Next

Run `node packages/cli/dist/index.js --help` and reply with the routes it lists.
