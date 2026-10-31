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

Force minimum track depth based on file patterns:

```json
{
  "track_rules": [
    { "pattern": "src/auth/**", "minimum_track": "rigorous", "reason": "Auth changes require full governance" },
    { "pattern": "*.sql", "minimum_track": "standard", "reason": "Schema changes need design review" }
  ]
}
```

### Mandatory Subagents

Require specific specialist reviewers for sensitive areas:

```json
{
  "mandatory_subagents": [
    { "pattern": "src/payments/**", "subagent": "quality-security/security-auditor.md", "phase": "code-review" }
  ]
}
```

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

Adjust cost and iteration limits:

```json
{
  "budget_overrides": {
    "max_cost_usd": 10.0,
    "max_iterations": 15,
    "max_doubt_cycles": 5
  }
}
```

## Commands

- `/policy show` — display effective merged policy
- `/policy explain <state>` — show what's enforced for a state
- `/policy check` — validate policy schema

## CI Enforcement

`work-engine` reads the merged policy during `/check` commands. Invalid policies fail with structured errors.
