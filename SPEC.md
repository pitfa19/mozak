# MOZAK v1 spec

Status: draft, from the 24 grilling decisions of 2026-10-11. Not yet implemented.

## Purpose

MOZAK connects the git and Obsidian stack for humans and AI agents. In the AI era developers and researchers work with ideas more than with files. Until tooling is AI native they need an intermediate. This is it.

Pitch order:
1. **Organisation.** Projects are git repos. Topics are Obsidian folders. Each has the same three root files, and together they form one graph.
2. **Translation.** That graph is the working ground for moving an idea from one scope to another.
3. **Safe concurrency.** Several agents on different scopes keep the graph fresh without breaking it. This is an engineering property, not the headline.

## Scopes

A scope is a directory with three root files.

| Scope kind | Lives in | Notes |
|---|---|---|
| project | a git repository | the repo root holds the three files |
| topic | an Obsidian folder | the topic root holds the three files, and may contain any other notes and subfolders |

The three files:

| File | Reader | Role |
|---|---|---|
| `README.md` | humans | stable description. For a topic it is the index note |
| `AGENTS.md` | agents | instructions an agent needs. `CLAUDE.md` is a one line pointer to it |
| `MOZAK.md` | both | the bridge: living plan, links, translations |

`MOZAK.md` is the only file that links to other scopes or to MOZAK related work. It may reference files inside its own scope.

All Obsidian scopes live inside one git repository, so the vault is shared across machines and users.

## MOZAK.md format

Plain Markdown that Obsidian renders. Frontmatter:

```yaml
---
id: my-scope
kind: project   # or topic
format: 1
---
```

Three fixed sections, in order.

### `## Plan`

Free form checklist and prose. One living document. Finished work is recorded by git history, not by separate files. Agents may edit this section directly.

### `## Links`

One edge per line: `relation: target`.

- Relations (closed set): `depends-on`, `informs`, `derived-from`, `translates-to`.
- A target is a repository URL or an Obsidian `[[wikilink]]`.
- Changes to this section are proposals the owner approves.

### `## Translations`

One block per idea moved between scopes. Each block names the source, the target, and every assumption the source idea rests on, marked `re-derived` or `open`. A translation is invalid while any assumption is open. It creates a new claim in the target and never transfers truth or authority. Changes are proposals the owner approves.

## Link resolution

`MOZAK.md` stores only the portable link. A local config maps each link to a folder on the current machine (vault root, repo clones). `graph` and `translate` read only those local folders and never use the network. Each person sets up their own mapping.

## Core operations

1. `init`: scaffold the three files.
2. `check`: validate structure, verify links resolve, rebuild the graph cache, and flag unapproved changes to Links and Translations by comparing against git history.
3. `graph`: print the cross-scope graph.
4. `translate`: produce the packet for moving an idea into a target scope.
5. `audit`: read-only. List what an old `.mozak/` directory holds and propose a draft `MOZAK.md`. The owner edits and approves, then the old directory is archived.

## Concurrency

Plain files are the source of truth. Writes made through the CLI or MCP server:

1. take a lock file,
2. compare the base content hash with the current file (compare and swap),
3. write to a temporary file and atomically rename,
4. release the lock.

A stale write is refused with an error, and the caller re-reads and retries. The graph is a derived cache, always rebuildable from the `MOZAK.md` files. No daemon, no database, no server.

Direct edits (a human in Obsidian, an agent in an editor) cannot be blocked. The guarded path covers only writes through MOZAK, and `check` catches the rest.

## Packages

TypeScript, shipped on npm. No Rust is carried over from the old repository.

| Package | Role |
|---|---|
| `core` | parser, `check`, locked write, `graph`, `translate` |
| `cli` | thin command line wrapper over `core` |
| `mcp` | thin MCP server over `core` |

Later: an Obsidian plugin and a Pi harness extension import `core` in process.

## Out of scope

Improve Lab, goal plans, executions, knowledge packages, attestation, research run recorders, tool evidence hashing, Meta KB registry, feature record files. Research evidence is plain notes in a topic, linked from `MOZAK.md`.

## Build order

1. Parser and `check`.
2. Locked write, hash check, and a concurrency test with two writers.
3. `graph`.
4. `translate`.
5. `init` and `audit`.
6. README, demo GIF, v0.1 release.

Steps 1 to 3 form the first milestone and the demo: two agents on two repos update `MOZAK.md`, one write is refused as stale and retried, and `graph` stays consistent.

## Versioning and migration

Ships as `mozak` 1.0.0 with no aliases for old commands. Old projects are audited and ported one at a time with `audit`. There is no bulk migrator.

## Prior art

Crowded: Obsidian MCP servers, basic-memory (Markdown and wikilink memory), lock plus atomic write for shared Markdown, compare and swap for agent memory, AGENTS.md. Apparently unoccupied: idea translation with assumption re-derivation, and a single file that is the only cross-scope linker. The pitch leans on the second group.
