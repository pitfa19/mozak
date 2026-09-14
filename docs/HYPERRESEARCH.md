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

## One vault per Scope family

A Scope is already the container for a family of related work: `genome` covers
the MCP, its benchmark, and its paper; `rinalmo2` covers the RiNALMo2 project and
the upstream RiNALMo lineage it succeeds. Research belongs at that level, because
a question about the family is rarely a question about one checkout.

A vault binds to the Scope id you name, and a family topic such as
`topic-genome-family` or `topic-rinalmo-family` records what the family is and
which Scopes it ties together. Binding a vault to a project Scope works and is
what is installed today; pointing it at a family topic instead is a
re-registration, not an edit, for the reason in the next section.

```bash
MOZAK=<repo>/target/release/mozak \
  scripts/adapters/hyperresearch_scope_install.sh <scope-id>
```

It initializes the vault, writes the request, registers a `<scope-id>-hyperresearch`
binding, and refuses a Scope the KB does not know. Running it twice is safe: an
existing vault, request, or binding is reused rather than replaced.

### Why the vault lives outside the Scope

Vaults go in `~/Documents/research-vaults/<scope-id>/`, not inside the Scope root
or a project repository. A Scope pins its manifest hash and a project declares
the paths it owns, so a vault stored inside either would make every fetch look
like drift, and the family would fail validation for doing exactly what it was
set up to do.

### Adding a repository to a family

A repository only shares a family's research once it is bound to that Scope:

```bash
mozak scope add-project <scope-root> <project-id> "<title>" "<intent>" <repo-root>
mozak kb repin <kb-root> <registration-id> <scope-root>
```

Editing a registered Scope invalidates its pin by design, and a configured KB
then needs `project discover`, `project review`, and an owner-approved
`project refresh`. That sequence is not a workaround; it is the KB refusing to
accept a changed registry without the owner saying so.

### An empty vault records nothing

Snapshotting a vault with no matching note fails with a message saying the vault
is empty or the selection matched nothing, and writes no run. A run asserting
that zero sources were read would be an artifact carrying no observation, and it
would sit in the evidence store looking like a finding.

### Upstream repositories are not bound as projects

A family often includes code someone else maintains. The original RiNALMo is
upstream work by other authors; binding it as a project would have MOZAK claim
owned paths in a repository the owner does not own, and a project manifest is a
statement of ownership rather than of interest.

Such a repository enters the family as *subject matter*, not as a bound project:
its paper and its README are fetched into the family vault like any other source,
and the family topic's intent names the lineage explicitly. `mozak kb tree` then
shows the family, and the evidence is addressable, without MOZAK asserting
authority it does not have.


### Changing a binding's target is a re-registration

Editing a pinned request moves its binding to `needs_recheck` and makes it
non-callable, and `adapter recheck` refuses an edit that retargets the Scope. So
a request's `scope_id` cannot be changed in place. Retargeting means registering
a new binding against the new Scope and leaving or replacing the old one.

That refusal is the contract working. A binding records that a specific runner
and request were reviewed for a specific Scope, and silently accepting a new
target would let evidence land against a Scope no one approved it for.
