# Privacy contract

`note-voice-census` is designed for private corpora. By default it reports aggregate metrics only and suppresses note bodies, quotes, and absolute input paths.

Owner-specific baselines are generated artifacts. Keep them in device-local state such as `$XDG_STATE_HOME/note-voice-census` or `$HOME/.local/state/note-voice-census`, not in this repository.

The script performs no network access and uses only Python's standard library.
