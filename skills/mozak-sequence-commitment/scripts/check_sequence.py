#!/usr/bin/env python3
"""Read-only audit of declared completion, not evidence or approval authentication."""
import hashlib
import json
import os
import stat
import sys


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key")
        result[key] = value
    return result


def read_json(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as stream:
        metadata = os.fstat(stream.fileno())
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_size > 1024 * 1024:
            raise ValueError("record must be a regular file within 1 MiB")
        data = stream.read(1024 * 1024 + 1)
        if len(data) != metadata.st_size:
            raise ValueError("record changed or exceeded size cap")
    return data, json.loads(data, object_pairs_hook=unique_object)


def indexed(rows):
    if not isinstance(rows, list) or not rows or len(rows) > 200:
        raise ValueError("require a nonempty bounded list")
    result = {}
    for row in rows:
        identifier = row["id"]
        if not isinstance(identifier, str) or not identifier.strip() or identifier in result:
            raise ValueError("invalid or duplicate ID")
        result[identifier] = row
    return result


def audit(contract_bytes, contract, checkpoint):
    if not isinstance(contract["sequence_id"], str) or not contract["sequence_id"].strip():
        raise ValueError("missing sequence identity")
    if checkpoint["sequence_id"] != contract["sequence_id"]:
        raise ValueError("sequence identity changed")
    if checkpoint["contract_sha256"] != hashlib.sha256(contract_bytes).hexdigest():
        raise ValueError("original contract bytes changed")
    original = indexed(contract["requirements"])
    current = indexed(checkpoint["requirements"])
    if original.keys() != current.keys():
        raise ValueError("original scope was dropped or substituted")
    incomplete = []
    for identifier, requirement in original.items():
        item = current[identifier]
        if item["status"] not in ("verified", "pending", "in_progress", "blocked"):
            raise ValueError("cancellation or deferral is not completion")
        expected = indexed(requirement["checks"])
        for check in expected.values():
            if type(check["real_required"]) is not bool:
                raise ValueError("real_required must be boolean")
        if item["status"] != "verified":
            incomplete.append(identifier)
            continue
        observed = indexed(item["checks"])
        if expected.keys() != observed.keys():
            raise ValueError("acceptance checks changed")
        for check_id, check in expected.items():
            observation = observed[check_id]
            reference = observation.get("evidence")
            if (observation.get("passed") is not True
                    or observation.get("observation") not in ("real", "synthetic", "inspection")
                    or not isinstance(reference, str) or not reference.strip()
                    or (check["real_required"] and observation["observation"] != "real")):
                incomplete.append(identifier + ":" + check_id)
    return {"state": "incomplete" if incomplete else "declared_complete",
            "remaining": incomplete,
            "limitation": "declared records only, not authenticated evidence or owner approval"}


def main():
    try:
        if len(sys.argv) != 3:
            raise ValueError("usage: check_sequence.py CONTRACT.json CHECKPOINT.json")
        data, contract = read_json(sys.argv[1])
        _, checkpoint = read_json(sys.argv[2])
        result = audit(data, contract, checkpoint)
        print(json.dumps(result, sort_keys=True))
        return 2 if result["remaining"] else 0
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as error:
        print(json.dumps({"state": "invalid", "error": str(error)}, sort_keys=True))
        return 3


if __name__ == "__main__":
    sys.exit(main())
