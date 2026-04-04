# Debugging playbook

Systematic method for AI agents debugging failures in the pipeline. Four phases, applied in order. Skip none — guessing wastes budget faster than tracing.

## Phase 1: Root-cause tracing

Reproduce the failure with the exact command and inputs that triggered it. If you cannot reproduce it, say so and stop — intermittent failures need different handling.

1. **Reproduce** — run the failing command. Capture exact output, exit code, and environment (OS, runtime version, relevant env vars).
2. **Instrument boundaries** — add logging or assertions at function entry/exit, API call sites, and data transformation points. The goal is to find where actual state diverges from expected state.
3. **Trace data flow** — follow the data backward from the symptom to the source. At each step, verify the value matches expectations. The first mismatch is your investigation target.

Do not theorize before you have a reproduction. Do not add fixes before you have a trace.

See `${CLAUDE_PLUGIN_ROOT}/references/root-cause-tracing.md` for deep techniques.

## Phase 2: Pattern matching

Before writing new code, check whether the failure matches a known pattern.

1. **Working examples** — find similar code in the same repo that works. What does it do differently?
2. **Reference reading** — check official docs for the API, library, or tool involved. Do not trust memory — read the source.
3. **Diff listing** — if the failure appeared after a recent change, `git diff` the relevant range. The bug is often in the diff, not in legacy code.

Pattern matching is cheap. Original analysis is expensive. Always look for precedent first.

## Phase 3: Single-hypothesis testing

Form one hypothesis about the root cause. Test it with the smallest possible change.

1. **Minimal test** — write or modify a test that isolates the hypothesis. If the hypothesis is correct, this test should fail before the fix and pass after.
2. **Verify** — run the test. If it does not behave as predicted, the hypothesis is wrong. Discard it and return to Phase 1 with new instrumentation.

Do not hold multiple hypotheses simultaneously. One at a time. Test, confirm or discard, move on.

## Phase 4: Fix with evidence

Apply the fix only after Phase 3 confirms the hypothesis.

1. **Failing test** — the test from Phase 3 must fail without the fix (red step).
2. **One fix** — apply the minimal change. Run the failing test — it must pass (green step).
3. **Regression check** — run the full relevant test suite. No new failures.

### Three-strike rule

If three fix attempts on the same root cause fail (same symptom, same area, three different patches that do not resolve it):

- **Stop fixing.** The mental model of the code is wrong.
- **Question the architecture** — the bug may be a design problem, not a code problem.
- **Escalate to human** with evidence: the three attempts, what each tried, why each failed.

This prevents infinite loops of "try another thing" when the real issue is structural.

## Condition-based waiting

When a test or validation depends on an asynchronous operation, never use arbitrary sleep/delay unless a documented protocol mandates a specific wait time (e.g., DNS propagation TTL).

### Poll with waitFor

```
result = waitFor(
    condition  = () => service.isReady(),
    timeout    = 30_000,
    interval   = 500,
    onTimeout  = () => throw TimeoutError("service not ready after 30s")
)
```

- Always set a **timeout** — unbounded polls hide hangs.
- Always set an **interval** — tight loops burn CPU and flood logs.
- Always **fail explicitly** on timeout — silent fallthrough masks real failures.

### When fixed delay is acceptable

- The upstream system documents a minimum propagation time (DNS, eventual consistency SLA).
- You are rate-limited and must back off by a documented amount.
- In all other cases, poll for the condition.

See `${CLAUDE_PLUGIN_ROOT}/references/condition-based-waiting.md` for detailed patterns.

## Defense-in-depth validation

When adding assertions or checks during debugging, place them at four layers:

| Layer | What it catches | Example |
|-------|----------------|---------|
| **Entry** | Bad inputs before any work | Type checks, schema validation, null guards |
| **Business** | Logic invariants violated during processing | State machine transitions, arithmetic bounds |
| **Environment** | Missing or broken external dependencies | File exists, service reachable, version compatible |
| **Debug** | Should-never-happen states during development | Assertions on "impossible" branches, exhaustive switch defaults |

Each layer catches a different class of bug. Entry catches caller mistakes. Business catches logic errors. Environment catches deployment issues. Debug catches false assumptions.

See `${CLAUDE_PLUGIN_ROOT}/references/defense-in-depth.md` for layer details and examples.

## Scope

This reference is consumed by:

- `${CLAUDE_PLUGIN_ROOT}/phases/validation.md` (when tests fail during validation)
- `${CLAUDE_PLUGIN_ROOT}/phases/escalate-validation.md` (three-strike rule for escalation)
- `${CLAUDE_PLUGIN_ROOT}/phases/implementation.md` (debugging during development)
- `${CLAUDE_PLUGIN_ROOT}/agents/developer-agent.md` (working method)

Related: `${CLAUDE_PLUGIN_ROOT}/references/root-cause-tracing.md`, `${CLAUDE_PLUGIN_ROOT}/references/defense-in-depth.md`, `${CLAUDE_PLUGIN_ROOT}/references/condition-based-waiting.md`
