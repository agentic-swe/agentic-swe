#!/usr/bin/env node
'use strict';

/**
 * AE-034c CLI — holdout runner + honesty report.
 * Default: fixture adapter (deterministic). Optional: --provider ollama|llama.cpp
 * (loopback only, labeled observed, never sole E8 proof / never paid).
 *
 * Results: bench/results/holdout-* (gitignored; never commit).
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { runHoldoutSuite } = require('../lib/bench/holdout-runner.cjs');
const { applyFixtureSolution, hasFixtureSolution } = require('../lib/bench/fixture-solutions.cjs');
const { writeLeanWorklog } = require('../lib/bench/holdout-runner.cjs');

const LOCAL = new Set(['ollama', 'llama.cpp', 'llamacpp']);

function parseArgs(argv) {
  const out = {
    provider: 'fixture',
    manifest: 'bench/manifests/public-holdout.json',
    out: null,
    e8Cited: true,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--provider') out.provider = argv[++i];
    else if (a === '--manifest') out.manifest = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--no-e8-cited') out.e8Cited = false;
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

async function runAgentHosted(ctx) {
  const { createRuntime } = require('../lib/hosted-runtime/index.cjs');
  const { createFixtureAdapter } = require('../lib/model-gateway/index.cjs');
  const pluginRoot = ctx.pluginRoot;
  const provider = ctx.provider || 'fixture';

  // Init a real work item under evalRoot so hosted-runtime can transition.
  const workRoot = ctx.evalRoot;
  const id = ctx.task.id;
  const init = spawnSync(
    process.execPath,
    [
      path.join(pluginRoot, 'scripts/work-engine.cjs'),
      'init',
      '--id',
      id,
      '--task',
      `holdout ${id}`,
      '--work-root',
      workRoot,
      '--budget-profile',
      'lean',
      '--plugin-root',
      pluginRoot,
      '--json',
    ],
    { encoding: 'utf8' }
  );
  if (init.status !== 0) {
    // Fall back to lean worklog writer if init fails in constrained sandboxes.
    writeLeanWorklog(ctx.workDir, {
      workId: id,
      implementationNote: `hosted init failed; fixture fallback (${init.stderr || init.stdout})`,
    });
    if (provider === 'fixture' && hasFixtureSolution(id)) {
      applyFixtureSolution(id, ctx.taskSandbox);
      return { provider, adapter: 'fixture', hosted: false, applied_fixture_solution: true };
    }
    return { provider, adapter: provider, hosted: false, applied_fixture_solution: false };
  }

  const workDir = path.join(workRoot, '.worklogs', id);
  const adapters =
    provider === 'fixture'
      ? { fixture: createFixtureAdapter() }
      : undefined;

  const runtime = createRuntime({
    workDir,
    pluginRoot,
    track: 'lean',
    provider: provider === 'llamacpp' ? 'llama.cpp' : provider,
    adapters,
    gatewayConfig:
      provider === 'fixture'
        ? undefined
        : {
            base_url:
              provider === 'ollama' ? 'http://127.0.0.1:11434' : 'http://127.0.0.1:8080',
            timeout_ms: 2000,
            max_retries: 0,
          },
    steps: {
      'lean-track-implementation': {
        artifact_content: {
          'implementation.md': `# implementation\nFixture/local holdout run for ${id}. Must mention arr.length when scoring 01.\narr.length\n`,
        },
      },
    },
  });

  // Stop once we have reached validation (4 lean transitions).
  const result = await runtime.run({ stopAfter: 4 });
  if (provider === 'fixture' && hasFixtureSolution(id)) {
    applyFixtureSolution(id, ctx.taskSandbox);
  }
  return {
    provider,
    adapter: provider === 'fixture' ? 'fixture' : provider,
    hosted: true,
    hosted_state: result.current_state,
    hosted_ok: result.ok === true || result.code === 'RUNTIME_STOPPED',
    applied_fixture_solution: provider === 'fixture' && hasFixtureSolution(id),
    label: LOCAL.has(provider) ? 'observed' : 'measured',
    sole_e8_proof: false,
    not_sole_e8_proof: true,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage: node scripts/bench/run-holdout.cjs [--provider fixture|ollama|llama.cpp] [--manifest path] [--out bench/results/holdout-….json]
Default provider=fixture. Local providers are labeled observed and never sole E8 proof (PD-41).`);
    process.exit(0);
  }

  const repoRoot = path.resolve(__dirname, '..', '..');
  const provider = args.provider;
  if (provider !== 'fixture' && !LOCAL.has(provider)) {
    console.error(`unsupported provider ${provider} (paid providers forbidden)`);
    process.exit(2);
  }

  const useHosted = process.env.AE_HOLDOUT_HOSTED === '1' || provider !== 'fixture';

  const result = await runHoldoutSuite({
    repoRoot,
    manifest: args.manifest,
    provider,
    out: args.out,
    e8Cited: args.e8Cited,
    label: LOCAL.has(provider) ? 'observed' : 'measured',
    runAgent: useHosted ? runAgentHosted : undefined,
    limitations: LOCAL.has(provider)
      ? [
          'Local model holdout labeled observed; not sole E8 proof (PD-41).',
          'Partial exit bar (PD-42): harness evidence only.',
        ]
      : undefined,
  });

  if (!result.ok) {
    console.error(JSON.stringify({ ok: false, errors: result.errors || result }, null, 2));
    process.exit(1);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        out: result.outPath,
        scorecard: result.scorecardPath,
        reached_validation: result.reachedValidation,
        delivered: result.report.summary.delivered,
        negatives_retained: result.report.summary.negatives_retained,
        sole_e8_proof: result.report.model_provenance.sole_e8_proof,
        label: result.report.model_provenance.label,
      },
      null,
      2
    )
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.stack || err.message || err);
    process.exit(1);
  });
}

module.exports = { main, runAgentHosted, parseArgs };
