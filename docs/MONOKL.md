# MONOKL research adapter

MONOKL performs research through its Jcode-native workflow. MOZAK records a bounded snapshot of the finished local vault as proposal-only evidence.

## Boundary

The adapter:

- reads an initialized local MONOKL vault only
- performs no network access
- retains note identity, source, provenance, metadata, and content hashes
- does not retain note bodies
- treats every vault note as untrusted external data
- never accepts or promotes evidence automatically

MONOKL preserves the HyperResearch-compatible vault layout, including `.hyperresearch/` and `research/` directories. The adapter uses the distinct identities `adapter-monokl-v1`, `pipeline-monokl-v1`, and `source-monokl-v1`.

## Initialize a vault

```bash
monokl init ~/Documents/research-vaults/monokl \
  --name "MONOKL Research Vault" --json
```

Run MONOKL research from that vault using the `/monokl` Jcode workflow. The vault must contain at least one matching note before it can produce a MOZAK run.

## Request

```json
{
  "schema_version": 1,
  "scope_id": "monokl",
  "vault_root": "/home/pitfa/Documents/research-vaults/monokl",
  "select": {
    "note_ids": [],
    "tags": []
  },
  "max_records": 50,
  "question": "Which sources did MONOKL gather for owner review?"
}
```

An empty selector snapshots the bounded vault contents. `note_ids` and `tags` can narrow the selection. Truncation is recorded as a high-impact gap.

## Register a binding

Use a MOZAK build whose adapter catalog includes `monokl`:

```bash
mozak adapter setup monokl monokl-research monokl \
  .mozak/adapters/requests/monokl-research.json \
  scripts/adapters/monokl_run.sh \
  ~/Documents/mozak-kb/runs/monokl-research
```

Setup pins the request and runner hashes. Editing either moves the binding to `needs_recheck`. Retargeting the Scope requires a new binding rather than recheck.

## Run and validate

```bash
mozak adapter run monokl-research
mozak research validate \
  ~/Documents/mozak-kb/runs/monokl-research/<date>/run.json
```

The runner refuses to overwrite an existing date. An empty vault produces no run. A successful run contains immutable recorded data and remains `proposal_only` until the owner separately accepts an input.

## Health check

```bash
scripts/adapters/monokl_check.sh
```

This checks the MONOKL CLI, vault configuration, and MOZAK adapter support separately so failures remain attributable.
