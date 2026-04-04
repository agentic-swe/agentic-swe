# Verification Standard

Claims without evidence are failures. Every assertion about system behavior must be backed by executable output captured during the current run.

## Claim-to-Evidence Map

| Claim | Required Evidence |
|-------|-------------------|
| "Tests pass" | Exit code 0 shown alongside test runner output (summary line at minimum) |
| "Bug fixed" | Failing test output **before** the fix, passing test output **after** — both captured in the same artifact |
| "Performance improved" | Quantitative before/after measurements with units, tool name, and run conditions |
| "No regressions" | Full test suite execution with pass count, fail count, and exit code |
| "Feature works" | At least one test (new or existing) that exercises the feature, with command and output shown |
| "Lint/format clean" | Linter command, exit code, and truncated output (or "no issues" line from tool) |
| "Build succeeds" | Build command and exit code; warnings summarized if present |
| "Security issue resolved" | Scan output before and after, showing the finding eliminated |
| "Dependency updated" | Lock-file diff and passing install + test output |

If a claim type is not listed above, the general rule applies: show the command, its output, and the exit code.

## Banned Hedging Language

The following words and phrases indicate an unverified claim. They must not appear in artifact conclusions or evidence sections:

- "should"
- "probably"
- "seems to"
- "I think"
- "likely"
- "appears to"
- "I believe"
- "presumably"
- "in theory"

If you cannot state a fact without hedging, you have not verified it. Run the command, capture the output, then state what happened.

## Delegation Verification

When integrating results from a sub-agent or delegated task:

- **Read the diff yourself** — do not accept "it worked" or "changes applied" at face value.
- **Re-run the decisive check** — if the sub-agent claims tests pass, run the tests in the Hypervisor context and capture the output.
- **Cross-check file state** — confirm the files listed in the sub-agent's report actually exist and contain the described changes.
- **Flag discrepancies** — if the sub-agent's claims do not match your verification, record both results and escalate rather than silently accepting either.

## Artifact Requirements

Every artifact that makes behavioral claims must include a `## Verification Evidence` section (or equivalent per the claim type) containing:

1. **Command** — the exact command executed
2. **Output** — decisive lines from stdout/stderr (truncate verbose output but keep summary and exit status)
3. **Result** — explicit pass/fail/blocked classification

Artifacts missing this section for behavioral claims are incomplete and must not pass review.

## Scope

This standard applies to all pipeline phases, all agents (core and sub-agents), and all artifact types. It is not optional — verification is a mandatory dimension of every artifact that asserts behavioral outcomes.

Phases that produce or consume behavioral evidence must reference this document and enforce its requirements. The phase checklist includes a verification gate that checks compliance.

## Relationship to Evidence Standard

This document complements `${CLAUDE_PLUGIN_ROOT}/templates/evidence-standard.md`. The evidence standard defines **how to structure observations and inferences**. This document defines **what executable proof is required** before a claim can be stated as fact. Both apply simultaneously.
