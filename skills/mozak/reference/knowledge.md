# MOZAK reference: Concepts, KB registry, Meta KB

Load this for cross-project idea sharing (Concepts, Translations), the KB registry, or the local Meta KB.

## Concepts, Translations, and case records

- A Concept is owned by whoever authored it: a Topic or Project keeps its own under `concepts/` in its Scope root or `.mozak/concepts/` in its repository, and a Translation lives with the adopting target under `.mozak/translations/`. A Concept is advisory only. It records a reusable mechanism, the invariant that must still hold, applicability limits, evidence, and the assumptions it rests on. It never authorizes adoption, execution, or mutation.
- A Translation is owned by the adopting target. It is valid only when the target re-derived every source assumption as holds, replaced, rejected, or could_not_check. Replacing or rejecting an assumption is qualified adoption, never full adoption, and a load-bearing assumption that was rejected or never checked is not adoption at all.
- A holding assumption requires evidence observed in the target, not in the source. A Translation pins the exact Concept hash and fails closed on drift.
- Use `mozak kb concept candidates TARGET_SCOPE_ID [RESEARCH_RUN_JSON ...]` when an agent needs cross-project experience. The output is a deterministic inventory, not a recommendation. Registered Concepts remain `advisory_only`; supplied research runs remain `proposal_only`, are never accepted by this command, and are not discovered by scanning.
- After choosing one exact candidate, use `mozak kb concept translation-packet TARGET_SCOPE_ID CONCEPT_ID CONCEPT_SHA256`. The target must then author its own Translation, provide target-side evidence for `holds` and `replaced`, and validate it with `mozak concept translation validate`. The packet itself is never an adoption record.
- A case record is a pinned, calibrated observation of finished real work. Its derived proposals are `proposal_only` and must pass the ordinary planning gates; recording a case never accepts its proposals and never makes them another project's truth.
- A case must record its own limitations, must separate measured observations from qualitative interpretation, and cannot report a comparative result without a control that declares itself comparable.
- `mozak kb tree` lists scope-owned Concepts, and `mozak project overview` and `mozak project list` report project-owned Concepts and Translations. A Translation whose source Concept is authored by another owner is reported as an external pin rather than as verified or as a defect.
- Automatic case collection, a self-improvement daemon, and any route that feeds findings into accepted knowledge without owner acceptance remain unimplemented and unsupported.

## Explicit KB registry

- For “my Meta KB”, “current Meta KB”, or an equivalent unqualified request, run the rootless configured route directly. Use `mozak kb tree` for a concise hierarchy and `mozak kb graph` for Termaid. Never search the filesystem for the KB path first.
- Rootless KB routes resolve only the exact owner-registered KB in the local MOZAK config and fail closed when the config is missing, malformed, or hash-drifted. Use a path argument only when the user explicitly identifies another KB root.
- A KB registry is rooted at strict `kb.json` and loads only explicitly registered canonical absolute Scope roots with exact `scope.json` hashes. It never scans for unregistered roots.
- Use `kb tree` for the deterministic combined hierarchy and `kb graph` for the actual Termaid view. Nested registrations appear nested only when both roots are explicit.
- `kb parity` reports every fixed gate as passed, failed, unsupported, or blocked. Exit 2 means parity was not demonstrated and must be reported honestly.
- Current import/export round trip, version history, and rollback/recovery gates are unsupported. Human editability remains blocked without a witnessed trial. Registered source vaults remain authoritative and must not be archived or deleted from these results.

## Local Meta KB

- A local Meta KB is rooted at a strict `meta-kb.json` manifest. `meta validate` is the authority for whether its release files, optional human overviews, hashes, identities, and relationships are valid.
- Use `meta list` for terminal inventory and `meta graph` for an actual Termaid relationship view.
- Knowledge releases remain immutable project publications. A cross-project relationship or reusable pattern is context for evaluation, not authorization and not automatically another project's truth.
- Current Meta KB commands are read-only. The configured KB can now inventory registered external Concepts and prepare target Translation packets, but MOZAK does not yet implement automatic import, relevance ranking, research discovery by scanning, networking, registry publication, hosted discovery, automatic adoption, or Meta KB mutation.
