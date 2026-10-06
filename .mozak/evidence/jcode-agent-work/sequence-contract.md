# Owner-approved Jcode bundle delivery sequence

Owner: pitfa. Decision observed: 2026-10-06T20:05:42Z.

The owner approved adding the discussed setup to MOZAK, publishing a new stable
MOZAK version containing it, and installing that stable version locally.

The exact accepted request is recorded in inputs-jcode-agent-work-001 and the
ready goal is validated by the public `mozak planning next` command. This file is
an execution-scope record, not a substitute for strict approval artifacts on
unrelated registry, KB, or release-of-knowledge commands.

## Required sequence

1. Bundle Low/Normal/teacher invocation skills and an explicit opt-in Jcode setup.
2. Verify native CLI workflows, safety refusals, idempotency, and preservation.
3. Publish a new stable tool version only after local gates pass.
4. Install that published, checksum-verified stable tool and apply/check the setup.
5. Confirm actual local version, managed skill parity, Jcode settings, unchanged
   credentials/unrelated configuration, and preserved previous-build rollback.

## Scope and runtime boundaries

- Low default: Sol 6.1 low coordinator, Sonnet 5.5 medium workers.
- Normal: Sol 6.1 medium coordinator, Opus 5.5 medium workers.
- Teacher is off by default, retains the invoking session's model/effort, briefs
  a development coordinator, and keeps the owner as its only user interface.
- The nested hierarchy requires Jcode's actual native swarm-deep mode. Prompt
  installation alone cannot switch a mode or override native spawning gates.
- Claude allowance fallback uses the other configured Claude OAuth account at
  the same selected worker model, then the Sol development coordinator works.
- No secrets, credentials, projects, KBs, or unrelated preferences are bundled.
- Full native teacher execution and actual two-account quota exhaustion must
  not be claimed from installer tests or metadata alone.

## Fresh baseline observed

The local checkout was initially v0.8.1 at 7909d4c. Public authenticated GitHub
release inspection showed v0.8.2 was already stable on October 6, 2026 at 10:08:30Z.
The explicit remote refs/heads/main was safely fast-forwarded to 940f2d9c87e1.
The next candidate is v0.9.0, with the same dependency pins. The unrelated
untracked potjera-app-hyperresearch request is preserved and excluded from commits.
