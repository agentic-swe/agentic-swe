# Smoke Tests

LLM-dependent pipeline smoke tests. These verify that the agentic-swe pipeline activates the correct phases for different task types.

## Prerequisites

- Claude Code CLI installed (`claude` command available)
- API key configured (`ANTHROPIC_API_KEY` set)
- This repository checked out locally

## Running

```bash
npm run test:smoke
```

Or directly:

```bash
bash test/smoke/run-smoke.sh
```

## How it works

Each file in `prompts/` contains a task description. The runner feeds each prompt to `claude -p` with `--output-format stream-json` and greps the output for expected phase activations.

- `fast-path-bug-fix.txt` — should route through fast-path-implementation
- `full-path-new-feature.txt` — should route through design + test-strategy + implementation

## Important

- These tests are **not** in `npm test` — they require API access and cost money
- They are for manual validation or nightly CI with API credentials
- Expected runtime: 2-5 minutes per prompt
