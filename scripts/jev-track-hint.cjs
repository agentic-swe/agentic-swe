#!/usr/bin/env node
/**
 * Advisory Jev track hint for lean-track-check.
 * Writes pipeline.jev_track and leaves pipeline.track unchanged.
 * Opt out: AGENTIC_SWE_JEV=0
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { discoverActiveWorkDir } = require('./lib/work-engine/discover-workdir.cjs');
const { adviseTrack, renderTrackHint } = require('./lib/jev/track.cjs');

function parseArgs(argv) {
  const args = argv.slice(2);
  let projectRoot = process.cwd();
  let pluginRoot = path.join(__dirname, '..');
  let workDir = process.env.AGENTIC_SWE_WORK_DIR || '';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--project-root' && args[i + 1]) {
      projectRoot = path.resolve(args[++i]);
      continue;
    }
    if (args[i] === '--plugin-root' && args[i + 1]) {
      pluginRoot = path.resolve(args[++i]);
      continue;
    }
    if (args[i] === '--work-dir' && args[i + 1]) {
      workDir = path.resolve(args[++i]);
    }
  }
  return { projectRoot, pluginRoot, workDir };
}

async function runTrackHint(opts) {
  const projectRoot = opts.projectRoot;
  const pluginRoot = opts.pluginRoot;
  let workDir = opts.workDir ? path.resolve(opts.workDir) : '';
  if (!workDir) workDir = discoverActiveWorkDir(projectRoot) || '';
  if (!workDir || !fs.existsSync(path.join(workDir, 'state.json'))) {
    process.stderr.write('jev-track-hint: no active work item\n');
    return 0;
  }
  const statePath = path.join(workDir, 'state.json');
  let state;
  try {
    state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch {
    process.stderr.write('jev-track-hint: state.json is not valid JSON\n');
    return 1;
  }
  const feasPath = path.join(workDir, 'feasibility.md');
  if (!fs.existsSync(feasPath)) {
    process.stderr.write('jev-track-hint: feasibility.md is missing\n');
    return 0;
  }
  const feasibilityText = fs.readFileSync(feasPath, 'utf8');
  const trackBefore = state.pipeline ? state.pipeline.track : undefined;
  const recommendationBefore = state.pipeline ? state.pipeline.track_recommendation : undefined;
  const hint = await adviseTrack({
    pluginRoot,
    projectRoot,
    workDir,
    feasibilityText,
    env: opts.env || process.env,
    fetchImpl: opts.fetchImpl,
  });
  if (!state.pipeline || typeof state.pipeline !== 'object') state.pipeline = {};
  state.pipeline.jev_track = hint;
  if (trackBefore === undefined) delete state.pipeline.track;
  else state.pipeline.track = trackBefore;
  if (recommendationBefore === undefined) delete state.pipeline.track_recommendation;
  else state.pipeline.track_recommendation = recommendationBefore;
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');
  process.stdout.write(renderTrackHint(hint) + '\n');
  return 0;
}

async function main() {
  const args = parseArgs(process.argv);
  const code = await runTrackHint(args);
  process.exit(code);
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`jev-track-hint: ${err && err.message ? err.message : 'failed'}\n`);
    process.exit(1);
  });
}

module.exports = { parseArgs, runTrackHint };
