#!/usr/bin/env python3
"""Fails when a doc claims something the binary does not.

Three checks, all cheap enough to run in CI:

1. The module map diagram in docs/ARCHITECTURE.md is byte-identical to
   `mozak-module-map.mmd`, so the single source really is single. The README
   uses the drawn PNG instead and carries no copy of it.
2. Every module id `mozak lab modules` returns appears in README.md and
   docs/MODULES.md, and no retired id survives anywhere in the docs.
3. No doc claims a module count that disagrees with the binary.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIAGRAM = ROOT / "docs/diagrams/mozak-module-map.mmd"
DOCS_WITH_DIAGRAM = [ROOT / "docs/ARCHITECTURE.md"]
DOCS_NAMING_MODULES = [ROOT / "README.md", ROOT / "docs/MODULES.md", ROOT / "docs/ARCHITECTURE.md"]
RETIRED_IDS = [
    "research-and-adapters",
    "scope-and-knowledge-state",
    "concepts-and-translations",
    "planning-and-execution",
    "evaluation-and-cases",
    "distribution-and-installation",
    "self-improvement-lab",
]
# Names a doc must not use for a current module, because the binary calls it
# something else. Matched as a whole word inside a backtick-quoted id list.
RENAMED_IDS = {"work": "plans"}
COUNT_WORDS = {
    "one": 1,
    "two": 2,
    "three": 3,
    "four": 4,
    "five": 5,
    "six": 6,
    "seven": 7,
    "eight": 8,
    "nine": 9,
    "ten": 10,
    "eleven": 11,
    "twelve": 12,
    "thirteen": 13,
}


def mozak_binary() -> str:
    for candidate in ("target/debug/mozak", "target/release/mozak"):
        path = ROOT / candidate
        if path.exists():
            return str(path)
    return "mozak"


def module_ids() -> list[str]:
    raw = subprocess.run(
        [mozak_binary(), "lab", "modules"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    return [module["id"] for module in json.loads(raw)["modules"]]


def mermaid_blocks(text: str) -> list[str]:
    return [block.strip() for block in re.findall(r"```mermaid\n(.*?)```", text, re.S)]


def main() -> int:
    failures: list[str] = []

    ids = module_ids()
    source = DIAGRAM.read_text().strip()

    for doc in DOCS_WITH_DIAGRAM:
        blocks = mermaid_blocks(doc.read_text())
        if source not in blocks:
            failures.append(
                f"{doc.relative_to(ROOT)} does not contain the exact diagram from "
                f"{DIAGRAM.relative_to(ROOT)}; copy it verbatim"
            )

    for doc in DOCS_NAMING_MODULES:
        text = doc.read_text()
        for module_id in ids:
            if module_id not in text:
                failures.append(
                    f"{doc.relative_to(ROOT)} never mentions module '{module_id}'"
                )

    for doc in sorted(ROOT.glob("docs/**/*.md")) + [ROOT / "README.md", ROOT / "CLAUDE.md"]:
        text = doc.read_text()
        for retired in RETIRED_IDS:
            if retired in text:
                failures.append(
                    f"{doc.relative_to(ROOT)} still names retired module id '{retired}'"
                )
        for old, new in RENAMED_IDS.items():
            if re.search(rf"`{re.escape(old)}`", text):
                failures.append(
                    f"{doc.relative_to(ROOT)} uses old module id `{old}`; it is now `{new}`"
                )
        for word, value in COUNT_WORDS.items():
            if value == len(ids):
                continue
            if re.search(rf"\b{word}\s+modules\b", text, re.I):
                failures.append(
                    f"{doc.relative_to(ROOT)} claims '{word} modules' but the binary "
                    f"reports {len(ids)}"
                )

    if failures:
        print("Documentation disagrees with the binary:", file=sys.stderr)
        for failure in sorted(set(failures)):
            print(f"  - {failure}", file=sys.stderr)
        return 1

    print(f"ok: {len(ids)} modules, diagram single-sourced, no retired ids")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
