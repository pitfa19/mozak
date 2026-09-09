# Lifecycle contracts

## Source

`registered -> acquired -> snapshotted -> parsed -> refreshed`

Acquisition failure leaves the previous snapshot intact. A content change at the same URL creates a new snapshot. Deletion or unreachability changes availability metadata but never deletes retained snapshots automatically.

## Claim

`candidate -> accepted | rejected | disputed -> superseded | retracted | archived`

Only an approved patch can enter `accepted`, `superseded`, or `retracted`. Accepted claims require at least one exact evidence span unless explicitly marked as a human decision or assumption. Conflict produces `disputed`, not silent replacement.

## Discovery branch

`intake -> active -> review_wait -> released -> refresh_due -> archived`

Branches are temporary and may propose patches. Their notes and model outputs are not canonical evidence.

## Job

`queued -> running -> approval_wait -> succeeded | failed | cancelled | interrupted | stale`

Retries create a new attempt under the same generation. A job whose base generation is older than canonical state becomes `stale` and cannot commit its patch.

## Packet

`draft -> reviewed -> released -> superseded | expired | archived`

Updating a released packet creates a new version. Released packet content remains immutable and names the canonical generation and evidence snapshot hashes used to produce it.
