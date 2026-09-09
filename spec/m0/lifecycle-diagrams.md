# Lifecycle diagrams

These diagrams are explanatory views of the normative transitions in `state-model.md`. Guards remain normative even when a diagram omits incidental metadata.

## Source

```mermaid
stateDiagram-v2
  [*] --> registered
  registered --> acquired: approved acquisition succeeds
  acquired --> snapshotted: bytes hashed and retained
  snapshotted --> parsed: parser output recorded
  parsed --> refreshed: refresh finds same or new content
  refreshed --> snapshotted: changed content creates new snapshot
  acquired --> registered: acquisition fails, prior snapshot retained
```

## Claim

```mermaid
stateDiagram-v2
  [*] --> candidate
  candidate --> accepted: authorized patch and evidence or declared human basis
  candidate --> rejected: authorized review
  accepted --> disputed: conflicting evidence
  accepted --> superseded: approved replacement
  accepted --> retracted: approved retraction
  disputed --> superseded: approved resolution
  rejected --> archived
  superseded --> archived
  retracted --> archived
```

## Discovery branch

```mermaid
stateDiagram-v2
  [*] --> intake
  intake --> active: scope and budget approved
  active --> review_wait: patch or release proposed
  review_wait --> active: changes requested
  review_wait --> released: owner approval
  released --> refresh_due: freshness threshold reached
  refresh_due --> active: refresh begins
  released --> archived
  refresh_due --> archived
```

## Job

```mermaid
stateDiagram-v2
  [*] --> queued
  queued --> running
  running --> approval_wait: privileged action or canonical patch
  approval_wait --> running: approval granted
  running --> succeeded
  running --> failed
  running --> interrupted
  queued --> cancelled
  running --> cancelled
  queued --> stale: base generation advanced
  running --> stale: base generation advanced
  approval_wait --> stale: base generation advanced
```

## Packet

```mermaid
stateDiagram-v2
  [*] --> draft
  draft --> reviewed: authorized review completed
  reviewed --> draft: changes requested
  reviewed --> released: owner release approval
  released --> superseded: replacement version released
  released --> expired: freshness threshold reached
  draft --> archived
  reviewed --> archived
  superseded --> archived
  expired --> archived
```

## Cross-cutting guards

- A transition that changes canonical claim state is represented by an authorized event in an approved, non-stale patch.
- Released packet bytes are immutable. Revision creates a new version and may set `supersedes`.
- Failure, cancellation, interruption, and staleness do not erase events, attempts, snapshots, or review records.
