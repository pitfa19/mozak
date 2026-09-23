# Note blocks

The unit of writing. Read this when a block is more than one topic, when a file has structure the three parts must spread across, or when deciding what counts as one block in an unfamiliar target.

## The three parts

**plan** opens the block. A short summary in human words: what this is about, what the plan is or was. Plain speech, the way the author would say it to a person. Not a log line, not a restatement of the heading.

**The body** carries what actually happened: what was done, the caveats that came up for that plan, how it went. A chronological timeline belongs here when there is one. This part carries no label at all. It is just the prose between `**plan**` and `**todo**`.

**todo** closes the block. What is left and where it stands right now. Not a wish list, not next steps invented on the author's behalf. Only what they said is outstanding, or what the body plainly leaves open.

## Omission is a feature

A part with nothing real in it is left out. A block that is only a `**todo**` is a normal block. A block with a plan and a body and nothing outstanding simply ends after the body.

An empty labelled part is worse than a missing one, because it promises content that was never there and invites a future reader to hunt for it.

```markdown
**plan** Wire the export path so the weekly report can leave as a PDF.

Pandoc handles the conversion. The template needed a font fallback because the heading font is not installed on the build box, and the first run silently produced boxes instead of glyphs.

**todo** Font fallback works locally. Still needs checking on the build box.
```

```markdown
**todo** Ask the mentor which of the two datasets is authoritative before the next run.
```

Both are valid. The second omits a plan and a body because neither exists yet.

## What counts as one block

The target's style document decides. Three common answers:

**One entry is one block.** The default when no style document exists. One topic, one concept, one reading, one session.

**One file is one block.** A project hub note, a `README.md`, an agent instruction file. The plan is the opening paragraph explaining what this is, the body is the substance of the file, and the todo closes it. Do not scatter repeated scaffolding under every heading.

**One report is one block, spread over its structure.** The parts sit at different levels but the order still holds top to bottom.

## Parts at different levels

A style document may distribute the three parts across a file's structure. The rule that survives is the order, not the nesting.

Worked example, a weekly report with a plan per task, a body per day, and one closing todo for the whole report:

```markdown
## Tasks

### 1) Rebuild the ingest path

**plan** Replace the ad-hoc loader so a failed batch can be retried without reprocessing the whole day.

#### *Monday*

Split the loader into fetch and apply. Fetch is idempotent now, apply is not yet.

#### *Wednesday*

Apply writes to a staging table and swaps on success. A partial batch leaves the staging table behind, which is ugly but recoverable.

### 2) Chase the missing survey exports

**plan** Find out why three sites never returned exports and whether the data still exists.

#### *Thursday*

Two sites had the wrong upload address. The third has not replied.

## Todo

Apply is still not idempotent, so a retry after a mid-swap crash needs checking by hand. The third site has not replied and the deadline is next Friday.
```

Note what is absent: no per-day plan, no per-task todo. The style document asked for a plan per task and one todo for the report, so those are the only levels where those parts appear. Adding a todo under each task would duplicate the same information at two levels and leave a future reader unsure which is current.

## Adding to an existing block

Read the block first. Match its spacing, its capitalisation, its level of formality.

Append to the body in the place the chronology or structure implies, not always at the end. Update the todo rather than adding a second one. If the new material changes what the plan was about, say so in the body rather than rewriting the plan to look as though it always said that.

Never rewrite the author's existing sentences while adding to a file. Add beside them.

## Common failures

**A plan that restates the heading.** "**plan** Notes on the ingest rebuild" under a heading called "Ingest rebuild" carries nothing. Say why it was being done.

**A body that is a list of commands.** The body records what happened and what it cost, not a shell transcript. Keep the commands that a reader would rerun; drop the ones that were noise.

**A todo invented to fill the slot.** If nothing is outstanding, omit the todo.

**Scaffolding repeated per heading.** When a file is one block, it gets one plan and one todo, not one per section.

**Two todos at different levels.** Whichever one a reader checks first will eventually be the stale one.
