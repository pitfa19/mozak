# ADR 0005: Remote-only project registrations

## Status

Accepted for 0.10.

## Context

A registration pinned a project to an absolute local checkout. A machine that
wants a project in its registry but not on its disk, for example a second
machine with little storage, could not have one: `project context` needs the
manifest and idea bytes to hash, and a missing checkout made the project invalid.

The core binary performs no networking. That rule exists so that nothing is
accepted from outside without an explicit step, and it is stated in the project
rules. Cloning a repository is a network effect, so any remote-only support has
to decide where that effect lives.

## Decision

A registration may carry an optional `remote` block: a git URL and an exact
pinned commit. Its root is a per-machine cache path,
`$XDG_CACHE_HOME/mozak/projects/<id>` (default `~/.cache/mozak/projects/<id>`).

Three commands implement it.

- `mozak project register-remote SPECS APPROVAL` adds remote-only
  registrations. It reads only local files, performs no networking, and requires
  an owner approval whose `specs_sha256` equals the exact specs file and whose
  intent is `project register-remote`. A duplicate id is refused.
- `mozak project fetch ID` is the one command that touches the network. It
  fetches exactly the registered URL at exactly the pinned commit, then verifies
  the checkout against the registration: the HEAD must equal the pinned commit,
  and the project's manifest and idea hashes, id, name and declared revision
  must equal the registered values. On any mismatch the checkout is removed and
  the command fails. An existing cache is only advanced, never replaced.
- `mozak project prune [ID]` deletes cached checkouts of remote-only
  registrations only. It refuses a local registration and any path other than
  the expected cache path.

`project context` never clones. For an unfetched remote-only project it reports
the project as invalid with the instruction to run `project fetch`.

## Rules that keep the existing guarantees

- Anything fetched is a proposal until its bytes match the owner-approved pins.
  A remote that rewrites history or serves different bytes is rejected.
- The URL is restricted to `https://` without credentials, or the fixed
  `git@github.com:` form. Local paths, `file://`, option-like values and
  whitespace are refused when registering.
- A remote-only registration never self-reconciles drift in `project context`.
  It is pinned to a commit, so drift is reported and a change needs a new
  registration.
- Ordinary registrations are unchanged. The `remote` field is optional and is
  omitted from the serialized record when absent, so existing config bytes and
  their hashes stay identical.

## Alternatives rejected

- **Clone inside `project context`.** It hides a network effect inside a read
  route and makes every context call able to change the disk.
- **Keep core offline and have the agent host clone.** It leaves no record that
  a checkout was verified, and each host would reimplement the verification.
- **Relative or variable paths in the KB registry.** Scope manifests hold no
  absolute paths. Only `kb.json` and `config.json` do, and both are per machine
  by design, so each machine writes its own paths. This avoids changing hash
  pinned core code.

## Consequences

- One documented exception to "the core does no networking": `project fetch`,
  which declares `"network": true` in its receipt. Every other command, including
  `register-remote` and `prune`, reports `"network": false`.
- A fetched checkout persists in the cache until pruned.
- `project fetch` depends on `git` and on the machine's own git credentials. It
  disables interactive prompts, so a missing credential fails instead of hanging.
- Remote-only registrations pin a commit, so following new upstream work is an
  explicit re-registration.
