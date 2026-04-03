# LLM / E2E tests (opt-in)

These checks call the **Claude Code CLI** (`claude`) with fixture prompts and assert on **stream output**. They cost API usage and can flake; they are **not** part of `npm test`.

## Run locally

```bash
export AGENTIC_SWE_LLM_TESTS=1
# Ensure `claude` is on PATH and ANTHROPIC_API_KEY (or host auth) is configured
npm run test:llm
```

## Fixtures

Files in `fixtures/*.txt` are user messages. `run-llm-tests.cjs` defines expected **substring** assertions per fixture (weak signal only—not a guarantee of correct routing).

## CI

Optional workflow: `.github/workflows/ci-llm.yml` (manual `workflow_dispatch` only). Add repo secrets for your provider before enabling scheduled runs.
