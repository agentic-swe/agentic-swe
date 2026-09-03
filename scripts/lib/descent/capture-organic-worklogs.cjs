'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { captureProcedureFromWork } = require('./capture-procedure.cjs');
const {
  isDogfoodLiveWorkItem,
  isOrganicPipelineWorkItem,
  ORGANIC_FIXTURE_WORKLOGS,
} = require('../bench/production-tier-totals.cjs');

function listWorklogDirs(root) {
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root)
    .map((name) => ({ name, dir: path.join(root, name) }))
    .filter(({ dir }) => fs.existsSync(path.join(dir, 'state.json')));
}

/**
 * Capture muscle-memory procedures from organic (non-dogfood) worklogs.
 * @param {{ projectRoot: string, pluginRoot: string, includeFixtures?: boolean }} opts
 */
function captureOrganicWorklogs(opts) {
  const projectRoot = path.resolve(opts.projectRoot);
  const pluginRoot = path.resolve(opts.pluginRoot);
  const includeFixtures = opts.includeFixtures !== false;
  const roots = [path.join(projectRoot, '.worklogs')];
  if (includeFixtures) roots.push(path.join(pluginRoot, ORGANIC_FIXTURE_WORKLOGS));

  const captures = [];
  const seen = new Set();
  for (const root of roots) {
    for (const { name, dir } of listWorklogDirs(root)) {
      if (seen.has(name)) continue;
      let state;
      try {
        state = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
      } catch {
        continue;
      }
      if (isDogfoodLiveWorkItem(name, state)) continue;
      if (!isOrganicPipelineWorkItem(name, state)) continue;
      seen.add(name);
      const isFixtureRoot = root.includes(`${path.sep}organic-worklogs`);
      const r = captureProcedureFromWork({
        workDir: dir,
        projectRoot,
        storeRoot: opts.storeRoot || projectRoot,
        writeState: !isFixtureRoot,
        preferIsolatedTest: opts.preferIsolatedTest !== false,
        source: 'organic-worklog',
      });
      captures.push({ work_id: name, work_dir: dir, from_fixture: isFixtureRoot, ...r });
    }
  }

  return {
    ok: captures.every((c) => c.ok !== false) || captures.some((c) => c.ok === true),
    captured: captures.filter((c) => c.ok === true).length,
    skipped: captures.filter((c) => c.ok === false).length,
    captures,
  };
}

module.exports = { captureOrganicWorklogs, listWorklogDirs };
