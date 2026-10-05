# Stable release closure: MOZAK v0.8.0

Owner approval: 2026-10-05T21:12:47Z, publish latest stable. New tag `v0.8.0` points to `5f30e565d29c56904d333bd665fbfc72f3bb56e8`; old stable tags were not replaced. GitHub published the non-draft, non-prerelease stable release at 2026-10-05T21:27:06Z. The latest-release API still returns v0.8.0 at this closure observation.

## Requirements and observed results

1. **Push completed migration:** fast-forward push of main and new annotated v0.8.0 tag succeeded atomically. Remote tag dereferences to the exact verified release commit.
2. **Publish latest stable:** tag workflow run 37375679923 passed tests, static musl build, packaging, checksum verification and stable publication. `stable-publication.json` records its exact head and conclusion. Downloaded archive SHA-256 is `914fd6d50a13f70f646613cb60fe71c54c9bf874d8d6004a32737e3c69f2ac57`; manifest revision, version, platform and stable channel match the new tag. GitHub latest API reports draft=false and prerelease=false.
3. **Install actual published stable:** managed `mozak update --channel stable` installed active `0.8.0-5f30e565d29c`, preserving previous `0.7.1-main-3de281a0ba98`. Both installed executable byte hashes exactly match the downloaded published archive. The installation did not merely reuse a local build.
4. **Verify observable behavior:** installed setup and doctor ready, CLI catalog and installed stdio MCP agree, MCP server version is 0.8.0. A fresh real arXiv MCP call was recorded, verified and ingested into a fresh Lab through the installed stable CLI without an adapter registry. Historical research remains total 40; the bounded 12 returned records and original registry/KB byte hashes are unchanged. Retired route refuses with exit 1. See installed-acceptance.json and live-stable-acceptance.json.
5. **Release quality:** versioned local workspace tests, strict all-target Clippy, formatting, docs and Python checks passed. Real fresh package, install/update/rollback and bootstrap acceptance passed. Gate logs are preserved in this goal directory.
6. **Hosted CI failure followthrough:** initial branch CI 37375680071 failed at a new Rust 1.99 Clippy assertion-style lint, not a runtime or release test. The local verified compiler was Rust 1.98.0. Commit `33927fcdd392f3689f8556d51e7e6907a3bff213` pins project/CI/release toolchains consistently to 1.98.0 and adds a matching-pin regression test, without weakening strict lints or altering the published tag. Repaired hosted CI 37376200540 and rolling publication 37376200456 both passed. This follow-up is on main, not retroactively claimed to be part of the immutable v0.8.0 tag.

## Boundaries and separate work

The v0.8.0 stable payload contains the verified MCP-only migration. Optional Fetch/GitHub/Firecrawl service usability remains unobserved. Missing prerequisites remain incomplete; no fallback or research acceptance is implied. Linux x86_64 is the published platform.

Automatic-update preference was preserved as false during this release's installation. The owner separately requested enabling it and changing fresh-install defaults in the seedling fork. That work is separately owned and tested, is not included in immutable v0.8.0, and may ship as a later stable release. This closure makes no claim about that future release or its policy. No knowledge state, notes or historical evidence was deleted or accepted by publication.
