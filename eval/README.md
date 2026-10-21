# Eval harness (S0b)

Small retrieval eval for mozak v-next. It measures the baseline that any search feature must beat.
Plain Node, no dependencies. Run every script as a file.

## Layout

- `fixture/timeline.mjs`: the truth timeline. Facts first, each with a date and the notes that state it.
- `fixture/generate.mjs`: renders the synthetic vault from the timeline. Same input gives the same bytes.
- `fixture/vault/`: 50 notes in 3 scopes (`vrt`, `bikeshop`, `teza`), 8 plans, and a root `plans.md`.
- `fixture/questions.json`: 40 questions with exact gold note paths. Gold is computed from the facts a
  question needs. 15 of 40 are Croatian with diacritics. 4 are abstain items (answer not in the vault).
- `lib/fold.mjs`: Croatian folding (č ć to c, š to s, ž to z, đ to d) and query terms.
- `lib/armA.mjs`: arm A. ripgrep with a folded pattern, plus `plans.md` if present. Pure Node fallback
  with the same results when `rg` is absent.
- `lib/metrics.mjs`: recall@5 (any gold, all gold), MRR@5, abstain accuracy.
- `lib/stats.mjs`: exact McNemar test and Wilcoxon signed-rank test (exact for n up to 50 without ties,
  else normal approximation with tie correction).
- `run.mjs`: runs the arms and prints JSON.
- `verify.mjs`: the verifier. Exits 1 if the fixture or the harness is broken.
- `results/synthetic-armA.json`: expected results on the fixture. The verifier compares against it.

## Commands

```
node eval/fixture/generate.mjs          # regenerate the fixture in place
node eval/run.mjs                       # arm A on the fixture
node eval/run.mjs --backend node        # same, without ripgrep
node eval/verify.mjs                    # all checks, exit code 0 or 1
node --test eval/test/*.test.mjs        # unit tests
```

Private sets: `node eval/run.mjs --vault DIR --questions FILE --out FILE`. Write private output outside
this repo. Never commit private questions, gold paths or results.

## Arms

- A: query terms are folded, stopwords dropped, terms over 6 letters cut to a 6-letter prefix. Each term
  becomes a pattern like `\b[cčć]lanar`. Notes are ranked by the sum of idf over matched terms. A line in
  `plans.md` that matches a term counts as a match for the plan note it links. Arm A abstains when the best
  note matches fewer than half of the terms.
- A-noplans: arm A without `plans.md`. An ablation, compared with McNemar.
- Q: `qmd search`. Runs only if `qmd` is on `PATH`. Nothing is installed by this harness.

## Ship rule (D3 Goal 3, pre-committed)

An arm beats A only if McNemar's exact test on paired items gives p < 0.05 and recall@5 rises by at least
10 points, or tokens fall by at least 30% at non-inferior accuracy. If A is not beaten, mozak ships no
search. The S7a cold-start experiment uses the Wilcoxon signed-rank test on 20 paired task medians.

## S7a cold-start tools

- `s7a/run-task.mjs`: runs one task with the subscription-authenticated `claude -p` in a scratch copy.
  Tools are Read, Grep and Glob only, `--restricted`, no MCP servers, no hooks or auto-memory, no bypass,
  a 15-turn cap and a hard timeout. It refuses a folder with `.git` and exits 3 without a first-party
  `claude.ai` login. API-key and provider-routing environment variables are removed from the child.
  Each process has a new explicit session UUID and no session persistence. Root `AGENTS.md` is injected
  explicitly with `--append-system-prompt-file`: restricted mode does not load the `CLAUDE.md` import.
  Account-side extra-usage settings still need separate owner verification; login alone does not prove them.
- `s7a/coldstart.mjs`: reads stream-json with partial messages enabled. It merges cumulative final
  `message_delta` usage by message id rather than summing provisional assistant block counts. It reconciles
  input, cache creation, cache read and output totals against the terminal result, without adding both.
  The runner writes raw stream, stderr and metric files and exits 4 for incomplete or unreconciled runs.
  Useful action = first Read (or Grep or Glob scoped to a file) of a gold note, or a mozak write. Explicit
  failed tool results do not count. Total tokens = full context of that turn plus its final output.
  Injected tokens are included, not added again. `toolReadTokens` is a context-growth estimate after
  subtracting earlier output, not an exact tokenizer measurement of tool bodies: wrappers and other
  context overhead can contribute. Cached input is included once through its disjoint usage categories.
  `runTokens` separately sums every request's context and output as a quota proxy. Runs that never reach
  gold are censored, not successful. A capped/error run is invalid even if it reached gold.
- `s7a/compare.mjs`: per-task medians of 3 runs per arm, Wilcoxon signed-rank on the paired medians,
  median reduction, and the D3 target (30% lower, p < 0.05).

The task list, prompts, gold paths, transcripts and results are private and live in the owner's vault,
outside this repo.
