---
name: note
description: Capture material into the right Markdown or Obsidian destination as a structured note block, and branch long detail into linked supplements. Use this whenever the user says "note this", "write this down", "add this to my notes", "save this for later", "recap this", "turn this into a note", or asks to fragment a fat note into supplements or inline a supplement back. Also use it when deciding where a piece of writing belongs across several note directories, or when a folder's own writing style should govern what gets written. Do not use it to audit or repair existing notes; that is note-healthcheck.
---

# note

Put the material where it belongs, in the author's structure, in the author's voice. You are writing into someone's own notes, so the failure that matters is not an ugly note. It is a note they cannot recognise as theirs, or one that quietly loses something they said.

Three ideas carry the whole skill. A **note block** is the unit of writing. A **supplement** is where detail goes when a block would sag under it. **Trim** decides how readily that happens. Everything else is routing and restraint.

## Before writing anything

Resolve four things in this order. Each step can answer the question outright, and a later step never overrides an earlier one.

1. **The explicit request.** What the user said for this operation wins. It governs this write only. It does not become a standing rule unless they say so in words like "from now on" or "always".
2. **The nearest style document.** Walk from the target directory up toward the root, taking the first `writing_style.md` you find. If the project uses an agent instruction file such as `CLAUDE.md` or `AGENTS.md` at that level, it counts too. That document overrides these defaults for anything inside its directory.
3. **The profile.** The owner's configured destinations, routing signals, voice, and trim defaults. Read it with `scripts/inspect_profile.py`. Persist only accepted preferences with `scripts/accept_preference.py`. Shared schema and atomic-write code lives in `scripts/profile_lib.py`. See [references/profile.md](references/profile.md).
4. **Portable defaults.** The rest of this file.

A style document governs only its directory and descendants. Do not route a note into that directory merely to acquire its style.

If steps 1 to 3 leave the destination ambiguous, ask one short question and write nothing until it is answered. A wrong destination is worse than a delayed note, because the user will not find it again.

> A note skill without a profile still works. With no configured destinations, treat the current directory or the path the user names as the destination, and say plainly that routing is unconfigured rather than inventing a vault layout.

## The note block

Three parts, always in this order:

1. **plan**, a short summary in human words: what this is about, what the plan is or was. Plain speech, the way they would say it to a person, not a log line.
2. **the body**, what was actually done, the caveats that came up for *that* plan, how it went. A chronological timeline belongs here when there is one.
3. **todo**, what is left and where it stands right now.

Only the first and last are labelled. Write `**plan**` and `**todo**` inline; the body in between carries no label at all, it is just the prose.

A part with nothing real in it is **omitted, not left empty**. A block that is only a `**todo**` is fine. An empty `**plan**` heading with nothing under it is not, because it promises content that was never there.

**What counts as one block depends on the target, and the target's style document decides.** A weekly report can be one block spread over its tasks and days. A project hub note, a `README.md`, or a `CLAUDE.md` is usually one block spanning the whole file. With no style document, one topic or concept or entry is one block.

**The three parts need not sit at the same level.** A style document can spread them across the structure of a file, and the order plan → body → todo still holds top to bottom. A report might carry a plan per task, a body per day inside that task, and a single closing todo for the whole report. Do not repeat a part at a level the style document did not ask for.

Full rules, including worked layouts: [references/note-blocks.md](references/note-blocks.md).

## Supplements

A supplement is a free-form detail document that a block links out to. It does **not** follow plan/body/todo and has no fixed shape. The block stays simple and readable; the supplement carries the real detail.

Three rules make supplements safe:

- **The link stays where the detail was brushed on.** Not in a footer, not in a related list. In the sentence that raised it.
- **Fragmenting moves every fact.** Never summarise a fact away while extracting it. If it does not appear in the supplement, it was lost.
- **Inlining verifies backlinks first.** Before folding a supplement back into its block, find everything that links to it. Then move the old file to a recoverable location rather than deleting it.

Put a supplement next to the project it explains, not next to the block that links it. Give it a name that is unique across the destination.

Full rules, including the fragment and inline procedures: [references/supplements.md](references/supplements.md).

## Trim

Trim is a parameter, not a personality. The target's style document sets it to `low`, `medium`, or `high`. The harder the trim, the more readily detail branches into a supplement instead of sitting inline.

| Trim | Inline tolerance |
|---|---|
| `low` | Detail stays in the block. Extract only when a section clearly outgrows it. |
| `medium` | A caveat longer than two or three sentences, or a table that describes rather than reports, goes to a supplement and leaves one sentence plus the link. |
| `high` | Anything beyond the immediate point goes to a supplement. The block reads as a summary with links. |

Default to `medium` when nothing sets it. Trim governs placement, never whether a fact survives.

## House style

These defaults hold unless a style document or the profile says otherwise.

- **Match the voice already in the target file.** Read it before writing. A casual lowercase file does not become formal because you arrived.
- **Write less.** The user authors their own notes. Add the specific facts and figures from the session and what they asked to capture. Do not editorialise or pad.
- **One paragraph is one line.** Markdown renderers treat a hard newline as a break, so wrapped prose reads as ragged. Never hard-wrap a paragraph or write one sentence per line. Keep a break the author clearly meant, such as a label line or stacked enumerations.
- **At most one blank line between blocks**, none between list items, and only where Markdown needs one.
- **No em dashes.** Use a period, a comma, or parentheses.
- **Links are rare and purposeful.** End an entry with the source you actually used. Do not decorate with internal links the user would never follow, and do not append a related-notes list.
- **No timestamps on entries.** Date-bearing filenames are fine.
- **Go light on bold and callouts.** A quiet structure reads better. Pick one restrained device if you must.

## Obsidian is optional

The suite writes plain Markdown. Obsidian conventions are a mode, not a requirement.

When the destination is an Obsidian vault, `[[wikilinks]]`, embeds, callouts, and frontmatter properties are available and preferred for internal links. When it is a plain directory, use relative Markdown links and skip vault-specific syntax entirely. Never require a running Obsidian instance, its CLI, or any community plugin in order to write a note.

If the user has `kepano/obsidian-skills` installed, defer to it for Obsidian syntax detail rather than restating it.

## Learning a preference

A preference becomes durable only when the owner accepts it. Learning is a proposal, never a side effect of being corrected once.

Propose a preference when you see a direct instruction to always do something, a correction repeated across separate occasions, or a consistent pattern in the destination's existing notes. Show the proposed rule, its scope, and the evidence behind it, then wait.

Scope every proposal to the narrowest level that fits: one destination, one folder, one note type, or global. A rule learned from formal research notes must not silently reshape a personal journal.

Use `scripts/propose_preference.py` to write the proposal. It records the rule as `proposed` and never applies it. Full procedure: [references/preference-learning.md](references/preference-learning.md).

## Refuse rather than guess

Some things are worse than an unwritten note.

- **Do not invent facts, figures, sources, plans, or todos.** If a part has no real content, omit it and say so.
- **Do not rewrite the user's existing sentences into your own voice** while adding to a file.
- **Do not create a new destination** because none matched. Ask.
- **Do not delete.** This skill writes and moves. Auditing and repair belong to `note-healthcheck`.
- **Do not persist a preference** the user did not accept in words.

## Writing the note

1. Resolve destination and governing style, as above.
2. Read the target file, or its neighbours if it is new, to match voice and spacing.
3. Draft the block: plan, body, todo, omitting whatever is genuinely absent.
4. Apply trim. Extract to a supplement where the level requires it, leaving the link in place.
5. Write, then reread what you wrote as the user would.
6. Report the destination path, what was added, and any supplement created or updated.
