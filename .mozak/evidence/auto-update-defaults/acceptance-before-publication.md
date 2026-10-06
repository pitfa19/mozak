# Auto-update defaults acceptance, 2026-10-05

Owner approval: 2026-10-05T21:24:06Z, accepted inputs inputs-auto-update-defaults-001.

## Whole-result checks

Task 790958fqt7 completed at 2026-10-05T21:30:20Z, exit 0. Checks ran against the entire scoped result after correcting the independent review findings.

| Requirement | Public acceptance check | Observed result |
| --- | --- | --- |
| Fresh archive defaults on | test_delivery_update.py installs an actual archive without enable flags, reads delivery status, starts CLI against a local release fixture | auto_update true, stable, 86400 seconds; startup advances REV1 to REV2 with previous REV1 |
| Fresh GitHub bootstrap defaults on | test_github_bootstrap.py builds and invokes bootstrap against local release assets | Fresh configuration enables auto updates |
| Preserve saved false on reinstall | Archive reinstall and ordinary GitHub re-bootstrap of explicit opt-out | false remains false and CLI does not update |
| Explicit disable honored | Archive --disable-auto and bootstrap --no-auto-update | false, original build retained |
| Missing config defaults on | test_auto_update_defaults.py launcher default_config | true, stable, 86400 seconds |
| Explicit enable/disable overrides saved preference | test_auto_update_defaults.py configure_delivery | both directions honored |
| MCP does not trigger update | Packaged mozak-mcp initialize with stale timestamp and a newer fixture release | initialize succeeds; active build and zero timestamp unchanged |
| Checks remain bounded and safe | Existing packaged daily-check, checksum rejection, update/rollback and offline fallback tests | Passed; project/KB sentinel preservation passed |
| No network in bootstrap tests | Launcher fixture supplied by test environment independently of curl stub | Final bootstrap suite passes using local assets |
| Documentation and shell validity | check_docs_match_binary.py, bash -n scripts/install.sh, git diff --check | All exit 0 |

Python unit discovery: 44 tests passed. Packaged delivery, fresh-machine and bootstrap acceptance suites all passed. Logs are in /home/pitfa/.jcode/scratch/mozak-auto-default-acceptance/{python-final,delivery-final,fresh-final,bootstrap-final,docs-final}.log. These are observed test outcomes, not a claim about all possible networks or operating systems.

## Actual owner installation

After release-owner handoff, task 9552900ibp invoked `mozak update --channel stable --enable-auto`, followed by delivery status and setup check. Completed at 2026-10-05T21:32:36Z, exit 0.

Observed: active build 0.8.0-5f30e565d29c, channel stable, auto_update true, check_interval_seconds 86400, previous build 0.7.1-main-3de281a0ba98. Managed setup check passed.

## Delivery boundary

The local policy is enabled. The default-on source changes are verified but are not part of the frozen v0.8.0 tag. Follow-up stable publication remains pending the release owner's version/tag/main ownership handoff. Do not report the archive default as shipped until the follow-up published archive passes acceptance.
