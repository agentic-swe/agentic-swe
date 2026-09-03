# Multi-team productization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn agentic-swe from a single-maintainer plugin pack into a local-first CLI product that multiple people on a team can join, sync signed team memory, pin evaluated skills, and hand off work — without a hosted SaaS.

**Architecture:** Git-native workspace (`.agentic-swe/workspace.json`) + person identity from git email + HMAC-signed sync events on branch `agentic-swe-memory` + CLI subcommands on `bin/agentic-swe.cjs`. Personal SQLite stays on the laptop; team chunks are redacted events ingested into the project graph.

**Tech Stack:** Node ≥18 CommonJS (`.cjs`), existing `scripts/lib/sync/git-sync.cjs`, `scripts/lib/memory/ingest-scopes.cjs`, JSON Schema under `schemas/`, `node:test`.

## Global Constraints

- Keep customer-owned `.worklogs/` and gitignored `memory.sqlite`; no new cloud runtime.
- Do not count teammate joins as independent fleet consumers; fleet-scale stays distinct `project_root`.
- Reject HMAC secret `local-dev` when `workspace.members.length >= 2`.
- Personal scope must never auto-promote into team events.
- Unevaluated skills cannot be workspace-pinned.
- Match existing CJS style (`'use strict'`, `module.exports`, no TypeScript).
- Do not commit secrets; `sync.secret` is gitignored.
- User rule: only `git commit` when the human asks — skip commit steps unless explicitly requested.

---

## File map (create / modify)

| Path | Responsibility |
|---|---|
| `schemas/workspace.schema.json` | Workspace file contract |
| `scripts/lib/team/identity.cjs` | Resolve `actor_id` |
| `scripts/lib/team/workspace.cjs` | Load/validate/mutate workspace |
| `scripts/lib/team/events.cjs` | Canonical event + HMAC verify |
| `scripts/lib/team/sync.cjs` | Push/pull wrapping git-sync |
| `scripts/lib/team/skills.cjs` | Pin/pull evaluated skills |
| `scripts/lib/team/handoff.cjs` | Work owner transfer |
| `scripts/lib/team/doctor.cjs` | Team-aware doctor checks |
| `scripts/team.cjs` | CLI entry for `team` / `sync` / `skill` |
| `bin/agentic-swe.cjs` | Dispatch new subcommands |
| `scripts/lib/sync/git-sync.cjs` | Stop using default `local-dev` when workspace forbids it |
| `scripts/lib/memory/ingest-scopes.cjs` | Persist `actor_id` on team nodes |
| `scripts/lib/work-engine/engine.cjs` | Stamp `actors.owner_id` on transitions when workspace exists |
| `.gitignore` | Ignore `.agentic-swe/sync.secret` |
| `docs/PUBLISHING.md` | Teams install section |
| `docs/teams.md` | Operator guide |
| `test/team-*.test.js` | Unit + two-person fixture |

---

### Task 1: Identity resolver

**Files:**
- Create: `scripts/lib/team/identity.cjs`
- Test: `test/team-identity.test.js`

**Interfaces:**
- Consumes: `process.env.AGENTIC_SWE_ACTOR`, `git config` via `execFileSync`
- Produces: `resolveActorId(opts) → { ok, actor_id, display_name, source }` where `actor_id` is `email:<lowercase>` or a raw `AGENTIC_SWE_ACTOR` if it already contains `:`

- [ ] **Step 1: Write the failing test**

```javascript
'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { resolveActorId } = require('../scripts/lib/team/identity.cjs');

describe('team identity', () => {
  it('uses AGENTIC_SWE_ACTOR when set', () => {
    const prev = process.env.AGENTIC_SWE_ACTOR;
    process.env.AGENTIC_SWE_ACTOR = 'email:ada@example.com';
    try {
      const r = resolveActorId({ env: process.env });
      assert.equal(r.ok, true);
      assert.equal(r.actor_id, 'email:ada@example.com');
      assert.equal(r.source, 'env');
    } finally {
      if (prev === undefined) delete process.env.AGENTIC_SWE_ACTOR;
      else process.env.AGENTIC_SWE_ACTOR = prev;
    }
  });

  it('normalizes a bare email env into email: prefix', () => {
    const prev = process.env.AGENTIC_SWE_ACTOR;
    process.env.AGENTIC_SWE_ACTOR = 'Ada@Example.com';
    try {
      const r = resolveActorId({ env: process.env });
      assert.equal(r.actor_id, 'email:ada@example.com');
    } finally {
      if (prev === undefined) delete process.env.AGENTIC_SWE_ACTOR;
      else process.env.AGENTIC_SWE_ACTOR = prev;
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/team-identity.test.js`
Expected: FAIL with `Cannot find module '../scripts/lib/team/identity.cjs'`

- [ ] **Step 3: Write minimal implementation**

```javascript
'use strict';

const { execFileSync } = require('node:child_process');

function normalizeActorId(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (s.includes(':')) return s.toLowerCase();
  return `email:${s.toLowerCase()}`;
}

function gitConfig(cwd, key) {
  try {
    return execFileSync('git', ['config', '--get', key], {
      cwd: cwd || process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

/**
 * @param {{ env?: NodeJS.ProcessEnv, cwd?: string }} [opts]
 */
function resolveActorId(opts) {
  const env = opts?.env || process.env;
  const cwd = opts?.cwd;
  const fromEnv = normalizeActorId(env.AGENTIC_SWE_ACTOR);
  if (fromEnv) {
    return { ok: true, actor_id: fromEnv, display_name: env.AGENTIC_SWE_ACTOR_NAME || fromEnv, source: 'env' };
  }
  const email = gitConfig(cwd, 'user.email');
  const name = gitConfig(cwd, 'user.name');
  const actor_id = normalizeActorId(email);
  if (!actor_id) {
    return { ok: false, error: 'set git user.email or AGENTIC_SWE_ACTOR' };
  }
  return { ok: true, actor_id, display_name: name || actor_id, source: 'git' };
}

module.exports = { resolveActorId, normalizeActorId };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/team-identity.test.js`
Expected: PASS

---

### Task 2: Workspace schema + load/save

**Files:**
- Create: `schemas/workspace.schema.json`
- Create: `scripts/lib/team/workspace.cjs`
- Test: `test/team-workspace.test.js`

**Interfaces:**
- Consumes: `resolveActorId` (Task 1)
- Produces: `loadWorkspace(projectRoot)`, `initWorkspace({ projectRoot, workspace_id, actor })`, `addMember(ws, member)`, `assertMember(ws, actor_id)`, `workspacePath(projectRoot)`

- [ ] **Step 1: Write the failing test**

```javascript
'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { initWorkspace, loadWorkspace, addMember, assertMember } = require('../scripts/lib/team/workspace.cjs');

describe('workspace', () => {
  it('init then load round-trips members', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-'));
    const created = initWorkspace({
      projectRoot: root,
      workspace_id: 'acme',
      actor: { actor_id: 'email:ada@example.com', role: 'admin' },
    });
    assert.equal(created.ok, true);
    const loaded = loadWorkspace(root);
    assert.equal(loaded.ok, true);
    assert.equal(loaded.workspace.workspace_id, 'acme');
    assert.equal(loaded.workspace.members[0].actor_id, 'email:ada@example.com');
    const next = addMember(loaded.workspace, { actor_id: 'email:bob@example.com', role: 'engineer' });
    assert.equal(assertMember(next, 'email:bob@example.com').ok, true);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('loadWorkspace missing file is solo mode', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-'));
    const loaded = loadWorkspace(root);
    assert.equal(loaded.ok, true);
    assert.equal(loaded.solo, true);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/team-workspace.test.js`
Expected: FAIL module not found

- [ ] **Step 3: Write schema + implementation**

`schemas/workspace.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://github.com/agentic-swe/agentic-swe/schemas/workspace.schema.json",
  "title": "Workspace",
  "type": "object",
  "required": ["schema_version", "workspace_id", "members", "sync"],
  "properties": {
    "schema_version": { "type": "integer", "minimum": 1 },
    "workspace_id": { "type": "string", "minLength": 1 },
    "display_name": { "type": "string" },
    "members": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["actor_id", "role"],
        "properties": {
          "actor_id": { "type": "string", "minLength": 1 },
          "role": { "enum": ["admin", "engineer", "readonly"] }
        }
      }
    },
    "skill_pins": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["name", "version", "source"],
        "properties": {
          "name": { "type": "string" },
          "version": { "type": "string" },
          "source": { "enum": ["pack", "workspace", "git"] },
          "eval_status": { "type": "string" }
        }
      }
    },
    "sync": {
      "type": "object",
      "required": ["branch", "require_signed_events"],
      "properties": {
        "branch": { "type": "string" },
        "require_signed_events": { "type": "boolean" }
      }
    }
  }
}
```

`scripts/lib/team/workspace.cjs` (minimal):

```javascript
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROLES = new Set(['admin', 'engineer', 'readonly']);

function workspacePath(projectRoot) {
  return path.join(path.resolve(projectRoot), '.agentic-swe', 'workspace.json');
}

function initWorkspace(opts) {
  const projectRoot = path.resolve(opts.projectRoot);
  const dir = path.join(projectRoot, '.agentic-swe');
  fs.mkdirSync(dir, { recursive: true });
  const workspace = {
    schema_version: 1,
    workspace_id: String(opts.workspace_id),
    display_name: opts.display_name || String(opts.workspace_id),
    members: [
      {
        actor_id: opts.actor.actor_id,
        role: opts.actor.role || 'admin',
      },
    ],
    skill_pins: [],
    sync: { branch: 'agentic-swe-memory', require_signed_events: true },
  };
  const file = workspacePath(projectRoot);
  fs.writeFileSync(file, `${JSON.stringify(workspace, null, 2)}\n`);
  return { ok: true, workspace, path: file };
}

function loadWorkspace(projectRoot) {
  const file = workspacePath(projectRoot);
  if (!fs.existsSync(file)) return { ok: true, solo: true, workspace: null, path: file };
  const workspace = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!workspace.workspace_id || !Array.isArray(workspace.members)) {
    return { ok: false, error: 'invalid workspace.json' };
  }
  return { ok: true, solo: false, workspace, path: file };
}

function addMember(workspace, member) {
  if (!ROLES.has(member.role)) throw new Error(`invalid role ${member.role}`);
  const members = workspace.members.filter((m) => m.actor_id !== member.actor_id);
  members.push({ actor_id: member.actor_id, role: member.role });
  return { ...workspace, members };
}

function saveWorkspace(projectRoot, workspace) {
  const file = workspacePath(projectRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(workspace, null, 2)}\n`);
  return file;
}

function assertMember(workspace, actorId) {
  if (!workspace) return { ok: true, solo: true };
  const row = workspace.members.find((m) => m.actor_id === actorId);
  if (!row) return { ok: false, error: `actor ${actorId} is not a workspace member` };
  return { ok: true, role: row.role };
}

function assertRole(workspace, actorId, allowed) {
  const m = assertMember(workspace, actorId);
  if (!m.ok) return m;
  if (m.solo) return m;
  if (!allowed.includes(m.role)) return { ok: false, error: `role ${m.role} cannot perform this action` };
  return m;
}

module.exports = {
  workspacePath,
  initWorkspace,
  loadWorkspace,
  addMember,
  saveWorkspace,
  assertMember,
  assertRole,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/team-workspace.test.js`
Expected: PASS

---

### Task 3: Signed team events (reject local-dev at ≥2 members)

**Files:**
- Create: `scripts/lib/team/events.cjs`
- Modify: `scripts/lib/sync/git-sync.cjs` — `appendLocalEvent` must accept `secret` required by caller; do not default to `local-dev` when `requireSecret: true`
- Test: `test/team-events.test.js`

**Interfaces:**
- Consumes: `signEvent` from `git-sync.cjs` (keep HMAC algorithm)
- Produces: `buildTeamEvent({ actor_id, workspace_id, kind, payload })`, `signTeamEvent(event, secret)`, `verifyTeamEvent(event, secret)`, `resolveSyncSecret({ projectRoot, workspace, env })`

- [ ] **Step 1: Write the failing test**

```javascript
'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildTeamEvent, signTeamEvent, verifyTeamEvent, resolveSyncSecret } = require('../scripts/lib/team/events.cjs');

describe('team events', () => {
  it('round-trips HMAC', () => {
    const ev = buildTeamEvent({
      actor_id: 'email:ada@example.com',
      workspace_id: 'acme',
      kind: 'work-completed',
      payload: { work_id: 'feat-a' },
    });
    const signed = signTeamEvent(ev, 's3cret');
    assert.equal(verifyTeamEvent(signed, 's3cret').ok, true);
    assert.equal(verifyTeamEvent(signed, 'wrong').ok, false);
  });

  it('rejects local-dev when workspace has 2+ members', () => {
    const r = resolveSyncSecret({
      workspace: { members: [{}, {}], sync: { require_signed_events: true } },
      env: { AGENTIC_SWE_SYNC_SECRET: 'local-dev' },
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /local-dev/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/team-events.test.js`
Expected: FAIL module not found

- [ ] **Step 3: Write implementation**

```javascript
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { signEvent } = require('../sync/git-sync.cjs');

function canonicalUnsigned(event) {
  const { sig, ...rest } = event;
  return rest;
}

function buildTeamEvent(opts) {
  return {
    schema_version: 1,
    id: crypto.randomUUID(),
    ts: new Date().toISOString(),
    actor_id: opts.actor_id,
    workspace_id: opts.workspace_id,
    kind: opts.kind,
    payload: opts.payload || {},
    redacted: true,
  };
}

function signTeamEvent(event, secret) {
  const unsigned = canonicalUnsigned(event);
  return { ...unsigned, sig: signEvent(unsigned, secret) };
}

function verifyTeamEvent(event, secret) {
  if (!event || !event.sig) return { ok: false, error: 'missing sig' };
  const expected = signEvent(canonicalUnsigned(event), secret);
  if (expected !== event.sig) return { ok: false, error: 'hmac mismatch' };
  return { ok: true };
}

function resolveSyncSecret(opts) {
  const env = opts.env || process.env;
  const workspace = opts.workspace;
  const memberCount = workspace?.members?.length || 0;
  let secret = env.AGENTIC_SWE_SYNC_SECRET || null;
  if (!secret && opts.projectRoot) {
    const p = path.join(path.resolve(opts.projectRoot), '.agentic-swe', 'sync.secret');
    if (fs.existsSync(p)) secret = fs.readFileSync(p, 'utf8').trim();
  }
  if (memberCount >= 2 && (!secret || secret === 'local-dev')) {
    return { ok: false, error: 'set AGENTIC_SWE_SYNC_SECRET or .agentic-swe/sync.secret (local-dev forbidden for teams)' };
  }
  return { ok: true, secret: secret || 'local-dev' };
}

module.exports = { buildTeamEvent, signTeamEvent, verifyTeamEvent, resolveSyncSecret, canonicalUnsigned };
```

Add to repo `.gitignore` if missing:

```
.agentic-swe/sync.secret
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/team-events.test.js`
Expected: PASS

---

### Task 4: Ingest team events with actor_id (personal never mixed)

**Files:**
- Modify: `scripts/lib/memory/ingest-scopes.cjs` `ingestTeamEvents` — typed node `id` = `team:${actor_id}:${event.id}`; body includes `actor_id` and `kind`; skip events that fail `verifyTeamEvent` when workspace is not solo
- Test: `test/team-ingest-isolation.test.js`

**Interfaces:**
- Consumes: `verifyTeamEvent`, `loadWorkspace`, `resolveSyncSecret`
- Produces: same `ingestTeamEvents` return `{ ok, events, skipped_bad_sig }`

- [ ] **Step 1: Write the failing test**

```javascript
'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { appendLocalEvent } = require('../scripts/lib/sync/git-sync.cjs');
const { signTeamEvent, buildTeamEvent } = require('../scripts/lib/team/events.cjs');
const { ingestTeamEvents } = require('../scripts/lib/memory/ingest-scopes.cjs');

describe('team ingest isolation', () => {
  it('stores actor_id on team nodes and skips bad signatures', async () => {
    const pluginRoot = path.resolve(__dirname, '..');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ingest-'));
    fs.mkdirSync(path.join(root, '.agentic-swe', 'sync', 'events'), { recursive: true });
    const good = signTeamEvent(
      buildTeamEvent({
        actor_id: 'email:ada@example.com',
        workspace_id: 'acme',
        kind: 'work-completed',
        payload: { work_id: 'a' },
      }),
      's3cret'
    );
    fs.writeFileSync(
      path.join(root, '.agentic-swe', 'sync', 'events', 'good.json'),
      JSON.stringify(good)
    );
    const bad = { ...good, id: 'other', sig: 'deadbeef' };
    fs.writeFileSync(
      path.join(root, '.agentic-swe', 'sync', 'events', 'bad.json'),
      JSON.stringify(bad)
    );
    process.env.AGENTIC_SWE_SYNC_SECRET = 's3cret';
    const r = await ingestTeamEvents({ projectRoot: root, pluginRoot, syncSecret: 's3cret' });
    assert.ok(r.events >= 1);
    assert.ok((r.skipped_bad_sig || 0) >= 1);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/team-ingest-isolation.test.js`
Expected: FAIL (`skipped_bad_sig` undefined) or events include the forged file

- [ ] **Step 3: Patch `ingestTeamEvents`**

Inside the loop, after `JSON.parse`:

```javascript
const secret = opts.syncSecret;
if (secret && ev.sig) {
  const { verifyTeamEvent } = require('../team/events.cjs');
  const v = verifyTeamEvent(ev, secret);
  if (!v.ok) {
    skippedBadSig++;
    continue;
  }
}
const actorId = ev.actor_id || 'unknown';
const label = String(ev.label || ev.kind || f);
const body = JSON.stringify({
  kind: ev.kind,
  label,
  ts: ev.ts,
  scope: 'team',
  actor_id: actorId,
  workspace_id: ev.workspace_id,
});
insertScopedChunk(db, {
  path: `.agentic-swe/sync/events/${f}`,
  workId: 'team',
  body: `${label}\n${body}`,
});
nodes.push({
  id: `team:${actorId}:${ev.id || f}`,
  kind: 'team-event',
  label: label.slice(0, 120),
  body,
});
```

Return `{ ok: true, events, skipped_bad_sig: skippedBadSig, sqlitePath }`.

Do **not** call personal ingest from this function.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/team-ingest-isolation.test.js`
Expected: PASS

---

### Task 5: CLI product surface (`agentic-swe team|sync|skill|doctor`)

**Files:**
- Create: `scripts/team.cjs`
- Modify: `bin/agentic-swe.cjs` — dispatch `team`, `sync`, `skill`, `doctor`
- Test: `test/team-cli.test.js`

**Interfaces:**
- Consumes: workspace + identity + events APIs
- Produces: CLI argv:
  - `agentic-swe team init --workspace-id <id> --project-root <dir>`
  - `agentic-swe team whoami`
  - `agentic-swe team join --actor-id <id> --role engineer --project-root <dir>` (admin-only addMember + save)
  - `agentic-swe sync push|pull --project-root <dir>`
  - `agentic-swe doctor --project-root <dir>` (wrap existing muscle-memory doctor + team checks)

- [ ] **Step 1: Write the failing test**

```javascript
'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const bin = path.resolve(__dirname, '../bin/agentic-swe.cjs');

describe('agentic-swe team CLI', () => {
  it('team init writes workspace.json', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-'));
    const r = spawnSync(
      process.execPath,
      [bin, 'team', 'init', '--project-root', root, '--workspace-id', 'acme'],
      { encoding: 'utf8', env: { ...process.env, AGENTIC_SWE_ACTOR: 'email:ada@example.com' } }
    );
    assert.equal(r.status, 0, r.stderr || r.stdout);
    assert.equal(fs.existsSync(path.join(root, '.agentic-swe', 'workspace.json')), true);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/team-cli.test.js`
Expected: FAIL (usage / exit 1)

- [ ] **Step 3: Implement dispatcher**

In `bin/agentic-swe.cjs` after `goal`:

```javascript
if (cmd === 'team' || cmd === 'sync' || cmd === 'skill' || cmd === 'doctor') {
  const script = path.join(root, 'scripts', 'team.cjs');
  const res = spawnSync(process.execPath, [script, cmd, ...argv.slice(1)], { stdio: 'inherit' });
  process.exit(res.status == null ? 1 : res.status);
}
```

`scripts/team.cjs` parse `--project-root`, `--workspace-id`, `--actor-id`, `--role`. `init` calls `resolveActorId` + `initWorkspace`. Unknown subcommand exits 2 with usage.

`sync push` calls existing `pushEventsToGitBranch`. `sync pull` is allowed to be a documented no-op that lists `events/` on `agentic-swe-memory` if the worktree exists; implement copy-back of remote event JSON into `.agentic-swe/sync/events/` then `ingestTeamEvents`. If pull is too large for this task, implement push + a `sync pull` that returns `{ ok: false, reason: 'not a git repository' }` on non-git fixtures and `{ ok: true, imported: 0 }` when the branch is missing — plus a unit test for the import-from-dir helper `importEventsFromDir(srcDir, destDir)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/team-cli.test.js`
Expected: PASS

---

### Task 6: Skill pins require eval_status=evaluated

**Files:**
- Create: `scripts/lib/team/skills.cjs`
- Test: `test/team-skill-pins.test.js`

**Interfaces:**
- Consumes: pack `skills/<name>/SKILL.md` frontmatter (`eval_status`, `version`) — parse YAML-ish like existing skill-lint
- Produces: `pinSkill({ pluginRoot, projectRoot, name })` → updates `workspace.skill_pins` only if `eval_status === 'evaluated'`

- [ ] **Step 1: Write the failing test**

```javascript
'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { initWorkspace } = require('../scripts/lib/team/workspace.cjs');
const { pinSkill } = require('../scripts/lib/team/skills.cjs');

describe('team skill pins', () => {
  it('pins evaluated pack skill fleet', () => {
    const pluginRoot = path.resolve(__dirname, '..');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pin-'));
    initWorkspace({
      projectRoot: root,
      workspace_id: 'acme',
      actor: { actor_id: 'email:ada@example.com', role: 'admin' },
    });
    const r = pinSkill({ pluginRoot, projectRoot: root, name: 'fleet' });
    assert.equal(r.ok, true);
    assert.equal(r.pin.name, 'fleet');
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('rejects missing skill', () => {
    const pluginRoot = path.resolve(__dirname, '..');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pin-'));
    initWorkspace({
      projectRoot: root,
      workspace_id: 'acme',
      actor: { actor_id: 'email:ada@example.com', role: 'admin' },
    });
    const r = pinSkill({ pluginRoot, projectRoot: root, name: 'definitely-not-a-skill-xyz' });
    assert.equal(r.ok, false);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/team-skill-pins.test.js`
Expected: FAIL module not found

- [ ] **Step 3: Implement `pinSkill`**

Read `path.join(pluginRoot, 'skills', name, 'SKILL.md')`. Extract `eval_status:` and `version:` from the first `---` block with regex `/^eval_status:\s*"?([^"\n]+)"?/m`. If not `evaluated`, return `{ ok: false, error: 'skill not evaluated' }`. Else `loadWorkspace`, push pin `{ name, version, source: 'pack', eval_status: 'evaluated' }`, `saveWorkspace`.

Wire `agentic-swe skill pin <name>` in `scripts/team.cjs`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/team-skill-pins.test.js`
Expected: PASS

---

### Task 7: Work handoff stamps actor_id

**Files:**
- Create: `scripts/lib/team/handoff.cjs`
- Modify: `scripts/lib/work-engine/engine.cjs` `applyTransition` — if `loadWorkspace` is not solo, set `next.actors = { owner_id, watchers }` when missing; set `entry.actor_id` from `resolveActorId`
- Test: `test/team-handoff.test.js`

**Interfaces:**
- Consumes: `loadWorkItem` / write lock from engine
- Produces: `handoffWork({ workDir, pluginRoot, toActorId, fromActorId })` → owner becomes `toActorId`, history entry `{ from, to: same state, actor: 'user', actor_id, reason: 'handoff' }` without requiring a state-machine edge

- [ ] **Step 1: Write the failing test**

Use a copy of `templates/state.json` in a temp work dir. Call `handoffWork`. Assert `state.actors.owner_id === 'email:bob@example.com'` and last history reason is `handoff`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/team-handoff.test.js`
Expected: FAIL module not found

- [ ] **Step 3: Implement handoff as a locked JSON rewrite** (do not call `applyTransition` for same-state). Validate `toActorId` with `assertMember` if workspace exists.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/team-handoff.test.js`
Expected: PASS

---

### Task 8: Two-person fixture (the product proof)

**Files:**
- Create: `scripts/bench/run-two-person-workspace.cjs`
- Test: `test/team-two-person-fixture.test.js`

**Interfaces:**
- Consumes: Tasks 1–5
- Produces: JSON `{ ok, personal_leaked: false, team_visible_to_b: true, local_dev_rejected: true }`

- [ ] **Step 1: Write the failing test** calling the bench with `--out` in tmp

- [ ] **Step 2: Run to verify fail**

- [ ] **Step 3: Implement bench**

1. `os.tmpdir()` repo with `git init`
2. HomeA / HomeB via `AGENTIC_SWE_PERSONAL_ROOT`
3. Actor A inits workspace, writes `sync.secret` = `team-secret-1`, adds B as engineer
4. A appends signed `work-completed` event
5. Ingest as B (same projectRoot, B personal root)
6. Search team chunks for A's `actor_id`
7. Ingest a personal style chunk only under HomeA; assert B sqlite / prime does not contain the personal phrase `UNIQUE_PERSONAL_MARKER_A`
8. Assert `resolveSyncSecret` fails if secret is `local-dev`

- [ ] **Step 4: Run tests**

Run: `node --test test/team-two-person-fixture.test.js`
Expected: PASS

Add npm script `"bench:two-person-workspace": "node scripts/bench/run-two-person-workspace.cjs"` in `package.json`.

---

### Task 9: Doctor + docs (install path)

**Files:**
- Create: `scripts/lib/team/doctor.cjs`
- Modify: `docs/PUBLISHING.md` (append Teams section)
- Create: `docs/teams.md`
- Modify: `bin/agentic-swe.cjs` usage text
- Test: `test/team-doctor.test.js`

**Interfaces:**
- Produces: `runTeamDoctor({ projectRoot, pluginRoot })` → `{ ok, blockers: string[] }` including:
  - identity missing
  - members ≥ 2 and secret is local-dev
  - skill pins with eval_status ≠ evaluated
  - actor not in members

- [ ] **Step 1: Failing test** — two-member workspace without secret → `ok: false`

- [ ] **Step 2: Run fail**

- [ ] **Step 3: Implement doctor; document:**

```bash
npm install -g @agentic-swe/agentic-swe
cd <team-repo>
agentic-swe team init --workspace-id <id>
echo '<random>' > .agentic-swe/sync.secret
agentic-swe team join --actor-id email:teammate@org.com --role engineer
agentic-swe doctor
```

Existing Cursor/Claude plugin install unchanged.

- [ ] **Step 4: `node --test test/team-doctor.test.js` PASS** then `npm test` full suite PASS

---

## Spec coverage (self-review)

| Spec section | Task |
|---|---|
| Identity | 1 |
| Workspace file | 2 |
| HMAC / forbid local-dev | 3 |
| Memory scopes / ingest | 4, 8 |
| CLI product | 5, 9 |
| Skill pins | 6 |
| Handoff | 7 |
| Two-person proof | 8 |
| Docs / doctor | 9 |
| Fleet not mixed with teammates | 9 docs + Task 8 comment; no fleet ingest in join |
| No SaaS | Global constraints |

No TBD placeholders. Commit steps omitted unless the human asks.

## Execution handoff

Plan saved to `docs/superpowers/plans/2026-09-03-multi-team-productization.md`.

Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks
2. **Inline Execution** — this session, `executing-plans`, checkpoints after each task

Which approach?
