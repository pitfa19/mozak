# Project and idea contract version 1

## `.mozak/project.yml`

The manifest is provider-neutral canonical control data. YAML is accepted only as a serialization of the closed shape in [`project.schema.json`](project.schema.json). All mappings reject unknown fields and all required fields are mandatory.

- `version` and `framework_contract_version` MUST both be integer `1`. Unknown versions fail closed because their semantics are unknown.
- `project.id` MUST be a stable lowercase ASCII slug. `project.name` MUST be non-empty. Neither value identifies a provider or onboarding project.
- `repository.revision` MUST be the full 40-character lowercase hexadecimal Git object ID that the manifest describes. Symbolic refs, abbreviated hashes, mixed case, and non-hash generation labels are rejected so freshness comparisons are unambiguous.
- `owned_paths` MUST be non-empty, unique, normalized, repository-relative paths. Absolute paths, empty components, `.`, `..`, backslashes, trailing slashes, and ancestor/descendant overlap are rejected. Ownership grants no authority outside these paths and does not itself authorize mutation.
- Sequence order is preserved. Validation is deterministic, offline, and independent of repository contents or a named provider.

## `.mozak/idea.md`

The idea document MUST begin with exactly one non-empty level-one title. It MUST then contain each of these level-two sections exactly once: `Intent`, `Desired outcomes`, `Boundaries`, `Assumptions`, and `Open questions`. Other headings and content outside these sections fail closed. Each section MUST contain substantive non-placeholder text.

The idea is accepted planning input, not an active procedure. Text claiming direct executable authority, tool authorization, or trusted executable instructions is invalid under PF-I01 and PF-I04.

## Canonical interpretation

The Rust validator converts supported YAML into typed data and Markdown into an ordered semantic section map. Validation never reads the network, invokes a model, resolves a symbolic revision, or infers undeclared semantics. A future format change requires a new contract version and migration decision.
