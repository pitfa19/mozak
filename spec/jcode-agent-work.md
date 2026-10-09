# Jcode agent-work delivery contract (retired)

## Status

Retired in MOZAK 0.11.0 by owner decision on 2026-10-09.

`mozak setup jcode <plan|install|check> <HOME>` and its four managed skills
(`swarm-low`, `swarm-normal`, `teacher`, `mozak-jcode`) plus the
`swarm-prompt.md` and `prompt-overlay.md` payloads are no longer shipped. The
route no longer exists in the binary.

This file is kept, not deleted, because sealed goal evidence under
`.mozak/evidence/jcode-agent-work/` refers to this contract. The full
contract that those records describe is preserved in git history at
`v0.10.0`.

## What still applies

- Rollback to 0.9.x or 0.10.x still parses the 136-file managed generation.
  The installer keeps the Jcode custody reader for that purpose.
- Upgrading from 0.9.x or 0.10.x accepts the four retired skill files being
  absent. A modified managed file still refuses the upgrade.
- MOZAK never writes or reads an owner's `~/.jcode/config.toml`,
  `swarm-prompt.md`, `prompt-overlay.md` or credentials, before or after 0.11.
