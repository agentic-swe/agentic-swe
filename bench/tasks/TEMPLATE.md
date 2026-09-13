# Bench task template

Create a new task under `bench/tasks/<id>/` or `bench/corpus/<id>/`.

## Required files

```
<id>/
  task.json           # metadata
  scoring.json        # weighted dimensions + acceptance command
  expected/
    patterns.json     # optional artifact regex / state checks
  repo/               # optional isolated repo (SWE-bench style)
    package.json
    src/
    test/
```

## task.json

```json
{
  "id": "my-task-id",
  "title": "Short title",
  "description": "What the agent must accomplish.",
  "expected_track": "lean",
  "acceptance_tests": ["npm test"]
}
```

## scoring.json

Each dimension has `weight` (must sum to 1.0) and `method`:

| method | fields |
|--------|--------|
| `run_acceptance_tests` | `command`, `cwd`, `full_credit_exit_code` |
| `run_command` | same |
| `cost_vs_budget` | `cost_budget_usd` |
| `artifact_presence` | `artifact`, `partial_credit` |
| `transition_chain` | `expected_track`, penalties |

## patterns.json

```json
{
  "required_patterns": [{ "file": "implementation.md", "pattern": "arr\\.length" }],
  "required_states": ["validation"],
  "track_must_be": "lean"
}
```

## Corpus classes

- **oracle** — pack health checks (`bench/corpus/oracle-*`)
- **version-sync** — synthesized manifest drift (`ritual-version-sync-*`)
- **mined** — fail-to-pass test stubs

Regenerate corpus: `npm run bench:corpus`

Validate: `npm run bench:validate` or `node scripts/bench/run.cjs validate --corpus`

Run scorecard: `node scripts/bench/run.cjs run --corpus --out bench/results/run-<date>.json`
