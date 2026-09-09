# M0 scenario contract

This directory defines the executable boundary between the adversarial fixtures and any future product scenario runner. `contract.json` is normative.

## Sealed identity

A scenario identity is the SHA-256 digest of the canonical JSON object containing only `contract`, `version`, `fixture_id`, and `fixture_case`. Once reset begins, the identity is immutable. Events, paths, expected answers, runtime metadata, and model output cannot alter it.

## State and actions

Every scenario begins from the declared empty state. The vocabulary is deliberately small:

- `reset(sealed_scenario)` binds identity and returns the initial observation.
- `step(fixture_event)` applies one generation-ordered event and returns an observation.
- `save()` returns a path-independent, canonical JSON checkpoint.
- `restore(saved_state)` accepts only a checkpoint whose identity and replay digest are valid.

Observations contain only the fields listed in `contract.json`. Before termination, canonical outcome fields remain empty. This prevents an adapter from learning held-out answers while it acts.

## Setup, Rule, and Link

`Setup` maps fixture identity to a reset. `Rule` maps each fixture event to exactly one step without invention, deletion, or reordering. `Link` closes the trace with fixture and replay-digest provenance. These transformations are an equivalence adapter for the existing abstract fixtures, not a claim that their sparse events are a production reducer.

## Held-out verifier boundary

The adapter receives only fixture `id`, `case`, and `events`. A verifier-owned oracle keeps `expected` and `forbidden_outcomes` outside that interface. After the trace is complete, the verifier resolves the sealed identity, attaches the expected canonical outcome, and compares it with direct fixture replay. The comparison includes canonical JSON bytes and their SHA-256 digest. Save/restore is exercised before verification.

Run the executable proof from the repository root:

```bash
python3 scripts/test_m0_scenario_adapter.py
```
