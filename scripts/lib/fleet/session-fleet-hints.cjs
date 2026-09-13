'use strict';

const { buildFleetConsumerChecklist } = require('./consumer-checklist.cjs');
const { readFleetStatusSnapshot } = require('./fleet-status-snapshot.cjs');

/**
 * Append fleet consumer hints for session-start routing.
 * @param {string[]} lines
 * @param {{ projectRoot: string, pluginRoot: string, muscleMemoryOk: boolean }} opts
 */
function appendFleetConsumerHints(lines, opts) {
  const checklist = buildFleetConsumerChecklist({
    projectRoot: opts.projectRoot,
    pluginRoot: opts.pluginRoot,
    muscleMemoryOk: opts.muscleMemoryOk,
  });
  const cached = readFleetStatusSnapshot(opts.projectRoot);

  lines.push('');
  lines.push('### Fleet muscle memory (consumer repo)');
  lines.push('');

  if (checklist.fleet_submission_ready) {
    lines.push('- **Submission ready:** true');
    lines.push(
      `- **Submit:** \`npm run fleet-submit -- --project-root ${opts.projectRoot} --out fleet-submission.json\``
    );
    lines.push('- Use default `fleet_evidence_class=independent` (do not set maintainer_dogfood)');
    return;
  }

  const organic = cached?.organic_live ?? checklist.readiness?.organic_live ?? '?';
  lines.push(`- **Submission ready:** false (${checklist.blockers.length} blocker(s); organic_live=${organic})`);
  for (const b of checklist.blockers.slice(0, 4)) {
    lines.push(`  - ${b}`);
  }
  const next = checklist.steps[checklist.steps.length - 1];
  if (next) lines.push(`- **Next:** \`${next}\``);
}

module.exports = { appendFleetConsumerHints };
