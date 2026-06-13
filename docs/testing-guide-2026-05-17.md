# Testing guide — PRs #60, #61, #62 (merged 2026-05-17)

This guide walks through every feature, fix, and asset shipped across the three merged PRs so you can spot-check them on a fresh clone or your existing checkout.

**Prereqs**

```bash
git pull origin main
npm install
```

Quick global sanity (covers the test plan from all three PRs at once):

```bash
npm run ci      # = npm run verify && npm run version:check && npm test
```

Expected: `verify-sanity: OK (21 phases, 22 commands)` · `catalog-lint: OK (138 agents)` · `# pass 405` · exit 0.

If `npm run ci` is green you can skip to the **Manual / visual checks** section. The detailed sections below let you isolate any one feature.

---

## What was shipped

| PR | Title | Theme |
|---|---|---|
| [#60](https://github.com/agentic-swe/agentic-swe/pull/60) | OWAI schema + missing default policy + CLI parsing + CLAUDE.md gaps | Bug fixes uncovered by DDV review of #57 |
| [#61](https://github.com/agentic-swe/agentic-swe/pull/61) | TUI mascot cockpit + 3 Salesforce platform subagents | New surface + catalog growth |
| [#62](https://github.com/agentic-swe/agentic-swe/pull/62) | `/receipt` v1 + README rewrite + compliance map + 3 silent-failure bug fixes | The Receipt positioning |

---

## PR #60 — DDV-found bug fixes

### 60.1 OWAI conformance accepts both `at` and `timestamp`

`schemas/owai/state.schema.json` used to require `timestamp` while the work engine writes `at`. Conformance failed on every real worklog.

```bash
# Use a real worklog that has all OWAI L3 required files (progress.md etc.)
node scripts/owai-conformance.cjs .worklogs/phase-3-orchestration --level L3
```

Expected: `OWAI L3 conformance: PASS`. Before this fix the same command failed with 11 errors about missing `timestamp` fields in history entries.

> The `test/fixtures/receipt/lean-happy/` fixture intentionally omits `progress.md`, so it will fail L3 on the "Missing required file" check — that's expected and unrelated to this fix. Use any directory under `.worklogs/`.

### 60.2 `--level L3` (space-separated) now works

The argparser silently fell back to L1 for space-separated form.

```bash
# Both forms should produce the same result
node scripts/owai-conformance.cjs .worklogs/phase-3-orchestration --level=L3
node scripts/owai-conformance.cjs .worklogs/phase-3-orchestration --level L3
```

Expected: identical output for both, both reporting L3 (not L1).

### 60.3 `config/default-policy.json` exists

`scripts/lib/policy/merge.cjs` referenced this as the pack default but the file didn't exist.

```bash
cat config/default-policy.json
node -e "JSON.parse(require('fs').readFileSync('config/default-policy.json','utf8')); console.log('valid JSON')"
```

Expected: minimal valid policy with `version: "1.0"` and empty arrays/objects; `valid JSON` printed.

### 60.4 `/doubt`, `/policy`, `/swe-tui` registered in CLAUDE.md

```bash
grep -E "^\| \`/(doubt|policy|swe-tui|receipt)\`" CLAUDE.md
```

Expected: four rows printed (one each), all inside the Utility skills table.

---

## PR #61 — TUI mascot cockpit + Salesforce subagents

### 61.1 TUI server — non-TTY pipe mode

The cleanest non-interactive smoke. Pipe mode produces plain ASCII (no escape codes, no mascot).

```bash
node scripts/swe-tui-server.cjs --work-dir test/fixtures/receipt/lean-happy | head -30
```

Expected: a state bar with the work ID `add-retry-logic`, status `completed`, track `lean`, a budget bar, and a "Recent transitions" panel. No ANSI escape codes.

### 61.2 TUI server — multi-item mode

Walk all worklogs the repo currently has (CI doesn't need `.worklogs/` to exist; only run this if you have some):

```bash
ls .worklogs/ 2>/dev/null && node scripts/swe-tui-server.cjs --all --cwd "$PWD" | head -40
```

Expected: side-by-side columns on a wide terminal (≥120 cols), stacked otherwise. Each block shows the state bar.

### 61.3 TUI server — interactive (mascot + colors)

This one needs your eyeball:

```bash
node scripts/swe-tui-server.cjs --work-dir test/fixtures/receipt/lean-happy --interactive
```

Expected:
- ASCII mascot at the top
- Color-coded state (terminal colors)
- Live updates if you `touch test/fixtures/receipt/lean-happy/state.json` in another shell
- `q` or Ctrl-C exits cleanly

### 61.4 TUI unit tests (the 5 new ones)

```bash
node --test test/swe-tui-server.test.js 2>&1 | tail -10
```

Expected: `# pass 5 # fail 0` (`formatBudgetBar`, `discoverWorkDir`, `discoverAllWorkDirs`, `renderWorkItem`, `chooseLayout`).

### 61.5 Salesforce subagents are present and lint-clean

```bash
ls agents/subagents/specialized-domains/salesforce-*.md
npm run catalog:lint 2>&1 | tail -3
```

Expected: three files (`salesforce-developer`, `salesforce-headless`, `salesforce-agentforce`); catalog-lint reports `138 agents` with no errors.

### 61.6 Salesforce subagents — manual invocation

These are model-routed (Opus for `developer` + `agentforce`, Sonnet for `headless`). Invoke from any Claude Code session against a Salesforce repo:

```text
/subagent invoke specialized-domains/salesforce-developer
/subagent invoke specialized-domains/salesforce-headless
/subagent invoke specialized-domains/salesforce-agentforce
```

Or via the Agent tool inline:

```
Agent(prompt="${CLAUDE_PLUGIN_ROOT}/agents/subagents/specialized-domains/salesforce-developer.md", description="Apex code review")
```

**Eyeball check:** each agent file should mention its specific surface area (Apex/LWC for `developer`, SCAPI/PWA Kit for `headless`, Agent Builder for `agentforce`).

---

## PR #62 — `/receipt` v1 + README rewrite + compliance map

### 62.1 `/receipt` against the fixture (markdown)

```bash
node scripts/render-receipt.cjs --work-dir test/fixtures/receipt/lean-happy
```

Expected: clean markdown receipt with headline `# /work add-retry-logic — Add retry logic to the API client`, a 7-row meta table (Work ID / Track / Status / Duration / Cost / PR), a numbered "Decisions made (6)" section, a "Human gates respected (1)" section, "Loop counters", and "Verifiable references" with a **relative** path (not your absolute home dir).

### 62.2 `/receipt` JSON output

```bash
node scripts/render-receipt.cjs --work-dir test/fixtures/receipt/lean-happy --format json | python3 -m json.tool | head -20
```

Expected: valid JSON with `workId: "add-retry-logic"`, `costUsd: 1.84`, `track: "lean"`, `auditEntryCount: 9`.

### 62.3 `/receipt` write-to-file

```bash
tmp=$(mktemp -d)
node scripts/render-receipt.cjs --work-dir test/fixtures/receipt/lean-happy --output "$tmp/receipt.md"
wc -l "$tmp/receipt.md"
rm -rf "$tmp"
```

Expected: `receipt written to /tmp/.../receipt.md` on stderr; the file is ~30 lines of markdown.

### 62.4 `/receipt` via npm bin

```bash
node bin/agentic-swe.cjs receipt --work-dir test/fixtures/receipt/lean-happy | head -8
node bin/agentic-swe.cjs help | grep receipt
```

Expected: same markdown as 62.1; the `help` line shows `agentic-swe receipt [args]`.

### 62.5 `/receipt` slash command (in Claude Code)

```text
/receipt
/receipt add-retry-logic
/receipt add-retry-logic --format=json
```

Expected: same content as 62.1–62.2. Bare `/receipt` picks the newest non-completed (or most recent completed) work item under `.worklogs/`.

### 62.6 `/receipt` negative cases

```bash
# Missing work dir
node scripts/render-receipt.cjs --work-dir /tmp/does-not-exist-9999 2>&1; echo "exit=$?"
```

Expected: `Error: state.json not found at ...` on stderr; `exit=1`.

### 62.7 Receipt unit + integration tests

```bash
node --test test/receipt-extract.test.js test/receipt-format.test.js test/receipt-cli.test.js 2>&1 | tail -10
```

Expected: `# pass 16 # fail 0` (7 extract + 6 format + 3 CLI).

### 62.8 Bug-fix regression: SessionStart matcher includes `resume`

```bash
grep -A1 '"SessionStart"' hooks/hooks.json | head -3
```

Expected: a matcher line containing `"startup|resume|clear|compact"` (NOT `"startup|clear|compact"`).

### 62.9 Bug-fix regression: artifact-direction (lean-track smoke)

This is the end-to-end test that proves the artifact enforcement no longer blocks legitimate transitions. It exercises `initialized → feasibility → … → completed` on a synthetic worklog:

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

Expected: every line prints `OK ->`. **No `FAIL`** lines.

### 62.10 Bug-fix regression: bench tasks seeded

```bash
ls bench/tasks/
ls bench/tasks/01-off-by-one/ bench/tasks/02-add-retry/ bench/tasks/03-rate-limiter/
node scripts/bench/run.cjs --help 2>&1 | head -5 || node scripts/bench/run.cjs 2>&1 | head -5
```

Expected: three directories, each containing `task.json` (+ `repo/`, `expected/`, `scoring.json`). The bench runner produces non-empty output (no "no tasks found").

---

## Manual / visual checks

These can't be scripted; spend ~5 minutes on each.

### M.1 README first viewport on github.com

Open https://github.com/agentic-swe/agentic-swe and check the rendered README:

- Headline reads **"Claude codes your PRs. You review the receipt. Then merge."** (no `Hypervisor policy · Pure markdown · No cloud runtime`)
- Badge row renders all six badges
- Quickstart block is two lines: `npm install -g @agentic-swe/agentic-swe` + `claude --plugin-dir "$(agentic-swe path)"`
- "What `/receipt` looks like" section embeds the sample receipt inline (table + decisions + counters + references)
- All anchor links resolve (`#install--first-run`, `#subagents`)

### M.2 Sample receipt content

```bash
cat docs/assets/sample-receipt.md
```

Spot-check: no absolute paths leaking (paths should start with `test/fixtures/...`), USD figures are `$X.XX` format, no NaN, no `undefined`.

### M.3 Compliance map renders coherently

```bash
cat docs/compliance-mapping.md
```

Spot-check:
- Three top-level tables (NIST AI RMF, OWASP Agentic Top 10, EU AI Act)
- Each citation points to a real `.worklogs/` artifact or pack file
- The "What this doc is not" disclaimers are present (NOT a SOC 2 / ISO cert / legal advice)

### M.4 Launch artifacts ready for review

```bash
cat docs/launch-week-1.md
```

Read the LinkedIn long-form, the Twitter thread, the Show HN body. Decide which (if any) you want to actually post. The metrics table at the bottom is your tracking baseline for the 90-day push.

### M.5 Asciinema demo (Task 10 — outstanding)

Not shipped in #62. Recipe lives at `docs/plans/2026-05-17-positioning-and-receipt.md:993-1049`. When you're ready:

```bash
brew install asciinema  # if needed
asciinema rec docs/assets/receipt-demo.cast --title "agentic-swe /receipt demo" --idle-time-limit 2
# ...run the demo commands from the plan...
# Ctrl-D to stop
agg docs/assets/receipt-demo.cast docs/assets/receipt-demo.gif  # if agg is installed
```

Then update README to embed the cast/GIF.

---

## All-in-one smoke (for CI or a quick sanity loop)

```bash
npm run ci \
  && node scripts/render-receipt.cjs --work-dir test/fixtures/receipt/lean-happy > /dev/null \
  && (node scripts/swe-tui-server.cjs --work-dir test/fixtures/receipt/lean-happy 2>/dev/null | head -1 > /dev/null) \
  && node scripts/owai-conformance.cjs .worklogs/phase-3-orchestration --level L3 > /dev/null \
  && node bin/agentic-swe.cjs receipt --work-dir test/fixtures/receipt/lean-happy > /dev/null \
  && echo "ALL GREEN"
```

Expected final line: `ALL GREEN`.

> Note: `swe-tui-server.cjs` keeps a `fs.watch` + 2s poll loop running and never exits on its own — the `| head -1 > /dev/null` triggers SIGPIPE on the next render so the smoke can move on. The `2>/dev/null` swallows a cosmetic EPIPE stack trace the TUI emits before it dies (the server doesn't currently handle EPIPE on stdout — minor follow-up). If you run `node scripts/swe-tui-server.cjs ...` directly, exit with Ctrl-C.

---

## References

- Spec: [`docs/specs/positioning-and-receipt.md`](specs/positioning-and-receipt.md)
- Plan: [`docs/plans/2026-05-17-positioning-and-receipt.md`](plans/2026-05-17-positioning-and-receipt.md)
- OWAI spec: [`docs/specs/owai-1.0.md`](specs/owai-1.0.md)
- Compliance map: [`docs/compliance-mapping.md`](compliance-mapping.md)
- Launch checklist: [`docs/launch-week-1.md`](launch-week-1.md)
