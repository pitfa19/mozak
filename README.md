<h1 align="center">MOZAK</h1>

<p align="center"><strong>Projects that keep improving.</strong></p>

<p align="center">
  MOZAK gives a research topic or code repository a Git-native memory:<br>
  what you learned, what you decided, what is ready, and what happened.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green.svg" alt="MIT license"></a>
</p>

Long projects lose context. Agents repeat research, forget decisions, rebuild
plans, and start work that another session already handled. MOZAK keeps the
durable state in plain, reviewable files and exposes it through a CLI, an MCP
server, and a managed agent skill. Outside information stays a proposal until
you approve it.

## Use it from an MCP client

MOZAK ships a typed stdio server named `mozak-mcp`.

```json
{
  "mcpServers": {
    "mozak": {
      "command": "mozak-mcp",
      "args": []
    }
  }
}
```

Claude Code:
```bash
claude mcp add mozak -- mozak-mcp
```

## See it work

This is real output from `mozak project init .`, reduced only by the shown
`jq` filter so the machine-specific absolute path is not printed:

```console
$ mozak project init . | jq '{state, created, checks}'
{
  "state": "valid",
  "created": [
    ".mozak/project.yml",
    ".mozak/idea.md"
  ],
  "checks": [
    {
      "message": "contract validation passed",
      "path": ".mozak/project.yml",
      "status": "valid"
    },
    {
      "message": "contract validation passed",
      "path": ".mozak/idea.md",
      "status": "valid"
    }
  ]
}
```

`mozak project overview .` then reports the plans, accepted inputs, goals,
concepts, executions, findings, and next action it can validate.

A cross-repository decision is stored as plain JSON:

```json
{
  "assumption_id": "A-04",
  "outcome": {
    "kind": "rejected",
    "rationale": "No key-value binding exists on the target host, and faking a throttle in edge memory would be worse than none because it would not survive across instances. Recorded as a real reduction in defence in depth rather than an equivalence."
  }
}
```

## Install

**Release installer, available now on Linux x86-64:**

```bash
curl -fsSL https://raw.githubusercontent.com/pitfa19/mozak/main/scripts/install.sh | bash
mozak setup check "$HOME"
```

You can also install from a downloaded release archive without network access.
See [Install and update](docs/distribution/INSTALL.md).

`cargo install`, `cargo binstall`, and a Homebrew tap are not published yet.

## One concept, two repositories

A publishing mechanism moved from one repository to another as a reusable
Concept. MOZAK required the target to check all five source assumptions:

- one held
- two were replaced for the target host
- two were rejected and recorded as real limitations

The result was a qualified adoption, not a claim that both projects were the
same. The recorded fixtures and validation test are in
[`crates/mozak-core/tests/fixtures/concept/`](crates/mozak-core/tests/fixtures/concept/)
and [`concept_translation.rs`](crates/mozak-core/tests/concept_translation.rs).

MOZAK has also recorded its own development and produced six improvement
proposals. This is a real self-study, not a controlled comparison.

## What MOZAK is not

- **Not a `CLAUDE.md` convention:** instructions guide one agent; MOZAK validates shared, versioned project state.
- **Not a generic memory MCP:** memory stores context; MOZAK also models evidence, acceptance, plans, execution observations, and reuse boundaries.
- **Not only a spec workflow:** specs describe intended work; MOZAK connects accepted evidence, ready goals, observed results, and cross-repository concepts.

MOZAK does not autonomously modify projects, accept research, or run hidden
background work. Pair it with an ambient agent if you want the proposal cycle
checked periodically. The owner still approves changes.

## How it works

<p align="center">
  <img src="docs/diagrams/mozak-architecture.png" alt="MOZAK brain architecture" width="100%">
</p>

Six modules form one modular skeleton:

`scope` holds topics and projects · `research` records evidence · `plans` tracks
goals and progress · `meta-kb` connects repositories · `improve-lab` proposes
upgrades · `skill` lets agents operate MOZAK through natural language.

## Why Rust

Rust makes MOZAK a fast, portable, offline binary with no language runtime. Its
type and memory safety help protect deterministic project state. Rust is how it
ships reliably, not the reason to use it.

## Read next

[Quickstart](docs/QUICKSTART.md) · [Modules](docs/MODULES.md) ·
[Architecture](docs/ARCHITECTURE.md) · [Commands](docs/REFERENCE.md) ·
[Install and update](docs/distribution/INSTALL.md) ·
[Influences and prior work](ACKNOWLEDGMENTS.md)
