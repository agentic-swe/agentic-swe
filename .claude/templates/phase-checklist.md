# Phase Checklist

Use this checklist before every state transition.

## Structural Gate

- required files for the destination state exist
- required files are non-empty
- `state.json` `current_state` matches the intended transition
- `history` includes the most recent reasoned transition
- artifact filenames in `state.json.artifacts` match actual files when applicable
- `updated_at` reflects the latest change
- `progress.md` has an entry for the current phase work
- `audit.log` contains durable or external actions
- loop counters are updated when the phase is budgeted or retry-driven

## Evidence Gate

- each artifact distinguishes observation from inference
- important claims are supported by repository evidence, command output, or primary documentation
- open uncertainties are named explicitly
- delegated findings are integrated, not copied blindly

## Quality Gate

- self-review rubric scores recorded before code-review (full path) or within fast-implementation (fast path)
- reflection-log read before rework when prior rejection exists
- test adequacy assessment completed before implementation begins (full path)
- changed behavior has at least one decisive verification path
- tests pass before or during `validation`, or the lack of runnable tests is precisely documented
- reviewable output exists before `pr-created`
- risky git or GitHub actions use official workflow semantics instead of assumptions
- design feedback is resolved before moving from `design-review` to `verification`
- code review rejection results in explicit `review-feedback.md`
- blocked validation records why escalation is necessary

## Reliability Gate

- likely rollback or repair path is understood for high-risk changes
- destructive or privileged actions have explicit approval when required
- external blockers are recorded rather than worked around unsafely
- resumability is preserved if the work pauses now

## Convergence Gate

- if reflection-log has 2+ entries with the same failure category, escalate rather than retry
- if fast-path self-review scores a dimension as 1 that the developer cannot resolve, escalate rather than consuming the next iteration
- if design review is failing on fundamentally different criteria each iteration (thrashing), escalate after iteration 2

## Context Condensation Gate

- if this is the 3rd+ transition, progress.md contains a current Context Summary
- subsequent phase reads prioritize context summary over full early-phase artifacts

## Stop Conditions

- `ambiguity-wait`
- `approval-wait`
- `escalate-code`
- `escalate-validation`
- `completed`
- `failed`
