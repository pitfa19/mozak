#!/usr/bin/env python3
"""Deterministic read-only audit, repair planning, and mechanical apply for notes."""
from __future__ import annotations

import argparse, datetime as dt, hashlib, json, os, re, shutil, sys, tempfile
from pathlib import Path
from typing import Any

SCHEMA = 1
CONFIDENCE = {"low", "medium", "high"}
SEMANTIC_CODES = {"missing_trust_metadata", "stale_last_verified", "broken_link", "possible_duplicate", "archive_proposal"}
MECHANICAL_CODES = {"trailing_whitespace", "excess_blank_lines", "missing_final_newline"}


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def path_sha(path: Path) -> str:
    return sha(path.read_bytes())


def die(message: str, code: int = 2) -> None:
    print(json.dumps({"schema_version": SCHEMA, "state": "invalid", "error": message}, sort_keys=True), file=sys.stderr)
    raise SystemExit(code)


def inside(child: Path, parent: Path) -> bool:
    try:
        child.resolve(strict=False).relative_to(parent.resolve(strict=True))
        return True
    except (OSError, ValueError):
        return False


def safe_root(value: str) -> Path:
    if not value:
        die("--root is required")
    root = Path(value).expanduser()
    if not root.is_absolute():
        die("root must be absolute")
    if root.is_symlink() or not root.is_dir():
        die("root must be an existing non-symlink directory")
    for ancestor in [root, *root.parents]:
        if ancestor.is_symlink():
            die("root must not have symlink ancestors")
    return root.resolve()


def rel(path: Path, root: Path) -> str:
    return path.resolve().relative_to(root).as_posix()


def md_files(root: Path) -> list[Path]:
    ignored = {".git", ".obsidian", ".trash", "node_modules", "__pycache__"}
    out: list[Path] = []
    for path in sorted(root.rglob("*.md")):
        if any(part in ignored for part in path.relative_to(root).parts):
            continue
        if not path.is_symlink() and path.is_file():
            out.append(path)
    return out


def parse_frontmatter(text: str) -> dict[str, str]:
    if not text.startswith("---\n"):
        return {}
    end = text.find("\n---", 4)
    if end == -1:
        return {}
    fields: dict[str, str] = {}
    for line in text[4:end].splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            fields[k.strip()] = v.strip().strip('"')
    return fields


def fixed_text(text: str) -> str:
    lines = text.splitlines()
    fixed_lines = [re.sub(r"[ \t]+$", "", line) for line in lines]
    fixed = "\n".join(fixed_lines)
    fixed = re.sub(r"\n{3,}", "\n\n", fixed)
    return fixed + "\n"


def detect_links(text: str) -> list[str]:
    targets = re.findall(r"\[[^\]]+\]\(([^):#][^)]*)\)", text)
    targets += [m.strip() + ".md" for m in re.findall(r"\[\[([^\]#|]+)", text)]
    return [t for t in targets if t.strip()]


def audit(args: argparse.Namespace) -> int:
    root = safe_root(args.root)
    files = md_files(root)
    findings, repairs, proposals = [], [], []
    seen_body: dict[str, str] = {}
    for path in files:
        raw = path.read_bytes()
        text = raw.decode("utf-8-sig", errors="replace")
        r = rel(path, root)
        digest = sha(raw)
        fix = fixed_text(text)
        if fix.encode() != raw:
            codes = []
            if any(line.rstrip(" \t") != line for line in text.splitlines()):
                codes.append("trailing_whitespace")
            if re.search(r"\n{3,}", text):
                codes.append("excess_blank_lines")
            if not raw.endswith(b"\n"):
                codes.append("missing_final_newline")
            repairs.append({"path": r, "before_sha256": digest, "after_sha256": sha(fix.encode()), "codes": codes, "kind": "mechanical"})
        fm = parse_frontmatter(text)
        missing = [k for k in ("last_verified", "confidence") if k not in fm]
        if missing:
            proposals.append({"path": r, "kind": "proposal_only", "code": "missing_trust_metadata", "fields": missing})
        if fm.get("confidence") and fm.get("confidence") not in CONFIDENCE:
            findings.append({"path": r, "severity": "warning", "code": "invalid_confidence", "value": fm.get("confidence")})
        if fm.get("archive_proposal"):
            proposals.append({"path": r, "kind": "proposal_only", "code": "archive_proposal", "reason": fm["archive_proposal"], "before_sha256": digest})
        if fm.get("last_verified"):
            try:
                verified = dt.date.fromisoformat(fm["last_verified"][:10])
                if (dt.date.today() - verified).days > args.stale_days:
                    proposals.append({"path": r, "kind": "proposal_only", "code": "stale_last_verified", "last_verified": fm["last_verified"]})
            except ValueError:
                findings.append({"path": r, "severity": "warning", "code": "invalid_last_verified", "value": fm["last_verified"]})
        body_key = sha(re.sub(r"\s+", " ", re.sub(r"---.*?---", "", text, flags=re.S)).strip().lower().encode())
        if body_key in seen_body:
            proposals.append({"path": r, "kind": "proposal_only", "code": "possible_duplicate", "other_path": seen_body[body_key]})
        else:
            seen_body[body_key] = r
        for target in detect_links(text):
            target_path = (path.parent / target).with_suffix(Path(target).suffix or ".md")
            if not inside(target_path, root) or not target_path.exists():
                proposals.append({"path": r, "kind": "proposal_only", "code": "broken_link", "target": target})
    report: dict[str, Any] = {"schema_version": SCHEMA, "mode": "read_only_audit", "root_included": bool(args.show_absolute_root), "root": str(root) if args.show_absolute_root else None, "file_count": len(files), "findings": findings, "mechanical_repairs": repairs, "semantic_proposals": proposals}
    write_json(args.output, report)
    print(json.dumps({"state": "ok", "output": args.output, "file_count": len(files), "mechanical_repairs": len(repairs), "semantic_proposals": len(proposals)}, sort_keys=True))
    return 0


def write_json(path_value: str, data: Any) -> None:
    path = Path(path_value)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def plan(args: argparse.Namespace) -> int:
    report_path = Path(args.report)
    report = json.loads(report_path.read_text(encoding="utf-8"))
    actions = []
    for item in report.get("mechanical_repairs", []):
        actions.append({"action": "rewrite_file", "kind": "mechanical", "path": item["path"], "before_sha256": item["before_sha256"], "after_sha256": item["after_sha256"], "codes": item["codes"]})
    plan_doc = {"schema_version": SCHEMA, "source_report_sha256": path_sha(report_path), "allowed_actions": ["rewrite_file"], "forbidden_actions": ["delete", "merge", "semantic_restructure", "supplement_extract", "trust_metadata_write"], "actions": actions, "semantic_proposals_archived": report.get("semantic_proposals", [])}
    write_json(args.output, plan_doc)
    print(json.dumps({"state": "ok", "output": args.output, "actions": len(actions)}, sort_keys=True))
    return 0


def apply(args: argparse.Namespace) -> int:
    root = safe_root(args.root)
    plan_doc = json.loads(Path(args.plan).read_text(encoding="utf-8"))
    snapshot_dir = Path(args.snapshot_dir).resolve(); archive_dir = Path(args.archive_dir).resolve()
    snapshot_dir.mkdir(parents=True, exist_ok=True); archive_dir.mkdir(parents=True, exist_ok=True)
    receipts = []
    for action in plan_doc.get("actions", []):
        if action.get("kind") != "mechanical" or action.get("action") != "rewrite_file":
            die("plan contains non-mechanical action", 3)
        path = (root / action["path"]).resolve()
        if not inside(path, root) or not path.is_file() or path.is_symlink():
            die("plan path is unsafe", 3)
        before = path.read_bytes()
        if sha(before) != action["before_sha256"]:
            die(f"hash mismatch for {action['path']}", 3)
        fixed = fixed_text(before.decode("utf-8-sig", errors="replace")).encode()
        if sha(fixed) != action["after_sha256"]:
            die(f"planned after hash mismatch for {action['path']}", 3)
        snap = snapshot_dir / action["path"]
        snap.parent.mkdir(parents=True, exist_ok=True)
        snap.write_bytes(before)
        tmp_fd, tmp_name = tempfile.mkstemp(prefix=path.name + ".", dir=str(path.parent))
        with os.fdopen(tmp_fd, "wb") as handle:
            handle.write(fixed)
        os.replace(tmp_name, path)
        receipts.append({"path": action["path"], "before_sha256": sha(before), "after_sha256": path_sha(path), "snapshot_path": snap.relative_to(snapshot_dir).as_posix(), "snapshot_sha256": path_sha(snap), "preserved": path_sha(snap) == sha(before)})
    receipt = {"schema_version": SCHEMA, "state": "applied", "permanent_delete": False, "archive_dir_created_for_recoverability": str(archive_dir.name), "preservation_verified": all(r["preserved"] for r in receipts), "actions": receipts}
    write_json(args.output, receipt)
    print(json.dumps({"state": "applied", "actions": len(receipts), "preservation_verified": receipt["preservation_verified"]}, sort_keys=True))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("audit"); a.add_argument("--root", required=True); a.add_argument("--output", required=True); a.add_argument("--stale-days", type=int, default=180); a.add_argument("--show-absolute-root", action="store_true")
    p = sub.add_parser("plan"); p.add_argument("--report", required=True); p.add_argument("--output", required=True)
    ap = sub.add_parser("apply"); ap.add_argument("--plan", required=True); ap.add_argument("--root", required=True); ap.add_argument("--snapshot-dir", required=True); ap.add_argument("--archive-dir", required=True); ap.add_argument("--output", required=True)
    args = parser.parse_args()
    return {"audit": audit, "plan": plan, "apply": apply}[args.cmd](args)

if __name__ == "__main__":
    raise SystemExit(main())
