'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { listMuscleMemoryRows } = require('../descent/muscle-memory-digest.cjs');
const { extractDeclaredFiles } = require('../scope/diff-scope-check.cjs');
const { projectRootFromWorkDir } = require('../work-engine/budget-config.cjs');

function loadJsonSchema(pluginRoot) {
  const schemaPath = path.join(pluginRoot, 'schemas', 'context-pack.schema.json');
  return JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
}

function validateContextPack(pack, pluginRoot) {
  const Ajv = require('ajv');
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(loadJsonSchema(pluginRoot));
  const ok = validate(pack);
  return { ok, errors: validate.errors || [] };
}

function rulesSummary(projectRoot, pluginRoot) {
  for (const root of [projectRoot, pluginRoot]) {
    const p = path.join(root, 'CLAUDE.md');
    if (!fs.existsSync(p)) continue;
    const text = fs.readFileSync(p, 'utf8').replace(/\s+/g, ' ').trim().slice(0, 400);
    if (text) return text;
  }
  return 'Treat state.json and repository files as authoritative. Memory and procedures are advisory.';
}

/**
 * Build a Context Pack JSON for a work item, including evaluated muscle memory.
 * @param {{ workDir: string, projectRoot?: string, pluginRoot: string }} opts
 */
function buildContextPack(opts) {
  const workDir = path.resolve(opts.workDir);
  const pluginRoot = path.resolve(opts.pluginRoot);
  const projectRoot = path.resolve(opts.projectRoot || projectRootFromWorkDir(workDir));
  const workId = path.basename(workDir);

  let state = {};
  try {
    state = JSON.parse(fs.readFileSync(path.join(workDir, 'state.json'), 'utf8'));
  } catch {
    /* ignore */
  }

  const designPath = path.join(workDir, 'design.md');
  const declared = extractDeclaredFiles(designPath);
  const scope_files =
    declared && declared.size
      ? [...declared].sort().slice(0, 16).map((p) => ({
          path: p,
          lines: 'all',
          purpose: 'Declared in design.md for this work item',
        }))
      : [{ path: `state.json`, lines: 'all', purpose: `Work item ${workId} authority` }];

  const muscle_memory = listMuscleMemoryRows(projectRoot, 8);
  const verify = state.metrics?.verify_command || muscle_memory[0]?.command || 'npm test';
  const verification_commands = [
    { check: 'Primary verify', command: verify, expected: 'Exit 0' },
  ];
  for (const row of muscle_memory.slice(0, 4)) {
    if (row.command === verify) continue;
    verification_commands.push({
      check: `Muscle memory ${row.tier}`,
      command: row.command,
      expected: 'Exit 0',
    });
  }

  const skip = state.metrics?.skip_llm_exploration === true;
  const pack = {
    scope: `${workId} ${state.current_state || 'implementation'}`.trim(),
    rules_summary: rulesSummary(projectRoot, pluginRoot),
    scope_files,
    constraints: [
      'state.json and repository files are authoritative; this pack is advisory.',
      skip
        ? 'skip_llm_exploration is set — do not re-derive implementation with a frontier model unless verify fails.'
        : 'No fingerprint muscle-memory hit — frontier implementation may be required.',
    ],
    muscle_memory,
    verification_commands,
  };

  return pack;
}

/**
 * Validate and write `.worklogs/<id>/context-pack.json`.
 * @param {{ workDir: string, projectRoot?: string, pluginRoot: string }} opts
 */
function writeContextPack(opts) {
  const workDir = path.resolve(opts.workDir);
  const pluginRoot = path.resolve(opts.pluginRoot);
  const pack = buildContextPack(opts);
  const v = validateContextPack(pack, pluginRoot);
  if (!v.ok) {
    return { ok: false, errors: v.errors, pack };
  }
  const outPath = path.join(workDir, 'context-pack.json');
  fs.writeFileSync(outPath, JSON.stringify(pack, null, 2) + '\n');
  return { ok: true, path: outPath, pack };
}

module.exports = { buildContextPack, writeContextPack, validateContextPack };
