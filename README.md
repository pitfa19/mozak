# MOZAK

**One living plan per project and per research topic, linked into a graph that you and your AI agents can both read. An idea is only recorded as moved after the target has written down a re-derivation of each assumption it rests on.**

Agent plans kept in loose notes drift apart, and nothing tells you which one is current. MOZAK gives every scope, a git repo or an Obsidian topic folder, exactly one plan file, `MOZAK.md`. By convention it is the only file that links to other scopes, so the graph has one place to look. `graph` only reads `MOZAK.md`. `check` does not stop you linking elsewhere in your notes, and `stale` also follows wikilinks in a scope's other files to see if a cited note changed. Three things follow from that:

1. **One plan, one bridge file.** `MOZAK.md` holds the plan, the links, and the translations. `README.md` is for you, `AGENTS.md` is for your agents.
2. **Translation that has to be earned.** Moving an idea to another scope lists every assumption it rests on. It stays invalid until each one is marked re-derived in the target. MOZAK records that state, it cannot check that anyone really re-derived anything. `resolve` just flips the mark.
3. **Compare-and-swap on the shared plan.** When several agents edit, a stale write is refused instead of overwriting.

It is plain Markdown, so Obsidian draws the graph for free. It is not a memory store or a search tool. If you want agent memory from an Obsidian vault, [obsidian-mind](https://github.com/breferrari/obsidian-mind) does that. See [Prior art](#prior-art).

## How it is organised

Everything MOZAK manages is a **scope**. A scope is either:

- a **project**: a git repository, or
- a **topic**: an Obsidian folder (it can hold any other notes and subfolders).

Each scope has exactly three files at its root:

| File | For | What it holds |
|---|---|---|
| `README.md` | you | what this is |
| `AGENTS.md` | your agents | how to work here |
| `MOZAK.md` | both | the **one living plan**, links to other scopes, and translations |

In `MOZAK.md`, link a repo by URL and a topic by `[[wikilink]]`. Put all your topics in one git repo and the whole thing is shared across machines and people. Because it is plain Markdown, Obsidian draws the graph for free.

`CLAUDE.md` is optional. Claude Code 2.1.277 and newer reads `AGENTS.md` by itself when there is no `CLAUDE.md`. Older versions do not, so add a `CLAUDE.md` containing the line `@AGENTS.md`. Do not write "see AGENTS.md" in words: once a `CLAUDE.md` exists, Claude Code stops falling back to `AGENTS.md`, so a prose pointer hides it. `check` flags that. (Based on the [Claude Code docs](https://code.claude.com/docs/en/memory), not yet confirmed by running it here.)

```markdown
---
id: api
kind: project
format: 1
---

## Plan

- [ ] add rate limiting

## Links

- depends-on: [[research]]
- informs: https://github.com/you/web

## Translations
```

Relations are a closed set: `depends-on`, `informs`, `derived-from`, `translates-to`.

## What that makes possible: idea translation

Moving an idea between scopes is where things quietly go wrong. A publishing setup that works in one repo carries hidden assumptions (where it deploys, how it builds) that may not hold in the next.

In MOZAK a translation lists every assumption the idea rests on. It starts with all of them **open**, and it is invalid until the target has re-derived each one. A translation transfers no truth and no authority, it only creates a new claim in the target.

```bash
# draft: every assumption starts [open], and `check` fails
mozak translate --idea "publishing concept" --from research --to site \
  --assumption "deploys from main" --assumption "markdown build step" --write
mozak check ./site        # fails: 2 open assumptions

# after you verify each one in the target
mozak resolve --in site --idea "publishing concept" --n 1
mozak resolve --in site --idea "publishing concept" --n 2
mozak check ./site        # ok
```

## Several agents editing one plan

Agents on different projects update the same graph. Writes through MOZAK take a lock, compare the file's hash against what the agent last read, and rename atomically. A stale write is refused instead of overwriting someone else's edit, and the agent re-reads and retries. This is compare-and-swap on one shared, editable plan. Other tools protect append-only memory writes, which is a different problem.

Three real processes appending 120 lines to one file keep all 120, run after run. The same test without the guard lost most of them (8 of 120 survived in the one run I measured). See `packages/core/test/write.test.ts`.

![Two agents edit the same MOZAK.md: one write is refused as stale, retried, and both edits survive](docs/demo.gif)

The GIF is rendered from the real output of `scripts/demo.ts`. Only the pacing is simulated, it is not a live recording. Regenerate it with `python3 scripts/render_gif.py`.

Edits made directly in an editor or in Obsidian cannot be blocked, so `check` is the safety net for those.

## Commands

```text
mozak init [dir] --kind project|topic     scaffold the three files, never overwrites
mozak check [dir]                         validate a scope
mozak graph [--config FILE] [--mermaid]   print the graph across scopes
mozak stale [scope] [--plan-only]         what changed after each scope was last touched (read only)
mozak translate ...                       draft a translation, or print the packet an agent works from
mozak resolve ...                         mark an assumption re-derived
mozak audit [dir]                         read only: look at an old .mozak/ and propose a MOZAK.md
```

### Staleness

`mozak stale` answers "what changed since I last touched this?". Nothing is stored. Dates come from git (the last commit, or the file time for uncommitted edits), so there is no timestamp to forget to update.

A scope is flagged when something it relies on changed after it: a scope it `depends-on` or `derived-from`, a scope that `informs` it, or a note its own files cite with a wikilink. A link that does not resolve on this machine is reported as "cannot judge" instead of passing silently. Exit code 3 means at least one input changed, so it works in a script.

```text
agentic-systems (topic): last touched 2026-09-01 (40d ago, commit)  [inputs changed]
  note [[list]]  changed 2026-10-06 +35d
  cannot judge, not found on this machine: derived-from: [[personal-research]]
```

It says something changed, not that the change matters. It works at the level of notes and scopes, not individual statements. Commit dates move on rebase or bulk reformatting.

`graph` reads a small local config that says where your vault and repos live. It never uses the network.

```json
{ "roots": ["/home/you/obsidian", "/home/you/code"] }
```

Save it as `~/.config/mozak/config.json`.

## Try it

Not on npm yet. From a clone:

```bash
git clone https://github.com/pitfa19/mozak && cd mozak
npm install && npm run build && npm test
node --experimental-strip-types --no-warnings scripts/demo.ts   # two agents, one refused as stale, graph stays consistent
node packages/cli/dist/index.js init ./my-scope --kind project
```

Needs Node 22 or newer.

## For agents (MCP)

`mozak-mcp` is a stdio MCP server over the same core. It has five tools and only one of them writes:

| Tool | Does |
|---|---|
| `mozak_graph` | list scopes and how they link |
| `mozak_read` | read a scope's `MOZAK.md` and get a `base_hash` |
| `mozak_check` | validate a scope |
| `mozak_set_plan` | replace the **Plan** section only, with the `base_hash` from `mozak_read` |
| `mozak_translation_packet` | read only: build the work packet for moving an idea |

An agent can never change Links or Translations through MCP. Those are proposals for you. A hostile plan string containing `## Links` is refused, and this is tested.

```json
{ "mcpServers": { "mozak": { "command": "node", "args": ["/path/to/mozak/packages/mcp/dist/index.js"], "env": { "MOZAK_CONFIG": "/home/you/.config/mozak/config.json" } } } }
```

## Status

Early. Working: `init`, `check`, `graph`, `translate`, `resolve`, `audit`, guarded writes, and the MCP server. Not built yet:

- `check` flagging unapproved changes to Links and Translations against git history
- an Obsidian plugin
- publishing to npm

The MCP server is tested over a real stdio session and through a real Jcode session (all five tools discovered, a valid plan write, a stale write refused, and a plan that tried to inject a link refused with the file left byte for byte unchanged). It is not yet tested in Claude Code or Cursor.

Locking is tested on Linux only.

[SPEC.md](SPEC.md) has the full design.

## Prior art

This space is not empty. [obsidian-mind](https://github.com/breferrari/obsidian-mind) already gives coding agents cross-repo memory from an Obsidian vault, with trust labels on every memory and atomic writes. [basic-memory](https://github.com/basicmachines-co/basic-memory) and several Obsidian MCP servers cover Markdown memory, and AGENTS.md is the shared instruction file. MOZAK does not try to be a memory store.

What I found nothing for in any of them, from reading their READMEs and, for obsidian-mind, its architecture doc (not their code, so treat this as "I did not find it", not "it does not exist"):

- translation where the target must re-derive each assumption before an idea moves
- one `MOZAK.md` per scope as the only cross-scope linker, with one living plan in it
- compare-and-swap on that shared plan, so a stale edit is refused

Safe concurrent writes in general are not unique: obsidian-mind handles them too, for a different kind of write.

MIT licensed.
