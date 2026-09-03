#!/usr/bin/env node
/**
 * Git-transport memory sync client (local-first, offline-safe).
 *
 * Usage:
 *   node scripts/sync/git-sync.cjs append --kind lesson --label "..." [--project-root dir]
 *   node scripts/sync/git-sync.cjs push [--project-root dir] [--json]
 */
'use strict';

const path = require('node:path');
const {
  appendLocalEvent,
  pushEventsToGitBranch,
} = require('../lib/sync/git-sync.cjs');

function parseArgs(argv) {
  const out = { json: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--project-root') out.projectRoot = path.resolve(argv[++i]);
    else if (a === '--kind') out.kind = argv[++i];
    else if (a === '--label') out.label = argv[++i];
    else if (!a.startsWith('-')) out.command = a;
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  const projectRoot = args.projectRoot || process.cwd();
  const cmd = args.command || 'push';

  if (cmd === 'append') {
    const file = appendLocalEvent({
      projectRoot,
      event: {
        kind: args.kind || 'lesson',
        label: args.label || '',
        scope: 'team',
      },
    });
    const out = { ok: true, file };
    if (args.json) console.log(JSON.stringify(out, null, 2));
    else console.log(file);
    return;
  }

  if (cmd === 'push') {
    const r = pushEventsToGitBranch({ projectRoot });
    if (args.json) console.log(JSON.stringify(r, null, 2));
    else console.log(r.ok ? `exported ${r.exported || 0}` : r.reason);
    process.exit(r.ok ? 0 : 1);
  }

  console.error('Usage: git-sync.cjs append|push');
  process.exit(2);
}

main();
