#!/usr/bin/env python3
"""Private aggregate Markdown voice census.

Builds corpus baselines and compares drafts without retaining or printing note
bodies, quotes, or absolute input roots by default. Standard library only.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Dict, Iterable, List, Tuple

VERSION = "1.0.0"
TOKEN_RE = re.compile(r"[A-Za-z][A-Za-z'-]*")
SENTENCE_RE = re.compile(r"[^.!?]+[.!?]|[^.!?]+$", re.VERBOSE)
HEADING_RE = re.compile(r"^\s{0,3}#{1,6}\s+(.+?)\s*$")
STOPWORDS = {
    "a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "from",
    "has", "have", "in", "is", "it", "its", "of", "on", "or", "that", "the",
    "this", "to", "was", "were", "with", "you", "your", "i", "we", "our", "they",
    "their", "not", "no", "if", "then", "than", "so", "because", "into", "over",
}
DEFAULT_THRESHOLDS = {
    "min_corpus_word_count": 20,
    "word_rate_multiplier": 2.0,
    "word_rate_absolute_floor": 0.08,
    "sentence_shape_multiplier": 2.0,
    "sentence_shape_absolute_floor": 0.35,
    "sentence_length_multiplier": 2.0,
    "sentence_length_absolute_floor": 0.35,
    "heading_opener_multiplier": 2.0,
    "heading_opener_absolute_floor": 0.6,
}


def err(message: str) -> int:
    print(json.dumps({"status": "error", "message": message}, sort_keys=True), file=sys.stderr)
    return 2


def local_paths(paths: List[str]) -> List[Path]:
    if not paths:
        raise ValueError("at least one local path is required")
    resolved = []
    for raw in paths:
        p = Path(raw).expanduser()
        if re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*://", raw):
            raise ValueError("network or URL inputs are not accepted")
        if not p.exists():
            raise ValueError("input path does not exist")
        resolved.append(p.resolve())
    return resolved


def markdown_files(paths: List[Path]) -> List[Path]:
    files: List[Path] = []
    for p in paths:
        if p.is_file():
            if p.suffix.lower() in {".md", ".markdown"}:
                files.append(p)
            continue
        for child in sorted(p.rglob("*")):
            if child.is_file() and child.suffix.lower() in {".md", ".markdown"}:
                files.append(child)
    if not files:
        raise ValueError("no Markdown files found")
    return sorted(set(files))


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return path.read_text(encoding="utf-8", errors="ignore")


def normalize_token(token: str) -> str:
    return token.lower().strip("'-")


def length_bucket(count: int) -> str:
    if count <= 8:
        return "short"
    if count <= 18:
        return "medium"
    if count <= 30:
        return "long"
    return "very_long"


def sentence_shape(sentence: str) -> Tuple[str, str]:
    words = [normalize_token(t.group(0)) for t in TOKEN_RE.finditer(sentence)]
    end = sentence.strip()[-1:] or "none"
    punct = {".": "period", "!": "exclaim", "?": "question"}.get(end, "open")
    return (f"{length_bucket(len(words))}-{punct}", length_bucket(len(words)))


def strip_code(text: str) -> str:
    text = re.sub(r"```.*?```", " ", text, flags=re.S)
    text = re.sub(r"`[^`]*`", " ", text)
    return text


def collect(files: List[Path]) -> Dict[str, object]:
    words: Counter[str] = Counter()
    shapes: Counter[str] = Counter()
    lengths: Counter[str] = Counter()
    headings: Counter[str] = Counter()
    file_hashes: List[str] = []
    byte_count = 0
    for path in files:
        text = read_text(path)
        byte_count += len(text.encode("utf-8"))
        file_hashes.append(hashlib.sha256(text.encode("utf-8")).hexdigest())
        safe = strip_code(text)
        for line in safe.splitlines():
            m = HEADING_RE.match(line)
            if m:
                toks = [normalize_token(t.group(0)) for t in TOKEN_RE.finditer(m.group(1))]
                toks = [t for t in toks if t and t not in STOPWORDS]
                if toks:
                    headings[toks[0]] += 1
        for match in TOKEN_RE.finditer(safe):
            tok = normalize_token(match.group(0))
            if tok and tok not in STOPWORDS and len(tok) > 1:
                words[tok] += 1
        for sent in SENTENCE_RE.findall(safe.replace("\n", " ")):
            if TOKEN_RE.search(sent):
                shape, bucket = sentence_shape(sent)
                shapes[shape] += 1
                lengths[bucket] += 1
    source_digest = hashlib.sha256("".join(sorted(file_hashes)).encode("ascii")).hexdigest()
    return {
        "file_count": len(files),
        "byte_count": byte_count,
        "source_digest": source_digest,
        "words": dict(sorted(words.items())),
        "sentence_shapes": dict(sorted(shapes.items())),
        "sentence_lengths": dict(sorted(lengths.items())),
        "heading_openers": dict(sorted(headings.items())),
    }


def rates(counter: Dict[str, int]) -> Dict[str, float]:
    total = sum(counter.values())
    if total == 0:
        return {}
    return {k: v / total for k, v in sorted(counter.items())}


def baseline_doc(metrics: Dict[str, object]) -> Dict[str, object]:
    return {
        "schema_version": 1,
        "tool": "note-voice-census",
        "tool_version": VERSION,
        "privacy": {
            "aggregate_only": True,
            "contains_note_bodies": False,
            "contains_quotes": False,
            "contains_input_paths": False,
        },
        "corpus": {
            "file_count": metrics["file_count"],
            "byte_count": metrics["byte_count"],
            "source_digest": metrics["source_digest"],
        },
        "metrics": {
            "word_counts": metrics["words"],
            "word_rates": rates(metrics["words"]),
            "sentence_shape_counts": metrics["sentence_shapes"],
            "sentence_shape_rates": rates(metrics["sentence_shapes"]),
            "sentence_length_counts": metrics["sentence_lengths"],
            "sentence_length_rates": rates(metrics["sentence_lengths"]),
            "heading_opener_counts": metrics["heading_openers"],
            "heading_opener_rates": rates(metrics["heading_openers"]),
        },
    }


def load_json(path: Path) -> Dict[str, object]:
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def load_thresholds(path: str | None) -> Dict[str, float]:
    data = dict(DEFAULT_THRESHOLDS)
    if path:
        loaded = load_json(Path(path).expanduser())
        data.update(loaded)
    return data


def top_limited(rate_map: Dict[str, float], limit: int = 50) -> Dict[str, float]:
    return dict(sorted(rate_map.items(), key=lambda kv: (-kv[1], kv[0]))[:limit])


def compare_family(name: str, base: Dict[str, float], draft: Dict[str, float], multiplier: float, floor: float) -> List[Dict[str, object]]:
    exceeded = []
    keys = set(base) | set(draft)
    for key in sorted(keys):
        draft_rate = float(draft.get(key, 0.0))
        base_rate = float(base.get(key, 0.0))
        allowed = max(base_rate * multiplier, floor if base_rate == 0 else 0.0)
        if draft_rate > allowed:
            exceeded.append({
                "metric": name,
                "item": key,
                "baseline_rate": round(base_rate, 6),
                "draft_rate": round(draft_rate, 6),
                "allowed_rate": round(allowed, 6),
            })
    return exceeded


def cmd_baseline(args: argparse.Namespace) -> int:
    try:
        paths = local_paths(args.corpus)
        files = markdown_files(paths)
        doc = baseline_doc(collect(files))
        out = Path(args.output).expanduser()
        out.parent.mkdir(parents=True, exist_ok=True)
        tmp = out.with_name(out.name + ".tmp")
        tmp.write_text(json.dumps(doc, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        os.replace(tmp, out)
        summary = {"status": "ok", "output": str(out) if args.include_paths else "written", "corpus": doc["corpus"], "privacy": doc["privacy"]}
        print(json.dumps(summary, sort_keys=True))
        return 0
    except Exception as exc:
        return err(str(exc))


def cmd_compare(args: argparse.Namespace) -> int:
    try:
        baseline = load_json(Path(args.baseline).expanduser())
        if not baseline.get("privacy", {}).get("aggregate_only"):
            raise ValueError("baseline is not marked aggregate-only")
        th = load_thresholds(args.thresholds)
        metrics = collect(markdown_files(local_paths(args.draft)))
        draft_doc = baseline_doc(metrics)
        if sum(baseline["metrics"]["word_counts"].values()) < int(th["min_corpus_word_count"]):
            raise ValueError("baseline corpus is smaller than min_corpus_word_count")
        exceeded: List[Dict[str, object]] = []
        exceeded += compare_family("word", top_limited(baseline["metrics"]["word_rates"]), draft_doc["metrics"]["word_rates"], float(th["word_rate_multiplier"]), float(th["word_rate_absolute_floor"]))
        exceeded += compare_family("sentence_shape", baseline["metrics"]["sentence_shape_rates"], draft_doc["metrics"]["sentence_shape_rates"], float(th["sentence_shape_multiplier"]), float(th["sentence_shape_absolute_floor"]))
        exceeded += compare_family("sentence_length", baseline["metrics"]["sentence_length_rates"], draft_doc["metrics"]["sentence_length_rates"], float(th["sentence_length_multiplier"]), float(th["sentence_length_absolute_floor"]))
        exceeded += compare_family("heading_opener", baseline["metrics"]["heading_opener_rates"], draft_doc["metrics"]["heading_opener_rates"], float(th["heading_opener_multiplier"]), float(th["heading_opener_absolute_floor"]))
        result = {
            "status": "exceeded" if exceeded else "ok",
            "privacy": draft_doc["privacy"],
            "draft": draft_doc["corpus"],
            "thresholds_exceeded": exceeded,
        }
        print(json.dumps(result, indent=2, sort_keys=True))
        return 1 if exceeded else 0
    except Exception as exc:
        return err(str(exc))


def main(argv: List[str]) -> int:
    parser = argparse.ArgumentParser(description="Aggregate-only Markdown voice census")
    sub = parser.add_subparsers(dest="cmd", required=True)
    p_base = sub.add_parser("baseline", help="build an aggregate baseline")
    p_base.add_argument("--corpus", action="append", required=True)
    p_base.add_argument("--output", required=True)
    p_base.add_argument("--include-paths", action="store_true")
    p_base.set_defaults(func=cmd_baseline)
    p_cmp = sub.add_parser("compare", help="compare drafts to a baseline")
    p_cmp.add_argument("--baseline", required=True)
    p_cmp.add_argument("--draft", action="append", required=True)
    p_cmp.add_argument("--thresholds")
    p_cmp.add_argument("--include-paths", action="store_true")
    p_cmp.set_defaults(func=cmd_compare)
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
