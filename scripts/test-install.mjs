import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Black-box acceptance tests. Run npm run build first, then:
// node --test scripts/test-install.mjs
// Fixtures COPY the actual built product, never a replacement implementation.
// All mutations and cleanup are restricted to this suite's own scratch roots.
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scratch = realpathSync(process.env.JCODE_SCRATCH_DIR || tmpdir());
const roots = [];
const codePointSort = values => values.sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const putJSON = (path, value) => writeFileSync(path, JSON.stringify(value));
after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = realpathSync(mkdtempSync(join(scratch, 'mozak-install-test-')));
  roots.push(root);
  let source = join(root, 'relocated source Ž');
  const cwd = join(root, 'unrelated working directory');
  const home = join(root, 'isolated home');
  mkdirSync(source);
  source = realpathSync(source);
  mkdirSync(cwd);
  mkdirSync(home);
  mkdirSync(join(source, 'scripts'));
  // Fail red with a useful message if the concurrently implemented installer is absent.
  assert.ok(existsSync(join(repository, 'scripts/install.mjs')), 'scripts/install.mjs must exist');
  for (const path of ['scripts/install.mjs', 'LICENSE', 'package.json', 'skills/mozak-conversation', ...['core', 'cli', 'mcp'].flatMap(name => [`packages/${name}/package.json`, `packages/${name}/dist`])]) {
    assert.ok(existsSync(join(repository, path)), `required actual source input missing: ${path}; run npm run build`);
    mkdirSync(dirname(join(source, path)), { recursive: true });
    cpSync(join(repository, path), join(source, path), { recursive: true, dereference: false });
  }
  const prefix = join(root, "installed space Ž ' quoted");
  const env = { PATH: process.env.PATH || '', HOME: home, TMPDIR: root, LANG: 'C.UTF-8' };
  return { root, source, cwd, home, prefix, env };
}

function run(f, args, { nodeArgs = [], input, executable = process.execPath } = {}) {
  const p = spawnSync(executable, [...nodeArgs, ...args], { cwd: f.cwd, env: f.env, encoding: 'utf8', input, timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
  assert.ifError(p.error);
  assert.equal(p.signal, null, `subprocess signal ${p.signal}: ${p.stderr}`);
  return p;
}
function result(p, expected) {
  let value;
  try { value = JSON.parse(p.stdout); } catch { assert.fail(`installer did not emit one JSON object: ${p.stdout}\n${p.stderr}`); }
  assert.deepEqual(Object.keys(value).sort(), ['committed', 'contentDigest', 'files', 'issues', 'prefix', 'status']);
  const exits = { checked: 0, installed: 0, unchanged: 0, 'invalid-input': 2, 'unsupported-platform': 2, 'source-unavailable': 2, conflict: 3, 'partial-install': 5 };
  assert.ok(Object.hasOwn(exits, value.status), `unknown status ${value.status}`);
  assert.equal(p.status, exits[value.status], `${p.stdout}\n${p.stderr}`);
  if (expected) assert.equal(value.status, expected, `${p.stdout}\n${p.stderr}`);
  assert.equal(value.committed, ['installed', 'unchanged'].includes(value.status));
  assert.ok(value.prefix === null || typeof value.prefix === 'string');
  assert.ok(value.contentDigest === null || /^[a-f0-9]{64}$/.test(value.contentDigest));
  assert.ok(Array.isArray(value.files));
  assert.deepEqual(value.files, codePointSort([...new Set(value.files)]));
  for (const path of value.files) {
    assert.equal(typeof path, 'string');
    assert.ok(!path.startsWith('/') && !path.includes('\\') && !path.split('/').some(p => p === '.' || p === '..' || p === ''));
  }
  assert.ok(Array.isArray(value.issues));
  for (const issue of value.issues) {
    assert.deepEqual(Object.keys(issue).sort(), ['code', 'message', 'path']);
    assert.equal(typeof issue.code, 'string');
    assert.equal(typeof issue.message, 'string');
    assert.ok(issue.path === null || typeof issue.path === 'string');
  }
  if (p.status !== 0) assert.ok(value.issues.length > 0, 'failure needs an actionable issue');
  return value;
}
function install(f, expected = 'installed', extra = [], options) {
  return result(run(f, [join(f.source, 'scripts/install.mjs'), '--prefix', f.prefix, '--json', ...extra], options), expected);
}

// Includes directories, inode, modes and timestamps so preflight cannot silently
// rewrite identical bytes, create/remove a lock, or touch an existing directory.
// Access time is deliberately excluded because ordinary reads can update it.
function snapshot(root) {
  const output = [];
  function walk(path, relative) {
    const st = lstatSync(path, { bigint: true });
    const entry = { path: relative, mode: String(st.mode), ino: String(st.ino), mtime: String(st.mtimeNs), ctime: String(st.ctimeNs) };
    if (st.isSymbolicLink()) entry.link = readlinkSync(path);
    else if (st.isFile()) entry.hash = sha256(readFileSync(path));
    else if (!st.isDirectory()) entry.special = true;
    output.push(entry);
    if (st.isDirectory()) for (const name of codePointSort(readdirSync(path))) walk(join(path, name), relative ? `${relative}/${name}` : name);
  }
  walk(root, '');
  return output;
}
function verifyManifest(prefix, expected) {
  const manifest = json(join(prefix, 'installation.json'));
  assert.deepEqual(Object.keys(manifest).sort(), ['contentDigest', 'files', 'format', 'nodeRange', 'version']);
  assert.equal(manifest.format, 'mozak.installation/v1');
  assert.equal(manifest.version, '0.1.0');
  assert.equal(manifest.nodeRange, '>=24.11.0');
  assert.ok(Array.isArray(manifest.files));
  assert.deepEqual(manifest.files.map(f => f.path), codePointSort([...new Set(manifest.files.map(f => f.path))]));
  for (const file of manifest.files) {
    assert.deepEqual(Object.keys(file).sort(), ['byteLength', 'executable', 'path', 'sha256']);
    assert.ok(Number.isSafeInteger(file.byteLength) && file.byteLength >= 0);
    assert.match(file.sha256, /^[a-f0-9]{64}$/);
    assert.equal(typeof file.executable, 'boolean');
    const path = join(prefix, file.path);
    assert.ok(lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink());
    const bytes = readFileSync(path);
    assert.equal(file.byteLength, bytes.length, file.path);
    assert.equal(file.sha256, sha256(bytes), file.path);
    assert.equal(file.executable, (lstatSync(path).mode & 0o111) !== 0, file.path);
  }
  const files = manifest.files.map(({ path, byteLength, sha256, executable }) => ({ path, byteLength, sha256, executable }));
  assert.equal(manifest.contentDigest, sha256(JSON.stringify({ format: manifest.format, version: manifest.version, nodeRange: manifest.nodeRange, files })));
  assert.equal(manifest.contentDigest, expected.contentDigest);
  assert.deepEqual(expected.files, codePointSort([...files.map(f => f.path), 'installation.json']));
  const actual = snapshot(prefix).filter(f => f.hash).map(f => f.path);
  assert.deepEqual(codePointSort(actual), codePointSort([...files.map(f => f.path), 'installation.json']));
  assert.ok(!files.some(f => f.path === 'installation.json'));
  for (const name of ['core', 'cli', 'mcp']) {
    const pkg = json(join(prefix, `node_modules/@mozak/${name}/package.json`));
    assert.equal(pkg.name, `@mozak/${name}`);
    assert.equal(pkg.version, '0.1.0');
    if (name !== 'core') assert.equal(pkg.dependencies['@mozak/core'], '0.1.0');
  }
  assert.equal(json(join(prefix, 'package.json')).type, 'module');
  return manifest;
}
function cli(f, args, expectedExit = 0) {
  const p = run(f, [join(f.prefix, 'bin/mozak'), ...args]);
  assert.equal(p.status, expectedExit, `${p.stdout}\n${p.stderr}`);
  return p;
}
async function mcpContext(f, config) {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [join(f.prefix, 'bin/mozak-mcp'), '--config', config], { cwd: f.cwd, env: f.env, stdio: ['pipe', 'pipe', 'pipe'] });
    let buffer = '', stderr = '', settled = false, initialized = false;
    const timer = setTimeout(() => finish(new Error(`MCP timed out: ${stderr}`)), 10000);
    function finish(error, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      error ? fail(error) : done(value);
    }
    child.on('error', finish);
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('exit', code => { if (!settled) finish(new Error(`MCP exited before context: ${code} ${stderr}`)); });
    child.stdout.on('data', chunk => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
        try {
          const response = JSON.parse(line);
          if (response.id === 1) {
            assert.ok(response.result && !response.error, line);
            initialized = true;
            child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
            child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'mozak_context', arguments: { scope: 'one' } } }) + '\n');
          } else if (response.id === 2) {
            assert.ok(initialized);
            assert.ok(!response.error && !response.result.isError, line);
            finish(null, JSON.parse(response.result.content[0].text));
          }
        } catch (error) { finish(error); }
      }
    });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'installer-acceptance', version: '1' } } }) + '\n');
  });
}

test('relocated real product installs at two canonical Unicode/quoted prefixes and works without source', async () => {
  const f = fixture();
  const before = snapshot(f.root);
  const check = install(f, 'checked', ['--check']);
  assert.deepEqual(snapshot(f.root), before, '--check performs zero writes');
  assert.equal(check.prefix, f.prefix);
  assert.ok(check.contentDigest);
  const installed = install(f);
  assert.equal(installed.contentDigest, check.contentDigest);
  const manifest = verifyManifest(f.prefix, installed);
  assert.equal(readFileSync(join(f.prefix, 'LICENSE'), 'utf8'), readFileSync(join(f.source, 'LICENSE'), 'utf8'));
  const unchangedBefore = snapshot(f.root);
  const repeated = install(f, 'unchanged');
  assert.equal(repeated.contentDigest, check.contentDigest);
  assert.deepEqual(snapshot(f.root), unchangedBefore, 'no-op does not rewrite target');
  assert.equal(install(f, 'checked', ['--check']).contentDigest, check.contentDigest);
  assert.deepEqual(snapshot(f.root), unchangedBefore, 'check of installed product writes nothing');
  const second = { ...f, prefix: join(f.root, 'second canonical Ž prefix') };
  const secondCheck = install(second, 'checked', ['--check']);
  const secondInstalled = install(second);
  assert.equal(secondCheck.contentDigest, secondInstalled.contentDigest);
  verifyManifest(second.prefix, secondInstalled);
  assert.notEqual(secondInstalled.contentDigest, installed.contentDigest, 'skill bytes bind distinct prefixes');
  const skill = readFileSync(join(f.prefix, 'skills/mozak-conversation/SKILL.md'), 'utf8');
  assert.ok(!skill.includes(repository) && !skill.includes(f.source), 'no developer/source path in skill');
  assert.ok(!/\{\{[^}]+\}\}/.test(skill), 'no unrendered placeholders');
  assert.ok(manifest.files.some(file => file.path.startsWith('skills/mozak-conversation/references/')));
  // Hiding the relocated source demonstrates wrappers cannot resolve its modules.
  renameSync(f.source, `${f.source} hidden`);
  assert.match(cli(f, ['--help']).stdout, /mozak/i);
  // Execute the delivered skill's actual documented startup command. This
  // validates shell quoting and binding, not activation in an agent host.
  const startup = skill.match(/`(node [^`\n]+ --help)`/);
  assert.ok(startup, 'rendered skill must supply an explicit startup command');
  const skillHelp = run(f, ['-c', startup[1]], { executable: '/bin/sh' });
  assert.equal(skillHelp.status, 0, `${skillHelp.stdout}\n${skillHelp.stderr}`);
  assert.match(skillHelp.stdout, /mozak/i);
  const direct = run(f, ['--help'], { executable: join(f.prefix, 'bin/mozak') });
  assert.equal(direct.status, 0, direct.stderr);
  cli(f, ['context', '--scope', 'one', '--json'], 2); // explicit config remains required
  cli(f, ['not-a-command'], 2); // wrapper preserves failure status
  const scope = join(f.root, 'synthetic scope'); mkdirSync(scope);
  writeFileSync(join(scope, 'README.md'), '# Synthetic scope\n');
  writeFileSync(join(scope, 'AGENTS.md'), '# Synthetic instructions\n');
  const config = join(f.root, 'inventory.json');
  putJSON(config, { format: 'mozak.local/v2', scopes: [{ id: 'one', root: scope }] });
  const request = join(f.root, 'init.json');
  putJSON(request, { operationId: 'init-one', scopeId: 'one', kind: 'project', title: 'Portable synthetic scope', expectedAbsent: { graph: true, bridge: true }, ownerRef: 'synthetic-owner:installer-test', ownerMessageAt: '2026-10-12T20:36:36.782Z' });
  assert.equal(JSON.parse(cli(f, ['scope', 'init', '--scope', 'one', '--request', request, '--config', config, '--json']).stdout).committed, true);
  const context = JSON.parse(cli(f, ['context', '--scope', 'one', '--config', config, '--json']).stdout);
  assert.deepEqual(await mcpContext(f, config), context, 'fresh installed MCP reads the same installed CLI scope');
  assert.match(cli(second, ['--help']).stdout, /mozak/i);
});

test('valid source B conflicts with source A install despite self-consistent old manifest', () => {
  const f = fixture(); install(f);
  const before = snapshot(f.prefix);
  const file = join(f.source, 'packages/core/dist/index.js');
  writeFileSync(file, `${readFileSync(file, 'utf8')}\n// valid source revision B\n`);
  install(f, 'conflict');
  install(f, 'conflict', ['--check']);
  assert.deepEqual(snapshot(f.prefix), before);
});

for (const [label, flags] of [
  ['no flags', []], ['missing prefix', ['--json']], ['missing JSON flag', ['--prefix', '$PREFIX']],
  ['relative prefix', ['--prefix', 'relative', '--json']], ['empty prefix', ['--prefix', '', '--json']],
  ['unknown flag', ['--prefix', '$PREFIX', '--json', '--force']], ['positional', ['--prefix', '$PREFIX', '--json', 'extra']],
  ['duplicate prefix', ['--prefix', '$PREFIX', '--prefix', '$PREFIX', '--json']],
  ['duplicate JSON', ['--prefix', '$PREFIX', '--json', '--json']], ['duplicate check', ['--prefix', '$PREFIX', '--json', '--check', '--check']],
  ['missing prefix value', ['--prefix', '--json']], ['dangling prefix', ['--json', '--prefix']],
]) test(`argument grammar: ${label} is refused without writes`, () => {
  const f = fixture(), before = snapshot(f.root);
  result(run(f, [join(f.source, 'scripts/install.mjs'), ...flags.map(v => v === '$PREFIX' ? f.prefix : v)]), 'invalid-input');
  assert.deepEqual(snapshot(f.root), before);
});

for (const path of ['LICENSE', 'packages/core/package.json', 'packages/cli/package.json', 'packages/mcp/package.json', 'packages/core/dist/index.js', 'packages/cli/dist/index.js', 'packages/mcp/dist/index.js', ...['SKILL.md', 'references/routes.md', 'references/bootstrap.md', 'references/recovery.md', 'examples/overview.md'].map(path => `skills/mozak-conversation/${path}`)]) {
  test(`missing actual source input: ${path}`, () => {
    const f = fixture(); rmSync(join(f.source, path));
    const before = snapshot(f.root);
    const res = install(f, 'source-unavailable');
    assert.equal(res.contentDigest, null);
    assert.deepEqual(snapshot(f.root), before);
  });
}

for (const kind of ['populated', 'partial', 'file', 'symlink', 'changed', 'extra', 'missing', 'mode', 'manifest-corrupt', 'manifest-unknown', 'manifest-duplicate', 'manifest-digest', 'manifest-negative-length', 'manifest-extra-record-key', 'manifest-uppercase-hash', 'manifest-unsorted', 'installed-symlink']) {
  test(`target conflict preserves all user bytes and metadata: ${kind}`, () => {
    const f = fixture();
    if (['populated', 'partial'].includes(kind)) {
      mkdirSync(f.prefix); writeFileSync(join(f.prefix, kind === 'partial' ? 'package.json' : 'user.txt'), 'preserve me\n');
    } else if (kind === 'file') writeFileSync(f.prefix, 'user file\n');
    else if (kind === 'symlink') symlinkSync(f.cwd, f.prefix, 'dir');
    else {
      install(f);
      const license = join(f.prefix, 'LICENSE'), manifestPath = join(f.prefix, 'installation.json');
      if (kind === 'changed') writeFileSync(license, 'user changed bytes\n');
      if (kind === 'extra') writeFileSync(join(f.prefix, 'unexpected'), 'extra bytes\n');
      if (kind === 'missing') rmSync(license);
      if (kind === 'mode') chmodSync(join(f.prefix, 'bin/mozak'), 0o644);
      if (kind === 'manifest-corrupt') writeFileSync(manifestPath, '{');
      if (kind === 'installed-symlink') { rmSync(license); symlinkSync(join(f.source, 'LICENSE'), license); }
      if (kind.startsWith('manifest-') && kind !== 'manifest-corrupt') {
        const m = json(manifestPath);
        if (kind === 'manifest-unknown') m.unexpected = true;
        if (kind === 'manifest-duplicate') m.files.push(m.files[0]);
        if (kind === 'manifest-digest') m.contentDigest = '0'.repeat(64);
        if (kind === 'manifest-negative-length') m.files[0].byteLength = -1;
        if (kind === 'manifest-extra-record-key') m.files[0].extra = true;
        if (kind === 'manifest-uppercase-hash') m.files[0].sha256 = m.files[0].sha256.toUpperCase();
        if (kind === 'manifest-unsorted') m.files.reverse();
        putJSON(manifestPath, m);
      }
    }
    const before = snapshot(f.root);
    install(f, 'conflict'); install(f, 'conflict', ['--check']);
    assert.deepEqual(snapshot(f.root), before);
  });
}

for (const kind of ['parent-symlink', 'target-descendant', 'target-source', 'target-ancestor', 'missing-parent', 'dot-segment', 'dotdot-segment']) {
  test(`unsafe prefix: ${kind} performs zero writes`, () => {
    const f = fixture();
    if (kind === 'parent-symlink') { const link = join(f.root, 'parent-link'); symlinkSync(f.cwd, link, 'dir'); f.prefix = join(link, 'target'); }
    if (kind === 'target-descendant') f.prefix = join(f.source, 'new-install');
    if (kind === 'target-source') f.prefix = f.source;
    if (kind === 'target-ancestor') f.prefix = f.root;
    if (kind === 'missing-parent') f.prefix = join(f.root, 'absent-parent', 'target');
    if (kind === 'dot-segment') f.prefix = `${f.root}/./target`;
    if (kind === 'dotdot-segment') f.prefix = `${f.root}/unused/../target`;
    const before = snapshot(f.root);
    install(f, 'invalid-input');
    assert.deepEqual(snapshot(f.root), before);
  });
}

for (const kind of ['source-file-symlink', 'source-directory-symlink', 'case-collision', 'unsafe-name', 'oversized-file', 'malformed-package']) {
  test(`unsupported source input: ${kind} refuses before writes`, t => {
    const f = fixture(), dist = join(f.source, 'packages/core/dist');
    if (kind === 'source-file-symlink') { const file = join(dist, 'index.js'); renameSync(file, join(f.root, 'actual.js')); symlinkSync(join(f.root, 'actual.js'), file); }
    if (kind === 'source-directory-symlink') { renameSync(dist, join(f.root, 'actual-dist')); symlinkSync(join(f.root, 'actual-dist'), dist, 'dir'); }
    if (kind === 'case-collision') {
      writeFileSync(join(dist, 'Collision.js'), '// first'); writeFileSync(join(dist, 'collision.js'), '// second');
      if (readdirSync(dist).filter(name => name.toLowerCase() === 'collision.js').length !== 2) {
        t.skip('case-insensitive filesystem cannot materialize two case-colliding source names'); return;
      }
    }
    if (kind === 'unsafe-name') writeFileSync(join(dist, 'unsafe\\name.js'), '// unsupported portable name');
    if (kind === 'oversized-file') writeFileSync(join(dist, 'oversized.js'), Buffer.alloc(16 * 1024 * 1024 + 1));
    if (kind === 'malformed-package') writeFileSync(join(f.source, 'packages/core/package.json'), '{');
    const before = snapshot(f.root);
    install(f, 'source-unavailable');
    assert.deepEqual(snapshot(f.root), before);
  });
}

test('failed installed smoke leaves visible partial directory, never a success manifest or repaired target', () => {
  const f = fixture();
  // Fault is in a copied real CLI module, not a substitute installer or core.
  writeFileSync(join(f.source, 'packages/cli/dist/index.js'), `${readFileSync(join(f.source, 'packages/cli/dist/index.js'), 'utf8')}\nprocess.exitCode = 19;\n`);
  install(f, 'checked', ['--check']); // preflight must not run product children
  const res = install(f, 'partial-install');
  assert.equal(res.prefix, f.prefix);
  assert.ok(existsSync(f.prefix));
  assert.ok(!existsSync(join(f.prefix, 'installation.json')));
  const before = snapshot(f.root);
  install(f, 'conflict');
  assert.deepEqual(snapshot(f.root), before);
});

test('two real simultaneous installers yield one create-only winner and a verifiable product', async () => {
  const f = fixture();
  const concurrent = () => new Promise((done, fail) => {
    const child = spawn(process.execPath, [join(f.source, 'scripts/install.mjs'), '--prefix', f.prefix, '--json'], { cwd: f.cwd, env: f.env, timeout: 30000 });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', fail);
    child.on('close', (status, signal) => {
      try { assert.equal(signal, null); done(result({ stdout, stderr, status })); } catch (error) { fail(error); }
    });
  });
  const results = await Promise.all([concurrent(), concurrent()]);
  assert.equal(results.filter(r => r.status === 'installed').length, 1);
  assert.ok(results.every(r => ['installed', 'conflict', 'unchanged'].includes(r.status)), JSON.stringify(results));
  const winner = results.find(r => r.status === 'installed');
  verifyManifest(f.prefix, winner);
  assert.equal(install(f, 'unchanged').contentDigest, winner.contentDigest);
});

// These are explicit environment fault injections, not evidence of execution on
// another host/Node version. Real macOS and host skill activation remain separate gates.
for (const [property, value] of [['platform', 'win32'], ['version', 'v22.11.0'], ['version', 'v24.10.0'], ['version', 'v23.99.0']]) {
  test(`unsupported host preflight (synthetic ${property}=${value}) writes nothing`, () => {
    const f = fixture();
    const preload = join(f.root, 'unsupported-host.mjs');
    const code = property === 'version'
      ? `Object.defineProperty(process, 'version', {value: ${JSON.stringify(value)}}); Object.defineProperty(process.versions, 'node', {value: ${JSON.stringify(value.slice(1))}});\n`
      : `Object.defineProperty(process, 'platform', {value: ${JSON.stringify(value)}});\n`;
    writeFileSync(preload, code);
    const before = snapshot(f.root);
    install(f, 'unsupported-platform', [], { nodeArgs: ['--import', preload] });
    assert.deepEqual(snapshot(f.root), before);
  });
}

test('source changes after exclusive target acquisition are detected (synthetic filesystem fault)', () => {
  const f = fixture();
  const preload = join(f.root, 'change-source-after-acquire.mjs');
  const sourceFile = join(f.source, 'packages/core/dist/index.js');
  const marker = '// injected change after target acquisition';
  writeFileSync(preload, `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const mkdir = fs.mkdirSync;
fs.mkdirSync = function(path, ...args) {
  const result = mkdir.call(this, path, ...args);
  if (String(path) === ${JSON.stringify(f.prefix)}) {
    fs.appendFileSync(${JSON.stringify(sourceFile)}, ${JSON.stringify(`\n${marker}\n`)});
  }
  return result;
};
syncBuiltinESMExports();
`);
  const changed = install(f, 'partial-install', [], { nodeArgs: ['--import', preload] });
  assert.ok(changed.issues.some(issue => /source.*chang|chang.*source/i.test(`${issue.code} ${issue.message}`)), 'failure specifically detects the changed source');
  assert.ok(readFileSync(sourceFile, 'utf8').includes(marker), 'fault actually happened');
  assert.ok(existsSync(f.prefix));
  assert.ok(!existsSync(join(f.prefix, 'installation.json')), 'changed source is never committed');
});

for (const kind of ['file-count', 'total-bytes']) test(`source budget ${kind} is enforced before target creation`, () => {
  const f = fixture(), dist = join(f.source, 'packages/core/dist');
  if (kind === 'file-count') for (let i = 0; i < 4096; i++) writeFileSync(join(dist, `budget-${i}.js`), '');
  else for (let i = 0; i < 5; i++) writeFileSync(join(dist, `budget-${i}.js`), Buffer.alloc(14 * 1024 * 1024));
  const before = snapshot(f.root);
  install(f, 'source-unavailable');
  assert.deepEqual(snapshot(f.root), before);
});

test('unreadable source is refused without mutation', t => {
  if (process.getuid?.() === 0) { t.skip('root can read mode-000 files, so unreadability cannot be established'); return; }
  const f = fixture(), path = join(f.source, 'packages/core/dist/index.js');
  const mode = lstatSync(path).mode & 0o777;
  chmodSync(path, 0);
  try {
    assert.throws(() => readFileSync(path), { code: 'EACCES' });
    const before = snapshot(f.cwd);
    install(f, 'source-unavailable');
    assert.ok(!existsSync(f.prefix));
    assert.deepEqual(snapshot(f.cwd), before);
    assert.equal(lstatSync(path).mode & 0o777, 0);
  } finally { chmodSync(path, mode); }
});

test('FIFO source is refused promptly without opening or modifying it', t => {
  const f = fixture(), path = join(f.source, 'packages/core/dist/not-a-file');
  const create = spawnSync('mkfifo', [path], { encoding: 'utf8', timeout: 5000 });
  if (create.error?.code === 'ENOENT') { t.skip('mkfifo unavailable on this host'); return; }
  assert.ifError(create.error);
  assert.equal(create.status, 0, create.stderr);
  assert.ok(lstatSync(path).isFIFO());
  const before = snapshot(f.root);
  install(f, 'source-unavailable');
  assert.deepEqual(snapshot(f.root), before);
});

test('a SIGTERM-resistant real CLI smoke child is bounded by the installer timeout', async () => {
  const f = fixture(), file = join(f.source, 'packages/cli/dist/index.js');
  writeFileSync(file, `${readFileSync(file, 'utf8')}\nprocess.on('SIGTERM', () => {}); setInterval(() => {}, 1000);\n`);
  const start = performance.now();
  // Own a detached process group so even a regressed installer cannot leave an
  // orphan smoke child when the independent test deadline fires.
  const failed = await new Promise((done, fail) => {
    const child = spawn(process.execPath, [join(f.source, 'scripts/install.mjs'), '--prefix', f.prefix, '--json'], {
      cwd: f.cwd, env: f.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    const killGroup = () => {
      if (!child.pid) return;
      try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    };
    const timer = setTimeout(() => {
      killGroup();
      fail(new Error(`installer exceeded the independent 20-second deadline: ${stdout} ${stderr}`));
    }, 20000);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => { clearTimeout(timer); killGroup(); fail(error); });
    child.on('close', (status, signal) => {
      clearTimeout(timer);
      try {
        killGroup();
        assert.equal(signal, null);
        done(result({ stdout, stderr, status }, 'partial-install'));
      } catch (error) { fail(error); }
    });
  });
  assert.ok(performance.now() - start >= 9000, 'the real child stayed alive until the timeout');
  assert.ok(failed.issues.some(issue => /smoke/i.test(`${issue.code} ${issue.message}`)));
  assert.ok(!existsSync(join(f.prefix, 'installation.json')));
});

for (const check of [false, true]) test(`source change during existing-target ${check ? 'check' : 'no-op'} verification cannot report success`, () => {
  const f = fixture(); install(f);
  const before = snapshot(f.prefix);
  const preload = join(f.root, 'change-source-during-target-verification.mjs');
  const file = join(f.source, 'LICENSE');
  const marker = '\nsynthetic source edit during target verification\n';
  writeFileSync(preload, `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const readdir = fs.readdirSync;
let changed = false;
fs.readdirSync = function(path, ...args) {
  if (String(path) === ${JSON.stringify(f.prefix)} && !changed) {
    changed = true;
    fs.appendFileSync(${JSON.stringify(file)}, ${JSON.stringify(marker)});
  }
  return readdir.call(this, path, ...args);
};
syncBuiltinESMExports();
`);
  const failed = install(f, 'source-unavailable', check ? ['--check'] : [], { nodeArgs: ['--import', preload] });
  assert.ok(failed.issues.some(issue => /source.*chang|chang.*source/i.test(`${issue.code} ${issue.message}`)));
  assert.ok(readFileSync(file, 'utf8').endsWith(marker), 'fault actually happened');
  assert.deepEqual(snapshot(f.prefix), before, 'existing target stays byte- and metadata-identical');
});
