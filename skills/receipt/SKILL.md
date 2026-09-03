---
name: receipt
description: "Render a completed work item from .worklogs/ as a shareable markdown / JSON summary — drop into a PR description, Slack message, or compliance ticket."
metadata:
  tier: "L2"
  eval_status: "evaluated"
  eval_ref: "bench/corpus/oracle-readme-badge"
  version: "1.0.0"
  provenance: "generate-skills"
  kind: "command"
  source: "commands/receipt.md"
---

# /receipt

Render a completed work item as a shareable markdown summary — drop into a PR description, Slack message, or compliance ticket.

## Usage

```
/receipt                       # newest work item under .worklogs/
/receipt <work-id>             # specific work item
/receipt <work-id> --format=json
/receipt <work-id> --output=receipt.md
```

## Behavior

1. Resolve the work directory:
   - If `<work-id>` given: `.worklogs/<work-id>/`
   - Else: newest directory under `.worklogs/` by mtime
2. Read `state.json`, `audit.log`, and `pr-link.txt` (if present).
3. Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/render-receipt.cjs --work-dir <resolved> --format=<markdown|json>`.
4. If `--output=<path>` was passed, the script writes to that path; otherwise print to chat.

## Constraints

- Read-only over `.worklogs/<id>/`. No state mutation.
- No LLM call required — pure deterministic rendering.
- Output is suitable for embedding in PR descriptions or compliance attachments.

## When to use

- After a `/work` invocation completes (`current_state == "completed"`)
- Sharing a worked-through decision with a reviewer or compliance partner
- Spot-checking budget burn or human-gate respect across a finished work item
