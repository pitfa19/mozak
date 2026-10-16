#!/usr/bin/env node
// Local-only installer. No network, package manager, build, global config or inferred inventory.
import {
  constants, closeSync, fchmodSync, fstatSync, lstatSync, mkdirSync, openSync,
  readSync, readdirSync, realpathSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const FORMAT = 'mozak.installation/v1';
const VERSION = '0.1.0';
const NODE_RANGE = '>=24.11.0';
const MAX_FILE = 16 * 1024 * 1024;
const MAX_TOTAL = 64 * 1024 * 1024;
const MAX_FILES = 4096;
const SOURCE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS = ['SKILL.md', 'references/routes.md', 'references/bootstrap.md', 'references/recovery.md', 'examples/overview.md'];
const PACKAGES = ['core', 'cli', 'mcp'];
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const sha = data => createHash('sha256').update(data).digest('hex');
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const quoted = value => "'" + value.replaceAll("'", "'\"'\"'") + "'";

class InstallError extends Error {
  constructor(status, code, path, message) {
    super(message);
    Object.assign(this, { status, code, path });
  }
}
function refuse(status, code, path, message) { throw new InstallError(status, code, path, message); }
function sameFile(a, b) { return a.dev === b.dev && a.ino === b.ino; }
function sameSnapshot(a, b) {
  return sameFile(a, b) && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
}
function exists(path) {
  try { return lstatSync(path); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
function regularBytes(path, status) {
  let fd;
  try {
    const first = lstatSync(path);
    if (!first.isFile() || first.isSymbolicLink() || first.size > MAX_FILE) {
      refuse(status, 'unsafe-file', path, 'Expected a bounded regular file, not a link or special file.');
    }
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = fstatSync(fd);
    if (!before.isFile() || !sameSnapshot(first, before)) refuse(status, 'file-changed', path, 'File changed before reading.');
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const n = readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (!n) refuse(status, 'file-changed', path, 'File shortened while reading.');
      offset += n;
    }
    const extra = readSync(fd, Buffer.alloc(1), 0, 1, offset);
    if (extra || !sameSnapshot(before, fstatSync(fd)) || !sameSnapshot(before, lstatSync(path))) {
      refuse(status, 'file-changed', path, 'File changed while reading.');
    }
    return { bytes, executable: (before.mode & 0o111) !== 0 };
  } catch (e) {
    if (e instanceof InstallError) throw e;
    refuse(status, 'unreadable-file', path, 'Cannot safely read the required file.');
  } finally { if (fd !== undefined) closeSync(fd); }
}
function canonicalDirectory(path, status) {
  try {
    let p = path;
    for (;;) {
      const st = lstatSync(p);
      if (!st.isDirectory() || st.isSymbolicLink()) refuse(status, 'unsafe-directory', p, 'Directory components must not be symlinks or special files.');
      const parent = dirname(p);
      if (parent === p) break;
      p = parent;
    }
    if (realpathSync(path) !== path) refuse(status, 'noncanonical-path', path, 'Use the canonical absolute directory path.');
    return lstatSync(path);
  } catch (e) {
    if (e instanceof InstallError) throw e;
    refuse(status, 'unavailable-directory', path, 'Required canonical parent directory is unavailable.');
  }
}
function safeSegment(name, status, path) {
  if (!name || name === '.' || name === '..' || /[\\/\x00-\x1f\x7f]/u.test(name)) {
    refuse(status, 'unsafe-name', path, 'Unsafe filesystem name.');
  }
}
function listTree(root, status) {
  const files = [];
  const dirs = [];
  function walk(path, rel) {
    const before = lstatSync(path);
    if (!before.isDirectory() || before.isSymbolicLink()) refuse(status, 'unsafe-directory', path, 'Expected an ordinary directory.');
    const names = readdirSync(path).sort(compare);
    const folded = new Set();
    for (const name of names) {
      safeSegment(name, status, join(path, name));
      const fold = name.normalize('NFC').toLowerCase();
      if (folded.has(fold)) refuse(status, 'case-collision', path, 'Names collide on a case-insensitive filesystem.');
      folded.add(fold);
      const child = join(path, name);
      const childRel = rel ? `${rel}/${name}` : name;
      const st = lstatSync(child);
      if (st.isSymbolicLink()) refuse(status, 'symlink', child, 'Symlinks are not installation inputs or outputs.');
      if (st.isDirectory()) { dirs.push(childRel); walk(child, childRel); }
      else if (st.isFile()) files.push(childRel);
      else refuse(status, 'special-file', child, 'Special files are not supported.');
      if (files.length + dirs.length > MAX_FILES * 2) refuse(status, 'capacity', root, 'Installation tree exceeds its entry bound.');
    }
    if (!sameSnapshot(before, lstatSync(path))) refuse(status, 'directory-changed', path, 'Directory changed during inspection.');
  }
  try {
    walk(root, '');
  } catch (e) {
    if (e instanceof InstallError) throw e;
    refuse(status, 'unreadable-tree', root, 'Cannot inspect the directory tree.');
  }
  return { files: files.sort(compare), dirs: dirs.sort(compare) };
}
function expectedProduct(prefix) {
  canonicalDirectory(SOURCE, 'source-unavailable');
  const output = new Map();
  const inputs = [];
  let inputSize = 0;
  function input(rel) {
    const path = join(SOURCE, rel);
    canonicalDirectory(dirname(path), 'source-unavailable');
    const { bytes, executable } = regularBytes(path, 'source-unavailable');
    inputSize += bytes.length;
    inputs.push({ path: rel, sha256: sha(bytes), executable });
    if (inputs.length > MAX_FILES || inputSize > MAX_TOTAL) refuse('source-unavailable', 'capacity', path, 'Source exceeds installation bounds.');
    return bytes;
  }
  function add(path, bytes, executable = false) {
    if (output.has(path)) refuse('source-unavailable', 'duplicate-path', path, 'Duplicate installation path.');
    output.set(path, { bytes: Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes), executable });
  }
  add('LICENSE', input('LICENSE'));
  add('package.json', json({ name: 'mozak-installation', version: VERSION, private: true, type: 'module', engines: { node: NODE_RANGE } }));
  for (const name of PACKAGES) {
    const sourceManifest = `packages/${name}/package.json`;
    const bytes = input(sourceManifest);
    let manifest;
    try { manifest = JSON.parse(bytes.toString('utf8')); } catch { refuse('source-unavailable', 'invalid-package', sourceManifest, 'Invalid product package manifest.'); }
    if (manifest.name !== `@mozak/${name}` || manifest.version !== VERSION || manifest.type !== 'module'
      || manifest.main !== 'dist/index.js' || manifest.engines?.node !== NODE_RANGE
      || (name !== 'core' && manifest.dependencies?.['@mozak/core'] !== VERSION)
      || Object.keys(manifest.dependencies ?? {}).some(key => name === 'core' || key !== '@mozak/core')) {
      refuse('source-unavailable', 'invalid-package', sourceManifest, 'Package identity, runtime or runtime dependencies do not match the installation contract.');
    }
    add(`node_modules/@mozak/${name}/package.json`, bytes);
    const dist = join(SOURCE, `packages/${name}/dist`);
    canonicalDirectory(dist, 'source-unavailable');
    for (const path of listTree(dist, 'source-unavailable').files) {
      if (!/\.(?:js|d\.ts)(?:\.map)?$/u.test(path)) refuse('source-unavailable', 'unexpected-dist-file', path, 'Unexpected built runtime file.');
      add(`node_modules/@mozak/${name}/dist/${path}`, input(`packages/${name}/dist/${path}`));
    }
    if (!output.has(`node_modules/@mozak/${name}/dist/index.js`)) refuse('source-unavailable', 'missing-entrypoint', dist, 'Build the package before installation.');
  }
  const cli = join(prefix, 'node_modules/@mozak/cli/dist/index.js');
  const skill = join(prefix, 'skills/mozak-conversation');
  for (const path of SKILLS) {
    const bytes = input(`skills/mozak-conversation/${path}`);
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { refuse('source-unavailable', 'invalid-template', path, 'Skill template is not UTF-8.'); }
    if (/node\s+\/(?:home|Users)\//u.test(text)) refuse('source-unavailable', 'unrendered-template', path, 'Skill template contains a developer-bound command.');
    text = text.replaceAll('{{MOZAK_CLI}}', quoted(cli)).replaceAll('{{MOZAK_SKILL}}', skill);
    if (/\{\{[A-Z_]+\}\}/u.test(text)) refuse('source-unavailable', 'unrendered-template', path, 'Skill template contains unresolved placeholders.');
    add(`skills/mozak-conversation/${path}`, text);
  }
  for (const [bin, name] of [['mozak', 'cli'], ['mozak-mcp', 'mcp']]) {
    // The existing MCP entrypoint checks a file-URL-shaped argv[1] before starting.
    // Adapt only the wrapper's internal entrypoint slot, preserving all user arguments.
    const entry = `../node_modules/@mozak/${name}/dist/index.js`;
    add(`bin/${bin}`, `#!/usr/bin/env node\nconst entry = new URL(${JSON.stringify(entry)}, import.meta.url);\nprocess.argv[1] = entry.href.slice('file://'.length);\nawait import(entry.href);\n`, true);
  }
  const files = [...output].sort(([a], [b]) => compare(a, b)).map(([path, value]) => ({
    path, byteLength: value.bytes.length, sha256: sha(value.bytes), executable: value.executable,
  }));
  if (files.length > MAX_FILES || files.some(f => f.byteLength > MAX_FILE) || files.reduce((sum, f) => sum + f.byteLength, 0) > MAX_TOTAL) {
    refuse('source-unavailable', 'capacity', null, 'Rendered installation exceeds bounds.');
  }
  const identity = { format: FORMAT, version: VERSION, nodeRange: NODE_RANGE, files };
  const contentDigest = sha(Buffer.from(JSON.stringify(identity)));
  const manifest = { format: FORMAT, version: VERSION, nodeRange: NODE_RANGE, contentDigest, files };
  const sourceDigest = sha(JSON.stringify(inputs.sort((a, b) => compare(a.path, b.path))));
  return { output, manifest, manifestBytes: json(manifest), sourceDigest };
}
function verifyTarget(prefix, product, manifestRequired) {
  canonicalDirectory(prefix, 'conflict');
  const entries = listTree(prefix, 'conflict');
  const expected = new Map(product.output);
  if (manifestRequired) expected.set('installation.json', { bytes: product.manifestBytes, executable: false });
  const directories = new Set();
  for (const path of expected.keys()) {
    const parts = path.split('/');
    parts.pop();
    while (parts.length) { directories.add(parts.join('/')); parts.pop(); }
  }
  if (JSON.stringify(entries.files) !== JSON.stringify([...expected.keys()].sort(compare))
    || JSON.stringify(entries.dirs) !== JSON.stringify([...directories].sort(compare))) {
    refuse('conflict', 'unexpected-tree', prefix, 'Existing tree does not match the current expected product.');
  }
  for (const [path, value] of expected) {
    const actual = regularBytes(join(prefix, path), 'conflict');
    if (!actual.bytes.equals(value.bytes) || actual.executable !== value.executable) {
      refuse('conflict', 'different-product', join(prefix, path), 'Installed bytes or executable bits differ from the current expected product.');
    }
  }
}
function parse(argv) {
  const values = new Map();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!['--prefix', '--check', '--json'].includes(arg) || values.has(arg)) refuse('invalid-input', 'arguments', null, 'Unknown or duplicate installer argument.');
    if (arg === '--prefix') {
      const value = argv[++i];
      if (!value || value.startsWith('--')) refuse('invalid-input', 'arguments', null, '--prefix requires an absolute path.');
      values.set(arg, value);
    } else values.set(arg, true);
  }
  if (!values.has('--prefix') || !values.has('--json')) refuse('invalid-input', 'arguments', null, '--prefix and --json are required.');
  const prefix = values.get('--prefix');
  if (!isAbsolute(prefix) || /[\x00-\x1f\x7f]/u.test(prefix) || resolve(prefix) !== prefix || dirname(prefix) === prefix) {
    refuse('invalid-input', 'invalid-prefix', null, 'Prefix must be a normalized absolute non-root path without control characters.');
  }
  function within(child, parent) { const rel = relative(parent, child); return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)); }
  if (within(prefix, SOURCE) || within(SOURCE, prefix)) refuse('invalid-input', 'source-overlap', prefix, 'Installation must not overlap the source tree.');
  return { prefix, check: values.has('--check') };
}
function smoke(prefix, createFile, guard) {
  const options = { cwd: prefix, encoding: 'utf8', timeout: 10_000, killSignal: 'SIGKILL', maxBuffer: MAX_FILE, env: { ...process.env, NODE_PATH: '', NODE_OPTIONS: '' } };
  const cli = spawnSync(process.execPath, [join(prefix, 'bin/mozak'), '--help'], options);
  if (cli.error || cli.status !== 0 || !cli.stdout.includes('mozak')) refuse('partial-install', 'cli-smoke', prefix, 'Installed CLI smoke check failed.');
  const name = '.installer-smoke-inventory.json';
  createFile(name, { bytes: json({ format: 'mozak.local/v2', scopes: [] }), executable: false });
  const inventory = join(prefix, name);
  const identity = lstatSync(inventory);
  const mcp = spawnSync(process.execPath, [join(prefix, 'bin/mozak-mcp'), '--config', inventory], {
    ...options,
    input: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } }) + '\n',
  });
  let reply;
  try { reply = JSON.parse(mcp.stdout.trim()); } catch { /* Refused below. */ }
  if (mcp.error || mcp.status !== 0 || reply?.id !== 1 || reply?.result?.serverInfo?.name !== 'mozak') {
    refuse('partial-install', 'mcp-smoke', prefix, 'Installed MCP handshake failed.');
  }
  guard();
  if (!sameFile(identity, lstatSync(inventory))) refuse('partial-install', 'smoke-changed', inventory, 'Installer temporary inventory changed.');
  unlinkSync(inventory); // Only this freshly created, identity-checked installer temporary file.
}
function main() {
  let prefix = null;
  let product;
  let created = false;
  const result = (status, committed, issues = []) => ({
    status, committed, prefix, contentDigest: product?.manifest.contentDigest ?? null,
    files: product ? [...product.output.keys(), 'installation.json'].sort(compare) : [], issues,
  });
  try {
    const args = parse(process.argv.slice(2));
    prefix = args.prefix;
    const version = process.versions.node.split('.').map(Number);
    if (!['linux', 'darwin'].includes(process.platform) || version[0] < 24 || (version[0] === 24 && version[1] < 11)) {
      refuse('unsupported-platform', 'runtime', null, 'Requires Linux or macOS and Node >=24.11.0.');
    }
    const parent = dirname(prefix);
    const parentIdentity = canonicalDirectory(parent, 'invalid-input');
    product = expectedProduct(prefix);
    function revalidateSource(status) {
      const fresh = expectedProduct(prefix);
      if (fresh.sourceDigest !== product.sourceDigest || fresh.manifest.contentDigest !== product.manifest.contentDigest) {
        refuse(status, 'source-changed', SOURCE, 'Source changed during inspection; retry against a stable source.');
      }
    }
    const old = exists(prefix);
    if (old) {
      verifyTarget(prefix, product, true);
      revalidateSource('source-unavailable');
      return { code: 0, data: result(args.check ? 'checked' : 'unchanged', !args.check) };
    }
    if (args.check) {
      revalidateSource('source-unavailable');
      if (exists(prefix)) refuse('conflict', 'target-appeared', prefix, 'Target appeared during preflight; run check again.');
      return { code: 0, data: result('checked', false) };
    }
    if (!sameFile(parentIdentity, canonicalDirectory(parent, 'conflict'))) refuse('conflict', 'parent-changed', parent, 'Installation parent changed.');
    try { mkdirSync(prefix, { mode: 0o755 }); } catch (e) {
      if (e.code === 'EEXIST') refuse('conflict', 'target-exists', prefix, 'Another installation acquired this target.');
      throw e;
    }
    created = true;
    const rootIdentity = lstatSync(prefix);
    const directories = new Map([[prefix, rootIdentity]]);
    function guard() {
      if (!sameFile(parentIdentity, canonicalDirectory(parent, 'partial-install'))
        || !sameFile(rootIdentity, canonicalDirectory(prefix, 'partial-install'))) {
        refuse('partial-install', 'target-changed', prefix, 'Installation directory identity changed.');
      }
    }
    function createFile(rel, value) {
      guard();
      const parts = rel.split('/');
      parts.pop();
      let p = prefix;
      for (const part of parts) {
        p = join(p, part);
        if (!directories.has(p)) { mkdirSync(p, { mode: 0o755 }); directories.set(p, lstatSync(p)); }
        const st = lstatSync(p);
        if (!st.isDirectory() || st.isSymbolicLink() || !sameFile(st, directories.get(p))) refuse('partial-install', 'directory-changed', p, 'Owned installation directory changed.');
      }
      const path = join(prefix, rel);
      let fd;
      try {
        fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, value.executable ? 0o755 : 0o644);
        writeFileSync(fd, value.bytes);
        fchmodSync(fd, value.executable ? 0o755 : 0o644);
      } finally { if (fd !== undefined) closeSync(fd); }
    }
    for (const [path, value] of product.output) createFile(path, value);
    smoke(prefix, createFile, guard);
    guard();
    verifyTarget(prefix, product, false);
    const fresh = expectedProduct(prefix);
    if (fresh.sourceDigest !== product.sourceDigest || fresh.manifest.contentDigest !== product.manifest.contentDigest) {
      refuse('partial-install', 'source-changed', SOURCE, 'Source changed during installation; no success manifest was published.');
    }
    createFile('installation.json', { bytes: product.manifestBytes, executable: false });
    guard();
    verifyTarget(prefix, product, true);
    return { code: 0, data: result('installed', true) };
  } catch (e) {
    const error = e instanceof InstallError ? e : new InstallError(created ? 'partial-install' : 'source-unavailable', 'io-error', prefix, 'Installation could not complete because of a filesystem or subprocess error.');
    const status = created ? 'partial-install' : error.status;
    const code = status === 'partial-install' ? 5 : status === 'conflict' ? 3 : 2;
    return { code, data: result(status, false, [{ code: error.code, path: error.path, message: error.message }]) };
  }
}
const { code, data } = main();
process.stdout.write(JSON.stringify(data) + '\n');
process.exitCode = code;
