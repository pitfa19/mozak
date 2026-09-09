# Resource and portability contract

## Provisional profiles

| Profile | Sources | Snapshots | Claims | Graph edges | Concurrent jobs |
|---|---:|---:|---:|---:|---:|
| smoke | 20 | 100 | 1,000 | 10,000 | 1 |
| personal | 5,000 | 50,000 | 500,000 | 5,000,000 | 4 |
| server | 100,000 | 1,000,000 | 10,000,000 | 100,000,000 | 32 |

The alpha must run the smoke and personal workflows on CPU. A GPU, network connection, cloud database, and hosted model are optional accelerators, never correctness dependencies.

## Portability

- Supported alpha hosts: current 64-bit Linux and macOS. Windows is supported through WSL until native path tests exist.
- Canonical exports use UTF-8 JSON Lines, lowercase hexadecimal SHA-256 hashes, RFC 3339 UTC timestamps, and stable string identifiers.
- Canonical paths use `/` separators and are relative to a declared project or brain root.
- Snapshots are content-addressed. Runtime indexes, caches, embeddings, and rendered views are rebuildable and excluded from canonical hashes.
- Backup and restore must reproduce the same canonical hash on a different absolute path.

Numeric latency, memory, and disk thresholds remain provisional until raw-file and lexical baselines are measured.
