#!/usr/bin/env python3
"""Decode mutator survivors in .metrics/mutate/*.edn into a readable list.

Usage: scripts/mutants.py [EDN ...] [--all]   (default: every .metrics/mutate/*.edn, survivors only)
Each line: file:line function  original -> mutant   [outcome]  followed by the source line.
"""
import glob
import json
import os
import re
import sys

OUTCOME = re.compile(r'"((?:[^"\\]|\\.)*)"\s+:(killed|survived|uncovered|timeout|error)')


def outcomes(text):
    """Yield (file, function, start, end, original, mutant, outcome) from one edn file's :outcomes map."""
    start = text.find(":outcomes {")
    if start < 0:
        return
    for key, outcome in OUTCOME.findall(text[start:text.find(":forms", start)]):
        file, _ns, form, begin, end, original, mutant = json.loads(json.loads(f'"{key}"'))
        yield file, form.split("/", 1)[-1], begin, end, original, mutant, outcome


def line_of(source, offset):
    """1-based line number and stripped text at a character offset, or (0, '') when the file is gone."""
    if source is None:
        return 0, ""
    line = source.count("\n", 0, offset) + 1
    return line, source.splitlines()[line - 1].strip()


def main(argv):
    show_all = "--all" in argv
    files = [a for a in argv if a != "--all"] or sorted(glob.glob(".metrics/mutate/*.edn"))
    count = 0
    for edn in files:
        with open(edn, encoding="utf-8") as fh:
            text = fh.read()
        cache = {}
        for file, func, begin, _end, original, mutant, outcome in outcomes(text):
            if outcome != "survived" and not show_all:
                continue
            if file not in cache:
                cache[file] = open(file, encoding="utf-8").read() if os.path.exists(file) else None
            line, code = line_of(cache[file], begin)
            print(f"{file}:{line} {func}  {original} -> {mutant}  [{outcome}]\n    {code}")
            count += 1
    print(f"{count} {'mutants' if show_all else 'survivors'}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
