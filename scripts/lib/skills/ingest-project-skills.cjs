'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const { openOrCreateDatabase, persistDatabase, closeDatabase, ensureChunksSchema } = require('../memory/graph-store.cjs');
const { loadMergedMemoryConfig, sqlitePathForProject } = require('../memory/config.cjs');
const { upsertTypedNodes } = require('../memory/session-capture.cjs');
const { buildIngestProvenance } = require('../memory/provenance.cjs');
const { insertScopedChunk } = require('../memory/ingest-scopes.cjs');
const { listSkills } = require('./project-skills.cjs');

/**
 * Index project-local `.agentic-swe/skills` into the team memory graph for routing boosts.
 * @param {{ projectRoot: string, pluginRoot: string }} opts
 */
async function ingestProjectSkills(opts) {
  const projectRoot = path.resolve(opts.projectRoot);
  const pluginRoot = path.resolve(opts.pluginRoot);
  const projectOnly = listSkills(pluginRoot, projectRoot).filter((s) => s.origin === 'project');
  if (!projectOnly.length) {
    return { ok: true, skills: 0, chunks: 0 };
  }

  const merged = loadMergedMemoryConfig(pluginRoot, projectRoot);
  const sqlitePath = sqlitePathForProject(merged, projectRoot);
  const { db } = await openOrCreateDatabase(sqlitePath);
  let chunks = 0;
  try {
    ensureChunksSchema(db);
    const nodes = [];
    for (const s of projectOnly) {
      const body = `project skill ${s.name} [${s.eval_status}]: ${s.description}`;
      const skillPath = `.agentic-swe/skills/${s.name}/SKILL.md`;
      insertScopedChunk(db, {
        path: skillPath,
        workId: 'team',
        body,
        source: 'ingest-project-skills',
        originPathOrEvent: skillPath,
        actor: 'system:ingest-project-skills',
      });
      chunks++;
      nodes.push({
        id: `project-skill:${s.name}`,
        kind: 'project-skill',
        label: s.name,
        body: body.slice(0, 2000),
        provenance: buildIngestProvenance({
          source: 'ingest-project-skills',
          originPathOrEvent: skillPath,
          actor: 'system:ingest-project-skills',
          sourceHash: crypto.createHash('sha256').update(body).digest('hex'),
        }),
      });
    }
    if (nodes.length) upsertTypedNodes(db, nodes);
    persistDatabase(db, sqlitePath);
  } finally {
    closeDatabase(db);
  }
  return { ok: true, skills: projectOnly.length, chunks, sqlitePath };
}

module.exports = { ingestProjectSkills };
