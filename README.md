<p align="center">
  <img src="docs/diagrams/mozak-architecture.png" alt="MOZAK, drawn as a brain: an idea reaches your agent harness, the skill module routes it to research, plans and scope; adapters feed research from arXiv and GitHub, improve-lab reads all three, and scope publishes into a KB registry and meta KB" width="100%">
</p>

<p align="center">
  <sub><b>skill</b> routes your request &middot; <b>research</b> records evidence through adapters &middot;
  <b>plans</b> turns accepted inputs into a goal DAG &middot; <b>scope</b> holds it &middot;
  <b>meta-kb</b> relates it across projects &middot; <b>improve-lab</b> keeps all five current</sub>
</p>

<p align="center">
  <b>Evidence, decisions, and live project state, in one offline binary your agent can read.</b>
</p>

<p align="center">
  Not a notes folder. Research runs with pinned sources, decisions that only you accept,
  and a goal graph that knows what is actually done. Self improving, under your review.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green.svg" alt="license MIT"></a>
</p>

## Install

Takes about 5 seconds. No account, no server, no Node.

The repository is currently **private**, so the installer is fetched with an
authenticated GitHub CLI rather than from a public URL.

```bash
gh auth login
gh api repos/pitfa19/mozak/contents/scripts/install.sh --jq .content | base64 -d | bash
mozak doctor "$HOME"
```

Or 🔗 [check the installation instructions](docs/distribution/INSTALL.md).

## Three things it holds

A notes file holds one of these. MOZAK holds all three, and keeps them
connected.

| | What it means | Why a notes file fails |
|---|---|---|
| **Evidence** | Every paper, release and observation you gathered, pinned to an exact source and hash. | Prose forgets where a claim came from, so nobody can check it later. |
| **Decisions** | What you accepted as true, and what you rejected, each recorded with its reason. | A rejected option looks identical to one nobody thought of. |
| **State** | A goal graph that knows what is done, what is ready, and what is blocked behind what. | A checklist cannot tell you why goal 7 is still not startable. |

No server, no database, no account. Two commands to start:

```bash
mozak project init .            # onboard a repository
mozak project overview .        # what is ready to work on?
```

## The same question, twice

> **You:** continue the auth refactor.
>
> **Without MOZAK:** the agent re-reads the repo, re-derives a plan, forgets you
> rejected session tokens last week, cites a benchmark nobody verified, and
> quietly overwrites a decision you already made.

> **You:** continue the auth refactor.
>
> **With MOZAK:** the agent opens with what you already decided, which options
> are off the table and why, and the one piece of work that is actually ready
> to start. It proposes the next step. Nothing you accepted changes unless you
> say so.

You talk to the agent, not to the CLI. MOZAK ships a skill that turns a request
like that into the exact command, so `mozak doctor` is usually the only thing
you type yourself. The [reference](docs/REFERENCE.md) lists a prompt, a
command, and the rule for every route.

## What a week looks like

Six beats, one per module. Substitute your own field: the shape does not change.

**1. Research.** An adapter reads a source at an exact commit and hands back
forty candidates with links, matched interest clusters, and the gaps it could
not cover. Not a summary. Nothing has entered your knowledge base yet, because
retrieved evidence is proposal-only.

**2. Scope.** You accept three of them into a Topic. A Topic is a Scope with no
repository: the thing you are studying, not the thing you are building. Those
three are now hashed and immutable, and their provenance is pinned.

**3. Meta KB.** One of them describes a technique worth reusing, so it becomes a
**Concept**: the mechanism, the invariant that must hold, and the six
assumptions it rests on. The Concept is advisory. It authorizes nothing.

**4. Plans.** Months later a different repository wants that technique. It
writes a **Translation**, valid only if the target re-derives every assumption
in its own codebase. Four hold. One is replaced, so this is qualified adoption,
not adoption. One cannot be checked, and because that one is load-bearing,
MOZAK refuses the Translation outright rather than letting a borrowed idea in
on an assumption nobody verified. You go and check it, it holds, and only then
does the mechanism become a goal in that project's DAG, blocked behind the work
it actually depends on.

**5. Skill.** New week, new session, cold agent. You say "continue." It reads
the pinned decisions, the ready goals, and the rejected options, then proposes.
Nothing you accepted changes unless you say so.

**6. Improve Lab.** The same adapter also caught something about how agent work
gets evaluated. The Lab turns it into a plan card for changing MOZAK itself,
citing the source claim, carrying two acceptance checks. Then it stops and
waits for your review.

A memory tool can do step 5. It cannot do step 4, because it does not know that
an idea has assumptions, or that they might not survive the trip.

## Self improving, under your review

MOZAK ships frozen. The field it tracks does not.

MOZAK has a module whose job is improving the other five. The **Improve Lab**
reads new papers and tool releases as they land, extracts the mechanism, and
turns it into a plan card with acceptance checks. It cites real claims or the
plan is rejected. Then it stops and hands you the packet.

That last part is the whole design. Self improvement without a gate is a loop
that amplifies its own noise, so MOZAK proposes and you decide. The path from
*the field moved* to *MOZAK moved* is a command, not a rewrite, and it never
runs behind your back.

## The modules

Six of them. Each owns one boundary and refuses to cross it. Their ids are
`scope`, `research`, `plans`, `meta-kb`, `improve-lab` and `skill`, which is
exactly what `mozak lab modules` prints.

| Module | Owns | Built from |
|---|---|---|
| **Scope** | The container for work: a Topic you study or a Project you change, holding hashed immutable inputs. A Project is a kind of Scope, not a peer. | [MDKG](https://github.com/nickreames/mdkg) (Git as authority, database as projection), [Tieline](https://github.com/knoxgraeme/tieline) (contract/evidence/derived planes), [Backstage](https://backstage.io/docs/features/software-catalog/) (stable identity, typed relations) |
| **Research** | Bounded observation, of the world through adapters or of your own finished work as a case. Always proposal-only. | [DVC](https://dvc.org/doc/user-guide/pipelines)/MLflow/OpenLineage (run provenance), [Graphiti](https://github.com/getzep/graphiti) (recorded vs valid time), *Evaluating Skills, Not Just Agents* ([arXiv:2608.20614](https://arxiv.org/abs/2608.20614)) §7, *Harness-of-Harness* ([arXiv:2609.01481](https://arxiv.org/abs/2609.01481)) §3.4.3 |
| **Plans** | Accepted inputs, the goal DAG derived from them, execution against an observed revision, and the sealed, attested package finished work becomes. | [OpenSpec](https://github.com/Fission-AI/OpenSpec) (always print the resolved scope), [OCI](https://github.com/opencontainers/image-spec/blob/v1.1.1/manifest.md) (descriptor shape), [in-toto v1](https://github.com/in-toto/attestation/blob/main/spec/v1/statement.md) + [SLSA](https://slsa.dev/spec/v1.2/build-provenance) (digest-pinned subjects) |
| **Meta KB** | Everything crossing projects: registered Scopes with pinned hashes, typed relations, and Concepts that only transfer through a Translation. | [MDKG](https://github.com/nickreames/mdkg) (cross-repo views stay read-only), [OCI distribution](https://github.com/opencontainers/distribution-spec/blob/main/spec.md) (a tag is a pointer, never authority), [MOOSEDev](https://github.com/Trivyn/moosedev) (lifecycle state instead of ranking) |
| **Improve Lab** | An improvement question turned into reviewable plans. Stops at your review. | *On the Fragility of Self-Improving Agents* ([arXiv:2608.18066](https://arxiv.org/abs/2608.18066)) (loops amplify evaluation noise and hide task-order dependence) |
| **Skill** | How MOZAK reaches you: request to route, the shape of the answer, and installation. | [i-have-adhd](https://github.com/ayghri/i-have-adhd) (lead with the action, number the steps, cap the list, no preamble) |

## Start here

| If you want to | Read |
|---|---|
| Use MOZAK for the first time | [`docs/QUICKSTART.md`](docs/QUICKSTART.md) |
| Understand how it is built | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| See every module and where it came from | [`docs/MODULES.md`](docs/MODULES.md) |
| See the modules as a flow diagram | [`docs/MODULES.md`](docs/MODULES.md#how-they-relate) |
| Explore the flows as explorable diagrams | [`docs/diagrams/`](docs/diagrams/) |
| Know why it exists | [`docs/WHY-MOZAK.md`](docs/WHY-MOZAK.md) |
| Know what to ask for, and look up any command | [`docs/REFERENCE.md`](docs/REFERENCE.md) |
| Install, update, or roll back | [`docs/distribution/INSTALL.md`](docs/distribution/INSTALL.md) |

## License

MIT, see [LICENSE](LICENSE). Projects, standards, and publications that
influenced MOZAK are credited in [ACKNOWLEDGMENTS.md](ACKNOWLEDGMENTS.md).

## Next

Run this in any repository you already have. Takes under a minute.

```bash
mozak project init .
mozak project overview .
```

Then tell your agent what you want, using
[`docs/REFERENCE.md`](docs/REFERENCE.md).

Star ⭐ if you are tired of re-explaining your own project to an agent.
