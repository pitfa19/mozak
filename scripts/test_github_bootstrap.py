#!/usr/bin/env python3
"""Acceptance for the GitHub bootstrap installer against a stubbed GitHub API.

Covers both repository visibilities with the same script: an anonymous public
install, and a private install that succeeds only with credentials.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUILDER = ROOT / "scripts/build_linux_release.sh"
BOOTSTRAP = ROOT / "scripts/install.sh"
REVISION = "a" * 40

# Stands in for curl. Serves release JSON and assets from a local directory and,
# when STUB_REQUIRE_AUTH is set, refuses unauthenticated requests the way a
# private repository does.
CURL_STUB = '''#!/usr/bin/env python3
import json, os, sys

release = os.environ["STUB_RELEASE_DIR"]
require_auth = os.environ.get("STUB_REQUIRE_AUTH") == "1"
args = sys.argv[1:]
url = args[-1]
output = None
authorized = False
for index, value in enumerate(args):
    if value == "--output":
        output = args[index + 1]
    if value == "-H" and args[index + 1].startswith("Authorization: Bearer "):
        authorized = bool(args[index + 1].split("Bearer ", 1)[1].strip())

Path = __import__("pathlib").Path
log = Path(os.environ["STUB_LOG"])
log.write_text(log.read_text() + ("auth" if authorized else "anon") + "\\n")

if require_auth and not authorized:
    sys.stderr.write("curl: (22) The requested URL returned error: 404\\n")
    raise SystemExit(22)

manifest = json.loads(Path(release, "release-manifest.json").read_bytes())
if url.endswith("/releases/latest") or url.endswith("/releases/tags/main"):
    payload = {"assets": [
        {"name": "release-manifest.json", "url": "https://api.github.com/stub/manifest"},
        {"name": manifest["archive"], "url": "https://api.github.com/stub/archive"},
    ]}
    data = json.dumps(payload).encode()
elif url.endswith("/stub/manifest"):
    data = Path(release, "release-manifest.json").read_bytes()
elif url.endswith("/stub/archive"):
    data = Path(release, manifest["archive"]).read_bytes()
else:
    sys.stderr.write(f"curl: unexpected url {url}\\n")
    raise SystemExit(22)

if output:
    Path(output).write_bytes(data)
else:
    sys.stdout.buffer.write(data)
'''

GH_STUB = '''#!/usr/bin/env python3
import sys
args = sys.argv[1:]
if args[:2] == ["auth", "status"]:
    raise SystemExit(0)
if args[:2] == ["auth", "token"]:
    print("stub-token-value")
    raise SystemExit(0)
raise SystemExit(1)
'''


def stub_dir(root: Path, *, with_gh: bool) -> Path:
    directory = root / ("stub-gh" if with_gh else "stub-plain")
    directory.mkdir()
    curl = directory / "curl"
    curl.write_text(CURL_STUB, encoding="utf-8")
    curl.chmod(0o755)
    if with_gh:
        gh = directory / "gh"
        gh.write_text(GH_STUB, encoding="utf-8")
        gh.chmod(0o755)
    return directory


def environment(root: Path, release: Path, stubs: Path, home: Path, prefix: Path, *, require_auth: bool) -> dict[str, str]:
    log = root / f"curl-log-{stubs.name}-{prefix.name}.txt"
    log.write_text("", encoding="utf-8")
    env = os.environ.copy()
    # Keep the stub ahead of any real curl/gh, and drop inherited credentials so
    # anonymous mode is genuinely anonymous.
    for name in ("MOZAK_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"):
        env.pop(name, None)
    env.update({
        "HOME": str(home),
        "XDG_CONFIG_HOME": str(root / f"xdg-{prefix.name}"),
        "MOZAK_PREFIX": str(prefix),
        "PATH": f"{stubs}{os.pathsep}{env['PATH']}",
        "STUB_RELEASE_DIR": str(release),
        "STUB_LOG": str(log),
        "LC_ALL": "C",
    })
    if require_auth:
        env["STUB_REQUIRE_AUTH"] = "1"
    return env


def bootstrap(env: dict[str, str], prefix: Path, home: Path, *extra: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["bash", str(BOOTSTRAP), "--prefix", str(prefix), "--home", str(home), *extra],
        env=env,
        capture_output=True,
        text=True,
    )


def main() -> int:
    if len(sys.argv) != 2:
        raise SystemExit("usage: test_github_bootstrap.py RELEASE_BINARY")
    binary = Path(sys.argv[1]).resolve(strict=True)
    with tempfile.TemporaryDirectory(prefix="mozak-bootstrap-") as directory:
        root = Path(directory)
        release = root / "release"
        release.mkdir()
        subprocess.run(
            [str(BUILDER), str(binary), str(release), "stable", REVISION, "pitfa19/mozak"],
            cwd=ROOT, check=True, capture_output=True, text=True,
        )
        plain_stubs = stub_dir(root, with_gh=False)
        gh_stubs = stub_dir(root, with_gh=True)

        # Public repository: no gh, no token, install must still succeed.
        home, prefix = root / "public-home", root / "public-prefix"
        home.mkdir(); prefix.mkdir()
        env = environment(root, release, plain_stubs, home, prefix, require_auth=False)
        result = bootstrap(env, prefix, home)
        assert result.returncode == 0, f"anonymous install failed:\n{result.stdout}\n{result.stderr}"
        status = json.loads(result.stdout.strip().splitlines()[-1])
        assert status["active_build"].endswith(REVISION[:12])
        assert status["channel"] == "stable" and status["auto_update"] is True
        assert "Project context is not configured yet" in result.stderr
        assert "mozak setup install" in result.stderr
        assert (home / ".agents/skills/mozak/SKILL.md").is_file()
        assert (home / ".claude/skills/mozak/SKILL.md").is_file()
        assert (home / ".jcode/skills/mozak/SKILL.md").is_file()
        assert (home / ".codex/skills/mozak/SKILL.md").is_file()
        requests = Path(env["STUB_LOG"]).read_text().split()
        assert requests and set(requests) == {"anon"}, requests
        version = subprocess.run([str(prefix / "bin/mozak"), "--version"], env=env, capture_output=True, text=True)
        assert version.returncode == 0 and version.stdout.startswith("mozak ")

        # Private repository without credentials: refuse with an actionable message.
        home, prefix = root / "denied-home", root / "denied-prefix"
        home.mkdir(); prefix.mkdir()
        env = environment(root, release, plain_stubs, home, prefix, require_auth=True)
        denied = bootstrap(env, prefix, home)
        assert denied.returncode != 0
        assert "gh auth login" in denied.stderr and "MOZAK_GITHUB_TOKEN" in denied.stderr, denied.stderr
        assert not (prefix / "bin/mozak").exists()

        # Private repository with gh credentials: install succeeds authenticated.
        home, prefix = root / "private-home", root / "private-prefix"
        home.mkdir(); prefix.mkdir()
        env = environment(root, release, gh_stubs, home, prefix, require_auth=True)
        private = bootstrap(env, prefix, home, "--no-auto-update")
        assert private.returncode == 0, f"private install failed:\n{private.stdout}\n{private.stderr}"
        private_status = json.loads(private.stdout.strip().splitlines()[-1])
        assert private_status["active_build"].endswith(REVISION[:12])
        assert private_status["auto_update"] is False
        assert "Project context is not configured yet" in private.stderr
        requests = Path(env["STUB_LOG"]).read_text().split()
        assert requests and set(requests) == {"auth"}, requests

        # An explicit token works without gh installed at all.
        home, prefix = root / "token-home", root / "token-prefix"
        home.mkdir(); prefix.mkdir()
        env = environment(root, release, plain_stubs, home, prefix, require_auth=True)
        env["MOZAK_GITHUB_TOKEN"] = "explicit-token"
        token_install = bootstrap(env, prefix, home)
        assert token_install.returncode == 0, token_install.stderr
        assert set(Path(env["STUB_LOG"]).read_text().split()) == {"auth"}

        # A tampered checksum is refused in every mode.
        tampered = json.loads((release / "release-manifest.json").read_text(encoding="utf-8"))
        tampered["archive_sha256"] = "0" * 64
        (release / "release-manifest.json").write_text(json.dumps(tampered), encoding="utf-8")
        home, prefix = root / "bad-home", root / "bad-prefix"
        home.mkdir(); prefix.mkdir()
        env = environment(root, release, plain_stubs, home, prefix, require_auth=False)
        refused = bootstrap(env, prefix, home)
        assert refused.returncode != 0 and "checksum mismatch" in refused.stderr
        assert not (prefix / "bin/mozak").exists()

    print("GitHub bootstrap acceptance passed (public, private, token, and tampered paths)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
