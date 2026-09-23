---
name: note-voice-census
description: Measure a Markdown draft against the owner's private writing baseline using aggregate word rates, sentence shapes, sentence lengths, and heading openers. Use when the user asks to check whether writing sounds like them, build a voice baseline, detect overused words, or compare a draft with their notes. No note bodies, quotes, or private roots are retained.
---

# note-voice-census

Measure whether a Markdown draft matches the owner's own writing baseline without exposing note bodies, quotes, or private roots.

## What this skill does

1. Build a baseline from explicit local Markdown roots or files.
2. Retain aggregate metrics only: word rates, sentence shape rates, sentence-length buckets, and heading-opener rates.
3. Compare a draft against that baseline.
4. Exit nonzero when configured corpus-relative thresholds are exceeded.

## Privacy boundary

- Accept only caller-provided local roots or files.
- Output aggregate counts, rates, hashes, and threshold decisions by default.
- Do not output note bodies, sentence text, quotes, or absolute/private roots by default.
- Store personalized baselines outside this repository, for example under a device-local state directory.
- Use plain Markdown. No Obsidian process, vault metadata, plugin, or network access is required.

## Commands

Build a baseline:

```sh
python3 skills/note-voice-census/scripts/voice_census.py baseline \
  --corpus ./my-notes \
  --output "$HOME/.local/state/note-voice-census/baseline.json"
```

Compare a draft:

```sh
python3 skills/note-voice-census/scripts/voice_census.py compare \
  --baseline "$HOME/.local/state/note-voice-census/baseline.json" \
  --draft ./draft.md \
  --thresholds skills/note-voice-census/references/default-thresholds.json
```

The compare command exits `0` when the draft is within thresholds and `1` when any configured metric exceeds the corpus-relative limit.

## Inputs

- `--corpus PATH`: repeatable path to a local Markdown file or directory for baseline creation.
- `--draft PATH`: repeatable path to a local Markdown file or directory for comparison.
- `--thresholds PATH`: optional JSON thresholds. The bundled default is generic and contains no owner data.
- `--output PATH`: baseline output path. Keep owner-specific baselines outside the repo.
- `--include-paths`: opt-in debug flag that prints redacted relative labels instead of private roots. Off by default.

## Metrics

- Overused words: normalized token frequency excluding a small generic stopword list.
- Sentence shapes: compact pattern of sentence length and punctuation, such as `medium-period`.
- Sentence lengths: buckets `short`, `medium`, `long`, `very_long`.
- Heading openers: first normalized word after Markdown heading markers.

## Exit codes

- `0`: completed and within thresholds.
- `1`: compare completed and one or more thresholds were exceeded.
- `2`: invalid arguments, unreadable input, malformed baseline, or unsafe output request.
