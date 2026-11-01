# Policy-as-Code (PaC)

Organizations and repositories can publish typed policy files that merge with pack defaults, enforcing engineering standards through the pipeline rather than through documentation alone.

## How It Works

1. **Pack default**: `config/default-policy.json` ships with agentic-swe
2. **Repo policy**: `.agentic-swe/policy.json` in the target repository
3. **Org policy**: pointed to by `AGENTIC_SWE_POLICY` environment variable

Policies merge with precedence: **org > repo > pack default**.

## Policy Schema

See `${CLAUDE_PLUGIN_ROOT}/schemas/agentic-swe-policy.schema.json`.

### Track Rules

Force a minimum track for work that touches matching paths:

```json
{
  "track_rules": [
    { "pattern": "src/auth/**", "minimum_track": "rigorous", "reason": "Auth changes require full governance" },
    { "pattern": "*.sql", "minimum_track": "standard", "reason": "Schema changes need design review" }
  ]
}
```

The work engine checks these when leaving `lean-track-check` and on any later `--set-pipeline-track` (including a waived downgrade). A track below the highest matching minimum fails with `TRACK_POLICY`. When rules exist and no changed paths are known, a `lean` or `standard` track fails with `POLICY_PATHS_REQUIRED`; `rigorous` always passes. A pattern without `/` matches the file name at any depth.

### Mandatory Subagents

Require specific specialist reviewers for sensitive areas:

```json
{
  "mandatory_subagents": [
    { "pattern": "src/payments/**", "subagent": "quality-security/security-auditor.md", "phase": "code-review" }
  ]
}
```

When a changed path matches, the work item's `history` must hold a spawn record for that subagent, written by `work record-spawn --role security-auditor` (the role is the file name without `.md`). The engine checks this when leaving `phase` (the spawn must be recorded in that phase) and, for every rule, before `validation` → `pr-creation` (anywhere in history). This also covers tracks that skip the rule's phase. A missing record fails with `MANDATORY_SUBAGENT_MISSING`.

A spawn record shows the agent recorded the spawn; it does not prove what the subagent reviewed.

### Changed paths

Path rules (`track_rules`, `mandatory_subagents`) match the union of:

- paths declared with `work transition --changed-paths a,b` (stored in `pipeline.changed_paths`), and
- files that differ from `pipeline.base_sha` in the project work tree (`git diff --name-only` plus untracked files). The engine records `base_sha` as `HEAD` when leaving `lean-track-check` if the policy has path rules and the project is a git repo.

`.worklogs/` paths are ignored. If `base_sha` is set but git cannot list changes, the transition fails with `POLICY_PATHS_UNAVAILABLE`. Without git, only declared paths count.

### Required Artifacts

Add files that must exist (non-empty) in `.worklogs/<id>/` before leaving a state, on top of the built-in table:

```json
{
  "required_artifacts": {
    "design": ["threat-model.md"],
    "validation": ["perf-results.md|perf-waiver.md"]
  }
}
```

`a.md|b.md` accepts either file. Missing files fail the transition with `ARTIFACTS_INCOMPLETE`.

### Banned Tools

Deny tools by name, or shell commands by prefix:

```json
{
  "banned_tools": [
    { "tool": "git push --force", "context": "main branch", "reason": "Protected branch" },
    { "tool": "mcp__untrusted__*", "reason": "Unreviewed MCP server" },
    { "tool": "WebFetch", "context": "implementation", "reason": "No network fetches while editing code" }
  ]
}
```

- `tool` without whitespace is a tool-name glob; with whitespace it is a shell command prefix (matched at the start of any `&&` / `;` / `|` segment).
- `context` that names a work-item state limits the rule to that state. Any other text (like `"main branch"`) is descriptive and the rule always applies.

### Banned Commands

Deny shell commands by regular expression, optionally only in some states:

```json
{
  "banned_commands": [
    { "pattern": "\\brm\\s+-rf\\s+/(\\s|$)", "reason": "Never delete the filesystem root" },
    { "pattern": "\\bnpm\\s+publish\\b", "reason": "Publishing is a human release step", "states": ["implementation", "validation"] }
  ]
}
```

An invalid regex is skipped with a warning on stderr; it does not block the call.

### Per-phase Tool Allowlist

Restrict which tools may run in a given work-item state. Unlisted states are unrestricted.

```json
{
  "phase_tool_allowlist": {
    "feasibility": ["Read", "Grep", "Glob", "Bash", "mcp__*"]
  }
}
```

When repo and org policies both list a state, only tools present in both lists are allowed.

## Runtime enforcement (PreToolUse hook)

`scripts/hook-pre-tool-policy.cjs` runs as a blocking pre-tool hook for every tool on Claude Code (`hooks/hooks.json`), Cursor (`hooks/hooks-cursor.json`, `--host cursor`) and the Codex plugin (`.codex-plugin/hooks/hooks.json`). `agentic-swe host-parity --json` reports `policy_hook` per host. Per call it:

1. Resolves the project root from the hook's `cwd` (then Cursor `workspace_roots[0]`, `CURSOR_PROJECT_DIR`, `CLAUDE_PROJECT_DIR`, the process cwd) and the work item from `AGENTIC_SWE_WORK_DIR` or `.worklogs/` discovery.
2. Loads the pack default, repo and org policies and validates each, and the merged result, against `schemas/agentic-swe-policy.schema.json`.
3. Evaluates `banned_tools` → `banned_commands` → `protected_paths` → `phase_tool_allowlist` against the current state.
4. Appends one line to the work item's `audit.log`:
   `<ISO> actor=agent action=tool_call tool=<name> decision=allow|deny state=<state> [rule=<rule>] input="<redacted, ≤160 chars>" | evidence: PreToolUse policy hook`
5. Exits `2` with the reason on stderr to deny, `0` to allow. With `--host cursor` it also prints `{"permission":"allow"|"deny",...}`.

Repo and org policy are enforced even without an active work item; audit lines are written only when one exists.

### Baseline policy

`config/default-policy.json` always applies; repo and org policies can add rules but not remove these:

| Rule | Denies |
|------|--------|
| `banned_commands[baseline-force-push-protected]` | `git push` with `--force`, `-f`, `--force-with-lease` or a `+refspec` naming `main`, `master` or `release/*` |
| `banned_commands[baseline-npm-publish]` | `npm publish`, `pnpm publish`, `yarn publish`, `yarn npm publish` |
| `banned_commands[baseline-rm-root]` | `rm` of `/` or `/*` |
| `banned_commands[baseline-integrity-files-shell]` | shell writes (`>`, `tee`, `sed -i`, `mv`, `cp`, `rm`, inline `node -e` / `python -c`, ...) naming `journal.jsonl` or `approval-record.json` |
| `protected_paths[baseline-journal]`, `protected_paths[baseline-approval-record]` | Write / Edit / `apply_patch` / Delete targets under `.worklogs/**/journal.jsonl` or `.worklogs/**/approval-record.json` |

`protected_paths` entries are globs matched against every path an edit-capable tool would modify (tool names containing write, edit, replace, patch, delete, create, move, rename or notebook; `apply_patch` file headers are parsed).

### Hook errors

A hook error is bad stdin, a missing `tool_name`, an unreadable or schema-invalid policy file, a missing `AGENTIC_SWE_POLICY` file, or a crash. It is logged as `action=tool_call_hook_error ... mode=fail-closed|fail-open`, and:

- **denies** the call when the active work item's `pipeline.track` is `rigorous` or missing, or its state is unreadable;
- in `lean` / `standard`, or with no work item, **denies** only when `.agentic-swe/runtime.json` contains `{ "policy": { "fail_closed": true } }` (or the file is unreadable) or `AGENTIC_SWE_POLICY_FAIL_CLOSED=1`; otherwise it warns on stderr and allows.

Neither setting can turn a fail-closed case into fail-open. Rules from valid policy sources still apply while another source is broken.

**Limits:** VS Code, OpenCode, Antigravity, Windsurf, Kiro and Copilot adapters do not register the hook yet, and repository-only Codex setup installs lifecycle hooks only. Codex runs plugin hooks only after you trust them, and hosted tools such as Codex `WebSearch` bypass hooks. Shell matching is textual — a command assembled at runtime (for example via `eval` or a script file) is not seen.

### Budget Overrides

Replace every track's cost and iteration ceilings:

```json
{
  "budget_overrides": {
    "max_cost_usd": 10.0,
    "max_iterations": 15
  }
}
```

`budget-config` applies them on top of `config/budget-thresholds.default.json`, `.agentic-swe/budget-thresholds.json` and `AGENTIC_SWE_BUDGET_THRESHOLDS`, so they set `budget.cost_budget_usd` and `budget.iteration_budget` at `work init` and when a track is set leaving `lean-track-check`. `max_doubt_cycles` is accepted by the schema but ignored: there is no doubt-cycle counter.

## Commands

- `/policy show` — display effective merged policy
- `/policy explain <state>` — show what's enforced for a state
- `/policy check` — validate policy schema

## Work engine enforcement

`work transition` and `work plan-transition` load and validate the merged policy on every transition. An unreadable or schema-invalid source fails the transition with `POLICY_INVALID`; there is no fail-open mode here.
