# Genome campaign planning workflow handoff

Proposal only, recorded 2026-09-10. No accepted lifecycle state is modified by this document.

## Resume context

Load mozak and run `mozak project context mozak` and `mozak project context genome-benchmark`. This local MOZAK registration currently has no ready goals. Both repositories report revision drift. Do not silently refresh pins or edit accepted inputs/plans.

Genome benchmark's full owner-requested experiment, staged plan and next-laptop multi-server assessment are in its repository:

- `proposals/EXPERIMENT-SUMMARY.md`
- `proposals/PLANNER-CAMPAIGNS.md`
- `proposals/LAPTOP-HANDOFF.md`
- `protocol/PLANNER-CAMPAIGN-PROTOCOL.md`
- `protocol/ACCEPTANCE-FOLLOWUP.md`

Use the owner-configured checkout of https://github.com/pitfa19/genome-benchmark rather than assuming an absolute laptop path.

## Observed gap

The user approved work toward iterative genome campaigns, including planner-memory and cookbook ablations. The accepted benchmark plan still exposes only release-acceptance for baseline work. Installed CLI and `cargo run -q -p mozak-cli -- --help` expose `planning next` but no public plan-authoring/acceptance command. Source dispatch confirms that boundary. Do not mistake the absence of a route for the absence of user intent.

MOZAK also ships mozak-mcp with five typed tools. Check the current MCP catalog for supported routes before extending anything, while preserving its CLI parity and authority model. Do not invent a mutation tool or treat context/validation as acceptance.

## Proposed smallest unblocker

First determine the intended current public workflow with the project's validated context and tests. If authoring/acceptance truly requires implementation, propose the smallest owner-gated route that can add a versioned campaign plan without destroying the existing baseline plan or fabricating approval. Define exact input pins, actor/approval record, revision checks and atomic failure behavior before coding. General campaign approval is not an invented signed approval artifact.

Acceptance checks for any approved extension:

1. Existing context, overview and planning next remain compatible. Original baseline plan/history remain preserved.
2. A proposed campaign DAG validates with explicit dependencies and owner-supplied inputs, but creates no execution authority.
3. Missing/negative approval, stale revision/hash, malformed data and conflicting IDs fail without partial writes.
4. An explicitly approved transition becomes visible to fresh-agent context and next-goal recommendation through real CLI interfaces.
5. Package/install and CLI/MCP parity tests pass for affected surfaces. Exercise the real benchmark handoff, not only fixtures, before claiming this unblocks it.

Then return to the benchmark plan: isolated planner, campaign controller, pinned KB access and bounded authorization. Next laptop has user-reported GIS/Zagreb server access for measured placement evaluation. Do not hardcode hosts or claim a fastest configuration before testing.

## Existing changes to carry

This branch already includes arXiv transient-refusal retry and throttling/vocabulary fixes in commits 1fce76a and 738253d. Push these along with this handoff. This handoff adds no code or accepted planning state.
