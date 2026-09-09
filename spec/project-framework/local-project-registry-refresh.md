# Local project registry refresh contract

`project register` creates only an absent local config. `project refresh` is the
distinct owner-authorized replacement boundary for an existing config.

Refresh accepts the unchanged strict `project discover` proposal. The proposal
must pin the SHA-256 of the existing config and represents the complete reviewed
replacement, so missing records are removals and changed records are new pins.
The strict refresh approval pins schema version 1, `decision: true`,
`intent: "project refresh"`, proposal digest, target config path, non-empty owner,
canonical UTC approval time, and non-empty rationale.

Before mutation, the implementation validates the existing config, proposal and
approval, target and all path components, current config base hash, live KB path
and bytes, and every proposed live project manifest and idea byte pin. Any stale,
invalid, drifted, symlinked, non-regular, or unsafe input fails closed.

Replacement uses an exclusive local lock, repeats the base-hash check inside the
critical section, writes and syncs a temporary regular file, atomically renames
it over the target, and syncs the parent directory. Therefore concurrent owners
cannot both commit from one base and the old config remains intact before the
atomic replacement point. The deterministic receipt reports exact counts and
states `trust_transfer: false` and `auto_discovery: false`.
