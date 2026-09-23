# Repair boundary

A repair is allowed to apply only when all of these are true:

1. The change is mechanical and meaning-preserving.
2. The audit observed the original file hash.
3. The plan records the original hash and the expected repaired hash.
4. Apply rereads the file and refuses if the original hash changed.
5. Apply writes a snapshot before rewriting and verifies the snapshot hash after rewriting.

Semantic work is proposal-only. This includes merge, delete, restructure, supplement extraction, trust metadata changes, archive decisions, routing changes, and edits that choose voice or meaning.

Permanent delete is never a valid action. Recoverable archive may be proposed, and any future owner-approved archive receipt must preserve original bytes under a named archive root.
