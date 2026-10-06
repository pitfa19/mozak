<p align="center">
  <img src="docs/diagrams/mozak-architecture.png" alt="MOZAK brain architecture" width="100%">
</p>

<h1 align="center">MOZAK</h1>

<p align="center"><strong>Projects that keep improving.</strong></p>

<p align="center">
  MOZAK gives a research topic or code repository a Git-native memory:<br>
  what you learned, what you decided, what is ready, and what happened.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green.svg" alt="MIT license"></a>
</p>

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/pitfa19/mozak/main/scripts/install.sh | bash
mozak setup check "$HOME"
```

Optional Jcode Low/Normal profiles and teacher supervision ship as invocation
skills. Global configuration is explicit opt-in, never an automatic update:
`mozak setup jcode plan "$HOME"`, then owner-approved
`mozak setup jcode install "$HOME"` and `mozak setup jcode check "$HOME"`.
See [Jcode agent work](docs/distribution/JCODE-AGENT-WORK.md). Python 3.11+
required. LOW stays default and teacher stays OFF until explicitly invoked.

This installs `mozak`, `mozak-mcp`, and the MOZAK skill for Claude Code,
Jcode, Codex, and agents using the shared `.agents` convention. The installer
prints the exact configuration step when this is a new machine.

Prefer natural language? Tell your coding agent:

> Install MOZAK from `github.com/pitfa19/mozak`, then onboard this repository.

Joining projects that a teammate already onboarded? Use the
[teammate quickstart](docs/TEAMMATE-QUICKSTART.md). It covers the local KB and
project registration step that a binary install cannot safely guess.

## Why MOZAK

Long projects lose context. Agents repeat research, forget decisions, rebuild
plans, and start work that another session already handled.

MOZAK keeps the durable parts in Git:

- **Improve:** turn new papers, tools, and completed work into reviewable improvement plans.
- **Remember:** keep goals, evidence, decisions, progress, and rejected options across sessions.
- **Share:** give every person and agent working from the repository the same project state.
- **Reuse:** move a useful concept between repositories only after its assumptions are checked again.

MOZAK proposes. You approve. Pair it with an ambient agent to run the
improvement cycle periodically.

## Tools per use case

```bash
mozak stack recommend literature       # arXiv; references: Zotero; manuscript: Overleaf
mozak stack check "$HOME" literature    # what is ready on this machine
```

MOZAK ships a catalog of MCP servers and skills per use case: arXiv for
literature, Zotero for references, Overleaf for manuscripts, Fetch and GitHub
for tooling watch, and Firecrawl for deep research. It shows exact install
steps for what is missing and installs nothing without your consent.
`stack check` reads local config only: an installed package is not a working
connection, and a working connection is not write access. Your agent makes the
MCP calls. MOZAK records the results as proposal-only evidence that you accept
separately. New research is MCP-only; the old source adapters are retired, and
their recorded runs stay readable as history. See the
[tool-stack guide](docs/TOOL-STACK.md).

## Start

```bash
mozak project init .
mozak project overview .
```

Then tell your agent what you want:

> Use MOZAK to plan the next improvement and show me what is ready.

MOZAK also manages research topics without code. See the
[5-minute quickstart](docs/QUICKSTART.md).

## One example

A reusable publishing concept moved between two repositories. MOZAK checked
five assumptions in the target: one held, two needed replacements, and two were
rejected. The idea transferred without pretending both projects were identical.

MOZAK has also recorded its own development and produced six improvement
proposals. This is a real self-study, not a controlled comparison. See the
[case and concept model](docs/ARCHITECTURE.md).

## Six modules

`scope` holds topics and projects · `research` records evidence · `plans` tracks
goals and progress · `meta-kb` connects repositories · `improve-lab` proposes
upgrades · `skill` lets agents operate MOZAK for you.

## Why Rust

Rust makes MOZAK a fast, portable, offline binary with no language runtime. Its
type and memory safety help protect deterministic project state. Rust is how it
ships reliably, not the reason to use it.

## Read next

[Teammate quickstart](docs/TEAMMATE-QUICKSTART.md) · [New-project quickstart](docs/QUICKSTART.md) · [How it works](docs/ARCHITECTURE.md) ·
[Commands](docs/REFERENCE.md) · [Tool stack](docs/TOOL-STACK.md) · [Install and update](docs/distribution/INSTALL.md)

MIT licensed. Influences and prior work are listed in
[ACKNOWLEDGMENTS.md](ACKNOWLEDGMENTS.md).
