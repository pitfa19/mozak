# ADR 0004: Context-first project routing

## Status

Accepted for the current recommended architecture.

## Decision

Fresh-agent operation starts with `mozak project context PROJECT_ID` against an
owner-approved local registration. The local config is a small routing index,
not a trust store or authority transfer. Discovery is explicit, bounded to caller
supplied roots, read-only, and produces a digest-pinned preview. Registration is
a separate create-only mutation requiring strict owner approval. Publication uses
an atomic no-replace filesystem operation, so a concurrently created owner config
is never overwritten. Refreshing or replacing an existing config is deferred until
MOZAK has a versioned update contract with equally strong conflict semantics.

The current architecture uses project manifests, idea documents, accepted plans,
goals, context notes, and observed repository facts directly. It does not require
an Execution Bundle core abstraction. The legacy `mozak execution validate`
route and its code remain available for compatibility with existing artifacts,
but it is not the recommended entry point for fresh-agent context discovery.

## Consequences

- No unbounded filesystem discovery or automatic registration exists.
- Exact project IDs avoid basename, prefix, and fuzzy resolution ambiguity.
- Context output is progressive disclosure and contains no note bodies or KB dump.
- Manifest revision and observed Git HEAD mismatch is reported, not made invalid.
- Deeper legacy lifecycle inspection remains possible through detail commands.
