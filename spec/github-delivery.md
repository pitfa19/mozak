# GitHub Delivery v1

## Status

Accepted for implementation on 2026-09-06. This contract covers tool delivery only. It does not publish, copy, merge, or mutate Project, Scope, KB, adapter, Lab, or Meta KB state.

## Goal

A collaborator with access to `pitfa19/mozak` can install MOZAK once, select a release channel, receive verified updates, and roll back without a source checkout. Project repositories continue to carry their own `.mozak` state while each user owns a separate local registry and KB.

User-facing instructions live in [`docs/distribution/INSTALL.md`](../docs/distribution/INSTALL.md). This page is the contract behind them.

## Channels

- `stable`: a GitHub Release created from a `vMAJOR.MINOR.PATCH` tag. This is the default channel.
- `main`: a rolling prerelease rebuilt after every successful push to `main`.

An installed launcher stores the selected channel and automatic-update preference in `$XDG_CONFIG_HOME/mozak/delivery.json` or `$HOME/.config/mozak/delivery.json`. Stable automatic checks are enabled by the online bootstrap installer. Offline archive installation enables them only when explicitly requested.

## Local layout

For the default `$HOME/.local` prefix:

```text
~/.local/bin/mozak                         launcher
~/.local/lib/mozak/current                 symlink to active version directory
~/.local/lib/mozak/previous                symlink to previous version directory
~/.local/lib/mozak/versions/BUILD_ID/
├── mozak                                  real binary
├── build.json                             immutable build identity
├── install.py                             matching activation logic
└── launcher.py                            matching launcher
```

A build ID includes both semantic version and Git revision. A version directory is create-only and byte-verified when already present. Activation replaces only MOZAK-owned launcher and symlink paths.

## Public commands

The installed launcher intercepts:

```text
mozak update
mozak update --channel <stable|main>
mozak update --enable-auto [--channel <stable|main>]
mozak update --disable-auto
mozak rollback
mozak delivery status
```

All other arguments are executed by the active real binary.

Before an ordinary invocation, an auto-enabled launcher checks at most once per configured interval. A failed check never prevents the current verified binary from running. An explicit `mozak update` reports failure and exits nonzero.

## GitHub and authentication

Delivery is visibility-agnostic. A request is made anonymously and carries credentials when they are available, so the same installer and launcher serve a private repository today and a public one later without a code change or a second migration.

Credentials are resolved in order:

1. `MOZAK_GITHUB_TOKEN`
2. `GH_TOKEN`
3. `GITHUB_TOKEN`
4. `gh auth token`

The public repository needs none of these. A private fork needs one. When none is available and the release is unreachable, the error names both possible causes rather than assuming one. No token is written into MOZAK configuration. GitHub API responses identify an exact release asset. The downloaded `release-manifest.json` identifies the archive and pins its SHA-256.

## Update transaction

1. Resolve the selected GitHub release and exact manifest asset.
2. Download and validate the schema-v1 manifest.
3. Download the named archive and verify its SHA-256.
4. Extract only regular safe relative paths. Reject links, devices, absolute paths, and traversal.
5. Run the new archive's matching installer.
6. Create or verify the immutable version directory.
7. Verify the new binary and embedded managed-skill payload.
8. If managed skills differ, require the old binary's exact setup parity, back up only its declared managed files, install the new payload, and restore on failure.
9. Atomically set `previous`, then atomically switch `current` and the launcher.
10. Run the active binary's setup check. Roll activation back if final verification fails.

Project repositories, `$XDG_CONFIG_HOME/mozak/config.json`, adapter registry, KB roots, Scope roots, and Meta KB roots are outside every update write set.

## Rollback

`mozak rollback` activates the exact directory pinned by `previous`, migrates the managed skill payload with the same transaction, and swaps `current` and `previous`. It performs no network access.

## GitHub automation

- Pull requests and pushes run formatting, Clippy, Rust tests, Python tests, release-build tests, and a clean-install/update/rollback acceptance test.
- A successful `main` push publishes or replaces the rolling `main` prerelease assets.
- A `vMAJOR.MINOR.PATCH` tag must match the Cargo package version before a stable GitHub Release is published.
- Linux v1 publishes an x86-64 musl-linked binary so delivery does not inherit the build host's glibc floor. Other platforms remain explicit future work.

## Acceptance checks

1. A clean HOME installs from a verified archive and executes `mozak --version` through the launcher.
2. Reinstalling the same build is idempotent.
3. A newer build installs beside the old build and becomes current.
4. Stable and main channel selection persist independently of project configuration.
5. Automatic checks honor their interval and fail open to the current binary.
6. A bad manifest, wrong checksum, unsafe archive, unavailable release, or missing private-repository authentication leaves the active build unchanged.
7. Rollback restores the previous binary and matching managed skill payload.
8. A sentinel project repository, project registry, adapter registry, Scope root, and KB root remain byte-identical through install, update, and rollback.
9. Release assets are reproducible for the same binary, channel, and revision.
10. The real GitHub workflows are syntactically valid and use least-required `contents: write` permission only for publishing.
11. An anonymous install succeeds against a public repository, a credentialed install succeeds against a private one, and an uncredentialed private install fails with a message naming both remedies.

## Going public later

Switching `pitfa19/mozak` to public requires no delivery change. Anonymous
installs and updates begin working immediately, and the shorter
`curl -fsSL .../install.sh | bash` form becomes usable. Existing installations
keep working unchanged, because credentials are optional rather than required.
