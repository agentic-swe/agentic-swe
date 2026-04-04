# Parallel agent dispatch (reference)

Use this when the Hypervisor or a core agent considers **multiple agents or specialists running at the same time** (e.g., several background subagents, separate developer slices, or parallel review passes). It complements delegation limits in `CLAUDE.md` and `${CLAUDE_PLUGIN_ROOT}/phases/subagent-selection.md`.

**Default:** prefer a single owner and serial work unless the criteria below clearly apply — parallelism trades wall-clock for coordination and merge risk.

## When to use parallel dispatch

- **Independent domains** — e.g. frontend and backend, or separate services with clear boundaries and no shared mutable surface in the same files.
- **Unrelated test failures** — each failure has a different root cause; parallel investigation reduces wall-clock time if ownership is split.
- **Review tasks** — e.g. spec review and quality review can run simultaneously when they read the same inputs but produce separate artifacts.
- **Large file sets with no shared state** — partitions are stable: each agent owns a disjoint set of paths or concerns.

## When not to use parallel dispatch

- **Shared state** — both agents would modify the same file or the same mutable resource; use one owner or serialize.
- **Sequential dependencies** — agent B needs agent A’s output as input; run A first, then B.
- **Complex merge scenarios** — changes likely to conflict (touching adjacent logic, same config keys, overlapping refactors); prefer a single agent or strictly non-overlapping slices.
- **Low budget** — each agent consumes budget and context; when `budget_remaining` is tight, skip parallel fan-out and do the minimum serial path.

## Prompt structure for parallel dispatch

Every parallel prompt should be explicit and bounded:

| Element | Purpose |
|---------|---------|
| **Scope** | Exactly which files, directories, or subsystem this agent owns. |
| **Goal** | What artifact or decision to produce (not “help with the repo”). |
| **Constraints** | What not to touch, edit, or assume (other agents’ areas, APIs under negotiation). |
| **Expected output** | Format, approximate length, and a clear **verdict** or structured sections the Hypervisor can merge. |

Vague parallel prompts produce duplicate work, drift, or silent overlap.

### Example prompt skeleton (copy and fill)

```
Scope: <paths or components — only these>
Goal: <one primary deliverable, e.g. “patch X + tests in Y”>
Constraints: Do not edit <paths>. Do not change public API of <module>.
Expected output: Bullets + verdict (pass/concerns/blocker) ≤ N words; list files touched.
```

## Integration after parallel work

1. **Conflict check** — Before treating work as done, verify no overlapping file edits or contradictory decisions across agent outputs. Diff and ownership lists are evidence.
2. **Full test suite** — After merging all outputs into the branch (or worktree), run the full relevant test/lint scope, not only per-agent narrow checks, unless the repo’s policy explicitly allows narrower gates.
3. **If a conflict is detected** — **Sequential rework**: assign one agent (or the primary developer) to resolve with a single coherent pass. Do **not** spawn another parallel round to “fix” conflicts; that amplifies merge risk.

## Relationship to this pipeline

- The **Hypervisor** owns multi-slice splits, conflict checks after parallel returns, and whether to fan out at all given `budget_remaining`.
- The **developer agent** may run one background subagent while continuing work; that subagent’s prompt should still follow the scope / goal / constraints / expected-output pattern.
- **Multi-slice implementation** (multiple developer agents with non-overlapping ownership) must be planned with this document plus `audit.log` and `implementation.md` integration so results reconcile to one coherent branch state.

## Pre-flight checklist (Hypervisor)

- [ ] Slices are disjoint by path or concern (documented in spawn prompts).
- [ ] No sequential dependency hidden between parallel tasks.
- [ ] Budget allows the fan-out; otherwise defer parallel work.
- [ ] Post-merge: conflict check, then full test (or policy-approved) suite before declaring the phase complete.
