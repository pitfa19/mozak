# Post-closure evidence calibration

Observed 2026-10-06T20:42Z. This supplements, rather than rewrites, the pinned
candidate and closure records for the owner-approved packaging and delivery goal.

## Refreshed real acceptance observations

- Installed public `mozak --version` returned `mozak 0.9.0`.
- Public `mozak setup check /home/pitfa` and `mozak setup jcode check /home/pitfa`
  both exited 0. Their exact JSON responses remain locally retained as
  postclosure-parity.json and postclosure-check.json in the validation scratch.
- The immediate pre-install SHA-256 baseline still passes for config.toml,
  swarm-prompt.md, prompt-overlay.md, auth.json and openai-auth.json. Credential
  bytes were neither printed nor changed.
- Closure commit 3b15faf CI run 37528121963 and publication run 37528121815
  are completed with success. This does not move stable tag v0.9.0, which remains
  pinned to source 4b50e115741deab7e8b95951b95766fbfc658a7e.
- Repository worktree has only the unrelated pre-existing untracked Potjera
  request. Project context and baseline tool-stack check both exited 0.

## Boundaries that must not be upgraded to runtime proof

The successful prior-binary migration used genuine 0.8.1 and 0.9.0 embedded
binaries, but packaged both using current archive scripts. It demonstrates the
new installer's upgrade and downward rollback with owner skill custody. It does
not demonstrate compatibility with every script in the originally published
0.8.1 archive, nor a second offline rollback toggle through the original old
launcher. No rollback was performed on the owner's active installation. A
second historical offline toggle is untested, not an observed failure.

Fresh native session discovery demonstrates Sol model identity and assembled
LOW-default, teacher-OFF policy with all invocation skills. Config values and
skill instructions alone do not prove effective inference effort, profile
switching, same-model cross-account failover, or teacher/coordinator/worker
execution. No full live teacher hierarchy was exercised. Earlier Claude quota
observations explain why the earlier worker attempts failed, but are not a claim
about current account availability. Teacher remains opt-in and was not activated
for this audit. The setup report correctly retains runtime.verified false.

## Calibrated completion

The requested MOZAK bundle, stable publication and local installation are
completed with direct real delivery acceptance. Runtime orchestration remains
unverified and must not be described as tested merely because the installer is
ready. Overall feedback is usable and representative of the full settings
request, with partial runtime traceability, rather than a closed end-to-end
runtime proof. This bounded audit makes no new model calls, changes no existing
sessions or credentials, and creates no substitute stable release.
