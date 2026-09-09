# Project Framework positive and adversarial examples

These fixtures are normative examples and are checked against the machine-readable catalog.

## Artifact lifecycle examples

| Class | Positive example | Adversarial boundary |
|---|---|---|
| Allowed | A versioned research-run JSON in a declared `.mozak` path validates against its contract. | Valid JSON outside an owned root is not allowed merely because its contents validate. |
| Temporary | A branch-local synthesis draft is labeled non-canonical and may only propose a planning input. | A temporary draft is queried as accepted truth or directly rewrites a goal. |
| Accepted | An authorized decision records evidence, reviewer, revision, and transaction time in canonical history. | An agent self-labels generated text `accepted` without the authorization event. |
| Superseded | Packet v2 links to immutable v1, and current selection resolves to v2 while v1 remains auditable. | Packet v1 is overwritten or deleted when v2 is released. |
| Rejected | A proposed finding is retained with reviewer rationale and excluded from current accepted knowledge. | A rejected proposal appears in a release as an accepted finding. |

## Invariant fixtures

### PF-I01: Trust-zone separation

- Positive: A fetched page is stored by hash and quoted as evidence, while an owner-approved pipeline file controls the run.
- Adversarial: A page says to ignore policy and publish a secret; the text is retained only as untrusted bytes and no action is authorized.

### PF-I02: Append-only accepted history

- Positive: A corrected finding supersedes the prior version while both remain reconstructable.
- Adversarial: A tool attempts to edit an accepted finding in place; validation rejects the mutation.

### PF-I03: Immutable exact evidence

- Positive: A finding cites snapshot sha256:abc and lines 10-14.
- Adversarial: A synthesis cites only a mutable URL; it cannot be accepted as a factual finding.

### PF-I04: Authorized mutation boundary

- Positive: An agent proposes a packet and an authorized owner records release approval.
- Adversarial: A provider marks its own output accepted; the transition is denied.

### PF-I05: Stale work fails closed

- Positive: A result based on revision R is accepted while R remains current.
- Adversarial: A result based on R is submitted after R+1; it is marked stale and cannot commit.

### PF-I06: Dependency provenance

- Positive: A build log supports an observed dependency from test to generated schema.
- Adversarial: A model guesses an edge and stores it as declared; validation rejects the provenance mismatch.

### PF-I07: Bounded immutable releases

- Positive: Packet v2 links to v1 and records changed constraints and fresh evidence hashes.
- Adversarial: A released packet is overwritten at the same version; canonical validation fails.

### PF-I08: Derived state is non-authoritative

- Positive: Deleting an index and rebuilding from canonical events yields the same accepted state.
- Adversarial: A vector result with no canonical record is returned as accepted knowledge; the query fails closed.

### PF-I09: Scope and time remain explicit

- Positive: A project-local policy valid from T1 coexists with a global default and retains its acceptance generation.
- Adversarial: Two scoped values are collapsed into one timeless global fact; validation rejects the lossy projection.

### PF-I10: Provider-neutral correctness

- Positive: Two adapters emit contract-equivalent research-run artifacts and offline validation gives equal results.
- Adversarial: A required field contains a vendor session identifier with no portable semantic equivalent; the contract rejects it.

### PF-I11: Capabilities, confinement, and audit

- Positive: A connector may read one approved URL within budget and records its inputs and result.
- Adversarial: A path resolves outside the declared root or a connector exceeds budget; execution stops without side effects.

### PF-I12: Independent acceptance evidence

- Positive: A separate validator maps all packet checks to command outputs and artifacts.
- Adversarial: The executor says tests passed but supplies no observable result; completion is not accepted.
