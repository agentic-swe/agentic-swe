# Catalog routing and CI

Phase 3 adds **headless** tools so subagent selection and model hints are **data-driven** and the **catalog is linted in CI** (same checks as `npm run verify` on a pack checkout).

## Commands (from a pack checkout)

| Command | Purpose |
|---------|---------|
| `npm run catalog:lint` | Validate every `agents/subagents/**/*.md`: frontmatter, unique `name`, `model` ∈ {sonnet, opus, haiku}, required `tools`, `name` matches filename, invocation-style **description**, duplicate text, high **Jaccard** overlap on descriptions (default threshold **0.55**, override `AGENTIC_SWE_CATALOG_OVERLAP_JACCARD`). |
| `npm run catalog:route` | Rank specialists for a natural-language **query**; **`--mode auto` \| `lexical` \| `semantic`**, **`--k N`**, **`--json`**. |
| `npm run catalog:index` | Build **`.agentic-swe/catalog-embeddings.json`** for semantic routing (gitignored). Uses the same embedding stack as [Durable memory](durable-memory.md) (`config/catalog.default.json` + optional `.agentic-swe/catalog.json`). |

**Semantic routing:** `auto` uses cosine similarity over stored vectors when the index exists and an embedding backend is configured (`test`, **Ollama**, or **OpenAI**); otherwise it falls back to **lexical** overlap. For CI and laptops without API keys, the **`test`** backend provides deterministic vectors (see `AGENTIC_SWE_EMBEDDINGS_BACKEND` / `config/catalog.default.json`).

**Model tier hints:** `config/model-routing.default.json` maps pipeline **phase** and optional **task class** to tiers `fast` / `balanced` / `heavy`. Merge overrides in **`.agentic-swe/model-routing.json`**. **`hooks/session-start`** appends a short tier hint when an active **`.worklogs/<id>/`** work item exists (opt out **`AGENTIC_SWE_MODEL_TIER_HINT=0`**). Hosts may not enforce model choice; this is advisory.

## Slash commands (unchanged)

Browse and invoke specialists with **`/subagent`** as before — see [Subagent catalog](subagent-catalog.md).

## CI

`npm run verify` runs **`verify-sanity`** plus **`catalog:lint`**, so catalog regressions fail the same check used in [GitHub Actions](https://github.com/surajSFDC/agentic-swe/blob/main/.github/workflows/ci.yml).

## Maintainer spec

Repo: [`docs/specs/catalog-routing.md`](https://github.com/surajSFDC/agentic-swe/blob/main/docs/specs/catalog-routing.md) (implementation paths and env vars).

## Related

- [Usage](usage.md) — pipeline overview  
- [Check commands](check-commands.md) — `/check` and `work-engine`  
- [Durable memory](durable-memory.md) — shared embedding configuration patterns  
