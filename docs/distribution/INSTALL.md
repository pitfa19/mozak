# Install and update MOZAK on Linux x86-64

One offline binary. `python3` and `curl` are required by the bootstrap and the
managed launcher. GitHub CLI is optional and used only as a credential source.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/pitfa19/mozak/main/scripts/install.sh | bash
mozak doctor "$HOME"
```

The bootstrap downloads the release through the GitHub API, validates the
release manifest and SHA-256, installs an immutable version directory under
`$HOME/.local/lib/mozak/versions`, enables a once-daily stable update check, and
runs the installed launcher.

Flags for either form, passed as `-s -- <flag>`: `--channel main` selects the
rolling build, `--no-auto-update` disables automatic checks, and `--prefix` and
`--home` accept absolute paths.

### Offline, from a downloaded archive

```bash
sha256sum -c SHA256SUMS
tar -xzf mozak-<build-id>-linux-x86_64.tar.gz
./mozak-<build-id>-linux-x86_64/install.py --prefix "$HOME/.local" --home "$HOME"
mozak doctor "$HOME"
```

This leaves automatic updates disabled unless you pass
`--enable-auto --channel stable|main`.

## Update and roll back

```bash
mozak delivery status                     # which build is active
mozak update                              # latest stable
mozak update --channel main --enable-auto # rolling build, periodic checks
mozak update --disable-auto
mozak rollback                            # back to the previous build
```

`stable` resolves the latest non-prerelease version tag. `main` resolves the
rolling prerelease rebuilt after every successful push to `main`. An explicit
update that fails exits nonzero; an automatic check that fails prints a warning
and keeps running the current verified binary.

An update installs beside the existing build, verifies the archive SHA-256,
migrates only exact verified MOZAK-managed skill files, then atomically switches
the launcher and the `current` link. `rollback` performs no network access: it
activates the build pinned by `previous`, restores its matching skill payload
through the same verified transaction, and swaps the two links.

Updates try anonymous access first and add credentials only when available.
They are read from `MOZAK_GITHUB_TOKEN`, `GH_TOKEN`, `GITHUB_TOKEN`, or
`gh auth token`, in that order. No token is ever written to disk. When none is
available and the release is unreachable, the error names both possible causes
rather than guessing.

## Local layout

```text
~/.local/bin/mozak                        launcher
~/.local/lib/mozak/current                link to the active version directory
~/.local/lib/mozak/previous               link to the previous one
~/.local/lib/mozak/versions/<build-id>/   immutable: binary, build.json, install.py, launcher.py
~/.config/mozak/delivery.json             channel and auto-update preference
```

`$XDG_CONFIG_HOME` replaces `$HOME/.config` when set. A build id carries both
the semantic version and the Git revision. A version directory is create-only
and byte-verified when already present.

## Backup

Version directories already retain the previous binary and its matching
installer. For an external backup, copy:

```text
PREFIX/lib/mozak/
PREFIX/bin/mozak
$XDG_CONFIG_HOME/mozak/delivery.json
```

**Knowledge state is separate and is not delivery state.** Back up Project
repositories, Scope roots, KB roots, and Meta KB roots through their own Git
workflow or storage policy.

## Safety boundary

The launcher and installer may modify only the selected prefix's `bin/mozak`,
`lib/mozak` version directories and managed links, `delivery.json`, and exact
embedded skill files after the old binary proves they are unchanged.

They never modify Project repositories, `.mozak` project state, adapter
registries, Scope roots, KB registries, Meta KB roots, or accepted knowledge.

Any of these fails without switching the active version: a checksum mismatch, a
malformed release, an unsafe archive path, missing authentication for a private
repository, an owner-edited launcher, or managed-skill drift.

Recovery constraints:

- Owner-edited managed skills stop automatic migration until reconciled.
- A non-MOZAK file at `PREFIX/bin/mozak` is never overwritten.
- Corrupt or escaping `current` and `previous` links fail closed.
- The update channel is not a trust decision about project or knowledge content.
- If both version links are lost, reinstall a retained archive or rerun the bootstrap.

## Platform boundary

Delivery v1 publishes a statically linked Linux x86-64 musl binary, so it does
not inherit the build host's glibc floor. macOS, Windows and ARM64 are not yet
published.

---

The full delivery contract, including the ten-step update transaction, the
GitHub automation rules, and the eleven acceptance checks, is specified in
[`spec/github-delivery.md`](../../spec/github-delivery.md).
