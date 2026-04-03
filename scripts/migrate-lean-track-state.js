#!/usr/bin/env node
/**
 * Migrate in-repo work items from pre-2.0 state names (fast-path-*) to lean-track-*.
 *
 * Usage:
 *   node scripts/migrate-lean-track-state.js           # dry-run, print planned changes
 *   node scripts/migrate-lean-track-state.js --apply   # rewrite state.json + rename artifacts
 *
 * Scans each subdirectory of `.claude/.work/` under the current working directory (typically repo root).
 *
 * Prefer **`scripts/migrate-work-state.js`** as the stable entrypoint; it delegates here today.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const WORK_ROOT = path.join(process.cwd(), '.claude', '.work');

const STATE_MAP = {
  'fast-path-check': 'lean-track-check',
  'fast-path-implementation': 'lean-track-implementation',
};

function migrateStateJson(obj, dryRun, workDir, log) {
  let changed = false;
  if (typeof obj.current_state === 'string' && STATE_MAP[obj.current_state]) {
    log('  current_state: ' + obj.current_state + ' -> ' + STATE_MAP[obj.current_state]);
    if (!dryRun) obj.current_state = STATE_MAP[obj.current_state];
    changed = true;
  }

  if (obj.pipeline && typeof obj.pipeline === 'object') {
    if (!Object.prototype.hasOwnProperty.call(obj.pipeline, 'track')) {
      log('  pipeline.track absent -> set rigorous (legacy work item)');
      if (!dryRun) obj.pipeline.track = 'rigorous';
      changed = true;
    }
    if ('fast_path_eligible' in obj.pipeline) {
      log(`  pipeline.fast_path_eligible -> lean_track_eligible`);
      if (!dryRun) {
        obj.pipeline.lean_track_eligible = obj.pipeline.fast_path_eligible;
        delete obj.pipeline.fast_path_eligible;
      }
      changed = true;
    }
    if ('fast_path_decision' in obj.pipeline) {
      log(`  pipeline.fast_path_decision -> lean_track_decision`);
      if (!dryRun) {
        obj.pipeline.lean_track_decision = obj.pipeline.fast_path_decision;
        delete obj.pipeline.fast_path_decision;
      }
      changed = true;
    }
  }

  if (obj.counters && typeof obj.counters === 'object' && 'fast_iter' in obj.counters) {
    log(`  counters.fast_iter -> lean_iter`);
    if (!dryRun) {
      obj.counters.lean_iter = obj.counters.fast_iter;
      delete obj.counters.fast_iter;
    }
    changed = true;
  }

  if (obj.artifacts && typeof obj.artifacts === 'object' && 'fast-path-check' in obj.artifacts) {
    log(`  artifacts.fast-path-check -> lean-track-check`);
    if (!dryRun) {
      obj.artifacts['lean-track-check'] = obj.artifacts['fast-path-check'];
      delete obj.artifacts['fast-path-check'];
    }
    changed = true;
  }

  return changed;
}

function renameArtifact(workDir, fromName, toName, dryRun, log) {
  const from = path.join(workDir, fromName);
  const to = path.join(workDir, toName);
  if (!fs.existsSync(from)) return false;
  log(`  rename ${fromName} -> ${toName}`);
  if (!dryRun) fs.renameSync(from, to);
  return true;
}

function main() {
  const apply = process.argv.includes('--apply');
  const dryRun = !apply;

  if (!fs.existsSync(WORK_ROOT)) {
    console.log(`No ${WORK_ROOT} — nothing to migrate.`);
    process.exit(0);
  }

  const ids = fs.readdirSync(WORK_ROOT).filter((name) => {
    const p = path.join(WORK_ROOT, name);
    return fs.statSync(p).isDirectory();
  });

  if (ids.length === 0) {
    console.log('No work directories found.');
    process.exit(0);
  }

  console.log(dryRun ? 'DRY RUN (use --apply to write changes):\n' : 'APPLYING migrations:\n');

  let any = false;
  for (const id of ids) {
    const workDir = path.join(WORK_ROOT, id);
    const statePath = path.join(workDir, 'state.json');
    if (!fs.existsSync(statePath)) continue;

    const raw = fs.readFileSync(statePath, 'utf8');
    let state;
    try {
      state = JSON.parse(raw);
    } catch (e) {
      console.error(`SKIP ${id}: invalid JSON in state.json`);
      continue;
    }

    const lines = [];
    const log = (msg) => lines.push(msg);

    const jsonChanged = migrateStateJson(state, dryRun, workDir, log);
    const fileChanged = renameArtifact(workDir, 'fast-path-check.md', 'lean-track-check.md', dryRun, log);

    if (jsonChanged || fileChanged) {
      any = true;
      console.log(`${id}:`);
      lines.forEach((l) => console.log(l));
      if (!dryRun && jsonChanged) {
        fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
      }
    }
  }

  if (!any) console.log('No legacy fast-path fields or artifacts found.');
  else if (dryRun) console.log('\nRe-run with --apply to perform updates.');
}

main();
