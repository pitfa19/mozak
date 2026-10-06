# Jcode agent-work v0.9.0 release candidate acceptance

Observed 2026-10-06, implementation commit
`f649fa9270b3b276530b47def045de65a3b25ac4`. Owner approved implementation,
stable publication and local installation on 2026-10-06T20:05:42Z. Goal remains
in progress until the published stable asset is installed and verified locally.

## Requirements mapped to observed public paths

- Bundled Low/Normal and opt-in teacher skills: the compiled `mozak setup install`
  route installs and checks exactly 136 managed files. Four added invocation files
  are Jcode-only. Ordinary archive install and update do not create/modify global
  Jcode settings or activate teacher mode. Exact bytes of the three invocation
  files plus full swarm policy and overlay match the approved owner files.
- Opt-in configuration: five native Rust CLI acceptance tests run the real built
  binary, exercising read-only plan/check, install, check, idempotency, unrelated
  TOML/comments/overlay retention, exact original backups and credential sentinel
  retention. They also exercise malformed/ambiguous config, static home/ancestor/
  directory/leaf symlinks, managed drift and Jcode-only custody. All passed.
- Failure boundaries: supplementary installer tests cover held lock through the
  real CLI, partial-write rollback, changed preflight, corrupt backups, wrong
  field types, complex owned fields and managed overlay-block drift. Fault
  injection is supplementary, not a substitute for packaged acceptance.
- Packaging: the genuine archive installs into an isolated home/prefix. Its
  installed launcher runs plan/install/check/idempotency, retains unrelated
  config and credential sentinel bytes and retains ordinary setup parity.
  Existing fresh-machine project/KB/MCP workflows, bootstrap (public/private,
  token, tamper), update/auto-check/channel/rollback workflows passed.
- Cross-generation ownership: a package containing the real locally installed
  0.8.1 binary (120 managed files) upgrades through the public launcher to the
  real 0.9.0 binary (136). Rollback restores the old embedded payload and the
  exact three pre-existing owner profile files, while removing only the newly
  acquired helper. Global config/policy/credential sentinels remain byte-identical.
  Wrong-home custody refuses rollback before migration and preserves current
  parity. Release lookup alone uses an offline fixture, not a mocked binary.

## Concrete improvement and correction

The extra real 120-to-136 migration trial initially observed that successful
rollback erased pre-existing swarm-low/SKILL.md. The original in-memory migration
backup protected only failed activation, not a later successful rollback.
Publication was paused. Durable private build-pair/home-pinned custody was added
for only the four Jcode invocation files, with strict path, coverage, hash, kind
and mode validation. The identical real migration now passes. Corrupt-custody
refusal and regression unit cases also pass. This is a witnessed before/after
improvement, not inspection-only assurance.

## Complete regression observations

- `cargo test --locked --workspace`: 534 tests passed across 59 result groups.
- `cargo clippy --locked --workspace --all-targets -- -D warnings`: passed after
  correcting an exit-code cast identified by the first lint run.
- `cargo fmt --all -- --check`: passed.
- `python3 -m unittest discover -s scripts -p 'test_*.py'`: 56 tests passed.
- `python3 scripts/validate_m0.py`: all schemas, fixtures, adapters and evaluation
  checks passed. Sealed M0/core source and contracts were not changed.
- `scripts/check_docs_match_binary.py`: six modules, current documented routes.
- Real fresh archive, install/update/rollback, bootstrap, cross-generation custody
  acceptance and `scripts/verify_phase1_slice.sh`: passed.

Local logs under `/home/pitfa/.jcode/scratch/swarm-settings-validation/`:

| Log | SHA-256 |
| --- | --- |
| workspace-tests.log | 4ce0940a668ae58b4b3690d4a294b6cde9444c854cd5623a2d42a53276117914 |
| clippy.log | ec1f2898fb8ecaeb50b20fe5f9ad942aa322b13c91817a95a4eca689e9921660 |
| python-tests.log | 279d9ceee33ab63276c955347b736eebaa9a16dc6052786de3f9161c15b81298 |
| fresh-package.log | 35adf6bfff7d4ae7da1107e2fb26bcfd5ab52552013f96001d554f2069cd429b |
| delivery-acceptance.log | 4b0f1c4d7a7e25235fd19a1138902c08e337f72fa2d7dd2d8622083c802e02ed |
| bootstrap-acceptance.log | 364d4e86579869387655049fdd8637e11469f263c06920577f142aa9ba5e07d5 |
| cross-generation.log | ad669f315e21f001c6bb9980388f6229b624a736dd38cde82792aad27fb1bfb5 |
| phase1.log | 7274ed40a0382da3e2fe011e4b31d2ed7aa1801400d35a2fb99aa0d11c5be68d |

## Runtime boundary and fallback actually observed

Both spawned Claude workers failed with rate-limit exhaustion. Native
`jcode usage --json` separately reported both owner-configured Claude OAuth
accounts at 100% five-hour usage. The coordinator resumed the remaining work
itself without another provider or paid API substitution, as approved. This
observes the trigger and direct-work fallback, not a successful live Claude call
or a full trace of native account switching.

The preceding personal-settings acceptance created a real fresh Jcode session
without inference and observed the global overlay, profile skill discovery and
teacher-off policy in assembled context. Full teacher-to-coordinator-to-Claude
execution has NOT passed a live acceptance trial. Claude quota prevents a useful
complete-worker trial now. CLI reports deliberately keep runtime.verified false.
Existing sessions retain their captured prompt. Native swarm-deep and compatible
models/accounts remain prerequisites. No force overwrite or credential handling.

Before release, GitHub latest stable was v0.8.2, published 2026-10-06T10:08:30Z.
v0.9.0 did not yet exist. Publication must target the tested successor commit,
follow established CI/release workflow, and install only its verified stable asset.
