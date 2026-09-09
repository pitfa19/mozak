# Why MOZAK?

A repository holds code and a README. It does not hold why the project exists,
which evidence shaped it, what was accepted, what remains uncertain, how the
plan was derived, or which ideas can safely move to another project. Coding
agents reconstruct that context every session, differently each time.

MOZAK gives a repository a versioned `.mozak/` layer holding exactly that, and
a CLI that validates it rather than trusting it. A Topic can use the same
framework with no codebase at all.

## The claim

Project memory tools exist. Code graphs exist. Specification workflows exist.
MOZAK does not claim those primitives as novel. Two things are its own:

1. **An idea can cross from one project to another, and the crossing is checked.** A Concept records a mechanism and the assumptions it rests on. A Translation is valid only when the adopting target re-derives every one of them in its own codebase. A load-bearing assumption that was rejected or never checked is refused, not warned about.
2. **A module whose job is improving the other five.** The Improve Lab reads new literature and tool releases and turns them into reviewable plan cards. A tool that cannot absorb the field it serves goes stale; that loop is the answer.

Everything else is the authority-preserving connection between them: nothing
imported becomes true, and no proposal becomes permission.

## Adjacent tools

Named as intended integrations, not competitors. MOZAK consumes them as
adapters and keeps the acceptance boundary.

| Tool | What it does | How MOZAK uses it |
|---|---|---|
| [Serena](https://github.com/oraios/serena) | Semantic code tools, Git-versioned Markdown memories | Code observations, bound to a revision |
| [Context7](https://github.com/upstash/context7) | Current library documentation | A research source with exact provenance |
| [GitNexus](https://github.com/abhigyanpatwari/GitNexus) | Code knowledge graph | Architecture observations, never the authority |
| [OpenSpec](https://github.com/Fission-AI/OpenSpec) | Proposal, spec, design, task workflows | Candidate plan exchange, acceptance stays explicit |
| [MDKG](https://github.com/nickreames/mdkg) | Git-native project memory, Plan → Work → Evidence | Closest analogue; see the two claims above |

An adapter receives an explicit Scope and pinned inputs, performs one bounded
capability, and returns normalized artifacts with provider version, hashes,
source locators, limitations, and a receipt. It stays proposal-only until you
accept it.

## What ships today

Onboarding, validated Project and Scope artifacts, Scope authoring, a local
composed KB with registration and re-pinning, terminal and Termaid views,
content-addressed packages with lineage, in-toto attestation, owner-gated
package import, agent-facing project context, reviewed discovery, pinned case
records with reproduction packets, Concepts and Translations, and Linux
distribution with update and rollback.

Four adapters are callable through owner-configured bindings: arXiv, DAIR.AI,
the MCP registry, and GitHub tooling in discover and watch modes. Networking
happens outside MOZAK and their output is proposal-only.

The Improve Lab is implemented and has been run end to end against MOZAK
itself.

**Not implemented:** a generic adapter SDK, registry networking, hosted
discovery, automatic trust, vault archival, automatic self-improvement, and a
web dashboard.

## Evidence

- `.mozak/research/runs/2026-09-02-mozak-landscape/`
- `.mozak/research/runs/2026-09-04-git-native-framing/`
