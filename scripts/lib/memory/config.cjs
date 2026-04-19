'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { deepMerge } = require('../work-engine/budget-config.cjs');

function readJsonIfExists(p) {
  if (!p || !fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * @param {string} pluginRoot pack root (contains config/memory.default.json)
 * @param {string} [projectRoot] target repo root; optional .agentic-swe/memory.json merged
 */
function loadMergedMemoryConfig(pluginRoot, projectRoot) {
  const defPath = path.join(pluginRoot, 'config', 'memory.default.json');
  let merged = readJsonIfExists(defPath);
  if (!merged || typeof merged !== 'object') {
    merged = {
      schema_version: 1,
      store: { sqlite_relative_path: 'memory.sqlite', directory_relative: '.agentic-swe' },
      ingest: {
        include_globs: [],
        exclude_globs: [],
        max_file_bytes: 1048576,
        max_chunk_chars: 8000,
        chunk_extensions: ['.md'],
      },
      prime: {
        max_chars_out: 12000,
        max_fts_hits: 12,
        retrieval_mode: 'auto',
        rrf_k: 60,
        semantic_candidate_limit: 8000,
      },
      embeddings: {
        enabled: false,
        provider: 'none',
        model: 'nomic-embed-text',
        ollama_host: 'http://127.0.0.1:11434',
        openai_model: 'text-embedding-3-small',
        test_dimension: 32,
      },
      compact: {
        include_names: ['progress.md', 'design.md', 'feasibility.md', 'implementation.md'],
        max_chars_per_file: 8000,
        max_total_chars: 24000,
        output_filename: 'context-compact.md',
      },
      graph: { enabled: true, package_manifests: ['package.json'] },
      import_adapter: { enabled: false, max_nodes_per_merge: 5000, max_edges_per_merge: 20000 },
      sliding: {
        recent_turns_verbatim: 8,
        max_old_turn_chars: 240,
        output_filename: 'sliding-summary.md',
        llm_enabled: false,
        llm_model: 'gpt-4o-mini',
      },
    };
  }

  const envPath = process.env.AGENTIC_SWE_MEMORY_CONFIG;
  const envOverlay = readJsonIfExists(envPath);
  if (envOverlay) merged = deepMerge(merged, envOverlay);

  if (projectRoot) {
    const local = readJsonIfExists(path.join(projectRoot, '.agentic-swe', 'memory.json'));
    if (local) merged = deepMerge(merged, local);
  }

  return merged;
}

/**
 * Absolute path to SQLite file for a project root.
 * @param {object} merged from loadMergedMemoryConfig
 * @param {string} projectRoot
 */
function sqlitePathForProject(merged, projectRoot) {
  const store = merged.store || {};
  const dir = store.directory_relative || '.agentic-swe';
  const file = store.sqlite_relative_path || 'memory.sqlite';
  return path.join(path.resolve(projectRoot), dir, file);
}

module.exports = {
  loadMergedMemoryConfig,
  sqlitePathForProject,
};
