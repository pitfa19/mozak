---
name: mozak
description: Operate MOZAK projects, feature records, Scopes, the KB registry and local Meta KB through the current local CLI. Use for any "work on PROJECT", project status, context, onboarding, registration, feature tracking, release, cross-project Concepts, notes links, research evidence, Meta KB tree or graph request. Every use loads i-have-adhd, reads project context, and checks the explicit tool stack (arXiv, Zotero, Overleaf, Fetch, GitHub) only for the applicable use case.
---

# MOZAK

MOZAK keeps the durable state around agent work: what a project is, what was
decided, what evidence exists, and which ideas can move between projects. It
is the project memory and the proof. Day-to-day feature work runs through the
Pocock flow (`/grill-me`, `/to-spec`, `/to-tickets`, `/implement`,
`/code-review`), and MOZAK records each finished feature.

Natural language is the user interface. Translate the request into the smallest current MOZAK command, inspect its result, and answer with terminal bullet lists or a `Termaid` diagram. Never direct the user to a web dashboard.

## Every MOZAK use starts the same way

1. Load the `i-have-adhd` skill and keep its output rules on.
2. For every fresh project request, first run `mozak project context PROJECT_ID`. Resolve exact registered IDs only. Do not guess, fuzzy-match, or scan. If the id is unknown, run `mozak project registrations`.
3. Run `mozak stack check HOME baseline`. When the request matches a specialized use case, run `mozak stack recommend USE_CASE` first, then `mozak stack check HOME USE_CASE`, and use only the tools that check reports ready. With no specialized match, `baseline` alone applies; do not activate every tool.

The CLI checks files, hashes and recorded evidence. It cannot force an agent to follow these rules. Following them is the agent's job.

## Tracking work: feature records

One feature record per finished, user-visible feature. A plan is one feature.

1. Design: `/grill-me`, then `/to-spec`. Start the record: `mozak feature new ROOT FEATURE_ID TITLE [SPEC_URL]`.
2. Split: `/to-tickets`. Save each issue's text under `.mozak/evidence/FEATURE_ID/issues/`, then `mozak feature ticket ROOT FEATURE_ID ISSUE_URL [SNAPSHOT_PATH]`.
3. Build: `/implement` and `/code-review` per ticket. Pin the ticket snapshot when it is done.
4. Finish: pin acceptance evidence with `mozak feature evidence ROOT FEATURE_ID PATH`, then `mozak feature close ROOT FEATURE_ID done`. Use `dropped` to abandon.

Every change writes a new create-only version file that pins the previous one. A closed feature is final. A new version of the same feature is only for an owner-approved scope change. New work is a new feature. MOZAK never fetches issues: you save the text, MOZAK pins the bytes.

Legacy goal-DAG plans stay readable. `mozak planning next ACCEPTED_INPUTS_JSON PLAN_JSON` is deprecated and only reads old plans.

## Owner-approved work completion

When the owner approves a sequence, plan, batch or checklist, keep the whole original scope until each requirement has current evidence or the owner changes it. A passing milestone is not completion. Never silently cancel, defer or narrow agreed work. Keep working on every safe, authorized branch while another waits for approval. A forced stop is reported as incomplete, with the open items and how to resume. Track this in the todo list or a feature record; no separate skill is needed.

## Mutation safety

Read-only routes stay read-only even when they reveal work to do. Before every mutation, run the matching status, overview or validate route, summarize the exact files and state that would change, and wait for explicit owner acceptance. A vague request for status or "what next?" is not acceptance. Never overwrite an existing file or accepted state; choose a new output path or ask. An approval artifact is required where the contract asks for one; never create, guess or infer it. Registration and refresh follow `project discover`, then `project review`, then an owner approval pinned to the review digest. Full rules: `reference/routes.md`.

## Load a reference file when you need it

All paths are relative to this skill directory. Each file holds the full, unabridged rules for its area.

| Need | Read |
|---|---|
| Exact route, setup, update, project context rules, registration, remote-only projects (`register-remote`, `fetch`, `prune`) | `reference/routes.md` |
| Papers, references, manuscripts, tooling watch, deep research, recording MCP evidence | `reference/tool-stack.md` |
| Cross-project Concepts and Translations, KB registry, Meta KB, notes links | `reference/knowledge.md` |
| Mapping a request to a route | `reference/examples.md` |
| Improve Lab, knowledge packages, package import, legacy execution bundles (frozen) | `reference/frozen.md` |

## MCP transport

- Prefer the installed `mozak-mcp` stdio server when the agent host supports MCP. Its managed descriptor is `mcp.json` in this skill directory.
- Use its closed typed tools for project context, project overview, project validation, KB tree, and legacy next-goal recommendation.
- Fall back to the `mozak` CLI for unsupported tools, mutations, or hosts without MCP. MCP does not weaken any approval, trust, or fail-closed boundary.

## Command runner

- Prefer `mozak ...` only when `mozak --help` or its usage shows the requested route.
- If `mozak` is absent or the route is unavailable, inspect `mozak --help`/usage, then run the repository implementation as `cargo run -q -p mozak-cli -- ...` from the MOZAK source tree.
- Map only to implemented, current routes. Do not invent flags, subcommands, services, or state transitions.

## Human output

Lead with the action or finding. Number steps. Restate where the work stands every turn. End with one concrete next step. Cap lists at five items. Report failures as cause then fix. No preamble, recap or closing pleasantry. For relationships, run a `graph` route and show the Termaid output in a fenced `text` block; never present Mermaid source as rendered. Never promise a web dashboard, background work, hidden ingestion, or self-modification.
