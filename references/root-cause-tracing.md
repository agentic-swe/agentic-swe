# Root-cause tracing

Deep-dive on Phase 1 of the debugging playbook. The goal is to move from symptom to cause using evidence, not intuition.

## Backward trace from symptom to cause

Start at the failure — the assertion message, the wrong output, the crash. Work backward.

1. **Identify the immediate symptom** — exact error message, wrong value, unexpected state.
2. **Find the producing expression** — what line of code generated the wrong value or threw the error?
3. **Trace each input** — for that expression, where did each input come from? Check actual values against expected.
4. **Recurse** — the first input that is wrong becomes the new symptom. Repeat until you reach a point where all inputs are correct but the output is wrong. That is the defective code.

Do not jump to conclusions at step 2. The producing expression is often not the bug — it is the victim. The bug is upstream.

## Stack instrumentation at boundaries

Instrument at the boundaries between components, not in the middle of functions.

**Good instrumentation points:**
- Function entry/exit (parameters in, return value out)
- API call sites (request sent, response received)
- Data format conversions (before parse, after parse)
- File/network I/O (what was read, what was written)
- Queue/event boundaries (what was enqueued, what was dequeued)

**Poor instrumentation points:**
- Inside tight loops (floods logs, obscures signal)
- After every variable assignment (too granular, too noisy)

### Technique

```
log("[boundary] functionName entry", { param1, param2 })
result = actualWork(param1, param2)
log("[boundary] functionName exit", { result })
```

Label each log line with the boundary name. When scanning output, you can filter by boundary to reconstruct the data flow path.

## Multi-layer pipeline recipes

When debugging a pipeline with multiple stages (e.g., parse → validate → transform → persist):

1. **Identify which stage fails** — add a checkpoint assertion between each stage. Run once. The first assertion failure tells you which stage produced bad output.
2. **Freeze upstream** — once you know stage N is the problem, hardcode the input to stage N (copy the actual input from the checkpoint). Now you can debug stage N in isolation without re-running stages 1 through N-1.
3. **Bisect within the stage** — if the stage is complex, split it in half with another checkpoint. Repeat until you find the defective operation.

This is faster than reading the entire pipeline top-to-bottom trying to spot the bug visually.

## When to widen vs narrow the search

### Narrow the search when:

- You have a specific symptom with a clear stack trace or error location.
- Instrumentation at one boundary shows the divergence point.
- The failure is deterministic — same inputs always produce the same wrong output.

Technique: bisect. Cut the suspected code path in half, check the midpoint, discard the correct half, repeat.

### Widen the search when:

- The failure is intermittent or timing-dependent.
- Instrumentation at the obvious boundary shows correct values — the bug is elsewhere.
- Multiple symptoms appear simultaneously (suggests a shared upstream cause).
- The bug appeared without any code change (suggests environment, dependency, or data change).

Technique: add instrumentation to adjacent systems. Check environment variables, dependency versions, external service responses, and data inputs that are assumed stable.

### Decision rule

If two rounds of narrowing produce no new information, widen. Do not keep narrowing into the same dead end.

## Common traps

- **Confirmation bias** — you expect the bug to be in module X, so you only instrument module X. If two instrumentation rounds show nothing wrong in X, move on.
- **Stale state** — you are debugging with cached data, compiled artifacts, or a stale process. Rebuild, restart, and re-reproduce before deep investigation.
- **Wrong layer** — the symptom is in the application but the cause is in the infrastructure (wrong env var, missing file, network timeout). If code-level tracing finds nothing, check the environment layer.

## Scope

Consumed by `${CLAUDE_PLUGIN_ROOT}/references/debugging-playbook.md` (Phase 1).

Related: `${CLAUDE_PLUGIN_ROOT}/references/defense-in-depth.md`, `${CLAUDE_PLUGIN_ROOT}/references/condition-based-waiting.md`
