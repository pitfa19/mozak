#!/usr/bin/env python3
"""Build a mozak request from an example payload and a fresh snapshot, so agents never hand-write
`expected` or reuse an operationId.

  python3 make_request.py <action> <payload.json> --config INV --scope ID [--out FILE]

Reads the scope's current snapshot with `mozak context --json` (revision, graphHash, bridge),
wraps the payload as {operationId, scopeId, expected, action, payload}, writes FILE (default
/tmp/mozak-<action>-<op>.json) and prints its path. Run the matching route with --request FILE.
On a `stale-input`/`stale-*` refusal: run this again (fresh snapshot, new operationId), retry once.
"""
import argparse, json, os, subprocess, sys, uuid

ap = argparse.ArgumentParser()
ap.add_argument("action", help="propose | revise | observe | attach-spec | save-discussion | complete")
ap.add_argument("payload", help="JSON file with the payload (see examples/*.json, the `payload` field)")
ap.add_argument("--config", required=True)
ap.add_argument("--scope", required=True)
ap.add_argument("--out")
a = ap.parse_args()

ctx = json.loads(subprocess.run([os.environ.get("MOZAK_CLI", "mozak"), "context", "--config", a.config, "--scope", a.scope, "--json"],
                                capture_output=True, text=True, check=True).stdout)
snap = ctx.get("snapshot") or {}
expected = {k: snap[k] for k in ("revision", "graphHash", "bridge")}
payload = json.load(open(a.payload))
payload = payload.get("payload", payload)  # accept a full example file or a bare payload
op = f"op-{a.action}-{uuid.uuid4().hex[:12]}"
req = {"operationId": op, "scopeId": a.scope, "expected": expected, "action": a.action, "payload": payload}
out = a.out or f"/tmp/mozak-{a.action}-{op[-12:]}.json"
json.dump(req, open(out, "w"), indent=2)
print(out)
