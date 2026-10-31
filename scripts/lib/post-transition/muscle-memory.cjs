'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { projectRootFromWorkDir } = require('../work-engine/budget-config.cjs');

const DESCENT_TIMEOUT_MS = 180000;

function runDescentScript(pluginRoot, script, workDir) {
  spawnSync(
    process.execPath,
    [path.join(pluginRoot, 'scripts', script), '--work-dir', workDir, '--plugin-root', pluginRoot, '--json'],
    { encoding: 'utf8', timeout: DESCENT_TIMEOUT_MS }
  );
}

/**
 * Pre-implementation descent on entering implementation; validation descent and
 * procedure capture on leaving validation for pr-creation or completed.
 * @param {{ workDir: string, pluginRoot: string, from: string, to: string, procedureStoreRoot?: string }} ctx
 */
function afterTransition(ctx) {
  const { workDir, pluginRoot, from, to } = ctx;
  if (to === 'implementation' || to === 'lean-track-implementation') {
    runDescentScript(pluginRoot, 'implementation-descent.cjs', workDir);
    return;
  }
  if (from === 'validation' && (to === 'pr-creation' || to === 'completed')) {
    try {
      runDescentScript(pluginRoot, 'validation-descent.cjs', workDir);
    } catch {
      /* tier recording is best-effort; capture still runs */
    }
    const { captureProcedureFromWork } = require('../descent/capture-procedure.cjs');
    const proj = projectRootFromWorkDir(workDir) || pluginRoot;
    captureProcedureFromWork({
      workDir,
      projectRoot: proj,
      storeRoot: ctx.procedureStoreRoot || proj || pluginRoot,
    });
  }
}

module.exports = { afterTransition };
