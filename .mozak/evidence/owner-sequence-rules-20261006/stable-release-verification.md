# Stable v0.8.2 release verification

Owner request: publish sequence-completion hardening as a new stable MOZAK version, preserving stable v0.8.1, before continuing Genome.

## Requirements and observed checks

1. Preserve approved sequence scope and synonyms: installed companion has a declared-contract checker with exact original requirement IDs and contract digest. Its 12 tests pass. It does not authenticate referenced evidence or guarantee agent obedience.
2. Exercise real continuation: a fresh Jcode worker actually completed remaining authorized summary and requirement-map work while retaining all five original requirements. Its summary bytes were independently checked as `assembly_length=12\nunknown_bases=4\n`. Steps 1 through 4 remained verified and step 5 remained explicitly blocked on publication approval, with parent status incomplete. No approval was fabricated. Root AGENTS policy was present in the worker context. The worker's skill-name lookup failed because its skill cache did not resolve the newly installed companion, then it read the installed SKILL.md directly. The task itself also required scope preservation, so this observation cannot isolate the policy's causal effect or prove universal future compliance. The worker's map is not the checker's checkpoint schema and was not presented as a checker pass.
3. Preserve current stable features: upstream v0.8.1 merged into main, including MCP-only stack projection and default-on automatic update. New companion adds twelve managed files across four hosts, for 132 total. Previous managed generation counts remain supported for rollback.
4. Safe managed upgrade: installer snapshots pre-existing newly managed files as well as old-generation paths before mutation. Nine installer tests pass, including rollback restoration of pre-existing owner companion bytes. These component tests do not replace packaged release acceptance.
5. Whole-source native checks: formatting, strict workspace/all-targets clippy, workspace Rust tests, release CLI/MCP build, six workflow tests, 42 MOZAK skill tests, twelve sequence tests, documentation/binary consistency and diff whitespace checks passed on October 6, 2026. Full local Python discovery has four Linux packager errors because macOS realpath lacks GNU -m. Full Linux CI is required before stable tagging.
6. Publication and delivery remain OPEN until real GitHub CI and static Linux fresh-install/update/rollback/bootstrap checks succeed, the immutable v0.8.2 release is published and asset checksums are verified.
7. Local Mac acceptance remains OPEN until native binaries built from the published source are installed with backups, all 132 managed files check ready, and the real Genome overview validates without changing historical approval/index bytes. Official archives target Linux x86_64. A native Mac source install is not a managed Linux archive install.

## Release changes

- Owner-approved work commitment companion and mandatory MOZAK policy hook.
- Exact-scope read-only declared completion checker and regression tests.
- Safe managed companion installation, update and rollback.
- Verified read-only planning archive access after project relocation, retaining strict approval/root checks for mutation.
- Stable release workflow exercises packaged delivery before publishing.

No Genome implementation scope is marked complete by this release.
