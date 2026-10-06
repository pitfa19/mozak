# Whole-result acceptance recheck and requirement traceability

Observed 2026-10-06T20:44Z against source d012c4d441281c5467e45e90a876ca6ecb4ba508
and the actual installed stable binary 0.9.0-4b50e115741d. Background task
431224qee3 exited 0 after 24.88 seconds. No product code changed since stable.

## Explicit owner requirements

| Requirement | Concrete acceptance path | Observed result and limit |
| --- | --- | --- |
| LOW default: Sol 6.1 low, Sonnet 5.5 medium | Installed `mozak setup jcode check /home/pitfa` settings fields plus previously recorded real fresh Jcode assembled context | Ready; exact low root/Sonnet medium config; fresh context Sol and LOW policy. Actual inference effort and successful Sonnet leaf execution remain unverified. |
| NORMAL/medium: Sol medium, Opus medium; LOW remains global default | Exact managed swarm-normal payload through installed setup parity; profile instruction inspection against requested IDs and efforts | Exact invocation skill shipped, defines requested models/efforts and session-local selection. Actual NORMAL invocation/model transition is not live-tested. |
| Teacher only on invocation; user speaks solely to teacher | Exact teacher payload plus actual fresh session regular-mode/teacher-OFF context | Opt-in policy and discovery verified. Successful sole-interface teacher graph is not live-tested. |
| Teacher deploys coordinator; coordinator owns workers and audits | Exact teacher and swarm policy define subtree ownership, selected Sol effort, leaf models and review gates | Packaged policy verified, execution unverified. Native swarm-deep prerequisite prevents pretending regular-mode workers are the hierarchy. |
| Claude quota: second configured account at same model, then coordinator works | Installed same_provider_account_failover true and cross_provider_failover off; earlier real worker failures and direct coordinator continuation; refreshed native `jcode usage --json` | At 20:44Z both Claude accounts report 100% five-hour allowance, reset about 20:49:59Z. Direct-work continuation observed earlier. Successful same-model second-account inference is blocked and unverified. |
| Persist for future sessions | Actual fresh native Jcode session context retained in closure evidence; current owner setup check | Installed defaults and all four skills discovered by a real new session. Already-captured sessions are explicitly excluded. |
| Ship options with MOZAK | Fresh genuine archive using the installed stable binary, installed launcher setup/check/opt-in/idempotency | PF-0025 packaged acceptance passed. Ordinary setup ships invocations without global opt-in. |
| Publish new stable and install locally | Exact GitHub stable publication and real owner `mozak update --channel stable` from closure; current version and public setup checks | Stable v0.9.0 delivered and active, 136-file parity. No local substitute binary or new release used for this recheck. |

## Changed public outputs and failure boundaries

| Public output or boundary | Named concrete check rerun | Observed result |
| --- | --- | --- |
| `setup jcode plan/check/install`, ready/incomplete exit semantics, idempotency | `real_cli_plan_check_install_and_idempotency` | Passed against built real CLI. |
| Retained TOML comments/settings, overlay prose, credential sentinel and exact backups | `preserves_comments_unrelated_settings_overlay_credentials_and_backups` | Passed. Owner five-file pre-install baseline also passed again after broad tests. |
| Malformed/ambiguous TOML fails before target writes | `malformed_and_ambiguous_toml_refuse_before_any_skill_write` | Passed. |
| Ordinary setup does not opt in; managed drift refuses | `base_setup_ships_invocations_but_never_opts_in_and_drift_is_refused` | Passed. |
| HOME, ancestor, directory and leaf symlinks refuse | `home_ancestor_directory_and_leaf_symlinks_are_refused` | Passed. |
| Real CLI held lock refuses without target changes | `test_actual_cli_locked_install_has_no_target_writes` in rerun Python suite | Passed. |
| Partial-write rollback, preflight changes, corrupted backups, wrong field types/complex forms, managed overlay drift | Five named supplementary tests in scripts/test_jcode_setup.py | Passed. Fault injection is supplementary, not a live user failure trial. |
| Fresh installed archive launcher with independent home/prefix | `test_fresh_machine_release.py` using actual installed stable binary | Passed real installed public workflow. |
| Archive update/channel/auto-check/downward rollback | `test_delivery_update.py` using actual installed stable binary | Passed, release lookup uses an offline fixture. |
| 120-to-136 payload custody and invalid-home custody refusal | `test_jcode_upgrade.py` genuine retained 0.8.1 and installed 0.9.0 binaries | Passed. Both repackaged with current scripts, not original historical archive scripts. Owner profiles/config/policy/credential sentinels retained. |

Concrete improvement remains the witnessed earlier rollback deletion of an owner
profile and its corrected identical migration now passing again. This is direct
before/after behavior, not inferred improvement from passing aggregate counts.

## Rerun observation pins

Logs under /home/pitfa/.jcode/scratch/swarm-settings-validation:

- recheck-cli.log: 629707b8ae88d6230d4687aadd36e4030e607b12a601a3a64c5301a5e9f1506e
- recheck-python.log: 308357db1b1a0ffdfae7f47cf8d642b2345f980edff7b6a01e6ce59f09e5091f
- recheck-fresh.log: 35adf6bfff7d4ae7da1107e2fb26bcfd5ab52552013f96001d554f2069cd429b
- recheck-delivery.log: 4b0f1c4d7a7e25235fd19a1138902c08e337f72fa2d7dd2d8622083c802e02ed
- recheck-upgrade.log: ad669f315e21f001c6bb9980388f6229b624a736dd38cde82792aad27fb1bfb5

The mapping is complete as an accounting of observations and gaps, not complete
runtime verification. Whole delivery acceptance passed. Runtime profile and
teacher execution remain acceptance-blocked or unexercised as stated above.
No existing user session, credential, active version or stable tag was changed.
