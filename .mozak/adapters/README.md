# Research adapters

MOZAK performs no networking and must stay reproducible. An adapter is the only
component that reaches a network source: it fetches, stores the exact returned
bytes content-addressed, and emits a fixture that MOZAK validates.

Adapters are optional integrations, not MOZAK core. MOZAK remains useful
offline; users install or invoke only the sources they want.

## Callable registry

MOZAK keeps owner-configured adapter bindings in
`~/.config/mozak/adapters.json`. Each binding names an exact registered Scope,
pins the request and external runner by SHA-256, and records its output root.
This makes invocation deterministic for both humans and later background agents:

```bash
mozak adapter catalog
mozak adapter list
mozak adapter show agentic-systems-dair-ai
mozak adapter run agentic-systems-dair-ai
```

`adapter setup` is the persistence step after an agent has inspected a Topic or
Project and the owner has accepted the proposed settings. Setup verifies that
the target Scope exists in the configured KB and that the request names that
same Scope. A drifted request or runner remains visible but is not callable.
Running an adapter creates proposal-only research evidence and never promotes it
to accepted Scope knowledge automatically.

## DAIR.AI curated Papers of the Week

DAIR.AI maintains the public
[`dair-ai/AI-Papers-of-the-Week`](https://github.com/dair-ai/AI-Papers-of-the-Week)
repository. It is a selective editorial layer over the much larger arXiv stream,
so it complements rather than replaces the arXiv adapter.

```bash
scripts/adapters/dair_weekly.sh \
  .mozak/adapters/requests/agentic-systems-dair-ai.json \
  ~/Documents/mozak-kb/runs/agentic-systems-dair-ai
```

The request binds the adapter to a generic `scope_id`, which may identify a
Topic, Project, or other Scope. The adapter resolves the official repository's
`main` branch to an exact commit, fetches the year file at that immutable
revision, records exact response hashes, and emits a callable metadata-only run.

The upstream repository currently declares no license. Its curator prose is
used transiently for matching target interest clusters but is never copied into
durable MOZAK records. Only paper titles, paper links, week labels, matched
clusters, and exact provenance are retained.

## Weekly catchup, one scope or project at a time

```bash
scripts/adapters/weekly.sh \
  .mozak/adapters/requests/agentic-systems-clusters.json \
  ~/Documents/mozak-kb/runs/agentic-systems
```

That plans, fetches, validates, and writes a dated run directory containing
`run.json`, `digest.md` and `shortlist.txt`. It refuses to overwrite an existing
run for the same day. Set `KEEP_RESPONSES=1` to retain the raw API bodies.

## Interest clusters

A request may declare named clusters instead of one flat term list. Each cluster
becomes its own bounded query, so the server filters and only matching papers are
downloaded. A paper matching several clusters is stored once and records every
cluster that matched it, which is the strongest available relevance signal.

A cluster that matches nothing is reported as a gap rather than passed over in
silence, because its terms may simply not be the vocabulary the field uses.

## Reading

```bash
# the decision list: titles, links, matching clusters
python3 scripts/adapters/arxiv_digest.py RUN.json
python3 scripts/adapters/arxiv_digest.py RUN.json --min-clusters 2
python3 scripts/adapters/arxiv_digest.py RUN.json --cluster context-memory

# pull chosen full text into a disposable scratch directory
python3 scripts/adapters/arxiv_pull.py /tmp/reading --from-digest shortlist.txt
python3 scripts/adapters/arxiv_pull.py /tmp/reading --clean
```

The pinned metadata record is the durable artifact. A PDF is working material:
pulled deliberately, read, then deleted. `--clean` refuses to remove a directory
this tool did not create.

## Other request shapes

`agentic-systems-catchup.json` covers everything published since yesterday in the
tracked categories, with no term filter. `agentic-systems-weekly.json` uses one
flat term list rather than clusters.

## What a retrieval is and is not

A retrieval is proposal-only research evidence. It records what the API reported,
what was kept, and what was not examined. Promoting a paper into a Scope input,
or accepting a planning input from it, stays an explicit owner decision.

The adapter makes no relevance-ranking claim. It filters by declared terms and
reports counts and candidates; judging relevance remains the owner's.
