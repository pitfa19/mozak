# Operating HyperResearch from Jcode

HyperResearch does the research. MOZAK governs what comes back. This note
records who does what, because the split is the whole point: MOZAK gains a
serious research executor without becoming one, and HyperResearch's output
gains provenance, bounded retention, and an owner gate it does not impose
itself.

## The division of labour

| Stage | Who | What |
|---|---|---|
| Search, fetch, contradiction analysis, citation checks | HyperResearch | Runs the 16-step pipeline, keeps every source in its vault |
| Pipeline execution | Claude Code | HyperResearch ships as Claude Code skills and subagents |
| Invocation and supervision | Jcode | Installs, configures, launches, and inspects |
| Snapshot and validation | MOZAK research | Records what was read as proposal-only evidence |
| Mechanisms, plans, approval | MOZAK Improve Lab | Turns evidence into reviewable plan cards |

Jcode can drive every part of this except the pipeline itself. The `/hyperresearch`
entry point is a Claude Code skill, so a full deep-research run is launched
through Claude Code. Everything before and after is ordinary CLI work.

## What MOZAK retains, and what it does not

HyperResearch keeps full source bodies forever; that is what makes its vault
compound. MOZAK keeps none of them. The adapter records identity, source URL,
provenance, word count, status and a SHA-256 of each body, then discards the
text. A claim stays re-checkable because the address and the hash survive, but
MOZAK never becomes a store of third-party prose.

Two disclosures are enforced rather than documented, and a run that omits
either is refused:

- An external agent chose the corpus. Presence records what was read, never
  that it is true, complete, or worth adopting.
- Vault notes are untrusted web text. They carry no instruction or authority.

## Setup, once

```bash
pipx install hyperresearch
hyperresearch init ~/Documents/hyperresearch-vault --name "MOZAK Research Vault"
```

The vault lives outside the MOZAK repository. It is markdown plus a rebuildable
SQLite index, so it is readable and versionable without either tool.

To run the full pipeline, install the skills into a Claude Code project:

```bash
cd <project>
hyperresearch install        # or --global
```

## The cycle

1. **Research.** Launch Claude Code in the vault directory and run
   `/hyperresearch <question>`. For a bounded lookup, Jcode can skip the
   pipeline entirely and use the CLI directly:

   ```bash
   hyperresearch fetch <url> --json
   hpr scholar search "<query>" -j
   hyperresearch search "<query>" --ranked -j
   ```

2. **Inspect.** Confirm what actually landed before recording it.

   ```bash
   hyperresearch status
   hyperresearch lint -j
   hyperresearch run status -j     # only after a pipeline run
   ```

3. **Record.** Snapshot the vault as MOZAK evidence. The runner refuses to
   overwrite an existing day, because a run is an immutable observation.

   ```bash
   mozak adapter run agentic-systems-hyperresearch
   ```

   Or directly, which is what the binding calls:

   ```bash
   scripts/adapters/hyperresearch_run.sh \
     .mozak/adapters/requests/agentic-systems-hyperresearch.json \
     <runs-dir>
   ```

4. **Validate.** `mozak research validate <run.json>` is the authority on
   whether the snapshot is contract-valid.

5. **Improve.** Feed it to a Lab run:

   ```bash
   mozak lab start <run-dir> <scope-id> <module> "<question>" agentic-systems-hyperresearch
   mozak lab refresh <run-dir> <runs-dir>/<date>/run.json
   ```

## Narrowing what gets recorded

By default the whole vault is snapshotted. A request may narrow it, which is
how one vault serves several topics:

```json
{
  "select": {"note_ids": ["somenote"], "tags": ["agentic-systems"]}
}
```

Selectors are validated as safe vault identifiers. A cap that truncates the
result must record a high-impact gap and cannot claim full support.

## What this integration does not do

- It does not re-derive HyperResearch's searching, deduplication, or citation
  checking. MOZAK validates the snapshot and re-derives none of that work.
- It does not promote anything. A recorded source is proposal-only evidence
  until the owner accepts an input.
- It performs no networking. Retrieval happened in the harness, before MOZAK
  saw anything, and a fixture claiming otherwise is refused.

## Is it working?

```bash
scripts/adapters/hyperresearch_check.sh
```

It reports three layers separately, because they fail for different reasons and
only one of them is about MOZAK.

## What needs an account, and what does not

Jcode holds no subscription and cannot supply one. What it can do is install,
configure, drive the CLI, and report exactly what is missing.

| Path | Needs an account | Notes |
|---|---|---|
| `hyperresearch fetch`, `search`, `scholar search`, `status`, `export` | No | Plain HTTP and public scholarly APIs |
| MOZAK adapter, normalize, validate, Lab | No | Local files only, no network |
| `/hyperresearch` full 16-step pipeline | Yes | Claude Code plus an Anthropic plan or API key |

The pipeline's cost is Claude Code usage: its subagent roster runs on Anthropic
models, so a `full` run is many Opus and Sonnet calls. That is the only
subscription in play. Everything MOZAK does with the result is free and offline.

Optional keys each unlock one extra source and none are required:
`HYPERRESEARCH_CONTACT_EMAIL` (Unpaywall recovery and the OpenAlex/Crossref
polite pools), `CORE_API_KEY`, `FRED_API_KEY`.

## Working without Claude Code

The CLI path is a complete, useful loop on its own:

```bash
cd ~/Documents/hyperresearch-vault
hpr scholar search "<topic>" -j          # eight scholarly sources, deduplicated
hyperresearch fetch <url> --json         # full text into the vault
mozak adapter run agentic-systems-hyperresearch
```

Jcode can drive all of it. What you give up without the pipeline is the
adversarial critics, the contradiction graph, and the written report, not the
evidence itself.
