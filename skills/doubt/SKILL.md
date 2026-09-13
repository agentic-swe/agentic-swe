---
name: doubt
description: "Command skill doubt."
metadata:
  tier: "L2"
  eval_status: "evaluated"
  eval_ref: "bench/corpus/oracle-claude-consistency"
  version: "1.0.0"
  provenance: "generate-skills"
  kind: "command"
  source: "commands/doubt.md"
---

# /doubt

Invoke a Doubt-Driven Verification cycle on a specific decision or artifact, outside the normal phase flow.

## Usage

```
/doubt <claim or artifact description>
```

## Behavior

1. Parse the user's input as the **CLAIM** under scrutiny.
2. Ask the user to confirm or refine the **ARTIFACT** (code, design section, assertion) and **CONTRACT** (what it must satisfy).
3. Execute the DDV protocol from `${CLAUDE_PLUGIN_ROOT}/references/doubt-driven-verification.md`:
   - Step 1: Surface the CLAIM
   - Step 2: EXTRACT the smallest reviewable unit
   - Step 3: DOUBT — spawn a fresh-context reviewer using `${CLAUDE_PLUGIN_ROOT}/agents/prompts/adversarial-reviewer-prompt.md`
   - Step 4: RECONCILE — classify each finding (contract-misread / actionable / trade-off / noise)
   - Step 5: STOP when trivial findings, 3 cycles, or user override
4. If an active work item exists (`.worklogs/<id>/`), increment `state.json.counters.doubt_cycles` and append findings to the relevant artifact.
5. If no active work item exists, report findings directly to the user.

## Constraints

- Maximum 3 DDV cycles per invocation. Escalate to the user if substantive issues persist.
- Anti-doubt-theater rule: if 2+ cycles produce substantive findings but zero are classified actionable, stop and report.
- Cross-model escalation is available via `${CLAUDE_PLUGIN_ROOT}/references/cross-model-escalation.md` — offer it to the user after the single-model review.
