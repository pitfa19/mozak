# MOZAK quickstart

This guide creates a new MOZAK project and then introduces advanced Topics,
Scopes, and adapters. If someone else already onboarded the projects you need,
use the shorter [teammate quickstart](TEAMMATE-QUICKSTART.md) instead.

**Steps 1 to 3 take about fifteen minutes with a MOZAK-aware coding agent. Stop
there unless you want Topics, shared knowledge, and research adapters.**

| Steps | Time | You get |
|---|---|---|
| 1 to 3 | 15 min | An onboarded repository, accepted inputs, and a reviewable first plan |
| 4 to 6 | 10 min | A research Topic and a knowledge base holding both |
| 7 to 9 | 15 min | Path-free commands and a bound research adapter |

Every knowledge command here is offline and deterministic. The optional managed
launcher contacts GitHub only for checksum-verified tool updates. Nothing is
accepted into your knowledge base without you saying so.

## 1. Install

```bash
curl -fsSL https://raw.githubusercontent.com/pitfa19/mozak/main/scripts/install.sh | bash
mozak setup check "$HOME"
```

Install also places the MOZAK agent skill where your coding agents look for it:
`.agents`, `.jcode`, `.claude`, and `.codex`. `setup check` verifies that.

Channels, offline installation, update, rollback, and the safety boundary are
in [`distribution/INSTALL.md`](distribution/INSTALL.md).

## 2. Onboard a project

Run this inside any repository.

```bash
cd ~/code/notes-app
mozak project init .
```

```
{"state":"valid","created":[".mozak/project.yml",".mozak/idea.md"]}
```

Two files now exist. `project.yml` is the contract: project identity, the
repository revision, and the paths MOZAK owns. `idea.md` is the direction:
intent, desired outcomes, boundaries, assumptions, and open questions.

Edit `idea.md` to say what this project is actually for, then check it:

```bash
mozak project status .
mozak project overview .
```

## 3. Work on it

`overview` always tells you the next concrete step.

```
{"state":"incomplete","next_actions":["create and validate .mozak/planning/accepted-inputs.json"]}
```

You need two things: **accepted inputs**, the facts you have agreed are true,
and a **plan**, a goal DAG derived from them.

In practice you do not hand-write either. Ask your agent, which has the MOZAK
skill installed. MOZAK currently validates and selects from planning artifacts;
it does not expose a public command that authors or accepts them for you:

> "Read my idea.md and propose accepted inputs and a first plan."

It writes the files and you approve them. The exact shapes are below, so you
can check what it produced or write them yourself.

<details>
<summary>The two file formats (click to expand)</summary>

`.mozak/planning/accepted-inputs.json`

```json
{
  "contract_version": 1,
  "id": "inputs-2026-09-06",
  "accepted_at": "2026-09-06T12:00:00Z",
  "inputs": [
    {
      "id": "input-search",
      "text": "Users need to find a note by its title.",
      "provenance": {"kind": "human_decision", "decision_id": "dec-001", "actor": "owner"}
    },
    {
      "id": "input-store",
      "text": "The repository has no storage layer yet.",
      "provenance": {
        "kind": "codebase_observation",
        "observation_id": "obs-001",
        "repository_revision": "<git rev-parse HEAD>",
        "paths": ["README.md"]
      }
    }
  ]
}
```

Every goal cites the inputs that justify it, so no goal can appear from
nowhere.

`.mozak/planning/plans/plan-notes-v1.json`

```json
{
  "contract_version": 1,
  "id": "plan-notes",
  "version": 1,
  "input_set_id": "inputs-2026-09-06",
  "goals": [
    {"id": "goal-store", "version": 1, "title": "Add a note storage layer",
     "status": "ready", "priority": 1, "input_ids": ["input-store"], "recovery_attempts": 0},
    {"id": "goal-search", "version": 1, "title": "Search notes by title",
     "status": "planned", "priority": 2, "input_ids": ["input-search"], "recovery_attempts": 0}
  ],
  "dependencies": [
    {"goal_id": "goal-search", "depends_on_goal_id": "goal-store",
     "provenance": {"kind": "declared", "input_ids": ["input-store"]}}
  ],
  "recovery": {"max_attempts_per_goal": 2, "allowed_failed_transition": "blocked"}
}
```

</details>

Then ask what is ready to work on:

```bash
mozak planning next .mozak/planning/accepted-inputs.json .mozak/planning/plans/plan-notes-v1.json
mozak project overview .
```

```
{"state":"valid",
 "ready_goals":[{"id":"goal-store","version":1,"title":"Add a note storage layer","status":"ready","priority":1}],
 "next_actions":["prepare bounded execution for ready goal goal-store"]}
```

`goal-search` is not ready because it depends on `goal-store`. That is the
point: the dependency is declared and checked, not remembered.

Hand `goal-store` to your coding agent. The project plan and repository commit
record what changed. `mozak execution validate` is retained only for legacy
Execution Bundles and is not the completion path for current projects.

**This is a good place to stop.** You have a repository whose plan survives a
new session. Steps 4 onward add research Topics and a knowledge base spanning
several projects, which matter once you have more than one.

## 4. Open a research topic

A **Topic** is a Scope for something you are learning rather than building.

```bash
mozak scope init ~/mozak-kb/topics/rust-async \
  topic-rust-async \
  "Rust async runtimes" \
  "Track how async runtimes trade latency against complexity, keeping candidates proposal-only."
```

```
{"state":"valid","scope_id":"topic-rust-async","kind":"topic"}
```

The Topic starts empty on purpose. It has an identity and a stated intent, and
no evidence yet.

## 5. Group related work in one Scope root

A Scope root is a directory with one `scope.json`, and it can hold **many**
Scope entries. That is how a family of related projects and topics shares one
manifest, one evidence store, and one history.

```bash
ROOT=~/mozak-kb/topics/rust-async

# Another topic in the same root.
mozak scope add-topic $ROOT topic-rust-tracing "Rust tracing" \
  "Track how tracing and metrics interact with async runtimes."

# A real repository, bound as a project Scope.
# The Scope id must equal the project id in .mozak/project.yml.
mozak scope add-project $ROOT notes-app "Notes app" \
  "The app where async findings get applied." ~/code/notes-app

# One advisory goal over all of them.
mozak scope add-goal $ROOT meta-goal-async-adoption \
  "Apply async runtime findings to the notes app" \
  topic-rust-async topic-rust-tracing notes-app

mozak scope list $ROOT
```

`add-project` copies `.mozak/project.yml` into the Scope root, pins its
SHA-256, and mirrors the revision and owned paths the manifest declares. The
repository stays authoritative; the copy lets the Scope verify itself, and if it
drifts, validation fails closed.

A Meta Goal is always `advisory_only`. Goals may overlap freely because they
coordinate without granting authority.

Every authoring command validates the whole root afterward and rolls back on
failure, so a rejected edit never leaves a half-written Scope behind.

## 6. Register it in your knowledge base

The KB registry is your index of Scopes.

```bash
mozak kb register ~/mozak-kb topic-rust-async ~/mozak-kb/topics/rust-async
mozak kb list ~/mozak-kb
mozak kb tree ~/mozak-kb
```

```
{"state":"valid","registration_count":1,
 "authority":"registration records a location only; it transfers no trust or truth"}
```

Registration pins the exact manifest hash. If the Scope changes underneath,
MOZAK reports drift rather than pretending nothing happened.

When you deliberately edit a registered Scope, move the pin:

```bash
mozak kb repin ~/mozak-kb topic-rust-async ~/mozak-kb/topics/rust-async
```

`repin` records the newly observed hash and nothing else. It refuses an invalid
Scope, so a broken Scope can never be pinned as good.

## 7. Tell MOZAK which knowledge base is yours

The steps so far took explicit paths. To let MOZAK resolve your KB on its own,
register it once. This is deliberately a three-step, owner-approved flow:
propose, review the exact delta, then approve it.

```bash
# 1. Propose. This scans only the roots you name and mutates nothing.
mozak project discover ~/mozak-kb ~/code/notes-app > discovery.json

# 2. Review the exact delta before anything changes.
mozak project review discovery.json
```

```
{"action":"refresh","additions":["notes-app"],"removals":[],"kb_changed":true,
 "proposal_digest":"9c3004e4...","target_config_path":"~/.config/mozak/config.json"}
```

**Read `removals` before you go further.** Discovery is a whole-list
replacement, not a merge, so a project you already registered but did not name
on this command line appears as a removal. If `removals` is not empty and you
did not intend it, name every workspace root you want kept and run `discover`
again. `review` exists precisely so this is visible before anything changes.

If `action` is `none`, you are already registered and there is nothing to
approve. Stop here.

Write an approval that pins that exact digest and target:

```json
{
  "schema_version": 1,
  "decision": true,
  "proposal_digest": "<proposal_digest from review>",
  "target_config_path": "<target_config_path from review>",
  "owner": "you",
  "approved_at": "2026-09-06T12:00:00Z",
  "rationale": "Register the notes-app project and my knowledge base."
}
```

```bash
mozak project register discovery.json approval.json
```

Now `mozak kb list` and `mozak project context notes-app` work without paths.
Use `mozak project refresh` later when pins change.

## 8. Research the topic

MOZAK never touches the network. An **adapter** does the fetching outside
MOZAK, and MOZAK validates the snapshot it recorded.

```bash
mozak adapter catalog
```

Write a request describing what you care about, as named interest clusters:

```json
{
  "schema_version": 1,
  "scope_id": "topic-rust-async",
  "weeks": 2,
  "clusters": [
    {"name": "runtimes", "terms": ["async runtime", "scheduler", "work stealing", "executor"]},
    {"name": "latency", "terms": ["tail latency", "throughput", "concurrency"]}
  ],
  "max_records": 50,
  "question": "Which curated papers relate to async runtime design and latency?"
}
```

Bind it once, then it is callable. Step 7 is a prerequisite: setup resolves the
target Scope through your configured KB and refuses a Scope that is not
registered there.

```bash
mozak adapter setup dair-ai rust-async-dair topic-rust-async \
  ~/mozak-kb/rust-request.json \
  /path/to/mozak/scripts/adapters/dair_weekly.sh \
  ~/mozak-kb/runs

mozak adapter list
mozak adapter run rust-async-dair
```

The runner path is a real script from a MOZAK checkout, so give it in full.
Setup pins the request and runner by SHA-256. If either changes, the binding
becomes non-callable instead of silently running something else, and
`mozak adapter recheck rust-async-dair` re-pins it after a deliberate edit.

The run produces a validated research run: paper titles, links, matched
clusters, and exact source provenance. It is **proposal-only**. Nothing entered
your Topic yet.

Accept what you actually want with `mozak scope ingest-links`, which applies an
owner-approved plan and writes a new validated Scope root.

## 9. See the whole picture

```bash
mozak scope list ~/mozak-kb/topics/rust-async
mozak scope graph ~/mozak-kb/topics/rust-async
mozak kb tree ~/mozak-kb
mozak project context <project-id>
mozak project refresh history
```

`project context` is the command to give a fresh agent. `project current` is the bounded read-only current-state view: goal state, adapter freshness, newest proposal-only research, superseded artifacts, and the next owner decision. `project browse <project-id>` lists the bounded configured records behind that view. `project resolve <project-id> <record-id>` follows only declared Stage 1 projection relationships and refuses stale or undeclared records. `project why <project-id> <record-id>` explains inclusion, freshness, authority, and blocking conditions, including why a newer DAIR run supersedes an older recorded run without accepting either. These commands label latest recorded, latest observed, and accepted separately, do not scan arbitrary files, do not dump note bodies, and do not transfer trust or promote research. `project context` reports the current
idea, latest plan, ready goals, and next actions in one JSON payload.
It may also repair valid pin-only drift for that exact registration. This uses
an exclusive lock and config digest check, records tamper-evident history, and
never scans. Membership, roots, KB pins, names, and manifest authority still
need explicit reviewed approval. A preserved identity-equivalent generation can
be restored with `mozak project refresh rollback <config-sha256>`.

## The rule behind all of it

Anything from outside is a proposal. Anything accepted is pinned by hash. Any
change to accepted state is an explicit decision by you.

That is why MOZAK can be trusted with long-running work: it never quietly
changes what you agreed was true.

## Next steps

- [`MODULES.md`](MODULES.md) for the six modules and where each came from.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) for the layers and trust boundaries.
- [`WHY-MOZAK.md`](WHY-MOZAK.md) for the product rationale.
- [`distribution/INSTALL.md`](distribution/INSTALL.md) for release installation.
