# Durable memory and project graph (Phase 2)

**Site (user guide):** [Durable memory](https://surajSFDC.github.io/agentic-swe/docs/durable-memory) on the project docs site mirrors this topic at a higher level.

This spec complements [`docs/roadmap.md`](../roadmap.md) Phase 2 and root [`CLAUDE.md`](../../CLAUDE.md). It is **original** to agentic-swe; do not copy prompts or code from third-party graph products.

## Goals

- **Local** compaction + queryable store (SQLite by default).
- **Token-efficient** runtime: small **prime** payloads and deterministic **graph** summaries before heavy retrieval.
- **Clean-room optional enrichment**: external pipelines may supply graph fragments only through a **versioned import contract** (see Layer C below)—no vendored upstream tools.

## Layers

| Layer | Description |
| :--- | :--- |
| **A — Core** | Deterministic graph ingest + chunked text index + `memory-prime` (**`auto`** retrieval: **hybrid** when embeddings are indexed, else **lexical**); config in [`config/memory.default.json`](../../config/memory.default.json), overrides in `.agentic-swe/memory.json`. |
| **B — User pipelines** | Any tooling the repo author runs outside this pack. |
| **C — Import boundary** | Future `memory-import`: validated JSON with provenance, caps (`import_adapter` in config), merge into the same SQLite store. |

## Storage layout

- Default directory: **`.agentic-swe/`** under the target project root.
- Default DB file: **`memory.sqlite`** (gitignored; see root `.gitignore`).
- Schema for **config** (not the SQLite DB): [`schemas/memory-config.schema.json`](../../schemas/memory-config.schema.json).

## Loader API

- Node: [`scripts/lib/memory/config.cjs`](../../scripts/lib/memory/config.cjs) — `loadMergedMemoryConfig(pluginRoot, projectRoot)`, `sqlitePathForProject`.
- Merge order: defaults → `AGENTIC_SWE_MEMORY_CONFIG` → `.agentic-swe/memory.json`.

## S1 — Deterministic graph ingest

- **CLI:** `npm run memory-index --` or `node scripts/memory-index.cjs [--project-root <dir>] [--json]` builds/refreshes **`.agentic-swe/memory.sqlite`** (gitignored).
- **Tables:** `nodes` (`project`, `manifest`, `file`, `npm`) and `edges` (`has_manifest`, `depends_on`, `has_file`, `imports`).
- **Manifests:** every `package.json` under the tree (skipping `node_modules`, `dist`, `.git`, `coverage`, `.agentic-swe`) feeds `depends_on` edges from declared dependency sections.
- **Imports:** line-scanned `import` / `export … from` / `require()` in `.{js,cjs,mjs,ts,tsx}`; relative specifiers resolve to existing files; bare specifiers map to `npm:<package>` (first segment, scoped packages preserved).
- **Implementation:** [`scripts/lib/memory/graph-ingest.cjs`](../../scripts/lib/memory/graph-ingest.cjs), [`scripts/lib/memory/import-extract.cjs`](../../scripts/lib/memory/import-extract.cjs), [`scripts/lib/memory/graph-store.cjs`](../../scripts/lib/memory/graph-store.cjs) (SQLite via [`sql.js`](https://github.com/sql-js/sql.js)); stats helpers in [`scripts/lib/memory/graph-query.cjs`](../../scripts/lib/memory/graph-query.cjs).
- **Full index:** [`scripts/lib/memory/memory-pipeline.cjs`](../../scripts/lib/memory/memory-pipeline.cjs) `runMemoryIndex` — graph + chunks (unless `--graph-only` / `--chunks-only` on the CLI).

## S2 — Chunked text index

- **CLI:** same as S1 (`memory-index`); refreshes **both** graph and markdown chunks by default.
- **Table:** `chunks` (`chunk_id`, `path`, `work_id`, `start_line`, `end_line`, `content_sha256`, `body`). `work_id` is set for paths under `.worklogs/<id>/`.
- **Chunking:** markdown split on heading lines; oversized sections split by size (`ingest.max_chunk_chars`, default 8000). Extensions from `ingest.chunk_extensions` (default `.md` only).
- **Glob filtering:** `ingest.include_globs` / `exclude_globs` (see [`glob-match.cjs`](../../scripts/lib/memory/glob-match.cjs) + [`minimatch`](https://github.com/isaacs/minimatch)).
- **Search:** the [`sql.js`](https://github.com/sql-js/sql.js) build does **not** load SQLite’s FTS5 extension, so retrieval uses **LIKE** over `chunks.body` (all query tokens must match, case-insensitive). Good enough for modest corpora; a native SQLite binding could add FTS5 later.

## S3 — Memory prime

- **CLI:** `npm run memory-prime --` or `node scripts/memory-prime.cjs [--query "…"] [--work-id <id>]` — env **`AGENTIC_SWE_MEMORY_PRIME_QUERY`** when `--query` omitted.
- **Output:** bounded markdown: graph digest (counts, high-degree nodes, embedding row count) + optional chunk hits with path:line citations. Capped by `prime.max_chars_out` / `prime.max_fts_hits` (name kept for config compatibility).
- **Retrieval:** `prime.retrieval_mode` — **`auto`** (default): use **`hybrid`** when embedding rows exist and a backend is configured, otherwise **`lexical`**; or set **`lexical`** / **`semantic`** / **`hybrid`** explicitly.
- **Implementation:** [`scripts/lib/memory/memory-prime.cjs`](../../scripts/lib/memory/memory-prime.cjs), entry [`scripts/memory-prime.cjs`](../../scripts/memory-prime.cjs).

## S4 — Optional embeddings + hybrid retrieval

- **Config:** [`config/memory.default.json`](../../config/memory.default.json) → `embeddings.*` (merge in `.agentic-swe/memory.json`). **`embeddings.enabled`** must be true to run the embed step or semantic modes.
- **Backends (env):** `AGENTIC_SWE_EMBEDDINGS_BACKEND` — **`test`** (deterministic vectors, for CI), **`ollama`** (`AGENTIC_SWE_OLLAMA_HOST`, `AGENTIC_SWE_OLLAMA_MODEL`), **`openai`** (`OPENAI_API_KEY` or `AGENTIC_SWE_OPENAI_API_KEY`, `AGENTIC_SWE_OPENAI_EMBEDDING_MODEL`). **`none`** / unset skips vectors even if `enabled` is true (use `enabled: false` for clarity).
- **Index:** `memory-index` runs chunk ingest, then writes **`chunk_embeddings`** (model id, dimension, sha256, float32 blob) for chunks missing or stale vs `chunks.content_sha256`. Stats line includes an **embeddings** count; JSON includes `stats.embedded` (and `embedError` on failure).
- **Prime:** `prime.retrieval_mode` — **`auto`** (default: **hybrid** when embedding rows exist and a backend is active, else **lexical**), or **`lexical`** / **`semantic`** / **`hybrid`** explicitly. **`semantic`** / **`hybrid`** fall back to lexical when no embedding rows exist or the backend is unavailable.
- **Code:** [`scripts/lib/memory/embeddings-backend.cjs`](../../scripts/lib/memory/embeddings-backend.cjs), [`scripts/lib/memory/chunk-embed.cjs`](../../scripts/lib/memory/chunk-embed.cjs).

## S5 — Deterministic context compact (batch)

- **CLI:** `npm run memory-compact -- --work-dir /abs/path/.worklogs/<id>` — writes **`compact.output_filename`** (default `context-compact.md`) under that work dir by concatenating **`compact.include_names`** with per-file and total caps (`compact.max_chars_per_file`, `compact.max_total_chars`). No LLM; complements human-written `progress.md`.
- **Implementation:** [`scripts/lib/memory/memory-compact.cjs`](../../scripts/lib/memory/memory-compact.cjs), [`scripts/memory-compact.cjs`](../../scripts/memory-compact.cjs).

## Session-start hook (optional memory prime)

- When **`AGENTIC_SWE_MEMORY_PRIME=1`**, [`hooks/session-start`](../../hooks/session-start) appends the same markdown as `memory-prime` after the routing hint (best-effort; failures are ignored). Uses **`AGENTIC_SWE_PROJECT_ROOT`**, else hook JSON **`cwd`** (when `jq` is available), else `pwd`. Optional **`AGENTIC_SWE_WORK_DIR`** → passes **`--work-id`** (basename). Optional **`AGENTIC_SWE_MEMORY_PRIME_QUERY`** → **`--query`**.

## Governance

- Injected memory remains **advisory**; `state.json` and repo files stay authoritative per [`CLAUDE.md`](../../CLAUDE.md).
