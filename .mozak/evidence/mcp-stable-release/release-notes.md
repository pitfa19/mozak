# MOZAK v0.8.0

## MCP-only research and explicit tool onboarding

- New research retrieval uses agent-host MCP tools exclusively. Live adapter commands, setup/recheck routes, subprocess runners and catalog fallbacks are retired.
- The shipped tool stack recommends tools per use case and checks local prerequisites without installing, executing servers, exposing credential values or claiming service usability.
- The catalog includes arXiv, Zotero, Overleaf, Fetch, GitHub and Firecrawl MCP integrations. Missing configuration is reported as incomplete, never silently replaced by an adapter.
- New Lab requests select shipped MCP tool IDs. Refresh ingests matching validated proposal-only tool evidence, rejects scope/source mismatch and tampering, and cites selected excerpts rather than embedded provenance records.
- Source-neutral tool evidence records exact response hashes, selected excerpts, call identity and declared effects. Recording does not accept research as knowledge.

## Compatibility and delivery

- This is a deliberate interface change from v0.7.1: `mozak adapter` commands are retired. Use the agent host's configured MCP tools and `mozak research record-tool`.
- Existing recorded research and historical Lab artifacts remain readable and verifiable. Historical adapter bindings are non-callable records, not runtime readiness.
- Managed tool-catalog upgrades and offline rollback preserve prior builds and user knowledge state. Managed skills and current documentation describe the MCP-only workflow.
- Release assets target Linux x86_64, use a static musl binary, and include SHA-256 checksums and a release manifest.

## Verification and limits

The completed migration passed 525 workspace tests, strict all-target Clippy, source and installed skill tests, real arXiv MCP-to-Lab ingestion, 24 historical old/new public-interface comparisons, and fresh installation/update/rollback acceptance. Release-specific checks are recorded separately under `.mozak/evidence/mcp-stable-release/`.

MOZAK itself does not execute or supervise MCP providers. Fetch, GitHub and Firecrawl need owner configuration and were not service-tested during the migration. This replaces the old batch adapters with explicit agent-host workflows, not a claim of identical automated pipeline behavior. Research remains proposal-only. Optional services and credentials are not installed by this release.
