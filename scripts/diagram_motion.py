#!/usr/bin/env python3
"""Report whether each diagram artifact carries authored trace motion.

The viewer's motion control unhides only when the SVG root carries
`data-animation="trace"`. Grepping the file for that string is misleading: the
shared stylesheet mentions it in fifteen selectors in every artifact, animated
or not. And `archify visual-check` sets `data-motion="still"` before it
captures, so its screenshots are deterministic and are not evidence about
motion either. Only the root attribute answers the question.

Usage: diagram_motion.py DIAGRAMS_DIR
"""

from __future__ import annotations

import os
import re
import sys

EXPECTED = {
    "mozak-modules.html": "none",
    "mozak-improve-lab.html": "trace",
    "mozak-kb-and-meta.html": "trace",
}


def motion(path: str) -> str:
    with open(path, encoding="utf-8") as handle:
        found = re.search(r'<svg[^>]*data-animation="(\w+)"', handle.read())
    return found.group(1) if found else "none"


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__, file=sys.stderr)
        return 2
    failed = False
    for artifact, expected in EXPECTED.items():
        observed = motion(os.path.join(argv[1], artifact))
        if observed == expected:
            print(f"  ok       {artifact} motion={observed}")
        else:
            print(f"  MISMATCH {artifact} motion={observed} expected={expected}")
            failed = True
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
