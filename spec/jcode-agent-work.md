# Jcode agent-work delivery contract

`mozak setup jcode <plan|install|check> <HOME>` is an offline opt-in local
configuration route. Python 3.11+ is required. It never starts agents, calls a
model, installs Jcode, creates accounts, handles credentials or mutates KB state.
The compatible Jcode host must support the declared model identifiers, effort
controls, same-provider account failover and native swarm-deep hierarchy.

## Profiles and authority

LOW is the default: `gpt-6.1-sol` low coordinator and
`claude-oauth:claude-sonnet-5-5` medium workers. NORMAL (medium alias) is Sol medium
and `claude-oauth:claude-opus-5-5` medium workers. Profile selections are
session-local. Teacher is OFF until explicitly invoked. Teacher keeps its
invoking model/effort, talks to the owner, and briefs one Sol development
coordinator. That coordinator owns workers. The root retains the sole shared-plan
runtime slot. Native swarm-deep must be checked before nested spawning.

On genuine quota exhaustion, native same-provider failover tries the other
configured Claude OAuth account with the same worker model. If both exhaust,
the development coordinator continues directly. No provider or paid API
substitution, credential manipulation, silent retries or duplicate execution.
Missing accounts and authentication failures must not be called quota evidence.

## File custody and checks

Ordinary setup embeds four Jcode-only SKILL.md files: swarm-low, swarm-normal,
teacher and mozak-jcode. Its exact generation contains 136 managed files.
Ordinary setup/update/rollback do not opt in or own Jcode global policy/config.
An update that newly acquires invocation files records their original bytes or
absence in a private build-pair and home-pinned custody record. Downgrading the
managed generation restores pre-existing files and removes only newly installed
ones. Missing, altered, unsafe or wrong-home custody fails closed before skill
migration. This custody applies only to the four Jcode invocation files, never
config, global policy or credentials.
The separate opt-in route manages those four invocation files, swarm-prompt.md,
the agent-work overlay content, and only ten declared fields in config.toml.
It preserves unrelated TOML semantics and comments. Unsupported inline/dotted
or complex owned-field edits fail closed rather than being reformatted.
An identical pre-existing approved policy is adopted without mutation. Other
swarm policy or skill drift is refused. Unrelated overlay text is retained,
with a delimited block appended. Divergent existing agent-work overlays require
owner reconciliation rather than a second competing policy.

Plan/check perform no writes. Plan returns 0 with planned/ready. Check returns
ready/0 or incomplete/2. Invalid, drifted, unsafe, locked and concurrent-change
targets return invalid/3. Invocation errors return 1. Reports contain only
declared settings, relative paths, hashes, effects, prerequisites and readiness,
never the owner's config values. Runtime verification is always explicitly false.

Install preflights every target and ancestor, refuses static symlinks and
non-regular targets, bounds reads to 2 MiB, takes a nonblocking advisory lock and
revalidates bytes. Changed existing files receive private content-addressed
backups. Writes use atomic replacement and fsync with readback. An interrupted
in-process commit attempts reverse rollback without overwriting a concurrent
third-party modification. This is not a transaction across process death or
hostile concurrent ancestor replacement. Backups and the persistent lock file
may remain after failure. No runtime account availability is inferred.

Existing sessions retain captured prompts. Fresh-session configuration parity
is not proof of nested teacher execution or native profile switching. Report
these runtime acceptance boundaries separately from packaged delivery tests.
