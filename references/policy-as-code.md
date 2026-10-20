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

`hooks/hooks.json` registers `scripts/hook-pre-tool-policy.cjs` as a blocking `PreToolUse` hook for every tool. Per call it:

1. Resolves the project root from the hook's `cwd` (then `CLAUDE_PROJECT_DIR`, then the process cwd) and the work item from `AGENTIC_SWE_WORK_DIR` or `.worklogs/` discovery.
2. Evaluates `banned_tools` → `banned_commands` → `phase_tool_allowlist` against the current state.
3. Appends one line to the work item's `audit.log`:
   `<ISO> actor=agent action=tool_call tool=<name> decision=allow|deny state=<state> [rule=<rule>] input="<redacted, ≤160 chars>" | evidence: PreToolUse policy hook`
4. Exits `2` with the reason on stderr to deny, `0` to allow.

Repo and org policy are enforced even without an active work item; audit lines are written only when one exists. Hook errors (bad input, crashes) **fail open** with a stderr warning and an `action=tool_call_hook_error` audit line; set `AGENTIC_SWE_POLICY_FAIL_CLOSED=1` to deny instead.

**Limits:** enforcement exists only on hosts that run Claude Code–style `PreToolUse` hooks; Cursor, Codex and other adapters do not register it yet. Shell matching is textual — a command assembled at runtime (for example via `eval` or a script file) is not seen.

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
