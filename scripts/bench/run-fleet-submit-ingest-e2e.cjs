#!/usr/bin/env node
/**
 * E2E bench: consumer fleet-submit → maintainer ingest-fleet-submission.
 * Uses isolated tmp roots; does not pollute pack fleet-submissions counts.
 *
 * Usage:
 *   node scripts/bench/run-fleet-submit-ingest-e2e.cjs [--out bench/results/fleet-submit-ingest-e2e-<date>.json]
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { getDefaultPluginRoot } = require('../lib/work-engine/engine.cjs');
const { emptyTierTotals } = require('../lib/bench/tier-totals.cjs');
const { ingestFleetSubmission, summarizeFleetSubmissions } = require('../ingest-fleet-submission.cjs');

function writeOrganicWorkItem(projectRoot, workId) {
  const workDir = path.join(projectRoot, '.worklogs', workId);
  fs.mkdirSync(workDir, { recursive: true });
  fs.writeFileSync(
    path.join(workDir, 'state.json'),
    JSON.stringify(
      {
        work_id: workId,
        current_state: 'completed',
        budget: { tier_totals: emptyTierTotals() },
        history: [
          { actor: 'engineer', from: 'implementation', to: 'validation' },
          { actor: 'user', from: 'pr-creation', to: 'completed' },
        ],
      },
      null,
      2
    )
  );
}

async function main() {
  const pluginRoot = getDefaultPluginRoot();
  const date = new Date().toISOString().slice(0, 10);
  const outIdx = process.argv.indexOf('--out');
  const outPath =
    outIdx >= 0
      ? process.argv[outIdx + 1]
      : path.join(pluginRoot, 'bench', 'results', `fleet-submit-ingest-e2e-${date}.json`);

  const consumerRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-e2e-consumer-'));
  const maintainerRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-e2e-maint-'));
  fs.mkdirSync(path.join(maintainerRoot, 'bench', 'results', 'fleet-submissions'), { recursive: true });
  fs.mkdirSync(path.join(maintainerRoot, 'hooks'), { recursive: true });
  fs.copyFileSync(path.join(pluginRoot, 'hooks/session-stop'), path.join(maintainerRoot, 'hooks/session-stop'));
  fs.copyFileSync(path.join(pluginRoot, 'hooks/hooks.json'), path.join(maintainerRoot, 'hooks/hooks.json'));
  fs.mkdirSync(path.join(maintainerRoot, 'config'), { recursive: true });
  fs.copyFileSync(
    path.join(pluginRoot, 'config/memory.default.json'),
    path.join(maintainerRoot, 'config/memory.default.json')
  );

  for (const id of ['feat-e2e-a', 'feat-e2e-b', 'feat-e2e-c']) {
    writeOrganicWorkItem(consumerRoot, id);
  }

  const subPath = path.join(consumerRoot, 'fleet-submission.json');
  const submit = spawnSync(
    process.execPath,
    [path.join(pluginRoot, 'scripts/fleet-submit.cjs'), '--project-root', consumerRoot, '--out', subPath],
    { encoding: 'utf8' }
  );
  const submitOk = submit.status === 0;

  let ingest = null;
  if (submitOk) {
    ingest = await ingestFleetSubmission({ submissionPath: subPath, pluginRoot: maintainerRoot });
  }

  const summary = summarizeFleetSubmissions(maintainerRoot);
  const packSummary = summarizeFleetSubmissions(pluginRoot);
  const packScale = summarizeFleetSubmissions(pluginRoot, { forFleetScale: true });

  const payload = {
    generated_at: new Date().toISOString(),
    ok: submitOk && ingest?.ok === true && summary.distinct_consumers === 1,
    measurement_contract:
      'Isolated tmp consumer + maintainer roots. Proves fleet-submit→ingest pipeline without affecting pack fleet-scale counts.',
    submit_ok: submitOk,
    ingest_ok: ingest?.ok === true,
    maintainer_archived: summary.archived,
    pack_fleet_submissions: packSummary.archived,
    pack_fleet_submissions_independent: packScale.archived_independent,
    target_met: submitOk && ingest?.ok === true,
  };

  fs.rmSync(consumerRoot, { recursive: true, force: true });
  fs.rmSync(maintainerRoot, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log(`fleet-submit-ingest-e2e: wrote ${outPath}`);
  console.log(`  submit=${submitOk} ingest=${ingest?.ok === true} target_met=${payload.target_met}`);
  process.exit(payload.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
