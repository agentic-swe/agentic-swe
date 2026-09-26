# Control-plane adoption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic agent-surface security gate and reversible install lifecycle, then add selective profiles, context and host reports, and memory trust without changing the landed Jev advisory seams.

**Architecture:** `scripts/lib/agent-surface/scan.cjs` returns deterministic findings. `scripts/lib/install-state/` owns manifests, transactions, profiles, and lifecycle commands. `scripts/setup.cjs` scans before writing and records `<destination>/install-state.json` last. `bin/agentic-swe.cjs` dispatches the new commands. Jev remains a fail-open advisor and is not called by setup or scan.

**Tech Stack:** Node.js >=18, CommonJS, `node:test`, `node:crypto`, existing `scripts/setup.cjs` and `scripts/doctor.cjs`. No new dependencies.

## Global Constraints

- Clean-room implementation: do not copy upstream source, skill text, hooks, or branding.
- Critical findings block setup. High, medium, and low findings warn. `--accept-risk "<reason>"` requires a non-empty reason and writes a receipt.
- Adopt an unmanaged file only when its SHA-256 equals the shipped pack file. Preserve modified and unknown files.
- `core` remains the current portable pack, discovered from `PORTABLE_ENTRIES`, including shipped Jev files.
- Jev cannot block, clear, or override the security gate. Setup and scan do not call `https://api.typesafe.ai/v1/systemone`.
- A literal `TYPESAFE_API_KEY` value is `secret-hardcoded`. A missing key is clean.
- Preserve destination-relative runtime files: `jev.json`, `memory.sqlite`, `memory.sqlite-shm`, `memory.sqlite-wal`, `procedures.json`, `catalog.json`, `catalog-embeddings.json`, `model-routing.json`, and `skills/`.
- Do not edit `scripts/lib/jev/`, `scripts/jev-track-hint.cjs`, `scripts/session-model-tier-hint.cjs`, `scripts/catalog-route.cjs`, `scripts/session-skill-route-hint.cjs`, or `phases/lean-track-check.md`.
- Repository manifest path is `<repo>/.agentic-swe/install-state.json`. Cursor manifest path is `~/.cursor/plugins/local/agentic-swe/install-state.json`.
- Tests use temporary directories, call no model, install no packages, and write nowhere outside the temp directory.
- Do not create a git commit unless the user explicitly asks during implementation.

---

## File map

| Path | Responsibility |
|---|---|
| `scripts/lib/agent-surface/scan.cjs` | Deterministic rules and `scanSurfaces` |
| `scripts/lib/install-state/hash.cjs` | SHA-256 helpers |
| `scripts/lib/install-state/manifest.cjs` | Manifest read/write, runtime exclusions, classification |
| `scripts/lib/install-state/transaction.cjs` | Rollback of files created by one setup |
| `scripts/lib/install-state/lifecycle.cjs` | list, repair, update, uninstall |
| `scripts/lib/install-state/profiles.cjs` | `minimal`, `core`, `full`, and `--with` |
| `config/capability-profiles.json` | Curated capability file lists |
| `scripts/control-plane.cjs` | CLI for scan and lifecycle commands |
| `scripts/lib/context-budget/estimate.cjs` | Token estimate from a file inventory |
| `scripts/context-budget.cjs` | `context-budget` command |
| `scripts/lib/host-parity/report.cjs` | Host status derived from setup capabilities |
| `scripts/host-parity.cjs` | `host-parity` command |
| `scripts/lib/memory/trust.cjs` | Decay, quarantine, replay, and promotion decisions |
| `scripts/setup.cjs` | Gate, receipt, transaction, profile selection |
| `scripts/doctor.cjs` | Manifest, drift, scan, and Jev readiness |
| `bin/agentic-swe.cjs` | Dispatch new commands |

---

### Task 1: Agent-surface scanner

**Files:**
- Create: `scripts/lib/agent-surface/scan.cjs`
- Test: `test/agent-surface.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `scanSurfaces({ roots = [], plannedWrites = [] })` returns `{ findings, summary }`. Each finding is `{ id, rule, severity, path, line, evidence, message }`. `summary` is `{ status, critical, high, medium, low }` where `status` is `clean`, `warnings`, or `blocked`.

- [ ] **Step 1: Write the failing test**

```js
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { scanSurfaces } = require('../scripts/lib/agent-surface/scan.cjs');

function tempDir(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-surface-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('clean policy produces no findings', () => {
  const result = scanSurfaces({
    plannedWrites: [{ path: 'CLAUDE.md', content: '# Project policy\nUse tests.\n' }],
  });
  assert.deepEqual(result.findings, []);
  assert.equal(result.summary.status, 'clean');
});

test('critical rules block and lower severities warn', (t) => {
  const directory = tempDir(t);
  fs.writeFileSync(path.join(directory, 'jev.json'), 'TYPESAFE_API_KEY=ts_live_secret\n');
  const result = scanSurfaces({
    roots: [directory],
    plannedWrites: [
      { path: 'hooks/hooks.json', content: '{ "command": "sh -c \\"${TOOL_INPUT}\\"" }\n' },
      { path: 'settings.json', content: '{ "allow": ["Bash(*)"] }\n' },
      { path: 'CLAUDE.md', content: 'Run with --dangerously-skip-permissions.\n' },
      { path: 'mcp.json', content: '{ "command": "npx -y some-server" }\n' },
      { path: 'quiet-hook.json', content: '{ "command": "npm test || true" }\n' },
      { path: 'described.json', content: '{ "mcpServers": { "docs": {} } }\n' },
    ],
  });
  const rules = result.findings.map((finding) => finding.rule);
  for (const rule of ['secret-hardcoded', 'hook-command-injection', 'permission-unrestricted-shell', 'policy-auto-run-unsafe']) {
    assert.ok(rules.includes(rule), rule);
  }
  assert.equal(result.summary.status, 'blocked');
  assert.ok(result.summary.critical >= 4);
  assert.ok(rules.includes('mcp-autoinstall'));
  assert.ok(rules.includes('hook-hidden-failure'));
  assert.ok(rules.includes('mcp-missing-description'));
});

test('a missing Jev key is not a finding', () => {
  const result = scanSurfaces({
    plannedWrites: [{ path: 'jev.json', content: '{ "enabled": true }\n' }],
  });
  assert.equal(result.findings.some((finding) => finding.rule === 'secret-hardcoded'), false);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test test/agent-surface.test.js`

Expected: FAIL because `scripts/lib/agent-surface/scan.cjs` does not exist.

- [ ] **Step 3: Implement the scanner**

```js
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const RULES = [
  ['secret-hardcoded', 'critical', /(?:AKIA[0-9A-Z]{16}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|TYPESAFE_API_KEY\s*[:=]\s*['"]?[A-Za-z0-9_\-]{8,})/],
  ['permission-unrestricted-shell', 'critical', /Bash\(\*\)/],
  ['hook-command-injection', 'critical', /\$\{(?:TOOL_INPUT|FILE|ARGUMENTS)\}/],
  ['policy-auto-run-unsafe', 'critical', /--dangerously-skip-permissions|bypass permission prompts/i],
  ['permission-missing-deny', 'high', /"allow"\s*:\s*\[[^\]]*"Bash\(\*\)"[^\]]*\](?![\s\S]{0,200}"deny")/],
  ['mcp-autoinstall', 'high', /npx\s+-y\s+/],
  ['hook-hidden-failure', 'medium', /\|\|\s*true|2>\s*\/dev\/null/],
  ['mcp-missing-description', 'low', /"mcpServers"\s*:\s*\{[\s\S]*?\{\s*\}/],
];

function lineOf(content, index) {
  return content.slice(0, index).split('\n').length;
}

function scanText(filePath, content) {
  const findings = [];
  for (const [rule, severity, pattern] of RULES) {
    const match = pattern.exec(content);
    if (!match) continue;
    const line = lineOf(content, match.index);
    findings.push({
      id: `${rule}:${filePath}:${line}`,
      rule,
      severity,
      path: filePath,
      line,
      evidence: match[0].slice(0, 120),
      message: `${rule} at ${filePath}:${line}`,
    });
  }
  return findings;
}

function walk(directory) {
  const files = [];
  if (!fs.existsSync(directory)) return files;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      files.push(...walk(full));
    } else if (entry.isFile()) files.push(full);
  }
  return files;
}

function summarize(findings) {
  const summary = { status: 'clean', critical: 0, high: 0, medium: 0, low: 0 };
  for (const finding of findings) summary[finding.severity] += 1;
  if (summary.critical > 0) summary.status = 'blocked';
  else if (findings.length > 0) summary.status = 'warnings';
  return summary;
}

function scanSurfaces({ roots = [], plannedWrites = [] } = {}) {
  const findings = [];
  for (const planned of plannedWrites) findings.push(...scanText(planned.path, planned.content));
  for (const root of roots) {
    for (const file of walk(root)) {
      findings.push(...scanText(path.relative(root, file), fs.readFileSync(file, 'utf8')));
    }
  }
  return { findings, summary: summarize(findings) };
}

module.exports = { scanSurfaces };
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `node --test test/agent-surface.test.js`

Expected: PASS, 3 tests.

- [ ] **Step 5: Commit only if the user explicitly asked**

```bash
git add scripts/lib/agent-surface/scan.cjs test/agent-surface.test.js
git commit -m "$(cat <<'EOF'
Add a deterministic agent-surface scanner.

EOF
)"
```

---

### Task 2: Install manifest and classification

**Files:**
- Create: `scripts/lib/install-state/hash.cjs`
- Create: `scripts/lib/install-state/manifest.cjs`
- Test: `test/install-manifest.test.js`

**Interfaces:**
- Consumes: nothing from Task 1
- Produces:
  - `sha256Text(text)` and `sha256File(filePath)` return lowercase hex.
  - `readManifest(destination)` returns the object or `null`. Invalid JSON or a missing `schema_version` throws `Error('corrupt manifest')`.
  - `writeManifest(destination, manifest)` writes `<destination>/install-state.json`.
  - `isRuntimePath(relativePath)` returns true for the preserved runtime names and `skills/`.
  - `classifyDestination({ destination, manifest, packFiles })` returns `{ current, drifted, preserved, adoptable }`. `packFiles` is a `Map` from relative path to hex digest.

- [ ] **Step 1: Write the failing test**

```js
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { sha256Text } = require('../scripts/lib/install-state/hash.cjs');
const {
  classifyDestination,
  isRuntimePath,
  readManifest,
  writeManifest,
} = require('../scripts/lib/install-state/manifest.cjs');

function tempDir(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'install-manifest-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('runtime state is never classifiable as owned content', () => {
  assert.equal(isRuntimePath('jev.json'), true);
  assert.equal(isRuntimePath('skills/local/SKILL.md'), true);
  assert.equal(isRuntimePath('commands/work.md'), false);
});

test('classification separates current, drifted, preserved, and adoptable files', (t) => {
  const destination = tempDir(t);
  const owned = sha256Text('owned\n');
  const shipped = sha256Text('shipped\n');
  fs.mkdirSync(path.join(destination, 'commands'));
  fs.writeFileSync(path.join(destination, 'commands/work.md'), 'owned\n');
  fs.writeFileSync(path.join(destination, 'commands/drift.md'), 'changed\n');
  fs.writeFileSync(path.join(destination, 'commands/same.md'), 'shipped\n');
  fs.writeFileSync(path.join(destination, 'jev.json'), '{}\n');
  writeManifest(destination, {
    schema_version: 1,
    installer_version: '3.3.1',
    host: 'codex',
    profile: 'core',
    files: [
      { path: 'commands/work.md', sha256: owned },
      { path: 'commands/drift.md', sha256: sha256Text('original\n') },
    ],
    edits: [],
    external_registrations: [],
    last_scan: { status: 'clean', critical: 0, high: 0, medium: 0, low: 0, receipt: null },
  });
  const result = classifyDestination({
    destination,
    manifest: readManifest(destination),
    packFiles: new Map([['commands/same.md', shipped]]),
  });
  assert.deepEqual(result.current, ['commands/work.md']);
  assert.deepEqual(result.drifted, ['commands/drift.md']);
  assert.deepEqual(result.adoptable, ['commands/same.md']);
  assert.equal(result.preserved.includes('jev.json'), false);
});

test('invalid manifest JSON throws', (t) => {
  const destination = tempDir(t);
  fs.writeFileSync(path.join(destination, 'install-state.json'), '{');
  assert.throws(() => readManifest(destination), /corrupt manifest/);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test test/install-manifest.test.js`

Expected: FAIL because the install-state modules do not exist.

- [ ] **Step 3: Implement hash and manifest helpers**

`scripts/lib/install-state/hash.cjs`:

```js
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');

function sha256Text(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function sha256File(filePath) {
  return sha256Text(fs.readFileSync(filePath));
}

module.exports = { sha256Text, sha256File };
```

`scripts/lib/install-state/manifest.cjs`:

```js
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { sha256File } = require('./hash.cjs');

const RUNTIME_FILES = new Set([
  'jev.json', 'memory.sqlite', 'memory.sqlite-shm', 'memory.sqlite-wal',
  'procedures.json', 'catalog.json', 'catalog-embeddings.json', 'model-routing.json',
  'install-state.json',
]);

function isRuntimePath(relativePath) {
  const normalized = relativePath.split(path.sep).join('/');
  return RUNTIME_FILES.has(normalized) || normalized === 'skills' || normalized.startsWith('skills/') || normalized.startsWith('install-receipts/');
}

function manifestPath(destination) {
  return path.join(destination, 'install-state.json');
}

function readManifest(destination) {
  const file = manifestPath(destination);
  if (!fs.existsSync(file)) return null;
  try {
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!manifest || manifest.schema_version !== 1 || !Array.isArray(manifest.files)) {
      throw new Error('corrupt manifest');
    }
    return manifest;
  } catch (error) {
    if (error.message === 'corrupt manifest') throw error;
    throw new Error('corrupt manifest');
  }
}

function writeManifest(destination, manifest) {
  fs.mkdirSync(destination, { recursive: true });
  fs.writeFileSync(manifestPath(destination), `${JSON.stringify(manifest, null, 2)}\n`);
}

function walkFiles(directory) {
  const out = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    const relative = path.relative(directory, full).split(path.sep).join('/');
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'install-receipts' || entry.name === 'skills') continue;
      out.push(...walkFiles(full));
    } else if (!isRuntimePath(relative)) out.push(relative);
  }
  return out;
}

function classifyDestination({ destination, manifest, packFiles }) {
  const current = [];
  const drifted = [];
  const preserved = [];
  const adoptable = [];
  const owned = new Map((manifest.files || []).map((file) => [file.path, file.sha256]));
  for (const relative of walkFiles(destination)) {
    const full = path.join(destination, relative);
    const actual = sha256File(full);
    if (owned.has(relative)) {
      if (owned.get(relative) === actual) current.push(relative);
      else drifted.push(relative);
    } else if (packFiles.get(relative) === actual) adoptable.push(relative);
    else preserved.push(relative);
  }
  return { current, drifted, preserved, adoptable };
}

module.exports = {
  classifyDestination,
  isRuntimePath,
  readManifest,
  writeManifest,
};
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `node --test test/install-manifest.test.js`

Expected: PASS, 3 tests.

- [ ] **Step 5: Commit only if the user explicitly asked**

```bash
git add scripts/lib/install-state/hash.cjs scripts/lib/install-state/manifest.cjs test/install-manifest.test.js
git commit -m "$(cat <<'EOF'
Record install ownership with exact file hashes.

EOF
)"
```

---

### Task 3: Setup gate, receipt, and rollback

**Files:**
- Create: `scripts/lib/install-state/transaction.cjs`
- Modify: `scripts/setup.cjs`
- Test: `test/setup-security-gate.test.js`

**Interfaces:**
- Consumes: `scanSurfaces` from Task 1; `sha256File`, `writeManifest` from Task 2; existing `setup`, `parseArgs`, and `PORTABLE_ENTRIES`.
- Produces: `beginTransaction()`, `recordCreated(transaction, filePath)`, and `rollback(transaction)`. `parseArgs` accepts `--accept-risk <reason>`. `setup` scans planned pack files before the first copy, writes `<destination>/install-receipts/<timestamp>.json` when risk is accepted, and writes the manifest last. A critical result without a reason throws before any copy. A failed copy removes only files recorded in the transaction.

- [ ] **Step 1: Write the failing test**

```js
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { parseArgs, setup } = require('../scripts/setup.cjs');

const packRoot = path.resolve(__dirname, '..');

function gitRepository(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-gate-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  assert.equal(spawnSync('git', ['init', '-q', directory]).status, 0);
  return directory;
}

test('parseArgs records the risk reason', () => {
  assert.equal(parseArgs(['--accept-risk', 'reviewed hook']).acceptRisk, 'reviewed hook');
  assert.throws(() => parseArgs(['--accept-risk']), /--accept-risk requires a reason/);
});

test('critical planned content blocks setup before writing', (t) => {
  const target = gitRepository(t);
  const source = path.join(packRoot, 'CLAUDE.md');
  const original = fs.readFileSync(source, 'utf8');
  fs.appendFileSync(source, '\n--dangerously-skip-permissions\n');
  t.after(() => fs.writeFileSync(source, original));
  assert.throws(() => setup({
    hosts: ['codex'], target, dryRun: false, gitignore: false, yes: true, allowNonGit: false,
  }, { packRoot, home: path.join(target, 'empty-home'), skipDependencyInstall: true }), /critical agent-surface findings/);
  assert.equal(fs.existsSync(path.join(target, '.agentic-swe', 'install-state.json')), false);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test test/setup-security-gate.test.js`

Expected: FAIL because `parseArgs` rejects `--accept-risk` as an unknown option.

- [ ] **Step 3: Add the transaction helper and the setup gate**

`scripts/lib/install-state/transaction.cjs`:

```js
'use strict';

const fs = require('node:fs');

function beginTransaction() {
  return { created: [] };
}

function recordCreated(transaction, filePath) {
  transaction.created.push(filePath);
}

function rollback(transaction) {
  for (const filePath of transaction.created.reverse()) fs.rmSync(filePath, { force: true });
}

module.exports = { beginTransaction, recordCreated, rollback };
```

In `scripts/setup.cjs`, initialize `acceptRisk: ''` and parse the flag:

```js
else if (arg === '--accept-risk') {
  const reason = argv[i + 1];
  if (!reason || reason.startsWith('--')) throw new Error('--accept-risk requires a reason');
  opts.acceptRisk = argv[++i];
}
```

Add this helper and call it immediately before the first copy inside `setup`:

```js
const { scanSurfaces } = require('./lib/agent-surface/scan.cjs');
const { writeManifest } = require('./lib/install-state/manifest.cjs');
const { sha256File } = require('./lib/install-state/hash.cjs');
const { beginTransaction, recordCreated, rollback } = require('./lib/install-state/transaction.cjs');

function plannedPackWrites(packRoot) {
  const writes = [];
  for (const entry of PORTABLE_ENTRIES) {
    const source = path.join(packRoot, entry);
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) continue;
    writes.push({ path: entry, content: fs.readFileSync(source, 'utf8') });
  }
  return writes;
}

function gateSetup(packRoot, target, acceptRisk, destination) {
  const scan = scanSurfaces({ roots: [target], plannedWrites: plannedPackWrites(packRoot) });
  if (scan.summary.status !== 'blocked') return scan;
  if (!acceptRisk) throw new Error('critical agent-surface findings');
  const receipts = path.join(destination, 'install-receipts');
  fs.mkdirSync(receipts, { recursive: true });
  const receipt = path.join(receipts, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(receipt, `${JSON.stringify({
    schema_version: 1,
    created_at: new Date().toISOString(),
    command: 'setup',
    reason: acceptRisk,
    findings: scan.findings.filter((finding) => finding.severity === 'critical'),
  }, null, 2)}\n`);
  return { ...scan, receipt: path.relative(destination, receipt) };
}
```

Create `const transaction = beginTransaction()` before copying. In `copyEntry`, when the destination does not exist, call `recordCreated(transaction, destination)` before `fs.cpSync`. On any thrown error, call `rollback(transaction)` and rethrow. After copies succeed, call `writeManifest(destination, { schema_version: 1, installer_version: require('../package.json').version, host, profile: 'core', files, edits, external_registrations, last_scan })`. `files` contains `{ path, sha256: sha256File(writtenFile) }` for every newly owned file. `external_registrations` contains `{ host: 'claude-code', id: 'agentic-swe@agentic-swe-catalog' }` only when the Claude host install succeeds. Export `PORTABLE_ENTRIES`.

- [ ] **Step 4: Run the test and verify it passes**

Run: `node --test test/setup-security-gate.test.js test/setup-cli.test.js`

Expected: PASS. The existing setup tests remain green.

- [ ] **Step 5: Commit only if the user explicitly asked**

```bash
git add scripts/lib/install-state/transaction.cjs scripts/setup.cjs test/setup-security-gate.test.js
git commit -m "$(cat <<'EOF'
Block setup on critical agent-surface findings.

EOF
)"
```

---

### Task 4: Repair, update, and uninstall

**Files:**
- Create: `scripts/lib/install-state/lifecycle.cjs`
- Test: `test/install-lifecycle.test.js`

**Interfaces:**
- Consumes: `classifyDestination`, `readManifest`, `writeManifest`, `sha256File`, and `isRuntimePath`.
- Produces:
  - `listInstalled({ destination, packFiles })`
  - `repair({ destination, packRoot, packFiles, dryRun })`
  - `updateInstalled({ destination, packRoot, packFiles, dryRun })`
  - `uninstall({ destination, dryRun })`
  Each returns `{ current, drifted, preserved, adoptable, changes }`. Uninstall returns `manual` for external registrations and drifted files.

- [ ] **Step 1: Write the failing test**

```js
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { sha256Text } = require('../scripts/lib/install-state/hash.cjs');
const { writeManifest } = require('../scripts/lib/install-state/manifest.cjs');
const { repair, uninstall, updateInstalled } = require('../scripts/lib/install-state/lifecycle.cjs');

function tempDir(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'install-life-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('repair adopts an exact match and preserves a modified file', (t) => {
  const destination = tempDir(t);
  const packRoot = tempDir(t);
  fs.mkdirSync(path.join(packRoot, 'commands'), { recursive: true });
  fs.writeFileSync(path.join(packRoot, 'commands/work.md'), 'shipped\n');
  fs.mkdirSync(path.join(destination, 'commands'), { recursive: true });
  fs.writeFileSync(path.join(destination, 'commands/work.md'), 'shipped\n');
  fs.writeFileSync(path.join(destination, 'notes.md'), 'local\n');
  const result = repair({
    destination,
    packRoot,
    packFiles: new Map([['commands/work.md', sha256Text('shipped\n')]]),
    dryRun: false,
  });
  assert.deepEqual(result.adoptable, []);
  assert.ok(result.preserved.includes('notes.md'));
  assert.equal(fs.existsSync(path.join(destination, 'notes.md')), true);
});

test('update refreshes a drifted owned file and uninstall preserves drift', (t) => {
  const destination = tempDir(t);
  const packRoot = tempDir(t);
  fs.mkdirSync(path.join(packRoot, 'commands'), { recursive: true });
  fs.mkdirSync(path.join(destination, 'commands'), { recursive: true });
  fs.writeFileSync(path.join(packRoot, 'commands/work.md'), 'new\n');
  fs.writeFileSync(path.join(destination, 'commands/work.md'), 'old\n');
  writeManifest(destination, {
    schema_version: 1, installer_version: '3.3.1', host: 'codex', profile: 'core',
    files: [{ path: 'commands/work.md', sha256: sha256Text('old\n') }],
    edits: [], external_registrations: [],
    last_scan: { status: 'clean', critical: 0, high: 0, medium: 0, low: 0, receipt: null },
  });
  updateInstalled({
    destination, packRoot,
    packFiles: new Map([['commands/work.md', sha256Text('new\n')]]),
    dryRun: false,
  });
  assert.equal(fs.readFileSync(path.join(destination, 'commands/work.md'), 'utf8'), 'new\n');
  fs.writeFileSync(path.join(destination, 'commands/work.md'), 'edited\n');
  const removed = uninstall({ destination, dryRun: false });
  assert.equal(fs.readFileSync(path.join(destination, 'commands/work.md'), 'utf8'), 'edited\n');
  assert.deepEqual(removed.drifted, ['commands/work.md']);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test test/install-lifecycle.test.js`

Expected: FAIL because `lifecycle.cjs` does not exist.

- [ ] **Step 3: Implement lifecycle operations**

```js
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { sha256File } = require('./hash.cjs');
const { classifyDestination, readManifest, writeManifest } = require('./manifest.cjs');

function copyOwned(packRoot, destination, relative) {
  const source = path.join(packRoot, relative);
  const target = path.join(destination, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function listInstalled({ destination, packFiles }) {
  const manifest = readManifest(destination) || { files: [] };
  return classifyDestination({ destination, manifest, packFiles });
}

function repair({ destination, packRoot, packFiles, dryRun }) {
  const manifest = readManifest(destination) || {
    schema_version: 1, installer_version: '0.0.0', host: 'unknown', profile: 'core',
    files: [], edits: [], external_registrations: [],
    last_scan: { status: 'clean', critical: 0, high: 0, medium: 0, low: 0, receipt: null },
  };
  const classified = classifyDestination({ destination, manifest, packFiles });
  const changes = [];
  for (const relative of classified.drifted) {
    if (!packFiles.has(relative)) continue;
    changes.push(`restore ${relative}`);
    if (!dryRun) copyOwned(packRoot, destination, relative);
  }
  for (const relative of classified.adoptable) {
    changes.push(`adopt ${relative}`);
    if (!dryRun) manifest.files.push({ path: relative, sha256: packFiles.get(relative) });
  }
  if (!dryRun) {
    for (const relative of classified.drifted.filter((file) => packFiles.has(file))) {
      const record = manifest.files.find((file) => file.path === relative);
      record.sha256 = sha256File(path.join(destination, relative));
    }
    writeManifest(destination, manifest);
  }
  return { ...classified, changes };
}

function updateInstalled({ destination, packRoot, packFiles, dryRun }) {
  const manifest = readManifest(destination);
  if (!manifest) throw new Error('corrupt manifest');
  const changes = [];
  for (const file of manifest.files) {
    if (!packFiles.has(file.path)) continue;
    changes.push(`update ${file.path}`);
    if (!dryRun) {
      copyOwned(packRoot, destination, file.path);
      file.sha256 = sha256File(path.join(destination, file.path));
    }
  }
  if (!dryRun) writeManifest(destination, manifest);
  return { ...classifyDestination({ destination, manifest, packFiles }), changes };
}

function uninstall({ destination, dryRun }) {
  const manifest = readManifest(destination);
  if (!manifest) throw new Error('corrupt manifest');
  const changes = [];
  const drifted = [];
  for (const file of manifest.files) {
    const full = path.join(destination, file.path);
    if (!fs.existsSync(full)) continue;
    if (sha256File(full) !== file.sha256) {
      drifted.push(file.path);
      continue;
    }
    changes.push(`remove ${file.path}`);
    if (!dryRun) fs.rmSync(full, { force: true });
  }
  const preserved = [];
  for (const edit of manifest.edits || []) {
    const edited = applyEdit(path.join(destination, edit.path), edit, dryRun);
    if (edited) changes.push(`reverse ${edit.path}`);
    else preserved.push(edit.path);
  }
  const manual = (manifest.external_registrations || []).map((item) => `${item.host}:${item.id}`);
  if (!dryRun && drifted.length === 0) fs.rmSync(path.join(destination, 'install-state.json'), { force: true });
  return { current: [], drifted, preserved, adoptable: [], changes, manual };
}

function applyEdit(filePath, edit, dryRun) {
  if (!fs.existsSync(filePath)) return false;
  const content = fs.readFileSync(filePath, 'utf8');
  let next = content;
  if (edit.type === 'policy-append' && content.endsWith(edit.body)) next = content.slice(0, -edit.body.length);
  if (edit.type === 'json-plugin-entry') {
    const parsed = JSON.parse(content);
    parsed.plugins = (parsed.plugins || []).filter((plugin) => !(plugin && plugin.name === edit.match.name && plugin.entry === edit.match.entry));
    next = `${JSON.stringify(parsed, null, 2)}\n`;
  }
  if (edit.type === 'gitignore-line') next = content.replace(/\n?\.worklogs\/\n/, '\n');
  if (next === content) return false;
  if (!dryRun) fs.writeFileSync(filePath, next);
  return true;
}

module.exports = { applyEdit, listInstalled, repair, updateInstalled, uninstall };
```

`uninstall` calls `applyEdit` for every `manifest.edits` entry whose current file still contains the exact recorded body or plugin entry. A missed match is added to `preserved`. Setup records three edit shapes only: `{ type: 'policy-append', path, body }`, `{ type: 'json-plugin-entry', path, match: { name: 'agentic-swe', entry } }`, and `{ type: 'gitignore-line', path, line: '.worklogs/' }`. A file created by setup stays in `files`; a pre-existing file stays in `edits`.

- [ ] **Step 4: Run the test and verify it passes**

Run: `node --test test/install-lifecycle.test.js`

Expected: PASS, 2 tests.

- [ ] **Step 5: Commit only if the user explicitly asked**

```bash
git add scripts/lib/install-state/lifecycle.cjs test/install-lifecycle.test.js
git commit -m "$(cat <<'EOF'
Add hash-checked install repair and uninstall.

EOF
)"
```

---

### Task 5: CLI dispatch and doctor

**Files:**
- Create: `scripts/control-plane.cjs`
- Modify: `bin/agentic-swe.cjs`
- Modify: `scripts/doctor.cjs`
- Test: `test/control-plane-cli.test.js`

**Interfaces:**
- Consumes: `scanSurfaces`, `listInstalled`, `repair`, `updateInstalled`, `uninstall`, and `readManifest`.
- Produces: `agentic-swe scan|list-installed|repair|update|uninstall [--target <repo>] [--json] [--dry-run]`. `inspect` adds `manifest`, `drift`, `last_scan`, and `jev` checks. `jev.state` is `disabled`, `missing_key`, or `ready`, and the returned object has no API key.

- [ ] **Step 1: Write the failing test**

```js
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { inspect } = require('../scripts/doctor.cjs');

const bin = path.resolve(__dirname, '../bin/agentic-swe.cjs');

test('scan JSON reports a clean empty directory', (t) => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'control-plane-'));
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  const result = spawnSync(process.execPath, [bin, 'scan', '--target', target, '--json'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).summary.status, 'clean');
});

test('doctor reports Jev readiness without the key', (t) => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-jev-'));
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  const ready = inspect({ target }, { env: { TYPESAFE_API_KEY: 'secret-value' } });
  assert.equal(ready.jev.state, 'ready');
  assert.equal(JSON.stringify(ready).includes('secret-value'), false);
  const missing = inspect({ target }, { env: {} });
  assert.equal(missing.jev.state, 'missing_key');
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test test/control-plane-cli.test.js`

Expected: FAIL because `scan` is not a command and `inspect` has no `jev` field.

- [ ] **Step 3: Dispatch the commands and extend doctor**

Add this dispatcher to `bin/agentic-swe.cjs` before the `path` branch:

```js
const controlCommands = new Set(['scan', 'list-installed', 'repair', 'update', 'uninstall']);
if (controlCommands.has(cmd)) {
  const script = path.join(root, 'scripts', 'control-plane.cjs');
  const res = spawnSync(process.execPath, [script, cmd, ...argv.slice(1)], { stdio: 'inherit' });
  process.exit(res.status == null ? 1 : res.status);
}
```

`scripts/control-plane.cjs` parses `--target`, `--json`, and `--dry-run`. `scan` calls `scanSurfaces({ roots: [target] })`, prints JSON when requested, and exits 2 for `blocked`. `list-installed`, `repair`, `update`, and `uninstall` call the Task 4 functions. `repair` and `update` pass `dryRun` through and perform no writes when it is true.

In `scripts/doctor.cjs`, add:

```js
function jevReadiness(env) {
  if (env.AGENTIC_SWE_JEV === '0') return { state: 'disabled' };
  if (!env.TYPESAFE_API_KEY) return { state: 'missing_key' };
  return { state: 'ready' };
}
```

Include `jev: jevReadiness(context.env || process.env)` in the `inspect` return. Add advisory checks for manifest presence and drifted owned-file count. A corrupt manifest sets `ok` false.

- [ ] **Step 4: Run the test and verify it passes**

Run: `node --test test/control-plane-cli.test.js test/bin-agentic-swe.test.js`

Expected: PASS.

- [ ] **Step 5: Commit only if the user explicitly asked**

```bash
git add scripts/control-plane.cjs bin/agentic-swe.cjs scripts/doctor.cjs test/control-plane-cli.test.js
git commit -m "$(cat <<'EOF'
Expose install lifecycle commands and Jev readiness.

EOF
)"
```

---

### Task 6: Profiles and selective capabilities

**Files:**
- Create: `config/capability-profiles.json`
- Create: `scripts/lib/install-state/profiles.cjs`
- Modify: `scripts/setup.cjs`
- Test: `test/install-profiles.test.js`

**Interfaces:**
- Consumes: exported `PORTABLE_ENTRIES`.
- Produces: `resolveProfile({ profile, withCapabilities, packRoot })` returns relative file paths. Unknown profile or capability throws `Error('unknown profile')` or `Error('unknown capability')`. `core` equals the current portable entries. `minimal` omits `scripts/lib/jev` and `config/jev.default.json`. `full` adds every capability in the config.

- [ ] **Step 1: Write the failing test**

```js
'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { PORTABLE_ENTRIES } = require('../scripts/setup.cjs');
const { resolveProfile } = require('../scripts/lib/install-state/profiles.cjs');

test('core matches the shipped portable pack and minimal omits Jev', () => {
  const core = resolveProfile({ profile: 'core', withCapabilities: [], packRoot: process.cwd() });
  assert.deepEqual(core, PORTABLE_ENTRIES);
  const minimal = resolveProfile({ profile: 'minimal', withCapabilities: [], packRoot: process.cwd() });
  assert.equal(minimal.includes('config/jev.default.json'), false);
  assert.equal(minimal.includes('scripts/lib/jev'), false);
});

test('unknown capability is rejected before a file list is returned', () => {
  assert.throws(() => resolveProfile({
    profile: 'core', withCapabilities: ['not-a-capability'], packRoot: process.cwd(),
  }), /unknown capability/);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test test/install-profiles.test.js`

Expected: FAIL because `profiles.cjs` does not exist.

- [ ] **Step 3: Implement profile resolution**

`config/capability-profiles.json`:

```json
{
  "security-scan": ["scripts/lib/agent-surface/scan.cjs", "scripts/control-plane.cjs"],
  "context-budget": ["scripts/context-budget.cjs", "scripts/lib/context-budget/estimate.cjs"],
  "memory-trust": ["scripts/lib/memory/trust.cjs"]
}
```

`resolveProfile` reads that JSON from `packRoot`. `minimal` returns `['CLAUDE.md', 'AGENTS.md', 'state-machine.json', 'commands', 'phases', 'scripts/work-engine.cjs', 'schemas', 'templates', 'hooks/session-start']`. `core` returns `PORTABLE_ENTRIES`. `full` returns `core` plus every capability path. `--with` appends one capability's paths to `minimal` or `core`. `setup --profile` uses this list instead of always copying `PORTABLE_ENTRIES`.

- [ ] **Step 4: Run the test and verify it passes**

Run: `node --test test/install-profiles.test.js`

Expected: PASS, 2 tests.

- [ ] **Step 5: Commit only if the user explicitly asked**

```bash
git add config/capability-profiles.json scripts/lib/install-state/profiles.cjs scripts/setup.cjs test/install-profiles.test.js
git commit -m "$(cat <<'EOF'
Add selective install profiles without changing core.

EOF
)"
```

---

### Task 7: Context budget

**Files:**
- Create: `scripts/lib/context-budget/estimate.cjs`
- Create: `scripts/context-budget.cjs`
- Modify: `bin/agentic-swe.cjs`
- Test: `test/context-budget.test.js`

**Interfaces:**
- Consumes: the profile file list from Task 6.
- Produces: `estimateContext({ files, jevHintText = '' })` returns `{ total, components, jevTaskText, savings }`. `components` has `policy`, `agentDescriptions`, `skills`, `mcpSchemas`, and `jevHint`. `files` entries are `{ path, content, kind }`. Estimator: prose words × 1.3, rounded; each MCP tool schema is 500. Jev task text is reported in `jevTaskText` and excluded from `total`.

- [ ] **Step 1: Write the failing test**

```js
'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { estimateContext } = require('../scripts/lib/context-budget/estimate.cjs');

test('estimates components and keeps capped Jev task text separate', () => {
  const result = estimateContext({
    files: [
      { path: 'CLAUDE.md', content: 'one two three four', kind: 'policy' },
      { path: 'mcp.json', content: '{"tools":[{},{}]}', kind: 'mcp' },
    ],
    jevHintText: 'fixed hint',
    jevTaskText: 'capped task',
  });
  assert.equal(result.components.policy, 6);
  assert.equal(result.components.mcpSchemas, 1000);
  assert.equal(result.components.jevHint, 3);
  assert.equal(result.jevTaskText, 3);
  assert.equal(result.total, 1009);
  assert.equal(result.savings[0].action, 'AGENTIC_SWE_JEV=0');
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test test/context-budget.test.js`

Expected: FAIL because the estimator does not exist.

- [ ] **Step 3: Implement the estimator and command**

```js
'use strict';

function proseTokens(text) {
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  return Math.ceil(words * 1.3);
}

function estimateContext({ files, jevHintText = '', jevTaskText = '' }) {
  const components = { policy: 0, agentDescriptions: 0, skills: 0, mcpSchemas: 0, jevHint: proseTokens(jevHintText) };
  for (const file of files) {
    if (file.kind === 'policy') components.policy += proseTokens(file.content);
    if (file.kind === 'agent-description') components.agentDescriptions += proseTokens(file.content);
    if (file.kind === 'skill') components.skills += proseTokens(file.content);
    if (file.kind === 'mcp') components.mcpSchemas += 500 * Math.max(1, (file.content.match(/\{\s*\}/g) || []).length);
  }
  const total = Object.values(components).reduce((sum, value) => sum + value, 0);
  const savings = [];
  if (components.jevHint > 0) savings.push({ action: 'AGENTIC_SWE_JEV=0', tokens: components.jevHint });
  return { total, components, jevTaskText: proseTokens(jevTaskText), savings };
}

module.exports = { estimateContext };
```

`scripts/context-budget.cjs` reads the selected profile inventory, assigns the kinds above, prints the three largest component totals, and supports `--json`. Dispatch it from `bin/agentic-swe.cjs`.

- [ ] **Step 4: Run the test and verify it passes**

Run: `node --test test/context-budget.test.js`

Expected: PASS, 1 test.

- [ ] **Step 5: Commit only if the user explicitly asked**

```bash
git add scripts/lib/context-budget/estimate.cjs scripts/context-budget.cjs bin/agentic-swe.cjs test/context-budget.test.js
git commit -m "$(cat <<'EOF'
Report context budget from the selected install profile.

EOF
)"
```

---

### Task 8: Host parity

**Files:**
- Create: `scripts/lib/host-parity/report.cjs`
- Create: `scripts/host-parity.cjs`
- Modify: `bin/agentic-swe.cjs`
- Modify: `scripts/doctor.cjs`
- Test: `test/host-parity.test.js`

**Interfaces:**
- Consumes: `SUPPORTED_HOSTS` from `scripts/setup.cjs`.
- Produces: `reportHostParity()` returns one `{ host, status }` row per supported host. `status` is `stable`, `partial`, or `instruction-only`. Doctor includes the rows.

- [ ] **Step 1: Write the failing test**

```js
'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { SUPPORTED_HOSTS } = require('../scripts/setup.cjs');
const { reportHostParity } = require('../scripts/lib/host-parity/report.cjs');

test('every setup host has one parity status', () => {
  const rows = reportHostParity();
  assert.deepEqual(rows.map((row) => row.host), SUPPORTED_HOSTS);
  assert.equal(rows.find((row) => row.host === 'claude-code').status, 'stable');
  assert.equal(rows.find((row) => row.host === 'cursor').status, 'partial');
  assert.equal(rows.find((row) => row.host === 'antigravity').status, 'instruction-only');
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test test/host-parity.test.js`

Expected: FAIL because the report module does not exist.

- [ ] **Step 3: Implement the status map**

```js
'use strict';

const { SUPPORTED_HOSTS } = require('../../setup.cjs');

const STATUS = {
  'claude-code': 'stable',
  cursor: 'partial',
  vscode: 'partial',
  codex: 'partial',
  opencode: 'partial',
  antigravity: 'instruction-only',
};

function reportHostParity() {
  return SUPPORTED_HOSTS.map((host) => {
    if (!STATUS[host]) throw new Error(`unknown host parity: ${host}`);
    return { host, status: STATUS[host] };
  });
}

module.exports = { reportHostParity };
```

Dispatch `scripts/host-parity.cjs` from the bin and add `hostParity: reportHostParity()` to doctor output. The command supports `--json`.

- [ ] **Step 4: Run the test and verify it passes**

Run: `node --test test/host-parity.test.js`

Expected: PASS, 1 test.

- [ ] **Step 5: Commit only if the user explicitly asked**

```bash
git add scripts/lib/host-parity/report.cjs scripts/host-parity.cjs bin/agentic-swe.cjs scripts/doctor.cjs test/host-parity.test.js
git commit -m "$(cat <<'EOF'
Report host parity from the setup capability map.

EOF
)"
```

---

### Task 9: Memory trust

**Files:**
- Create: `scripts/lib/memory/trust.cjs`
- Test: `test/memory-trust.test.js`

**Interfaces:**
- Consumes: procedure records from `scripts/lib/descent/promotion.cjs` only as plain objects. Do not change Jev confidence thresholds.
- Produces:
  - `annotateTrust(record, now)` adds `source`, `scope`, `confidence`, `last_confirmed`, and `external`.
  - `decayConfidence(record, now, windowMs)` reduces confidence by 0.1 for each elapsed window.
  - `canReplay(record)` returns false when `external` is true and `promoted` is not true.
  - `promoteTrust(record, { confirmations, humanApproved })` sets `promoted` true only for two confirmations or human approval.
  - `isJevEvidence(record)` returns true when `record.actor === 'jev'` or `record.kind === 'pipeline.jev_track'`. `promoteTrust` throws `Error('jev evidence cannot be promoted')` for that input.

- [ ] **Step 1: Write the failing test**

```js
'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { annotateTrust, canReplay, decayConfidence, isJevEvidence, promoteTrust } = require('../scripts/lib/memory/trust.cjs');

test('external memory cannot replay before promotion', () => {
  const record = annotateTrust({ id: 'memory-1', external: true }, '2026-09-26T00:00:00Z');
  assert.equal(canReplay(record), false);
  assert.equal(canReplay(promoteTrust(record, { confirmations: 2, humanApproved: false })), true);
  assert.equal(canReplay(promoteTrust(record, { confirmations: 0, humanApproved: true })), true);
});

test('confidence decays by one tenth per window', () => {
  const record = annotateTrust({ id: 'memory-2', confidence: 0.9 }, '2026-09-26T00:00:00Z');
  const decayed = decayConfidence(record, '2026-09-28T00:00:00Z', 24 * 60 * 60 * 1000);
  assert.equal(decayed.confidence, 0.7);
});

test('Jev advisory evidence cannot become a procedure', () => {
  const record = { actor: 'jev', kind: 'pipeline.jev_track' };
  assert.equal(isJevEvidence(record), true);
  assert.throws(() => promoteTrust(record, { confirmations: 2, humanApproved: true }), /jev evidence cannot be promoted/);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test test/memory-trust.test.js`

Expected: FAIL because `trust.cjs` does not exist.

- [ ] **Step 3: Implement trust decisions**

```js
'use strict';

function isJevEvidence(record) {
  return record.actor === 'jev' || record.kind === 'pipeline.jev_track';
}

function annotateTrust(record, now) {
  return {
    ...record,
    source: record.source || 'manual',
    scope: record.scope || 'project',
    confidence: record.confidence == null ? 0.5 : record.confidence,
    last_confirmed: record.last_confirmed || now,
    external: Boolean(record.external),
    promoted: Boolean(record.promoted),
  };
}

function decayConfidence(record, now, windowMs) {
  const elapsed = Math.floor((Date.parse(now) - Date.parse(record.last_confirmed)) / windowMs);
  return { ...record, confidence: Math.max(0, Number((record.confidence - (0.1 * Math.max(0, elapsed))).toFixed(1))) };
}

function canReplay(record) {
  return !record.external || record.promoted === true;
}

function promoteTrust(record, { confirmations, humanApproved }) {
  if (isJevEvidence(record)) throw new Error('jev evidence cannot be promoted');
  if (confirmations >= 2 || humanApproved === true) return { ...record, promoted: true };
  return { ...record, promoted: false };
}

module.exports = { annotateTrust, canReplay, decayConfidence, isJevEvidence, promoteTrust };
```

Call `canReplay` from the procedure replay path before an external record is executed. Leave Jev files unchanged.

- [ ] **Step 4: Run the targeted tests and the full suite**

Run: `node --test test/memory-trust.test.js && npm test`

Expected: the new test passes and the full suite reports `# fail 0`.

- [ ] **Step 5: Commit only if the user explicitly asked**

```bash
git add scripts/lib/memory/trust.cjs test/memory-trust.test.js
git commit -m "$(cat <<'EOF'
Quarantine external memory without promoting Jev evidence.

EOF
)"
```
