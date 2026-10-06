# Optional Jcode agent-work profiles

1. Preview: `mozak setup jcode plan "$HOME"`.
2. With owner approval, apply: `mozak setup jcode install "$HOME"`.
3. Verify: `mozak setup jcode check "$HOME"`. Start a fresh Jcode session.

Python 3.11+ and compatible Jcode are prerequisites. Setup does not install
Jcode/models/accounts or touch credentials. Ordinary MOZAK installation delivers
invocation skills, but does not change your global Jcode settings. Plan is
read-only. Install defaults to LOW and keeps teacher OFF.

| Selection | Coordinator | Workers |
| --- | --- | --- |
| `/swarm-low` (default) | Sol 6.1 low | Sonnet 5.5 medium |
| `/swarm-normal` (medium alias) | Sol 6.1 medium | Opus 5.5 medium |

These are behavioral skills, not new native Jcode menu modes. A loaded skill
alone does not switch the running session's model/effort. Use supported current
session controls, or `/model gpt-6.1-sol` and `/effort low` or `/effort medium`.
Profile selections do not change the global LOW default.

For teacher supervision, enter `/effort swarm-deep`, then invoke `/teacher`.
Talk only to the teacher with your high-level task. Teacher briefs one development
coordinator, which manages workers and returns results for teacher auditing.
Teacher retains its invoking model/effort. Deep-mode entry may itself adjust root
effort, so inspect it rather than assuming it stayed unchanged. No idle
coordinator is spawned without a task. Turn off with `teacher mode off`.

Claude quota fallback uses the other owner-configured Claude OAuth account at
the same selected worker model. If both are exhausted, the coordinator completes
the work directly. No alternate provider or paid API substitution.

Setup preserves unrelated TOML/comments and overlay prose. Changed originals are
backed up under `.jcode/settings-backups/mozak-agent-work/`. Drifted invocation
skills or swarm policy, malformed/ambiguous owned TOML, symlinks, occupied locks
and concurrent changes are refused. Inspect/reconcile those owner files before
retrying. There is no force-overwrite switch. Delivery rollback restores managed
skills only, not your opt-in global Jcode configuration.
Updates preserve pre-existing invocation files for later rollback using private,
home-pinned custody records. Missing or corrupt custody refuses the downgrade
instead of erasing owner files.

Ready means installed file/settings parity, not a live model/account or nested
hierarchy test. Existing sessions retain their old captured prompt. Compatible
models and configured accounts remain host prerequisites.
