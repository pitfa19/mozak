# MOZAK

Run this before researching, planning, editing, or answering anything:

```bash
mozak project context mozak      # this repo's id is `mozak`
```

Then use [`docs/REFERENCE.md`](docs/REFERENCE.md) to turn any request into
the right command.

MOZAK holds the durable state around agent work: what this project is, what
evidence exists, what was decided, and what was actually observed.

## Rules for using context

Use only the exact registration, drift report, ready goals, and validated
context-note paths it returns. Do not guess a project id, fuzzy-match it, or
scan the filesystem. If the id is unknown, run `mozak project list`.

## The rule everything follows

> Anything from outside is a proposal. Anything accepted is pinned by hash.
> Any change to accepted state is an explicit decision by the owner.

Read-only routes stay read-only even when they reveal work to do.

## Before any mutation

Registering, refreshing, importing, releasing, and scope authoring are
mutations. For each one:

1. Run the matching status, overview, or validate route first.
2. Summarise the exact files, state, and output path that would change.
3. Wait for explicit owner acceptance. A vague request for status or "what
   next?" is not acceptance.
4. Never overwrite an existing file or accepted state. Choose a new output path
   or stop and ask.

An approval artifact is required where the contract asks for one. Never create,
guess, or infer that approval.

## Never claim

- Autonomous background work, self-modification, or hidden ingestion.
- A web dashboard or hosted registry. There is none.
- Networking from the core binary. Only adapters and the update launcher touch
  the network, and each declares its effects.
- That registering, importing, or reading something makes it true.

## The six modules

`scope`, `research`, `plans`, `meta-kb`, `improve-lab`, `skill`. Run
`mozak lab modules` for each id, its one-line summary, and the source files it
governs. That list is the architecture and the Lab target list at once, so a
change to one changes both.

A change that moves a file between modules must update `Module::source_areas`
in `crates/mozak-core/src/lab.rs`. `scripts/check_docs_match_binary.py` fails
CI when a doc claims a module count, id, or diagram the binary does not have.

## Working on the code

```bash
cargo test --workspace
cargo clippy --all-targets -- -D warnings
cargo fmt --all -- --check
python3 scripts/validate_m0.py
python3 scripts/check_docs_match_binary.py
./scripts/verify_phase1_slice.sh
```

CI runs the same set. A change to a contract must change its specification
under `spec/` in the same commit.

Rust lives in `crates/mozak-core` (contracts) and `crates/mozak-cli` (routes).
Adapters are Python under `scripts/adapters/` and stay proposal-only.

## Map of the docs

| For | Read |
|---|---|
| The six modules and their provenance | [`docs/MODULES.md`](docs/MODULES.md) |
| A command for a request, and its exact contract | [`docs/REFERENCE.md`](docs/REFERENCE.md) |
| How it is built | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| First run end to end | [`docs/QUICKSTART.md`](docs/QUICKSTART.md) |

Exit codes: `0` valid, `2` incomplete, `3` invalid, `1` bad invocation. A
non-zero exit is a result to report honestly, not a problem to work around.
