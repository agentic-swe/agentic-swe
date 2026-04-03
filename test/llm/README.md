# LLM / E2E tests (opt-in)

These checks call the **Claude Code CLI** (`claude`) with fixture prompts and assert on **plain-text output** (weak signal only — not a guarantee of correct routing). They cost API usage and can flake; they are **not** part of `npm test`.

## Prerequisites

| Requirement | Notes |
|-------------|--------|
| **`claude` on `PATH`** | Claude Code CLI installed and runnable. Override binary with `CLAUDE_CLI=/path/to/claude`. |
| **Authentication** | Typically `ANTHROPIC_API_KEY` in the environment, or whatever your host uses for Claude Code. Unset keys cause failures — this is expected locally until you configure auth. |
| **Network** | Calls the configured Claude API / service. |

## Run locally

```bash
export AGENTIC_SWE_LLM_TESTS=1
# Optional: export CLAUDE_CLI=claude
npm run test:llm
```

## Fixtures

Files in `fixtures/*.txt` are user messages. `run-llm-tests.cjs` defines per-case:

- **`expectAny`** — at least one substring must appear in stdout/stderr (case-insensitive).
- **`expectAll`** (optional) — every listed substring must appear.

## CI

Workflow: [`.github/workflows/ci-llm.yml`](../../.github/workflows/ci-llm.yml).

- Default trigger: **`workflow_dispatch` only** (manual from the Actions tab) to avoid surprise API spend.
- To run on a schedule, uncomment the `schedule` block in that file and ensure the repository has the right **secrets** for your runner (e.g. `ANTHROPIC_API_KEY` for Anthropic-hosted usage). Prefer **self-hosted** runners with pre-installed `claude` + auth for teams that cannot store keys in GitHub.
