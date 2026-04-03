#!/usr/bin/env node
/**
 * Work-folder migration entrypoint for `.claude/.work/<id>/`.
 *
 * Today this delegates to the lean-track renames (v1.x fast-path-* -> v2 lean-track-*).
 * Add future migrators here as new pipeline versions ship.
 *
 * Usage (passed through to the concrete migrator):
 *   node scripts/migrate-work-state.js              # dry-run
 *   node scripts/migrate-work-state.js --apply      # write changes
 *
 * Direct migrator (same effect):
 *   node scripts/migrate-lean-track-state.js [--apply]
 */
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const leanTrackMigrator = path.join(__dirname, 'migrate-lean-track-state.js');
const args = process.argv.slice(2);
const r = spawnSync(process.execPath, [leanTrackMigrator, ...args], { stdio: 'inherit' });
process.exit(r.status === null ? 1 : r.status);
