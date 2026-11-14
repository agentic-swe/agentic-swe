'use strict';

/**
 * Index project-local `.agentic-swe/skills` into team memory.
 * AE-R2: opens sqlite via MemoryService.withProjectDb (no direct graph-store require).
 */

const path = require('node:path');
const crypto = require('node:crypto');
const { createMemoryService } = require('../memory/memory-service.cjs');
const { upsertTypedNodes } = require('../memory/session-capture.cjs');
const { buildIngestProvenance } = require('../memory/provenance.cjs');
const { insertScopedChunk } = require('../memory/ingest-scopes.cjs');
const { listSkills } = require('./project-skills.cjs');

/**
 * @param {{ projectRoot: string, pluginRoot: string }} opts
 */
async function ingestProjectSkills(opts) {
  const projectRoot = path.resolve(opts.projectRoot);
  const pluginRoot = path.resolve(opts.pluginRoot);
  const projectOnly = listSkills(pluginRoot, projectRoot).filter((s) => s.origin === 'project');
  if (!projectOnly.length) {
    return { ok: true, skills: 0, chunks: 0 };
  }

  const svc = createMemoryService({ pluginRoot, projectRoot });
  try {
    const result = await svc.withProjectDb(async (db, ctx) => {
      let chunks = 0;
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
      return { chunks, sqlitePath: ctx.sqlitePath };
    });
    return { ok: true, skills: projectOnly.length, chunks: result.chunks, sqlitePath: result.sqlitePath };
  } finally {
    await svc.close();
  }
}

module.exports = { ingestProjectSkills };
