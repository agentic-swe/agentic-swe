# Durable memory (optional)

The pack can index **local** project context into **`.agentic-swe/memory.sqlite`** (gitignored) and emit a bounded **memory prime** markdown block for the Hypervisor. This is **advisory only**: **`state.json`**, **`progress.md`**, and repository files stay authoritative (see root **`CLAUDE.md`** Source priority).

**Canonical spec (repo):** [memory-graph.md](https://github.com/surajSFDC/agentic-swe/blob/main/docs/specs/memory-graph.md) — config schema, SQLite tables, retrieval modes, and implementation paths.

## What you run

| NPM script | Purpose |
|------------|---------|
| **`npm run memory-index`** | Refresh the deterministic **project graph** + **markdown chunks** (and **embeddings** when enabled). Run from a checkout with deps installed, or invoke **`node ${CLAUDE_PLUGIN_ROOT}/scripts/memory-index.cjs`** against a target **`--project-root`**. |
| **`npm run memory-prime`** | Print a bounded digest (graph stats + optional chunk hits). Use **`--query "…"`** or env **`AGENTIC_SWE_MEMORY_PRIME_QUERY`**. Optional **`--work-id`** scopes paths under **`.worklogs/<id>/`**. |
| **`npm run memory-compact`** | Write **`context-compact.md`** under a work item: **`--work-dir /abs/path/.worklogs/<id>`** (deterministic merge of key markdown; no LLM). |
| **`npm run memory-import`** | Merge a validated **JSON bundle** (nodes + edges) into **`memory.sqlite`**. Requires **`import_adapter.enabled`** in config or **`--force`**. See [memory-import-bundle schema](https://github.com/surajSFDC/agentic-swe/blob/main/schemas/memory-import-bundle.schema.json). |
| **`npm run memory-sliding-summary`** | Build **`sliding-summary.md`** from a Claude Code **JSONL transcript**: older turns compressed (bullets), recent turns verbatim; optional **`--llm`** (OpenAI) for the older block. |

Config merges **`config/memory.default.json`** → **`AGENTIC_SWE_MEMORY_CONFIG`** (path) → **`.agentic-swe/memory.json`** in the **target project**. Sliding options live under **`sliding.*`** (recent turn count, caps, output filename, LLM toggle).

## Session start (Claude Code & Cursor)

**Memory prime runs by default** at session start (same output as **`npm run memory-prime`**). **Opt out:** set **`AGENTIC_SWE_MEMORY_PRIME=0`** (or **`false`**, **`no`**, **`off`**).

| Variable | Role |
|----------|------|
| **`AGENTIC_SWE_MEMORY_PRIME=0`** | Disable memory prime injection |
| **`AGENTIC_SWE_PROJECT_ROOT`** | Project root for indexing / prime (else hook **`cwd`**, else shell **`pwd`**) |
| **`AGENTIC_SWE_MEMORY_PRIME_QUERY`** | Default **`--query`** when not passed on the CLI |
| **`AGENTIC_SWE_WORK_DIR`** | If set to **`.worklogs/<id>`**, passes **`--work-id`** (basename) |

**Cursor** ships **`hooks/hooks-cursor.json`** session-start only (same script). **Claude Code** uses **`hooks/hooks.json`**.

## Retrieval and embeddings

- Default **`prime.retrieval_mode`** is **`auto`**: use **hybrid** (lexical + semantic fusion) when embedding rows exist and a backend is configured; otherwise **lexical**.
- Optional backends: **`AGENTIC_SWE_EMBEDDINGS_BACKEND=test`** (CI/deterministic), **`ollama`**, **`openai`** — requires **`embeddings.enabled: true`** in merged config. See the [spec](https://github.com/surajSFDC/agentic-swe/blob/main/docs/specs/memory-graph.md). The same embedding stack is reused for **catalog semantic routing** ([Catalog routing](catalog-routing.md), [catalog-routing spec](https://github.com/surajSFDC/agentic-swe/blob/main/docs/specs/catalog-routing.md)).

## Related

- [Multi-platform support](multi-platform-support.md) — hooks and hosts
- [Usage](usage.md) — pipeline overview
- [Claude Code plugin](claude-code-plugin.md) · [Cursor plugin](cursor-plugin.md)
- Pack commands: **`commands/`** (install, work, check) — root **`CLAUDE.md`**
