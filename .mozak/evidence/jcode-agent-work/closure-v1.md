# Jcode agent-work stable publication and owner installation closure

Observed 2026-10-06T20:38Z. Completes the owner-approved sequence: bundle,
validate, publish a new stable MOZAK, install it locally and observe acceptance.
The separate pinned release-candidate ledger records the tests, witnessed
rollback correction and limits. No pinned predecessor evidence was rewritten.

## Stable identity and publication

- Repository: `pitfa19/mozak`, stable tag `v0.9.0`.
- Source commit: `4b50e115741deab7e8b95951b95766fbfc658a7e`.
- GitHub CI run `37527099163`: completed, success, exact source commit.
- Static main publication run `37527097752`: completed, success, exact source.
- Stable publication run `37527479257`: completed, success, exact source.
- Release published at `2026-10-06T20:36:48Z`, draft false, prerelease false.
- Assets: `mozak-0.9.0-4b50e115741d-linux-x86_64.tar.gz`,
  `release-manifest.json` and `SHA256SUMS`. The established workflow checked
  archive SHA-256 and real static packaged acceptance before publication.

## Real owner installation path and observed result

`mozak update --channel stable` downloaded and validated the published stable
manifest/archive through the existing launcher. No local build or prerelease was
substituted. Active build is `0.9.0-4b50e115741d`. Previous build
`0.8.1-71d2f0abb01a` remains preserved. Stable channel, daily interval and automatic
updates true were preserved. `mozak --version` returned `mozak 0.9.0`.

`mozak setup check /home/pitfa` returned parity true, all 136 managed files.
`mozak setup jcode plan /home/pitfa`, install and check all returned ready after
archive installation. Explicit opt-in install returned no changes and
mutation false because the approved original policy/config/profile files already
matched. The archive added only the previously absent helper invocation among
Jcode agent-work files. `mozak doctor /home/pitfa` returned ready.

SHA-256 checks taken immediately before update and checked after explicit opt-in
passed for config.toml, swarm-prompt.md, prompt-overlay.md, auth.json and
openai-auth.json. No credential values were displayed, copied or modified.
Native account availability and quota were not changed. Project/KB context
remained valid, and the unrelated untracked Potjera request remains untouched.

## Real fresh Jcode acceptance

The installed skill registry was refreshed without activating a profile or
teacher mode. A new, empty native Jcode session was created with the public debug
interface and its assembled context and metadata inspected without inference.
It reported model `gpt-6.1-sol`, provider OpenAI, native mode regular. The context
contained all four invocation skills, the LOW-default overlay and teacher-OFF
policy. The acceptance-created empty session was then destroyed. No existing
session was reset, switched or interrupted. Installed configuration has the
approved low coordinator and medium Sonnet worker defaults and account policy.
This observes actual fresh-session prompt/discovery, not a mere file inspection.

## Claim limits and completion assessment

The bundle, stable release, local verified installation and fresh-session policy
acceptance are delivered. Both Claude accounts previously reported exhausted
five-hour allowance, and the coordinator directly completed work as approved.
No alternate worker provider or paid API route was introduced.

A complete live teacher -> Sol development coordinator -> Claude worker run is
still unverified because Claude allowance is exhausted. The ready CLI report
correctly retains runtime.verified false. Teacher requires `/effort swarm-deep`
and explicit `/teacher`, and profile skills must align actual current session
model/effort rather than pretend a runtime switch. Existing sessions retain their
captured prompts. These are behavioral skills, not new native menu modes.

## Locally retained observation pins

Under `/home/pitfa/.jcode/scratch/swarm-settings-validation/`:

| Observation | SHA-256 |
| --- | --- |
| stable-release.json | 5a460a5745266a2dbd162737f4392c276ffe346460445bec1bf109c3a076453d |
| delivery-after.json | ae7191f8fa2ad311590d5053f6d67999f4970fb1ef7dc4dc8c562fa566f02096 |
| setup-after.json | 01a2692c10af08514ea5485751b08e8410417b7eba5bfad86fd161f007c444cc |
| owner-optin-check.json | aa605c8ef468b19ec27b90cab869fae46a41fa5941ae7f78db47660c1b2e7044 |
| final-native-context.json | 5596de7b70cb0b2789d752abef2d6c749e1fd949f18679d7e74458edfb02ef3a |
| final-native-info.json | 9e210f9d74ce9ae653cb6d5d7e5f7bb9c21ffb16e217cb245cec355399058e95 |
| owner-doctor.json | 5444c4d96c26a70765e5d1160191e28dacf5f16db4352f2eb93069372db40af6 |

No raw local configuration or credential material is published as evidence.
