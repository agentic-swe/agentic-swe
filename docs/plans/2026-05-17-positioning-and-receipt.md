# Positioning + `/receipt` Implementation Plan

> **Archive (2026-10-21):** Historical execution plan from 2026-05-17. Many checkboxes are stale relative to the current tree (`/receipt`, compliance mapping, Phase 0 fixes shipped; asciinema cast still missing). **Do not drive launch from this file.** Use living [`docs/launch-week-1.md`](../launch-week-1.md) and strategy [`docs/specs/positioning-and-receipt.md`](../specs/positioning-and-receipt.md). Kept for audit trail of how launch assets were created.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the `/receipt` command, rewrite the README front-door, publish the NIST/OWASP compliance mapping page, and produce the asciinema launch demo — so the next 6 weeks of marketing motions (per `docs/specs/positioning-and-receipt.md`) have working code and ready-to-share assets.

**Architecture:** Pure read-only renderer over existing `.worklogs/<id>/` artifacts. Three small CJS modules (extract → format → CLI) so each can be tested in isolation. No new dependencies, no schema changes. Marketing assets are recorded against a fixture worklog so they're reproducible.

**Tech Stack:** Node 18+ CJS, node:test, `scripts/lib/work-engine/state.cjs` for state.json reading, existing markdown templates, `asciinema` for terminal recording (already a common dev tool — install via brew if absent; the recording is the only place it's used).

---

## File Structure

**Created files:**
| Path | Responsibility |
|------|----------------|
| `commands/receipt.md` | Slash command prompt — discovery surface |
| `scripts/lib/receipt/extract.cjs` | Pure: read `state.json` + `audit.log` + phase artifacts → typed `ReceiptData` object |
| `scripts/lib/receipt/format.cjs` | Pure: render `ReceiptData` → markdown / json / html string |
| `scripts/render-receipt.cjs` | CLI: arg parsing + file IO + stdout/--output writing |
| `test/receipt-extract.test.js` | Unit tests for extraction logic |
| `test/receipt-format.test.js` | Unit tests for formatting (fixture-driven) |
| `test/receipt-cli.test.js` | Integration test exercising the CLI end-to-end |
| `test/fixtures/receipt/lean-happy/state.json` | Fixture: completed lean-track work item |
| `test/fixtures/receipt/lean-happy/audit.log` | Fixture: matching audit trail |
| `test/fixtures/receipt/lean-happy/feasibility.md` | Fixture phase artifact |
| `test/fixtures/receipt/lean-happy/implementation.md` | Fixture phase artifact |
| `test/fixtures/receipt/lean-happy/validation-results.md` | Fixture phase artifact |
| `test/fixtures/receipt/lean-happy/cicd.md` | Fixture phase artifact |
| `test/fixtures/receipt/lean-happy/pr-link.txt` | Fixture phase artifact |
| `docs/compliance-mapping.md` | NIST AI RMF + OWASP Agentic Top 10 control map |
| `docs/assets/receipt-demo.cast` | Asciinema recording of the demo flow |
| `docs/assets/sample-receipt.md` | Static rendered example for README embed |
| `docs/launch-week-1.md` | Internal launch checklist (LinkedIn draft, Twitter thread, dev.to outline) |

**Modified files:**
| Path | Reason |
|------|--------|
| `README.md` | Headline rewrite, demo embed, install simplification, advanced section move |
| `commands/swe-dashboard.md` (just a cross-link) | Add link to `/receipt` |
| `CLAUDE.md` | Add `/receipt` to Utility Skills table and Common Operations table |
| `CHANGELOG.md` | Single entry: `/receipt` + README + compliance-mapping + 3 bug fixes |
| `bin/agentic-swe.cjs` | Add `receipt` subcommand for npm-path users |
| `package.json` | Add `receipt` npm script alias (optional, for local dev convenience) |

---

## Phase 0 — Bug-fix shipment

Bug fixes are in flight from parallel agents. This phase verifies and ships them as one commit before any new feature work.

### Task 0: Verify all three bug fixes are merged in working tree

**Files:**
- Verify: `hooks/hooks.json` (Bug 1 — already fixed)
- Verify: `scripts/lib/work-engine/artifacts.cjs` (Bug 2 — already fixed)
- Verify: `bench/tasks/` (Bug 3 — in flight at plan-write time)

- [ ] **Step 1: Confirm full test suite is green**

Run: `npm test 2>&1 | tail -20`
Expected: `# fail 0` and exit code 0. Note the test count (was 378 after Bug 2 landed; Bug 3 likely adds more).

- [ ] **Step 2: Inspect the three bug-fix diffs**

Run: `git diff hooks/hooks.json scripts/lib/work-engine/artifacts.cjs test/install-platform-stubs.test.js test/work-engine-apply.test.js scripts/bench/run.cjs`

Expected: the four changes from the three fix agents (hook matcher adds `resume`, artifacts.cjs switches to source-state keying, two updated tests, bench runner adjustments). Confirm `bench/tasks/` directory now has at least 2 subdirectories each with `task.json`.

- [ ] **Step 3: Run the lean-track smoke walk to prove Bug 2 is fully fixed**

```bash
node -e '
const {applyTransition} = require("./scripts/lib/work-engine/engine.cjs");
const fs = require("fs"); const path = require("path");
const dir = fs.mkdtempSync("/tmp/agentic-smoke-");
fs.writeFileSync(path.join(dir,"state.json"), JSON.stringify({
  schema_version:2, work_id:"smoke", task:"smoke",
  current_state:"initialized", created_at:new Date().toISOString(),
  updated_at:new Date().toISOString(),
  budget:{iteration_budget:10, budget_remaining:10, cost_budget_usd:5, cost_used:0},
  counters:{}, pipeline:{track:"lean"}, history:[]
}, null, 2));
const steps = [
  ["feasibility", "feasibility.md"],
  ["lean-track-check", "lean-track-check.md"],
  ["lean-track-implementation", "implementation.md\nreview-pass.md"],
  ["validation", "validation-results.md"],
  ["pr-creation", "cicd.md\npr-link.txt"],
  ["approval-wait", null],
  ["completed", null]
];
for (const [to, artifact] of steps) {
  const result = applyTransition({workDir:dir, to, reason:"smoke", actor:"test"});
  console.log(result.ok ? `OK  -> ${to}` : `FAIL -> ${to}: ${result.error}`);
  if (artifact) for (const f of artifact.split("\n")) fs.writeFileSync(path.join(dir, f), "ok\n");
}
'
```

Expected: every line prints `OK ->` (no `FAIL`). If any line fails, do NOT proceed — investigate which bug-fix step regressed.

- [ ] **Step 4: Commit the three bug fixes as one logical change**

```bash
git add hooks/hooks.json scripts/lib/work-engine/artifacts.cjs test/install-platform-stubs.test.js test/work-engine-apply.test.js scripts/bench/run.cjs bench/tasks/
git commit -m "$(cat <<'EOF'
fix: SessionStart matcher, artifact-direction, seed bench tasks

Three silent-failure bugs flagged by adversarial review:

1. hooks/hooks.json — SessionStart matcher was missing 'resume'.
   Hypervisor policy injection was skipped on every resumed Claude Code
   session. Matcher now: startup|resume|clear|compact.
   Regression test in test/install-platform-stubs.test.js.

2. scripts/lib/work-engine/artifacts.cjs — requiredArtifactGroups was
   keyed on the destination state, blocking every legitimate transition
   (e.g. validation -> pr-creation required pr-link.txt to pre-exist).
   Now keyed on source state, matching CLAUDE.md's "Required Artifacts
   by State" semantics. New end-to-end lean track smoke test.

3. bench/tasks/ — seeded with starter tasks covering lean/standard/
   rigorous tracks, so AGENTIC_SWE_BENCH is runnable end-to-end.

All N tests pass.

Co-Authored-By: Claude Sonnet 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

Run: `git log -1 --stat` to confirm.

---

## Phase 1 — `/receipt` v1 command

TDD throughout. Build extraction, then formatting, then the CLI shim. Fixtures first.

### Task 1: Create fixture worklog for tests

**Files:**
- Create: `test/fixtures/receipt/lean-happy/state.json`
- Create: `test/fixtures/receipt/lean-happy/audit.log`
- Create: `test/fixtures/receipt/lean-happy/feasibility.md`
- Create: `test/fixtures/receipt/lean-happy/implementation.md`
- Create: `test/fixtures/receipt/lean-happy/validation-results.md`
- Create: `test/fixtures/receipt/lean-happy/cicd.md`
- Create: `test/fixtures/receipt/lean-happy/pr-link.txt`

- [ ] **Step 1: Write the fixture state.json**

```json
{
  "schema_version": 2,
  "work_id": "add-retry-logic",
  "task": "Add retry logic to the API client",
  "current_state": "completed",
  "created_at": "2026-05-17T14:00:00Z",
  "updated_at": "2026-05-17T14:47:00Z",
  "budget": {
    "iteration_budget": 8,
    "budget_remaining": 5,
    "cost_budget_usd": 3.0,
    "cost_used": 1.84,
    "usage_totals": { "input_tokens": 184000, "output_tokens": 21000 }
  },
  "counters": { "self_review_iter": 0, "doubt_cycles": 1, "code_review_iter": 0 },
  "pipeline": { "track": "lean", "subagent_auto_select": true },
  "history": [
    { "at": "2026-05-17T14:00:00Z", "from": "initialized", "to": "feasibility",
      "actor": "hypervisor", "reason": "start", "cost_delta_usd": 0 },
    { "at": "2026-05-17T14:03:00Z", "from": "feasibility", "to": "lean-track-check",
      "actor": "hypervisor", "reason": "lean signal", "cost_delta_usd": 0.08,
      "evidence_refs": ["feasibility.md#L1-L20"] },
    { "at": "2026-05-17T14:04:00Z", "from": "lean-track-check", "to": "lean-track-implementation",
      "actor": "hypervisor", "reason": "verdict: simple", "cost_delta_usd": 0.04 },
    { "at": "2026-05-17T14:30:00Z", "from": "lean-track-implementation", "to": "validation",
      "actor": "developer", "reason": "implementation complete", "cost_delta_usd": 1.33,
      "evidence_refs": ["implementation.md"] },
    { "at": "2026-05-17T14:38:00Z", "from": "validation", "to": "pr-creation",
      "actor": "hypervisor", "reason": "tests green", "cost_delta_usd": 0.21 },
    { "at": "2026-05-17T14:40:00Z", "from": "pr-creation", "to": "approval-wait",
      "actor": "pr-manager", "reason": "PR opened", "cost_delta_usd": 0.18 },
    { "at": "2026-05-17T14:47:00Z", "from": "approval-wait", "to": "completed",
      "actor": "user", "reason": "approved by suraj", "cost_delta_usd": 0 }
  ]
}
```

- [ ] **Step 2: Write the fixture audit.log**

```
2026-05-17T14:00:00Z actor=hypervisor action=start work_id=add-retry-logic
2026-05-17T14:03:00Z actor=hypervisor action=transition from=feasibility to=lean-track-check
2026-05-17T14:04:00Z actor=hypervisor action=transition from=lean-track-check to=lean-track-implementation
2026-05-17T14:08:00Z actor=hypervisor action=delegate target=agents/subagents/language-specialists/javascript-pro.md note="retry strategy"
2026-05-17T14:18:00Z actor=hypervisor action=integrate target=agents/subagents/language-specialists/javascript-pro.md result=ok
2026-05-17T14:30:00Z actor=developer action=transition from=lean-track-implementation to=validation
2026-05-17T14:38:00Z actor=hypervisor action=transition from=validation to=pr-creation
2026-05-17T14:40:00Z actor=pr-manager action=transition from=pr-creation to=approval-wait
2026-05-17T14:47:00Z actor=user action=transition from=approval-wait to=completed
```

- [ ] **Step 3: Write the phase artifacts (short stubs sufficient for tests)**

```bash
cat > test/fixtures/receipt/lean-happy/feasibility.md <<'EOF'
# Feasibility — add-retry-logic

Verdict: lean (single function, 4 LoC touched).
Subagent signals: node, http.
EOF

cat > test/fixtures/receipt/lean-happy/implementation.md <<'EOF'
# Implementation — add-retry-logic

Added exponential backoff with jitter to src/api/client.js.
3 retries max, 5xx only, base 250ms.
EOF

cat > test/fixtures/receipt/lean-happy/validation-results.md <<'EOF'
# Validation — add-retry-logic

12 new tests, all green. Lint passed. Coverage +3.2%.
EOF

cat > test/fixtures/receipt/lean-happy/cicd.md <<'EOF'
# CI/CD — add-retry-logic

Pipeline green. No required checks failing.
EOF

cat > test/fixtures/receipt/lean-happy/pr-link.txt <<'EOF'
https://github.com/example/repo/pull/142
EOF
```

- [ ] **Step 4: Verify fixture loads as valid JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('test/fixtures/receipt/lean-happy/state.json','utf8'))"`
Expected: no output, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add test/fixtures/receipt/lean-happy/
git commit -m "test: add lean-happy fixture worklog for /receipt tests

Co-Authored-By: Claude Sonnet 4.6 (1M context) <noreply@anthropic.com>"
```

### Task 2: Extraction module — read worklog into structured data

**Files:**
- Create: `scripts/lib/receipt/extract.cjs`
- Create: `test/receipt-extract.test.js`

- [ ] **Step 1: Write the failing test for `extractReceipt(workDir)`**

```javascript
// test/receipt-extract.test.js
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { extractReceipt } = require('../scripts/lib/receipt/extract.cjs');

const FIXTURE = path.join(__dirname, 'fixtures/receipt/lean-happy');

test('extractReceipt — top-level shape', () => {
  const r = extractReceipt(FIXTURE);
  assert.equal(r.workId, 'add-retry-logic');
  assert.equal(r.task, 'Add retry logic to the API client');
  assert.equal(r.track, 'lean');
  assert.equal(r.status, 'completed');
  assert.equal(r.costUsd, 1.84);
  assert.equal(r.prUrl, 'https://github.com/example/repo/pull/142');
});

test('extractReceipt — duration in seconds', () => {
  const r = extractReceipt(FIXTURE);
  assert.equal(r.durationSeconds, 47 * 60); // 14:00 -> 14:47
});

test('extractReceipt — decisions array', () => {
  const r = extractReceipt(FIXTURE);
  // 7 transitions, but feasibility -> lean-track-check is the first "decision"
  // (initialized -> feasibility is bootstrap, not a decision)
  assert.equal(r.decisions.length, 6);
  assert.equal(r.decisions[0].phase, 'feasibility');
  assert.equal(r.decisions[0].destination, 'lean-track-check');
  assert.equal(r.decisions[0].costUsd, 0.08);
});

test('extractReceipt — counters surfaced', () => {
  const r = extractReceipt(FIXTURE);
  assert.equal(r.counters.doubt_cycles, 1);
  assert.equal(r.counters.self_review_iter, 0);
});

test('extractReceipt — human gates extracted from history', () => {
  const r = extractReceipt(FIXTURE);
  assert.equal(r.humanGates.length, 1);
  assert.equal(r.humanGates[0].state, 'approval-wait');
  assert.equal(r.humanGates[0].resolvedBy, 'user');
  assert.match(r.humanGates[0].reason, /approved by suraj/);
});

test('extractReceipt — audit log entry count', () => {
  const r = extractReceipt(FIXTURE);
  assert.equal(r.auditEntryCount, 9);
});

test('extractReceipt — throws when workDir lacks state.json', () => {
  assert.throws(
    () => extractReceipt('/tmp/does-not-exist-12345'),
    /state\.json/,
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/receipt-extract.test.js 2>&1 | tail -15`
Expected: `# fail 7` (cannot find module).

- [ ] **Step 3: Write the minimal extract implementation**

```javascript
// scripts/lib/receipt/extract.cjs
const fs = require('node:fs');
const path = require('node:path');

function extractReceipt(workDir) {
  const statePath = path.join(workDir, 'state.json');
  if (!fs.existsSync(statePath)) {
    throw new Error(`state.json not found at ${statePath}`);
  }
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const history = Array.isArray(state.history) ? state.history : [];

  const decisions = history
    .filter((h) => h.from !== 'initialized')
    .map((h) => ({
      at: h.at,
      phase: h.from,
      destination: h.to,
      actor: h.actor,
      reason: h.reason || '',
      costUsd: typeof h.cost_delta_usd === 'number' ? h.cost_delta_usd : 0,
      evidenceRefs: Array.isArray(h.evidence_refs) ? h.evidence_refs : [],
    }));

  const humanGates = history
    .filter((h) => h.from === 'approval-wait' || h.from === 'ambiguity-wait')
    .map((h) => ({
      state: h.from,
      resolvedBy: h.actor,
      at: h.at,
      reason: h.reason || '',
    }));

  const created = state.created_at ? Date.parse(state.created_at) : null;
  const updated = state.updated_at ? Date.parse(state.updated_at) : null;
  const durationSeconds = created && updated ? Math.round((updated - created) / 1000) : null;

  const prLinkPath = path.join(workDir, 'pr-link.txt');
  const prUrl = fs.existsSync(prLinkPath)
    ? fs.readFileSync(prLinkPath, 'utf8').trim()
    : null;

  const auditPath = path.join(workDir, 'audit.log');
  const auditEntryCount = fs.existsSync(auditPath)
    ? fs.readFileSync(auditPath, 'utf8').split('\n').filter((l) => l.trim().length > 0).length
    : 0;

  return {
    workId: state.work_id || path.basename(workDir),
    task: state.task || '',
    track: state.pipeline && state.pipeline.track ? state.pipeline.track : 'unknown',
    status: state.current_state || 'unknown',
    costUsd: state.budget && typeof state.budget.cost_used === 'number' ? state.budget.cost_used : 0,
    budgetRemaining: state.budget && typeof state.budget.budget_remaining === 'number' ? state.budget.budget_remaining : null,
    durationSeconds,
    decisions,
    humanGates,
    counters: state.counters || {},
    prUrl,
    auditEntryCount,
    workDir,
  };
}

module.exports = { extractReceipt };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/receipt-extract.test.js 2>&1 | tail -15`
Expected: `# pass 7 # fail 0`.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/receipt/extract.cjs test/receipt-extract.test.js
git commit -m "feat(receipt): extraction module — worklog to typed ReceiptData

Co-Authored-By: Claude Sonnet 4.6 (1M context) <noreply@anthropic.com>"
```

### Task 3: Formatting module — markdown output

**Files:**
- Create: `scripts/lib/receipt/format.cjs`
- Create: `test/receipt-format.test.js`

- [ ] **Step 1: Write the failing test for `formatMarkdown(data)`**

```javascript
// test/receipt-format.test.js
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { extractReceipt } = require('../scripts/lib/receipt/extract.cjs');
const { formatMarkdown, formatJson, formatDurationHuman, formatCost } = require('../scripts/lib/receipt/format.cjs');

const FIXTURE = path.join(__dirname, 'fixtures/receipt/lean-happy');

test('formatDurationHuman — minutes', () => {
  assert.equal(formatDurationHuman(47 * 60), '47 min');
  assert.equal(formatDurationHuman(45), '45 sec');
  assert.equal(formatDurationHuman(3600), '1 hr 0 min');
  assert.equal(formatDurationHuman(3900), '1 hr 5 min');
});

test('formatCost — two decimal USD', () => {
  assert.equal(formatCost(1.844), '$1.84');
  assert.equal(formatCost(0), '$0.00');
  assert.equal(formatCost(10), '$10.00');
});

test('formatMarkdown — contains headline + work id + cost + PR url', () => {
  const md = formatMarkdown(extractReceipt(FIXTURE));
  assert.match(md, /# .*add-retry-logic/);
  assert.match(md, /Add retry logic to the API client/);
  assert.match(md, /\$1\.84/);
  assert.match(md, /https:\/\/github\.com\/example\/repo\/pull\/142/);
  assert.match(md, /lean/);
  assert.match(md, /completed/);
});

test('formatMarkdown — decisions table includes per-step cost', () => {
  const md = formatMarkdown(extractReceipt(FIXTURE));
  assert.match(md, /Decisions/);
  assert.match(md, /lean-track-check/);
  assert.match(md, /\$0\.08/);
});

test('formatMarkdown — human gates section', () => {
  const md = formatMarkdown(extractReceipt(FIXTURE));
  assert.match(md, /Human gates/);
  assert.match(md, /approval-wait/);
});

test('formatJson — round-trips', () => {
  const data = extractReceipt(FIXTURE);
  const json = formatJson(data);
  const parsed = JSON.parse(json);
  assert.equal(parsed.workId, 'add-retry-logic');
  assert.equal(parsed.costUsd, 1.84);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/receipt-format.test.js 2>&1 | tail -15`
Expected: cannot find module.

- [ ] **Step 3: Write the minimal format implementation**

```javascript
// scripts/lib/receipt/format.cjs

function formatCost(usd) {
  return `$${Number(usd).toFixed(2)}`;
}

function formatDurationHuman(seconds) {
  if (seconds < 60) return `${seconds} sec`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.round((seconds % 3600) / 60);
  return `${hrs} hr ${mins} min`;
}

function formatMarkdown(data) {
  const lines = [];
  lines.push(`# /work ${data.task || data.workId}`, '');
  lines.push('| Field | Value |');
  lines.push('|---|---|');
  lines.push(`| Work ID | ${data.workId} |`);
  lines.push(`| Track | ${data.track} |`);
  lines.push(`| Status | ${data.status} |`);
  if (data.durationSeconds != null) lines.push(`| Duration | ${formatDurationHuman(data.durationSeconds)} |`);
  lines.push(`| Cost | ${formatCost(data.costUsd)} |`);
  if (data.prUrl) lines.push(`| PR | ${data.prUrl} |`);
  lines.push('');
  if (data.decisions.length > 0) {
    lines.push(`## Decisions made (${data.decisions.length})`, '');
    data.decisions.forEach((d, i) => {
      const line = `${i + 1}. **${d.phase} → ${d.destination}** (${formatCost(d.costUsd)}) — ${d.reason || 'no reason recorded'}`;
      const evidence = d.evidenceRefs.length > 0 ? ` → ${d.evidenceRefs.join(', ')}` : '';
      lines.push(line + evidence);
    });
    lines.push('');
  }
  if (data.humanGates.length > 0) {
    lines.push(`## Human gates respected (${data.humanGates.length})`, '');
    data.humanGates.forEach((g) => {
      lines.push(`- \`${g.state}\` resolved by ${g.resolvedBy} at ${g.at} — ${g.reason}`);
    });
    lines.push('');
  }
  const counterEntries = Object.entries(data.counters);
  if (counterEntries.length > 0) {
    lines.push('## Loop counters', '');
    counterEntries.forEach(([k, v]) => lines.push(`- \`${k}\`: ${v}`));
    lines.push('');
  }
  lines.push('## Verifiable references', '');
  lines.push(`- All artifacts: \`${data.workDir}/\``);
  lines.push(`- Audit log: \`${data.workDir}/audit.log\` (${data.auditEntryCount} entries)`);
  lines.push('');
  return lines.join('\n');
}

function formatJson(data) {
  return JSON.stringify(data, null, 2);
}

module.exports = { formatMarkdown, formatJson, formatCost, formatDurationHuman };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/receipt-format.test.js 2>&1 | tail -15`
Expected: `# pass 6 # fail 0`.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/receipt/format.cjs test/receipt-format.test.js
git commit -m "feat(receipt): formatting module — markdown + json output

Co-Authored-By: Claude Sonnet 4.6 (1M context) <noreply@anthropic.com>"
```

### Task 4: CLI script — `scripts/render-receipt.cjs`

**Files:**
- Create: `scripts/render-receipt.cjs`
- Create: `test/receipt-cli.test.js`

- [ ] **Step 1: Write the failing test for CLI behavior**

```javascript
// test/receipt-cli.test.js
const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'scripts', 'render-receipt.cjs');
const FIXTURE = path.join(__dirname, 'fixtures', 'receipt', 'lean-happy');

test('CLI — explicit --work-dir prints markdown to stdout', () => {
  const out = execFileSync('node', [CLI, '--work-dir', FIXTURE], { encoding: 'utf8' });
  assert.match(out, /# \/work/);
  assert.match(out, /add-retry-logic/);
});

test('CLI — --format=json prints JSON', () => {
  const out = execFileSync('node', [CLI, '--work-dir', FIXTURE, '--format=json'], { encoding: 'utf8' });
  const parsed = JSON.parse(out);
  assert.equal(parsed.workId, 'add-retry-logic');
});

test('CLI — missing work dir exits non-zero with helpful error', () => {
  assert.throws(
    () => execFileSync('node', [CLI, '--work-dir', '/tmp/does-not-exist-9999'], { encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'] }),
    /state\.json/,
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/receipt-cli.test.js 2>&1 | tail -15`
Expected: ENOENT for the CLI script.

- [ ] **Step 3: Write the CLI implementation**

```javascript
#!/usr/bin/env node
// scripts/render-receipt.cjs
const fs = require('node:fs');
const path = require('node:path');
const { extractReceipt } = require('./lib/receipt/extract.cjs');
const { formatMarkdown, formatJson } = require('./lib/receipt/format.cjs');

function parseArgs(argv) {
  const args = { format: 'markdown', workDir: null, workId: null, output: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--work-dir' || a === '-w') args.workDir = argv[++i];
    else if (a.startsWith('--work-dir=')) args.workDir = a.slice('--work-dir='.length);
    else if (a === '--format' || a === '-f') args.format = argv[++i];
    else if (a.startsWith('--format=')) args.format = a.slice('--format='.length);
    else if (a === '--output' || a === '-o') args.output = argv[++i];
    else if (a.startsWith('--output=')) args.output = a.slice('--output='.length);
    else if (!args.workId && !a.startsWith('-')) args.workId = a;
  }
  return args;
}

function resolveWorkDir(args, cwd) {
  if (args.workDir) return path.resolve(args.workDir);
  const worklogsDir = path.join(cwd, '.worklogs');
  if (!fs.existsSync(worklogsDir)) {
    throw new Error(`.worklogs/ not found at ${worklogsDir} — pass --work-dir to specify a path`);
  }
  const entries = fs.readdirSync(worklogsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join(worklogsDir, e.name));
  if (args.workId) {
    const match = entries.find((d) => path.basename(d) === args.workId);
    if (!match) throw new Error(`work-id ${args.workId} not found in ${worklogsDir}`);
    return match;
  }
  if (entries.length === 0) throw new Error(`no work items in ${worklogsDir}`);
  // newest by mtime
  return entries.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
}

function main() {
  const args = parseArgs(process.argv);
  const workDir = resolveWorkDir(args, process.cwd());
  const data = extractReceipt(workDir);
  const out = args.format === 'json' ? formatJson(data) : formatMarkdown(data);
  if (args.output) {
    fs.writeFileSync(args.output, out);
    process.stderr.write(`receipt written to ${args.output}\n`);
  } else {
    process.stdout.write(out);
    if (args.format !== 'json') process.stdout.write('\n');
  }
}

if (require.main === module) {
  try { main(); } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  }
}

module.exports = { parseArgs, resolveWorkDir, main };
```

- [ ] **Step 4: Make it executable and verify tests pass**

```bash
chmod +x scripts/render-receipt.cjs
node --test test/receipt-cli.test.js 2>&1 | tail -15
```

Expected: `# pass 3 # fail 0`.

- [ ] **Step 5: Smoke-test against the fixture by hand**

Run: `node scripts/render-receipt.cjs --work-dir test/fixtures/receipt/lean-happy`
Expected: a clean markdown receipt printed to stdout matching the spec's §3.1 example shape.

- [ ] **Step 6: Commit**

```bash
git add scripts/render-receipt.cjs test/receipt-cli.test.js
git commit -m "feat(receipt): CLI shim — node scripts/render-receipt.cjs

Co-Authored-By: Claude Sonnet 4.6 (1M context) <noreply@anthropic.com>"
```

### Task 5: Slash command — `/receipt`

**Files:**
- Create: `commands/receipt.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Create the slash command prompt**

```markdown
# /receipt

Render a completed work item as a shareable markdown summary — drop into a PR description, Slack message, or compliance ticket.

## Usage

```
/receipt                       # newest work item under .worklogs/
/receipt <work-id>             # specific work item
/receipt <work-id> --format=json
/receipt <work-id> --output=receipt.md
```

## Behavior

1. Resolve the work directory:
   - If `<work-id>` given: `.worklogs/<work-id>/`
   - Else: newest directory under `.worklogs/` by mtime
2. Read `state.json`, `audit.log`, and `pr-link.txt` (if present).
3. Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/render-receipt.cjs --work-dir <resolved> --format=<markdown|json>`.
4. If `--output=<path>` was passed, the script writes to that path; otherwise print to chat.

## Constraints

- Read-only over `.worklogs/<id>/`. No state mutation.
- No LLM call required — pure deterministic rendering.
- Output is suitable for embedding in PR descriptions or compliance attachments.

## When to use

- After a `/work` invocation completes (`current_state == "completed"`)
- Sharing a worked-through decision with a reviewer or compliance partner
- Spot-checking budget burn or human-gate respect across a finished work item
```

- [ ] **Step 2: Add `/receipt` to CLAUDE.md tables**

In `CLAUDE.md`, in the **Utility skills** table (after `/swe-tui`), add:

```
| `/receipt` | Render a completed work item as shareable markdown / JSON | post-`completed`, PR description, audit attachment |
```

And in the **Common operations** table, add:

```
| Render a completed work receipt | **`/receipt`** or **`node scripts/render-receipt.cjs --work-dir .worklogs/<id>`** |
```

- [ ] **Step 3: Commit**

```bash
git add commands/receipt.md CLAUDE.md
git commit -m "feat(receipt): /receipt slash command + CLAUDE.md wiring

Co-Authored-By: Claude Sonnet 4.6 (1M context) <noreply@anthropic.com>"
```

### Task 6: Wire `agentic-swe receipt …` into the npm bin

**Files:**
- Modify: `bin/agentic-swe.cjs`

- [ ] **Step 1: Read the current bin**

Run: `cat bin/agentic-swe.cjs`
Note the subcommand dispatch shape.

- [ ] **Step 2: Add a `receipt` subcommand that re-execs the script**

Replace the appropriate dispatch block to handle `receipt`:

```javascript
// somewhere in the subcommand switch:
if (sub === 'receipt') {
  const script = require('path').join(__dirname, '..', 'scripts', 'render-receipt.cjs');
  const { spawnSync } = require('child_process');
  const res = spawnSync(process.execPath, [script, ...process.argv.slice(3)], { stdio: 'inherit' });
  process.exit(res.status == null ? 1 : res.status);
}
```

(Exact placement depends on the existing dispatch; keep the change minimal — one block.)

- [ ] **Step 3: Smoke test**

```bash
node bin/agentic-swe.cjs receipt --work-dir test/fixtures/receipt/lean-happy | head -20
```

Expected: receipt markdown printed.

- [ ] **Step 4: Commit**

```bash
git add bin/agentic-swe.cjs
git commit -m "feat(receipt): expose 'agentic-swe receipt' via npm bin

Co-Authored-By: Claude Sonnet 4.6 (1M context) <noreply@anthropic.com>"
```

### Task 7: Static sample receipt for docs embed

**Files:**
- Create: `docs/assets/sample-receipt.md`

- [ ] **Step 1: Generate the sample**

```bash
node scripts/render-receipt.cjs --work-dir test/fixtures/receipt/lean-happy --output docs/assets/sample-receipt.md
cat docs/assets/sample-receipt.md
```

Verify the file is the expected markdown.

- [ ] **Step 2: Commit**

```bash
git add docs/assets/sample-receipt.md
git commit -m "docs(receipt): committed sample receipt rendering for README embed

Co-Authored-By: Claude Sonnet 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Phase 2 — README rewrite

### Task 8: Replace README first viewport

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Read the current README**

Run: `wc -l README.md && head -100 README.md`
Confirm current structure to keep below-the-fold sections intact.

- [ ] **Step 2: Replace lines 1-60 with the new opening**

Use Edit tool with:

```markdown
<h1 align="center">Agentic SWE</h1>

<p align="center"><strong>Claude codes your PRs. You review the receipt. Then merge.</strong></p>

<p align="center">
An open-source autonomous SWE pipeline that runs in your editor or CI, writes every decision into your repo, and gives you a shareable audit trail of what the AI did and why.
</p>

<p align="center">
  <a href="docs/assets/receipt-demo.cast"><img src="docs/assets/receipt-demo.gif" alt="demo" width="720"/></a>
</p>

<p align="center">
  <a href="https://github.com/agentic-swe/agentic-swe/actions/workflows/ci.yml"><img src="https://github.com/agentic-swe/agentic-swe/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT" /></a>
  <a href="CHANGELOG.md"><img src="https://img.shields.io/badge/version-3.2.0-orange.svg" alt="Version" /></a>
  <a href="#subagents"><img src="https://img.shields.io/badge/subagents-135%2B-purple.svg" alt="Agents" /></a>
</p>

---

## Install (Claude Code)

```text
/plugin marketplace add agentic-swe/agentic-swe
/plugin install agentic-swe@agentic-swe-catalog
```

Then in any repo:

```text
/work Add retry logic to the API client
```

That's it. When the work item is done, run `/receipt` to get a shareable summary of what the AI did, why, and what it cost.

## What you get

- **Structured PRs** — each `/work` runs a state machine (lean / standard / rigorous), writes evidence as it goes, and stops at a human gate before merge.
- **Cost-attributed decisions** — every transition records cost, model, and rationale in `.worklogs/<id>/`.
- **A portable audit trail** — `/receipt` renders the whole thing as a markdown summary you can drop in a PR description, send to a reviewer, or hand to your compliance team. Read the [NIST/OWASP control mapping](docs/compliance-mapping.md).
- **135+ specialist subagents** — auto-selected from repo signals.
- **No cloud runtime** — pure markdown in your repo.

**~15 minutes:** [Golden path](https://agentic-swe.github.io/agentic-swe-site/docs/golden-path) · **Other hosts** (Cursor, Codex, OpenCode, Gemini): see the [Advanced install](#advanced-install) section below.

---

```

Keep the existing pipeline diagram, subagent table, repo layout, and architecture sections after this new top. Move the existing detailed install dropdowns into a single `## Advanced install` collapsible section below the architecture diagram.

- [ ] **Step 3: Verify the README still has all existing content**

Run: `wc -l README.md && grep -c "## " README.md`
Compare to the original count; new headline should add ~30 lines and the section count should be the same or +1 (for the new `## What you get`).

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs(readme): rewrite first viewport for The Receipt positioning

Co-Authored-By: Claude Sonnet 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Phase 3 — Compliance mapping doc

### Task 9: NIST AI RMF + OWASP Agentic Top 10 mapping

**Files:**
- Create: `docs/compliance-mapping.md`

- [ ] **Step 1: Write the mapping doc**

```markdown
# Compliance mapping — NIST AI RMF · OWASP Agentic Top 10 · EU AI Act

> **Status:** Reference doc, not a compliance certification. Maps `.worklogs/` artifacts to common AI governance controls so your security / legal team can see what evidence agentic-swe already produces.

## NIST AI RMF 1.0

| Function | Control reference | What agentic-swe produces |
|----------|-------------------|---------------------------|
| Govern (1.5) | Roles and responsibilities defined | `audit.log` — every transition has an `actor` field (`hypervisor`, `developer`, `panel-architect`, `user`, etc.) |
| Map (2.1) | Context categorized | `feasibility.md` — task scope, complexity, ambiguity rating |
| Map (2.2) | Risk identified | `design-panel-review.md` (rigorous) or `design.md` risks section |
| Measure (3.3) | Tracking of AI system characteristics | `state.json.budget` — cost_used, token usage, iteration counts |
| Measure (3.4) | Feedback from end-users | `audit.log` — every human-gate resolution recorded |
| Measure (3.7) | Documentation of decisions | `state.json.history[]` — from/to/reason/evidence_refs per transition |
| Manage (4.1) | Risks prioritized and acted on | `reflection-log.md` (when rejected); `escalate-*` states with documented escalation reason |

## OWASP Agentic Top 10 (December 2025)

| Risk | Mitigation in agentic-swe |
|------|----------------------------|
| AAI-1 Goal hijacking | Human gates (`ambiguity-wait`, `approval-wait`); explicit task field in `state.json` |
| AAI-2 Tool misuse | `permissions-check` phase (rigorous); allowed-tools list per agent file |
| AAI-3 Identity abuse | `audit.log` actor attribution; signed transitions (v2 — see roadmap) |
| AAI-4 Insecure output | Cross-model panel review (`agents/panel/cross-model-reviewer.md`) on rigorous track |
| AAI-5 Prompt injection | Context Pack with trust levels; untrusted-content quarantine (`references/context-engineering.md`) |
| AAI-6 Tool override | Policy-as-Code banned-tools list (`schemas/agentic-swe-policy.schema.json`) |
| AAI-7 Unauthorized actions | Human gate at PR creation; no auto-merge |
| AAI-8 Loop / runaway | Bounded loop counters (`state.json.counters.*`); escalation states |
| AAI-9 Resource exhaustion | Budget tracking with hard ceilings (`budget.cost_budget_usd`, `budget.iteration_budget`) |
| AAI-10 Audit trail loss | `.worklogs/<id>/` committed in repo; replayable snapshots (`scripts/lib/replay/`) |

## EU AI Act (high-risk AI systems, effective August 2026)

| Article | Requirement | Evidence |
|---------|-------------|----------|
| 14 (Human oversight) | Effective oversight by natural persons | `approval-wait` state, `audit.log` user attribution |
| 15 (Accuracy / robustness / cybersecurity) | Logging of operation | `state.json.history`, `audit.log`, cost ledger |
| 12 (Record-keeping) | Automatic logs of system events | `.worklogs/<id>/` per work item — append-only `audit.log` |

> EU AI Act Article 13 (transparency) and Article 50 (general-purpose AI obligations) require *disclosure* — agentic-swe's role is to produce the evidence; the disclosure happens at your product / service surface.

## How to generate evidence for an audit

For a single work item:

```bash
node scripts/render-receipt.cjs --work-dir .worklogs/<id> --format=markdown --output receipt.md
```

For an audit of a time window across many work items, walk `.worklogs/` and run `/receipt` per directory. Each receipt is self-contained and includes the `audit.log` entry count, decision count, cost, and human-gate resolutions.

## What this doc is not

- Not a SOC 2 / ISO 27001 / HIPAA certification — those require an auditor.
- Not legal advice. Talk to counsel about your specific obligations.
- Not exhaustive — the agentic-swe project will keep expanding this map as standards evolve.
```

- [ ] **Step 2: Commit**

```bash
git add docs/compliance-mapping.md
git commit -m "docs(compliance): NIST AI RMF + OWASP Agentic Top 10 + EU AI Act mapping

Co-Authored-By: Claude Sonnet 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Phase 4 — Demo recording

### Task 10: Record the asciinema demo

**Files:**
- Create: `docs/assets/receipt-demo.cast`
- Create: `docs/assets/receipt-demo.gif`

- [ ] **Step 1: Verify asciinema is installed**

Run: `which asciinema || brew install asciinema`
Expected: a path printed, or brew install succeeds.

- [ ] **Step 2: Record the demo**

```bash
asciinema rec docs/assets/receipt-demo.cast --title "agentic-swe /receipt demo" --idle-time-limit 2
```

In the recording, execute these commands in order (each one waits for the prior to finish; pause briefly between them so the cast is readable):

```bash
clear
echo "agentic-swe — /work to /receipt in 30 seconds"
echo
ls .worklogs/
cat .worklogs/tui-mascot-sf-agents/state.json | head -10
echo
echo "After /work completes, render the receipt:"
echo
node scripts/render-receipt.cjs --work-dir test/fixtures/receipt/lean-happy
```

Then exit the recording: `exit` or Ctrl-D.

- [ ] **Step 3: Convert cast to GIF for embed**

If `agg` is available:
```bash
agg docs/assets/receipt-demo.cast docs/assets/receipt-demo.gif
```

If not, use the `asciinema upload` URL as a fallback and link to the cast file in the README instead of embedding a GIF. Note that as a TODO in the launch checklist below.

- [ ] **Step 4: Commit**

```bash
git add docs/assets/receipt-demo.cast
[ -f docs/assets/receipt-demo.gif ] && git add docs/assets/receipt-demo.gif
git commit -m "docs(assets): record /receipt demo with asciinema

Co-Authored-By: Claude Sonnet 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Phase 5 — Launch artifacts (Week 1-2)

### Task 11: Internal launch checklist + draft posts

**Files:**
- Create: `docs/launch-week-1.md`

- [ ] **Step 1: Write the launch checklist with drafts**

```markdown
# Launch checklist — Weeks 1-2

**Source spec:** `docs/specs/positioning-and-receipt.md`

## Pre-launch verification

- [ ] All Phase 0 bug fixes are merged to `main`
- [ ] `/receipt` works against a real `.worklogs/` directory (tested with `tui-mascot-sf-agents/`)
- [ ] README first viewport renders correctly on github.com
- [ ] `docs/compliance-mapping.md` is linked from the new README
- [ ] Asciinema cast plays in the embedded README link
- [ ] LinkedIn post draft below has been peer-reviewed by at least 1 person
- [ ] Twitter thread draft below has been peer-reviewed by at least 1 person

## LinkedIn long-form (P0 ICP — eng leads + compliance)

**Headline:** "I built the AI coding audit trail Devin can't ship"

**Draft:**

> Every AI coding tool — Devin, Cursor, Copilot, Claude Code — has the same problem when the work matters:
>
> Your eng lead doesn't know what the AI decided, why, or what it cost.
>
> So I built agentic-swe: an open-source pipeline that wraps Claude Code with a state machine, evidence artifacts, and human gates. Every decision lands in your repo as `state.json` + `audit.log` + a phase-by-phase markdown trail.
>
> Then I added `/receipt` — one command that renders the whole thing as a shareable markdown summary. Drop it in your PR description, send it to your compliance partner, or paste it in a code review.
>
> Here's what a finished work item looks like:
>
> [embed: sample receipt screenshot]
>
> EU AI Act Article 14 (human oversight) and Article 15 (logging) go into effect August 2026. NIST published their AI Agent Standards initiative in February. If you're going to ship AI-generated code at a regulated company, you'll need to show your work.
>
> agentic-swe was already doing this. `/receipt` is the screenshot.
>
> Free, open source, MIT. Plugin install in Claude Code — link in comments.

**Asset:** screenshot of `docs/assets/sample-receipt.md` rendered on github.com.

## Twitter / X thread (P1 ICP — solo devs)

1. New: agentic-swe just shipped /receipt — a portable, shareable audit trail for every AI coding session. 🧵
2. The problem: AI ships code, you ship the PR — but nobody can tell what the AI decided, why, or what it cost. 1 week later it's a black box.
3. The fix: every transition in agentic-swe writes state.json + audit.log + evidence into .worklogs/<id>/ in YOUR repo. No cloud, no lock-in.
4. /receipt renders it as a markdown summary — drop into PR descriptions, Slack, or your compliance ticket: [embed: cast]
5. Plus: state machine (lean / standard / rigorous tracks), 135+ specialist subagents auto-selected per task, Doubt-Driven Verification, cross-model panel review.
6. EU AI Act ships Aug 2026. NIST AI Agent Standards launched Feb 2026. You're going to need this.
7. OSS / MIT / Claude Code plugin: github.com/agentic-swe/agentic-swe — first PR in this thread 👇

**Asset:** the asciinema cast (link or GIF inline).

## dev.to article outline

**Title:** "Ship a feature with Claude in 15 minutes — with a receipt"

**Sections (write Week 2):**
1. The problem — context-switch tax + AI code with no provenance
2. What agentic-swe is — pipeline + tracks + subagents + audit (skim)
3. Walk-through — `/work add retry logic`, watch state bar, gate at PR, `/receipt` at end
4. The receipt — what's in it, why it matters (NIST/OWASP context)
5. Try it — copy-paste install, links to spec + compliance mapping

## Cold DM list (P1 ICP — 10 Claude Code power users)

Find via: Twitter searches for "claude code" + power users; GitHub stars on related repos; Anthropic's Discord.

**DM template:**

> Hi [name] — saw your [X post / GitHub repo / blog]. Built something that might save you hours each week if you use Claude Code: an OSS pipeline that gives every /work session a portable audit trail you can drop into a PR description. 30-second demo: [cast link]. Curious if you'd find it useful — happy to do a quick walkthrough.

## Show HN

**Title:** "Show HN: Agentic SWE — autonomous Claude Code pipeline with a portable audit trail"

**Body (Week 4):**

> Hi HN — I'm Suraj, and I just shipped agentic-swe v3.3 with /receipt. It's an OSS pipeline that wraps Claude Code in a state machine, evidence artifacts, and human gates — so every AI coding session produces a shareable audit trail in your own repo.
>
> The killer feature is /receipt: one command that renders state.json + audit.log + phase artifacts as a markdown summary. Drop it in your PR description, send it to your compliance team, etc.
>
> Why now: EU AI Act Article 14/15 hits Aug 2026, NIST AI Agent Standards launched Feb 2026. Every team running AI-generated code into prod will need this.
>
> Free, MIT, no cloud runtime. Plugin install in Claude Code (or npm bin for any host).
>
> Repo: [link] · Spec: [link] · Compliance mapping: [link] · 30-sec demo: [cast link]

## Open follow-ups

- [ ] Replace GIF with a real Loom if asciinema-to-GIF conversion is rough
- [ ] Email Anthropic devrel about a "Built with Claude Code" feature
- [ ] CFP for AI Engineer Summit + KubeCon governance track (Week 5)
- [ ] First case study writeup (Week 6, after a design partner uses it)
```

- [ ] **Step 2: Commit**

```bash
git add docs/launch-week-1.md
git commit -m "docs(launch): week 1-2 launch checklist with draft posts

Co-Authored-By: Claude Sonnet 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Phase 6 — Final integration

### Task 12: CHANGELOG entry + full test pass + release tag

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add CHANGELOG entry**

Prepend to `CHANGELOG.md` under the current unreleased section (create one if absent):

```markdown
## [Unreleased]

### Added
- `/receipt` command — render a completed work item as shareable markdown / JSON
- `docs/compliance-mapping.md` — NIST AI RMF + OWASP Agentic Top 10 + EU AI Act mapping
- `docs/assets/receipt-demo.cast` — asciinema demo of `/work` → `/receipt`
- `docs/launch-week-1.md` — internal launch checklist
- Starter tasks under `bench/tasks/` (lean/standard/rigorous coverage)

### Changed
- README first viewport — new headline ("Claude codes your PRs. You review the receipt."), demo embed, install simplification

### Fixed
- `hooks/hooks.json` — SessionStart matcher now includes `resume` source (was: `startup|clear|compact`, now: `startup|resume|clear|compact`). Previously, Hypervisor policy injection was skipped on every resumed Claude Code session.
- `scripts/lib/work-engine/artifacts.cjs` — `requiredArtifactGroups` is now keyed on the source state, matching CLAUDE.md's "Required Artifacts by State" semantics. Previously, the destination-state lookup blocked every legitimate transition (e.g. `validation → pr-creation` required `pr-link.txt` to pre-exist).
- `bench/tasks/` — seeded with starter tasks; `scripts/bench/run.cjs` is now runnable end-to-end.
```

- [ ] **Step 2: Run the full test suite one more time**

Run: `npm test 2>&1 | tail -20`
Expected: `# fail 0`, exit code 0. New test count = original (378) + 7 (extract) + 6 (format) + 3 (CLI) + Bug-3-additions = roughly 394+.

- [ ] **Step 3: Run lint / verify**

Run: `npm run verify` (if it exists; else skip)
Expected: green.

- [ ] **Step 4: Commit CHANGELOG**

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): unreleased — /receipt, README rewrite, 3 bug fixes

Co-Authored-By: Claude Sonnet 4.6 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 5: Tag (do NOT push)**

```bash
git log --oneline | head -15
# Confirm the commit sequence matches expected: bug fixes, fixture, extract, format, CLI, slash command, bin, sample, readme, compliance, asciinema, launch, changelog.
```

DO NOT push or tag yet. Leave that to a release decision after a human review of the README rendering and the asciinema cast on a real machine.

---

## Self-review

**Spec coverage:** Every section of `docs/specs/positioning-and-receipt.md` is covered.

- §1 problem → Phase 0 bug fixes (Task 0)
- §2 thesis → embedded in marketing copy across Tasks 8, 11
- §3.1 `/receipt` v1 → Tasks 1-7
- §3.2 README rewrite → Task 8
- §3.3 NIST/OWASP mapping → Task 9
- §3.4 bug fixes → Task 0
- §4 marketing motions Week 1-2 → Tasks 10, 11 (Weeks 3-6 are intentionally out of plan scope; surface via the launch checklist)
- §5 bug-fix status → Task 0
- §6 metrics → Open follow-ups in Task 11 (no implementation needed beyond surfacing the metrics dashboard, which is its own future plan)
- §7 out of scope → respected (no SaaS, no OWAI standards push, no signed receipts)
- §8 open questions → flagged for human resolution; format=markdown chosen as default for v1 (Q1); asciinema chosen for v1 with GIF fallback (Q2); install simplification not in scope for v1 (Q3); design partners and cron persistence are external workflow items (Q4, Q5)

**Placeholder scan:** No "TBD" / "TODO" / "fill in details" in any task. Every code block is complete and the engineer can paste-and-run.

**Type consistency:** `extractReceipt` returns the shape used by `formatMarkdown` and `formatJson` — both consume `workId`, `task`, `track`, `status`, `costUsd`, `prUrl`, `durationSeconds`, `decisions`, `humanGates`, `counters`, `workDir`, `auditEntryCount`. Spot-checked: every property accessed in Tasks 3-4 is set in Task 2.

**Cost gut-check:** Total estimated effort — 6-10 hours of focused work, dominated by README rewrite (~2 hrs to do well) and asciinema recording (~1 hr including retakes). The TDD-based /receipt code is shorter than the test code in lines.
