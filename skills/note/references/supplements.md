# Supplements

A supplement is a free-form detail document that a note block links out to. Read this before fragmenting a fat block or inlining a supplement back, because both operations move the author's words and both can lose them.

## What a supplement is

Free-form. It does **not** follow plan/body/todo and has no fixed shape. It is whatever the detail needs: a table, a derivation, a transcript, a list of measurements, a long caveat with its own structure.

The division of labour is the point. The block stays simple enough to read in one pass. The supplement carries the detail a reader only wants when they are already interested.

## The three rules

**The link stays where the detail was brushed on.** In the sentence that raised it, not in a footer and not in a related list. A reader hitting the shortened caveat should see immediately where the rest went.

**Fragmenting moves every fact.** Extraction is a move, never a summary. If a number, a caveat, a date, or a source appears in the block before extraction and in neither place after, it was lost. This is the failure that makes a note untrustworthy, because nothing visibly breaks.

**Inlining verifies backlinks first.** A supplement may be linked from more than one block. Find every reference before folding it back, update them, and move the old file to a recoverable location rather than deleting it.

## Where a supplement lives

Next to the project it explains, not next to the block that links it. A caveat about the ingest pipeline belongs with the ingest project even when the block that raised it was a weekly report.

Name it for what it contains, uniquely across the destination. Two files called `notes.md` in different folders will eventually collide in any tool that resolves links by basename.

## When to extract

Trim decides. See the table in `SKILL.md`.

At `medium`, the usual triggers are a caveat running past two or three sentences, or a table that describes something rather than reporting a result. At `high`, anything beyond the immediate point goes. At `low`, extract only when a section has clearly outgrown the block.

Two things never justify extraction on their own: the block being long, and the detail being boring. Length is not a problem if every part is at the level the block is written at.

## Fragmenting a block

1. **Read the whole block.** Identify the detail that is leaving and the sentence that raised it.
2. **List the facts in the departing detail** before touching anything: numbers, dates, sources, caveats, names. This list is what you check against afterwards.
3. **Create the supplement** beside the project it explains, with a unique descriptive name. Move the detail into it whole. Do not rewrite it into your own words while moving it.
4. **Replace the detail in the block** with one sentence that says what the detail concerns, plus the link. The sentence must carry the conclusion if the block's reader needs it. A link alone is a dead end for someone skimming.
5. **Check the list from step 2.** Every fact appears in the supplement. Nothing was condensed into nonexistence.
6. **Report** the supplement path, and what was moved.

Before:

```markdown
The swap approach worked but the staging table survives a crash mid-swap, which means a retry sees rows from the previous attempt and double-counts them. Reproduced three times out of ten by killing the process during the swap window. The window is about 400ms on the current dataset and scales with row count, so it will widen. A transactional swap would close it but the driver does not support DDL inside a transaction on this version.
```

After, at medium trim:

```markdown
The swap approach worked, but a crash inside the swap window leaves the staging table behind and a retry double-counts. See [[ingest-swap-window]].
```

The supplement then carries the reproduction rate, the 400ms measurement, the scaling behaviour, and the driver limitation. All four facts survive. The block keeps the conclusion a skimming reader needs.

## Inlining a supplement

Do this when a supplement has shrunk to the point where the link costs more than the content.

1. **Find every backlink.** Search the destination for the supplement's filename and its link text. Do not assume the block you are editing is the only referrer.
2. **If more than one block links it, stop.** Inlining into one block breaks the other. Report this instead and let the owner decide.
3. **Fold the content back** into the block at the point the link sat, matching the block's voice and spacing.
4. **Remove the link**, since its target is about to move.
5. **Move the old file to a recoverable location**, the destination's trash or a dated archive. Never delete it in the same pass that inlines it.
6. **Report** what was inlined and where the old file went, by path.

## What not to do

- Do not impose plan/body/todo on a supplement. It is free-form by definition.
- Do not extract detail into a supplement and leave no link behind.
- Do not leave the same detail in both places. A duplicated fact becomes two facts that disagree after the next edit.
- Do not rename an existing supplement without updating every reference to it.
- Do not delete a supplement. Moving to a recoverable location is the strongest action this skill takes.
