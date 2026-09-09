#!/usr/bin/env bash
# Install MOZAK from GitHub Releases.
#
# Works with a public repository anonymously, and with a private repository
# through GitHub CLI or a token in MOZAK_GITHUB_TOKEN, GH_TOKEN, or GITHUB_TOKEN.
# The same command keeps working if the repository later becomes public.
set -euo pipefail
export LC_ALL=C

repository=${MOZAK_REPOSITORY:-pitfa19/mozak}
channel=stable
prefix=${HOME:-}/.local
home=${HOME:-}
auto=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --channel) channel=${2:-}; shift 2 ;;
    --prefix) prefix=${2:-}; shift 2 ;;
    --home) home=${2:-}; shift 2 ;;
    --no-auto-update) auto=0; shift ;;
    *) echo "usage: install.sh [--channel stable|main] [--prefix PATH] [--home PATH] [--no-auto-update]" >&2; exit 64 ;;
  esac
done
[[ "$channel" == stable || "$channel" == main ]] || { echo "channel must be stable or main" >&2; exit 1; }
[[ -n "$home" && "$home" == /* && -d "$home" && ! -L "$home" ]] || { echo "HOME must be an existing absolute real directory" >&2; exit 1; }
[[ -n "$prefix" && "$prefix" == /* ]] || { echo "PREFIX must be absolute" >&2; exit 1; }
mkdir -p "$prefix"
[[ -d "$prefix" && ! -L "$prefix" ]] || { echo "PREFIX must be a real directory" >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "python3 is required" >&2; exit 1; }

# Resolve credentials without requiring them: a public repository needs none.
token=${MOZAK_GITHUB_TOKEN:-${GH_TOKEN:-${GITHUB_TOKEN:-}}}
if [[ -z "$token" ]] && command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  token=$(gh auth token 2>/dev/null || true)
fi
command -v curl >/dev/null 2>&1 || { echo "curl is required" >&2; exit 1; }

fetch() {
  local url=$1 accept=$2 output=$3
  local args=(--fail --silent --show-error --location --retry 2
              -H "Accept: $accept" -H "X-GitHub-Api-Version: 2022-11-28"
              -H "User-Agent: mozak-bootstrap-v1" --output "$output")
  if [[ -n "$token" ]]; then
    args+=(-H "Authorization: Bearer $token")
  fi
  curl "${args[@]}" "$url"
}

api="https://api.github.com/repos/$repository/releases"
if [[ "$channel" == stable ]]; then endpoint="$api/latest"; else endpoint="$api/tags/main"; fi

scratch=$(mktemp -d "${TMPDIR:-/tmp}/mozak-bootstrap.XXXXXX")
trap 'rm -rf "$scratch"' EXIT

if ! fetch "$endpoint" 'application/vnd.github+json' "$scratch/release.json"; then
  if [[ -z "$token" ]]; then
    echo "cannot read $repository releases anonymously; if it is private, run 'gh auth login' or set MOZAK_GITHUB_TOKEN" >&2
  else
    echo "cannot read $repository releases with the supplied credentials" >&2
  fi
  exit 1
fi

read -r manifest_url < <(python3 - "$scratch/release.json" <<'PY'
import json, sys
assets = json.load(open(sys.argv[1], encoding="utf-8")).get("assets", [])
found = [a for a in assets if a.get("name") == "release-manifest.json"]
if len(found) != 1:
    raise SystemExit("release must contain exactly one release-manifest.json")
print(found[0]["url"])
PY
)
fetch "$manifest_url" 'application/octet-stream' "$scratch/release-manifest.json"

read -r archive_name expected_sha build_id manifest_channel manifest_repository < <(python3 - "$scratch/release-manifest.json" <<'PY'
import json, re, sys
v = json.load(open(sys.argv[1], encoding="utf-8"))
required = {"schema_version","repository","channel","version","revision","build_id","platform","archive","archive_sha256"}
if set(v) != required or v["schema_version"] != 1 or v["platform"] != "linux-x86_64":
    raise SystemExit("invalid release manifest")
if not re.fullmatch(r"[0-9a-f]{64}", v["archive_sha256"]):
    raise SystemExit("invalid release checksum")
for key in ("archive", "build_id"):
    if not isinstance(v[key], str) or not v[key] or "/" in v[key] or "\\" in v[key] or ".." in v[key]:
        raise SystemExit(f"unsafe {key}")
print(v["archive"], v["archive_sha256"], v["build_id"], v["channel"], v["repository"])
PY
)
[[ "$manifest_channel" == "$channel" && "$manifest_repository" == "$repository" ]] || { echo "release manifest identity mismatch" >&2; exit 1; }

archive_url=$(python3 - "$scratch/release.json" "$archive_name" <<'PY'
import json, sys
assets = json.load(open(sys.argv[1], encoding="utf-8")).get("assets", [])
found = [a for a in assets if a.get("name") == sys.argv[2]]
if len(found) != 1:
    raise SystemExit("release archive asset is missing or ambiguous")
print(found[0]["url"])
PY
)
fetch "$archive_url" 'application/octet-stream' "$scratch/$archive_name"
actual_sha=$(sha256sum "$scratch/$archive_name" | awk '{print $1}')
[[ "$actual_sha" == "$expected_sha" ]] || { echo "release archive checksum mismatch" >&2; exit 1; }

mkdir "$scratch/extract"
python3 - "$scratch/$archive_name" "$scratch/extract" <<'PY'
import pathlib, sys, tarfile
archive, output = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
with tarfile.open(archive, "r:gz") as bundle:
    roots = set()
    for member in bundle.getmembers():
        path = pathlib.Path(member.name)
        if path.is_absolute() or ".." in path.parts or not path.parts:
            raise SystemExit("unsafe release archive path")
        roots.add(path.parts[0])
        if not (member.isdir() or member.isfile()) or member.issym() or member.islnk():
            raise SystemExit("unsafe release archive entry")
    if len(roots) != 1:
        raise SystemExit("release archive must contain one root")
    bundle.extractall(output, filter="data")
PY
bundle=$(find "$scratch/extract" -mindepth 1 -maxdepth 1 -type d -print -quit)
args=(--prefix "$prefix" --home "$home" --expected-build-id "$build_id" --channel "$channel")
if [[ "$auto" == 1 ]]; then args+=(--enable-auto); else args+=(--disable-auto); fi
python3 "$bundle/install.py" "${args[@]}"
"$prefix/bin/mozak" delivery status
