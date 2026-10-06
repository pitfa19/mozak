<!-- User-approved personal swarm policy, 2026-10-06. Global default: low. -->

# Swarm work profiles

These are behavioral profiles, not native Jcode menu options. Default to LOW
unless the owner explicitly selects NORMAL for this session. "Medium profile"
means NORMAL. Never infer NORMAL from the worker's medium effort.

| Profile | Coordinator model | Coordinator effort | Worker model | Worker effort |
| --- | --- | --- | --- | --- |
| low (default) | gpt-6.1-sol | low | claude-oauth:claude-sonnet-5-5 | medium |
| normal | gpt-6.1-sol | medium | claude-oauth:claude-opus-5-5 | medium |

- Apply the selected profile to all implementation, design, research, debugging,
  review, verification, and summarization workers.
- Pass both model and effort explicitly on spawn, assign_task, fill_slots,
  run_plan, and replace. Always label spawned agents by responsibility.
- Brief every spawned agent with the selected profile, its role, and this policy,
  especially because new child sessions otherwise default to LOW.
- Do not silently change models or choose a paid API route.
- The current root is the coordinator outside teacher mode. If its actual model
  or effort differs, use supported session controls to align it, or state the
  exact required /model and /effort changes. Do not claim a switch without evidence.

# Claude allowance fallback

- Keep provider.same_provider_account_failover = true. On a genuine Claude
  allowance/quota exhaustion, let native same-provider failover try the other
  configured Claude OAuth account with the SAME selected worker model/effort.
- Never read, copy, rotate manually, or print credential values to implement this.
- If both accounts are exhausted, the Sol coordinator takes over the unfinished
  work itself at its selected effort. Preserve checkpoints and inspect partial
  changes before resuming. Stop repeated worker retries and avoid duplicate work.
- If no second configured account is available, report that fact and let the
  coordinator continue. Never claim that both accounts were tested if they were not.
- Authentication, permissions, missing model, or unrelated errors are not proof
  of exhausted allowance. Diagnose those separately. If work cannot be delegated,
  the coordinator may finish it directly and disclose the reason.
- Do not use automatic cross-provider worker substitution as the quota fallback.
  In any session where a provider-failover countdown appears, retain the Claude
  route rather than accepting another worker model, then hand work to the coordinator.

# Teacher mode (opt-in, session-local)

When the owner says "teacher mode", "be the teacher", or invokes /teacher:

- The current session becomes the teacher and remains the ONLY user interface.
  Preserve its current model and effort. Do not enable teacher mode by default.
- Teacher briefs ONE development coordinator with the owner's high-level intent,
  relevant MOZAK context, scope, acceptance checks, selected profile, and fallback.
  Spawn that coordinator on gpt-6.1-sol with LOW or NORMAL coordinator effort.
- The development coordinator briefs, spawns, manages, and integrates its workers.
  It reports results and evidence to the teacher. The owner never has to write a
  coordinator prompt or interact directly with it.
- Teacher guides scope, reviews progress and diffs, audits validation evidence,
  requests corrections, and brings only high-level decisions/blockers to the owner.
  Do not declare success solely from a worker's summary.
- This hierarchy requires the ROOT session's native swarm-deep mode. Check the
  actual mode before spawning the coordinator. If it is not enabled, explain the
  /effort swarm-deep prerequisite once. Do not simulate the hierarchy with workers
  spawned directly by the teacher and do not bypass the native spawn gate.
- Native Jcode reserves the one shared-plan coordinator slot for the root.
  The teacher holds that runtime slot. The nested development coordinator is a
  subtree owner and uses spawn, DMs, and reports, not root-only shared-plan actions.
  "Coordinator" here describes the development role, not a second runtime slot.
- In teacher mode the quota fallback is the DEVELOPMENT coordinator doing the
  work itself, not the teacher switching to implementation.
- "Teacher mode off" returns the current session to ordinary interaction.
  Reconcile any running child work before stopping anything. Profile is retained.

# Structure

- In ordinary/light swarm, only the root may spawn. Workers never spawn children.
- In teacher mode with swarm-deep, the teacher spawns its development coordinator,
  which spawns workers. Leaf workers must not spawn more generations.
- Recursive spawning outside teacher mode still requires explicit swarm-deep.
- Follow MOZAK project instructions before project work. These profiles do not
  authorize onboarding, source changes, destructive actions, or extra spending.
