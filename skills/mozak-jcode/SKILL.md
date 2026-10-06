---
name: mozak-jcode
description: Inspect and explicitly install MOZAK's opt-in Jcode Low/Normal profiles and teacher supervision policy without altering credentials or activating teacher mode.
---

# Opt-in Jcode agent work

1. Run `mozak setup jcode plan HOME` for the owner's real home directory.
2. Explain the listed settings and files. Install only with explicit owner consent:
   `mozak setup jcode install HOME`.
3. Verify with `mozak setup jcode check HOME`, then start a fresh Jcode session.

Requires Python 3.11+ and a compatible Jcode supporting the declared model ids,
effort controls, same-provider account failover and native swarm-deep mode.
No models, accounts, credentials or Jcode executable are installed by this route.
Ordinary `mozak setup install HOME` ships invocation skills only, not global
settings. Read the CLI report rather than inferring runtime readiness.

Default LOW. Explicit `/swarm-normal` selects NORMAL for this session only.
Teacher stays OFF until explicit `/teacher`, after `/effort swarm-deep`.
Existing sessions retain their captured prompts. Skill loading is not proof of
a model/effort switch or successful nested execution. Never claim runtime tests
from file parity. Missing second Claude account is not two exhausted accounts.
