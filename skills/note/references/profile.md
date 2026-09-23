# Profile and routing

The profile holds the owner's destinations, routing signals, and defaults. It lives outside this skill and outside any repository that ships it, so the payload stays generic and the configuration stays private.

Goal 2 defines the schema and command interfaces here. The contract is intentionally small: deterministic JSON, no discovery scan, no personal data in the shipped payload, and one readiness state.

## Where it lives

`$XDG_CONFIG_HOME/notes/profile.json`, falling back to `~/.config/notes/profile.json`.

Never inside the skill directory. Never committed. `profiles/example.json` in this repository is a placeholder with invented values, useful for reading the shape and for tests, and it is not anyone's configuration.

## Reading it

```bash
python3 scripts/inspect_profile.py
python3 scripts/inspect_profile.py --path /explicit/profile.json
python3 scripts/inspect_profile.py --resolve --target /absolute/target/directory --request "meeting recap"
python3 scripts/inspect_profile.py --resolve --explicit-path /absolute/target/file
```

`--resolve` adds a `resolution` object with the fixed precedence order, per-field sources, candidates when input is needed, and the machine-readable decision. Style lookup is confined to the canonical selected destination root and rejects symlink or traversal escapes. With `--resolve`, the process exit code follows `resolution.state`, not only profile validity: `0` ready, `2` needs_input, `3` invalid, `4` blocked.

| State | Meaning |
|---|---|
| `ready` | The profile parsed and every destination is usable. |
| `needs_input` | No profile exists, or it declares no destination. |
| `invalid` | The file exists but is malformed or a field is wrong. |
| `blocked` | The file could not be read at all, such as a permission error. |

`needs_input` is normal on a fresh install and is not an error. Route by explicit path, say routing is unconfigured, and offer to set it up. Treat `invalid` as repairable and show the specific issue. Treat `blocked` as an I/O boundary: report it and stop rather than guessing.

## Shape

```json
{
  "schema_version": 1,
  "destinations": [
    {
      "id": "example-research",
      "root": "/absolute/path/to/a/notes/directory",
      "purpose": "One human sentence about what belongs here.",
      "default": false,
      "routing_signals": ["paper", "experiment", "literature"],
      "trim": "medium",
      "obsidian": true,
      "excluded_paths": ["archive/completed-2024"]
    }
  ]
}
```

## Schema rules

- `schema_version` must be `1`.
- `destinations` is a list. Missing or empty means `needs_input`, not `invalid`.
- Each destination has a stable `id`, absolute `root`, human-written `purpose`, optional `default`, `routing_signals`, `trim`, `obsidian`, and safe relative `excluded_paths`.
- Destination roots must already exist when inspecting a real profile. The example profile uses placeholders and is validated by tests as documentation, not as a live profile.
- Unknown fields, duplicate ids, multiple defaults, unsafe excluded paths, non-boolean flags, and invalid trim values are `invalid`.
- `obsidian: true` enables Obsidian conventions for that destination. `obsidian: false` remains plain Markdown.

`purpose` is written by a person. Discovery can find a directory; it cannot know what the owner keeps there. A destination whose purpose was auto-generated is unresolved and must never become the default.

`routing_signals` are hints, not rules. They raise a destination as a candidate. They do not settle a choice on their own.

`excluded_paths` name places inside a destination that are reference-only, such as a finished project. Do not route new material there unless the user names that path explicitly.

## Nearest style document directives

A nearest `writing_style.md`, `CLAUDE.md`, or `AGENTS.md` can override profile defaults only with these exact per-field directives, one per line:

```text
trim: low
obsidian: false
```

Supported directive values are `trim: low|medium|high` and `obsidian: true|false`. These directives apply above the device-local profile and below explicit request flags. Arbitrary prose is style guidance for the writer, but it is not parsed as a directive.

## Routing a request

1. **An explicit path or destination in the request wins.** Nothing else is consulted.
2. **Otherwise gather candidates** by matching non-generic request words against each destination's purpose and routing signals. Generic note-operation words such as `note`, `notes`, `write`, `save`, `recap`, `add`, `my`, and `this` do not create candidates.
3. **Score candidates deterministically.** Exact multiword `routing_signals` phrase matches outrank single routing-signal word matches, and routing-signal word matches outrank purpose-word matches. Matching uses whole tokens only, so `paper` does not match `newspaper`.
4. **One unique highest score: use it,** and name it in the report so a wrong guess is visible immediately.
5. **A genuine equal highest-score tie: ask one short question.** Offer the tied candidates. Write nothing yet.
6. **A single destination marked `default`** resolves only the no-candidate case. A default never breaks a true ambiguity between candidates.

## Guarantees routing must keep

**Say where it went.** Every write reports its destination path. Routing that is silent cannot be corrected.

**Never invent a destination.** If nothing matches, ask. Creating a new vault or top-level folder is an owner decision.

**Never route into an excluded path** on a signal match alone. The exclusion exists because the owner already decided that place is closed.

**Never overwrite a human-written purpose** with an inferred description.

**Folder order carries no meaning.** The first destination in the file is not the most important one.

## Persisting preferences

A current operation instruction never persists. To save a standing rule, first record a proposal, then accept that exact proposal id:

```bash
python3 scripts/propose_preference.py --id sparse-links --scope destination:example-research --rule "Add internal links only when useful." --evidence "Owner asked for fewer decorative links." --output /path/to/proposals.json
python3 scripts/accept_preference.py --proposal-id sparse-links --proposals /path/to/proposals.json --profile /path/to/profile.json
```

`accept_preference.py` is the only shipped script that persists an accepted preference. It writes with a same-directory temporary file, flushes and fsyncs the file, checks that the target has not changed since read, atomically replaces the target, fsyncs the containing directory, then reads the target back and verifies the bytes. Symlinked parents or targets are refused. A failed readback means the preference did not count as saved.

## With no profile at all

The skill still works. Write to the path the user names, or the current directory, and say plainly that routing is unconfigured. Do not fabricate a layout, do not scan the filesystem looking for something vault-shaped, and do not write a profile without being asked.
