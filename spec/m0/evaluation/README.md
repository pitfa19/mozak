# M0 local retrieval baseline

This directory contains a tiny synthetic, redistributable corpus and a pinned deterministic configuration for the initial raw-file scan and lexical retrieval baselines. All corpus text is original and released under CC0-1.0 as recorded in `corpus/manifest.json`.

Run from the repository root:

```bash
python3 scripts/run_m0_baseline.py --output /tmp/m0-baseline.json
python3 scripts/run_m0_baseline.py --check-recorded
```

The first command writes a machine-readable result to the explicitly selected path. It never changes `results/recorded-baseline.json`. The second command reruns the evaluation and compares deterministic metrics and hashes with that recorded result. Runtime, host, start time, and software-revision observations are recorded but excluded from equality because they vary by run.

To deliberately replace the historical record, use `--record --force`. This explicit pair is required to guard the untouched baseline artifact against accidental writes.
