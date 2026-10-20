# /policy

Inspect and explain the active Policy-as-Code configuration.

## Subcommands

### `/policy show`

Display the effective merged policy (pack default + repo `.agentic-swe/policy.json` + org `AGENTIC_SWE_POLICY`).

### `/policy explain <state>`

Show what the policy enforces for a specific pipeline state:
- Minimum track (from `track_rules` matching the current diff)
- Mandatory subagents (from `mandatory_subagents` matching touched files)
- Banned tools
- Additional required artifacts
- Budget overrides

### `/policy check`

Validate the repo's `.agentic-swe/policy.json` against `${CLAUDE_PLUGIN_ROOT}/schemas/agentic-swe-policy.schema.json`. Report errors if the policy is malformed.

## Behavior

1. Resolve the effective policy via `${CLAUDE_PLUGIN_ROOT}/scripts/lib/policy/merge.cjs`.
2. For `show`: pretty-print the merged result.
3. For `explain <state>`: filter rules relevant to the given state and current diff.
4. For `check`: validate schema and report.

## Integration

The policy is evaluated during:
- `lean-track-check` — `track_rules` may force a minimum track
- Phase delegation — `mandatory_subagents` are enforced
- Tool invocations — `banned_tools`, `banned_commands` and `phase_tool_allowlist` are enforced by the PreToolUse hook (`scripts/hook-pre-tool-policy.cjs`, Claude Code); each call is logged to the active work item's `audit.log`
- Artifact validation — `required_artifacts` are merged with pack defaults
