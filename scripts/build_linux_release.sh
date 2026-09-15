#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C

if [[ $# -lt 2 || $# -gt 5 ]]; then
  echo "usage: $0 RELEASE_BINARY OUTPUT_DIRECTORY [stable|main] [GIT_REVISION] [OWNER/REPOSITORY]" >&2
  exit 64
fi
binary=$(realpath "$1")
mcp_binary=$(dirname "$binary")/mozak-mcp
out=$(realpath -m "$2")
channel=${3:-stable}
repo=$(cd "$(dirname "$0")/.." && pwd)
revision=${4:-$(git -C "$repo" rev-parse HEAD)}
repository=${5:-pitfa19/mozak}
[[ "$channel" == stable || "$channel" == main ]] || { echo "channel must be stable or main" >&2; exit 1; }
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || { echo "revision must be a lowercase 40-character Git hash" >&2; exit 1; }
[[ "$repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || { echo "repository must be OWNER/NAME" >&2; exit 1; }
[[ -f "$binary" && -x "$binary" ]] || { echo "release binary must be an executable regular file" >&2; exit 1; }
[[ -f "$mcp_binary" && -x "$mcp_binary" ]] || { echo "mozak-mcp must be an executable sibling of the release binary" >&2; exit 1; }
version=$($binary --version)
[[ "$version" =~ ^mozak\ ([0-9]+\.[0-9]+\.[0-9]+)$ ]] || { echo "unexpected version output: $version" >&2; exit 1; }
version=${BASH_REMATCH[1]}
short=${revision:0:12}
if [[ "$channel" == main ]]; then
  build_id="${version}-main-${short}"
else
  build_id="${version}-${short}"
fi
name="mozak-${build_id}-linux-x86_64"
archive="$name.tar.gz"
mkdir -p "$out"
for artifact in "$archive" SHA256SUMS release-manifest.json; do
  [[ ! -e "$out/$artifact" ]] || { echo "output artifact already exists: $out/$artifact" >&2; exit 1; }
done
stage=$(mktemp -d "${TMPDIR:-/tmp}/mozak-release.XXXXXX")
trap 'rm -rf "$stage"' EXIT
mkdir "$stage/$name"
chmod 0755 "$stage/$name"
install -m 0755 "$binary" "$stage/$name/mozak"
install -m 0755 "$mcp_binary" "$stage/$name/mozak-mcp"
install -m 0755 "$repo/scripts/archive_install.py" "$stage/$name/install.py"
install -m 0755 "$repo/scripts/mozak_launcher.py" "$stage/$name/launcher.py"
install -m 0644 "$repo/LICENSE" "$stage/$name/LICENSE"
install -m 0644 "$repo/README.md" "$stage/$name/README.md"
install -m 0644 "$repo/docs/distribution/INSTALL.md" "$stage/$name/INSTALL.md"
# README links are part of the offline product too. Ship the public docs at the
# same relative paths instead of leaving every archive-local link broken.
cp -R "$repo/docs" "$stage/$name/docs"
find "$stage/$name/docs" -type d -exec chmod 0755 {} +
find "$stage/$name/docs" -type f -exec chmod 0644 {} +
python3 - "$stage/$name/build.json" "$build_id" "$version" "$revision" "$channel" "$repository" <<'PY'
import json, pathlib, sys
path, build_id, version, revision, channel, repository = sys.argv[1:]
value = {
    "schema_version": 1,
    "build_id": build_id,
    "version": version,
    "revision": revision,
    "channel": channel,
    "platform": "linux-x86_64",
    "repository": repository,
}
pathlib.Path(path).write_text(json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8")
PY
chmod 0644 "$stage/$name/build.json"
find "$stage/$name" -exec touch -h -d '@0' {} +
tar --sort=name --format=ustar --owner=0 --group=0 --numeric-owner --mtime='@0' \
  -C "$stage" -cf - "$name" | gzip -n -9 > "$out/$archive"
archive_sha=$(sha256sum "$out/$archive" | awk '{print $1}')
printf '%s  %s\n' "$archive_sha" "$archive" > "$out/SHA256SUMS"
python3 - "$out/release-manifest.json" "$repository" "$channel" "$version" "$revision" "$build_id" "$archive" "$archive_sha" <<'PY'
import json, pathlib, sys
path, repository, channel, version, revision, build_id, archive, archive_sha = sys.argv[1:]
value = {
    "schema_version": 1,
    "repository": repository,
    "channel": channel,
    "version": version,
    "revision": revision,
    "build_id": build_id,
    "platform": "linux-x86_64",
    "archive": archive,
    "archive_sha256": archive_sha,
}
pathlib.Path(path).write_text(json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8")
PY
printf '{"archive":"%s","build_id":"%s","channel":"%s","checksums":"SHA256SUMS","manifest":"release-manifest.json","schema_version":1,"version":"%s"}\n' \
  "$archive" "$build_id" "$channel" "$version"
