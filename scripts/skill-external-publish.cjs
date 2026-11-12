#!/usr/bin/env node
/**
 * AE-028b: maintainer CLI for governed external skill publication.
 *
 * Usage:
 *   node scripts/skill-external-publish.cjs \
 *     --registry <dir> --source <skill-dir> \
 *     --actor <maintainer> --approval-ref <PR#|review-url> \
 *     [--expected-digest <sha256>]
 *
 * Requires explicit human approval record. Does not create remote releases.
 */
'use strict';

const path = require('node:path');
const { publishExternalContribution } = require('./lib/skills/skill-external-publish.cjs');

function flagValue(argv, name) {
  const idx = argv.indexOf(name);
  if (idx === -1) return undefined;
  return argv[idx + 1];
}

function main() {
  const argv = process.argv.slice(2);
  const registryRoot = flagValue(argv, '--registry');
  const sourceDir = flagValue(argv, '--source');
  const actor = flagValue(argv, '--actor');
  const approvalRef = flagValue(argv, '--approval-ref');
  const expectedDigest = flagValue(argv, '--expected-digest');
  const json = argv.includes('--json');

  if (!registryRoot || !sourceDir) {
    console.error(
      'usage: node scripts/skill-external-publish.cjs --registry <dir> --source <skill-dir> --actor <id> --approval-ref <ref> [--expected-digest <sha256>]'
    );
    process.exit(2);
  }

  const opts = {
    registryRoot: path.resolve(registryRoot),
    sourceDir: path.resolve(sourceDir),
    actor,
    approvalRef,
  };
  if (argv.includes('--expected-digest')) {
    opts.expectedDigest = expectedDigest;
  }

  const result = publishExternalContribution(opts);
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.ok) {
    console.log(
      `skill-external-publish: PASS tag=${result.tag} digest=${result.digest} actor=${result.actor} approval_ref=${result.approvalRef}`
    );
  } else {
    console.error(
      `skill-external-publish: FAIL code=${result.code || 'PUBLISH_FAILED'}${(result.errors || []).map((e) => `\n  - ${e}`).join('')}`
    );
  }
  process.exit(result.ok ? 0 : 1);
}

main();
