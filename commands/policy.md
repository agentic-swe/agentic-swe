# /policy

Inspect and explain the active Policy-as-Code configuration.

## Subcommands

### `/policy show`

Display the effective merged policy (pack default + repo `.agentic-swe/policy.json` + org `AGENTIC_SWE_POLICY`).

### `/policy explain <state>`

Show what the policy enforces for a specific pipeline state:
- Minimum track (from `track_rules` matching the changed paths)
- Mandatory subagents (from `mandatory_subagents` matching the changed paths)
- Banned tools
- Additional required artifacts
- Budget overrides

### `/policy check`

Validate the repo's `.agentic-swe/policy.json` against `${CLAUDE_PLUGIN_ROOT}/schemas/agentic-swe-policy.schema.json`. Report errors if the policy is malformed.

## Behavior

1. Resolve the effective policy via `${CLAUDE_PLUGIN_ROOT}/scripts/lib/policy/merge.cjs`.
2. For `show`: pretty-print the merged result.
3. For `explain <state>`: filter rules relevant to the given state and the changed paths (`pipeline.changed_paths` plus files changed since `pipeline.base_sha`).
4. For `check`: validate schema and report.

## Integration

The policy is evaluated during:
- Every work-engine transition — an invalid policy fails with `POLICY_INVALID`
- Leaving `lean-track-check` (and any `--set-pipeline-track`) — a track below a matching `track_rules` minimum fails with `TRACK_POLICY`
- Leaving a rule's `phase`, and before `validation` → `pr-creation` — each matching `mandatory_subagents` entry needs a `work record-spawn` record, else `MANDATORY_SUBAGENT_MISSING`
- Tool invocations — `banned_tools`, `banned_commands`, `protected_paths` and `phase_tool_allowlist` are enforced by the pre-tool policy hook (`scripts/hook-pre-tool-policy.cjs`; Claude Code, Cursor, Codex plugin); each call is logged to the active work item's `audit.log`. Hook errors deny in rigorous or track-less work items (see `references/policy-as-code.md`)
- Artifact validation — `required_artifacts[state]` files are required before leaving that state
- Budget profiles — `budget_overrides` replace track ceilings at `work init` and leaving `lean-track-check`

Changed paths are declared with `work transition --changed-paths a,b` and observed from git; see `references/policy-as-code.md`.
