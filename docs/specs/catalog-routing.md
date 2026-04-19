# Catalog routing (implementation spec)

User-facing overview: [Catalog routing](https://agentic-swe.github.io/agentic-swe-site/docs/catalog-routing) on the docs site.

## Layout

| Path | Role |
|------|------|
| `scripts/catalog-lint.cjs` | Catalog CI; exit **1** on violation |
| `scripts/catalog-route.cjs` | CLI router; `--mode`, `--k`, `--json`, `--project-root`, `--plugin-root` |
| `scripts/catalog-index.cjs` | Async embedding index build |
| `scripts/lib/catalog/*.cjs` | Parse, walk, lexical rank, embed rank, model-routing loader, catalog config merge |
| `scripts/session-model-tier-hint.cjs` | Markdown snippet for session-start |
| `config/catalog.default.json` | Default embedding + index paths; merge `.agentic-swe/catalog.json` |
| `config/model-routing.default.json` | Phase / task-class tiers; merge `.agentic-swe/model-routing.json` |
| `hooks/session-start` | Invokes tier hint (opt out `AGENTIC_SWE_MODEL_TIER_HINT=0`) |

## Environment

- **`AGENTIC_SWE_SUBAGENTS_DIR`** — override catalog root (tests, forks).
- **`AGENTIC_SWE_CATALOG_CONFIG`** — absolute path to extra JSON merged over `config/catalog.default.json`.
- **`AGENTIC_SWE_CATALOG_OVERLAP_JACCARD`** — float threshold for purpose-overlap (default **0.55**).
- Embeddings: same variables as **`scripts/lib/memory/embeddings-backend.cjs`** (`AGENTIC_SWE_EMBEDDINGS_BACKEND`, OpenAI/Ollama keys, etc.); catalog merge must expose **`embeddings`** like `memory.default.json`.

## Index artifact

Default output: **`.agentic-swe/catalog-embeddings.json`** (gitignored). Schema: `schema_version`, `model_id`, `dim`, `agents[]` with `id` and `vec`.

## Tests

`test/catalog-lint.test.js`, `test/catalog-route.test.js`, `test/catalog-semantic.test.js`, `test/model-routing.test.js`.
