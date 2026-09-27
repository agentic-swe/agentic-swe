# Lessons Feedback Loop

Compound experience across worklogs by classifying reflection-log entries into failure categories and surfacing them at feasibility and design time.

## How It Works

1. **Classify**: `scripts/memory-reflect.cjs` scans all `.worklogs/*/reflection-log.md` files and classifies each failure into categories (test-gap, type-mismatch, scope-creep, design-flaw, security, performance, dependency, ambiguity, uncategorized).
2. **Digest**: Results are written to `.agentic-swe/lessons.json` with counts per category and full entries.
3. **Surface**: During `feasibility` and `design` phases, the Hypervisor reads the top-3 relevant lessons based on category overlap with the current task signals.

## Running

Session start and session stop refresh `.agentic-swe/lessons.json` and the style profile automatically. Run the command below only to rebuild the digest outside a session, or when a hook receipt says the refresh failed:

```bash
node scripts/memory-reflect.cjs [repo-root]
# or
npm run memory-reflect
```

## Integration with Phases

### Feasibility

Add to the feasibility artifact:

```markdown
## Lessons from Prior Work

Top lessons relevant to this task (from .agentic-swe/lessons.json):
1. [category: test-gap] <what failed> — <strategy change>
2. ...
```

### Design

When designing, check if any lesson category matches the current task's domain. If a prior work item failed due to `design-flaw` in a similar module, the design must address that specific failure mode.

## Privacy

All data stays local in the repository. No external services are involved.

## Cold Start

Repos with no completed worklogs or no reflection logs produce an empty digest. The Hypervisor proceeds normally with the heuristic pipeline.
