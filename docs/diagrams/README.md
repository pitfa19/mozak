# Diagrams

Three self-contained HTML diagrams, generated with [archify](https://github.com/tt-a1i/archify)
from the typed JSON sources beside them. Open an HTML file directly; nothing is fetched.

`mozak-module-map.mmd` is the single source for the module map that appears in
[`../../README.md`](../../README.md) and [`../MODULES.md`](../MODULES.md).
`scripts/check_docs_match_binary.py` fails CI when either copy drifts from it.

| Artifact | Source | Shows |
|---|---|---|
| `mozak-modules.html` | `mozak-modules.architecture.json` | The six modules MOZAK consists of, and which of them may mutate state |
| `mozak-improve-lab.html` | `mozak-improve-lab.workflow.json` | The Improve Lab as an ordered run, with the points where it refuses |
| `mozak-kb-and-meta.html` | `mozak-kb-and-meta.dataflow.json` | How the KB registry pins Scopes, and how the Meta KB relates projects |

The Lab and KB diagrams set `animation: "trace"`, which the renderer emits as
`data-animation="trace"` on the SVG root; the viewer's motion control unhides
only when that attribute is present. `mozak-modules.html` omits it deliberately
and has no motion. Motion never enters a static export, and the viewer honours
`prefers-reduced-motion`.

Each viewer carries guided views (`P` to play, `[` and `]` to step), search
(`/`), route probing (`R`), theme switching (`T`) and export (`E`).

## Regenerating

```bash
cd ~/.claude/skills/archify
D="$(git rev-parse --show-toplevel)/docs/diagrams"

node bin/archify.mjs deliver architecture $D/mozak-modules.architecture.json    $D/mozak-modules.html      --quality showcase --json
node bin/archify.mjs deliver workflow     $D/mozak-improve-lab.workflow.json    $D/mozak-improve-lab.html  --quality showcase --json
node bin/archify.mjs deliver dataflow     $D/mozak-kb-and-meta.dataflow.json    $D/mozak-kb-and-meta.html  --quality showcase --json
```

Swap `deliver` for `validate` (dropping the output path) while iterating.
Validation must report all 9 artifact checks with no errors before delivery,
and a passing validation freezes the source: edit it again and revalidate
rather than editing after a pass.

Browser evidence needs a Chrome path, and on a distribution whose AppArmor
policy blocks unprivileged user namespaces it also needs the sandbox opt-out:

```bash
export ARCHIFY_CHROME=~/.cache/puppeteer/chrome/linux-152.0.7977.42/chrome-linux64/chrome
export ARCHIFY_CHROME_NO_SANDBOX=1
node bin/archify.mjs visual-check $D/mozak-modules.html --json
```

All three artifacts pass containment and readability at 1440x900, 1600x1000,
1920x1080 and 2048x1320. The `*.visual-check.*` screenshots and receipts are
regenerable evidence and are not tracked.

`visual-check` sets `data-motion="still"` before capturing, so its screenshots
are deterministic and are not evidence about motion. To check motion, read the
attribute on the SVG root. Grepping for the bare string is misleading, because
the shared stylesheet mentions `data-animation="trace"` in fifteen selectors
in every artifact, animated or not:

```bash
python3 -c "import re,sys; s=open(sys.argv[1]).read(); m=re.search(r'<svg[^>]*data-animation=\"(\w+)\"', s); print(m.group(1) if m else 'no motion')" \
  mozak-improve-lab.html
```

## What these diagrams do not claim

They show authored structure, not runtime behaviour, and no measurement.
A relationship is a recorded relationship, not a proven one.
Deterministic artifact checks, browser evidence, and perceptual review are
three separate claims: `deliver` proves the first, `visual-check` the second,
and only a human or an image-capable reviewer the third.
