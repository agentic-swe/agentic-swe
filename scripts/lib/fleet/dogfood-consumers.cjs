'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * Consumer project roots previously archived as maintainer_dogfood.
 * @param {string} pluginRoot
 */
function listMaintainerDogfoodConsumerRoots(pluginRoot) {
  const dir = path.join(path.resolve(pluginRoot), 'bench', 'results', 'fleet-submissions');
  if (!fs.existsSync(dir)) return [];
  const roots = new Set();
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    try {
      const submission = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      if (submission.fleet_evidence_class !== 'maintainer_dogfood') continue;
      if (submission.project_root) roots.add(path.resolve(submission.project_root));
    } catch {
      /* skip */
    }
  }
  return [...roots];
}

/**
 * @param {string} pluginRoot
 * @param {string} projectRoot
 */
function isKnownMaintainerDogfoodConsumer(pluginRoot, projectRoot) {
  const root = path.resolve(projectRoot);
  return listMaintainerDogfoodConsumerRoots(pluginRoot).includes(root);
}

module.exports = {
  listMaintainerDogfoodConsumerRoots,
  isKnownMaintainerDogfoodConsumer,
};
