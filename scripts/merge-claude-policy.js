#!/usr/bin/env node
'use strict';

/**
 * Non-interactive merge of this pack's Hypervisor policy into a target repo's CLAUDE.md,
 * matching commands/install.md delimiter rules.
 */

const fs = require('fs');
const path = require('path');

/** Search for this substring (matches commands/install.md). */
const BEGIN_NEEDLE = '<!-- BEGIN autonomous-swe-pipeline policy';

/** Full delimiter line appended on first merge. */
const BEGIN_LINE = '<!-- BEGIN autonomous-swe-pipeline policy -- do not edit above this line -->';

/** @param {string} existing */
function findDelimiterLineEnd(existing) {
  const i = existing.indexOf(BEGIN_NEEDLE);
  if (i === -1) return null;
  const end = existing.indexOf('\n', i);
  if (end === -1) return existing.length;
  return end + 1;
}

/** @returns {'appended'|'unchanged'|undefined} */
function maybeAppendGitignore(targetDir, gitignore) {
  if (!gitignore) return undefined;
  const gi = path.join(targetDir, '.gitignore');
  let content = '';
  if (fs.existsSync(gi)) {
    content = fs.readFileSync(gi, 'utf8');
  }
  const has = /(?:^|\n)\s*\.worklogs\/\s*(?:$|#)/m.test(content) || /(?:^|\n)\s*\.worklogs\s*$/m.test(content);
  if (!has) {
    const add = content === '' || content.endsWith('\n') ? '.worklogs/\n' : '\n.worklogs/\n';
    fs.appendFileSync(gi, add, 'utf8');
    return 'appended';
  }
  return 'unchanged';
}

/**
 * @param {{ packRoot: string, targetDir: string, gitignore?: boolean }} opts
 * @returns {{ action: 'created' | 'appended' | 'upgraded' | 'unchanged', targetFile: string, gitignore?: string }}
 */
function mergeClaudePolicy(opts) {
  const { packRoot, targetDir, gitignore } = opts;
  const sourceClaude = path.join(packRoot, 'CLAUDE.md');
  const targetFile = path.join(targetDir, 'CLAUDE.md');

  if (!fs.existsSync(sourceClaude)) {
    throw new Error(`pack CLAUDE.md not found: ${sourceClaude}`);
  }
  if (!fs.statSync(targetDir).isDirectory()) {
    throw new Error(`target is not a directory: ${targetDir}`);
  }

  const policyBody = fs.readFileSync(sourceClaude, 'utf8').replace(/\r\n/g, '\n');

  let action;
  let appendedBody;
  if (!fs.existsSync(targetFile)) {
    fs.writeFileSync(targetFile, policyBody.endsWith('\n') ? policyBody : `${policyBody}\n`, 'utf8');
    action = 'created';
  } else {
    const existing = fs.readFileSync(targetFile, 'utf8').replace(/\r\n/g, '\n');
    const lineEnd = findDelimiterLineEnd(existing);
    if (lineEnd === null && existing.trim() === policyBody.trim()) {
      action = 'unchanged';
    } else if (lineEnd === null) {
      const trimmed = existing.trimEnd();
      const sep = /\n---\s*$/.test(trimmed) ? '\n\n' : '\n\n---\n\n';
      const block = `${trimmed}${sep}${BEGIN_LINE}\n\n${policyBody}`;
      const written = block.endsWith('\n') ? block : `${block}\n`;
      fs.writeFileSync(targetFile, written, 'utf8');
      action = 'appended';
      // Exact bytes appended after the pre-existing (trimmed) content, so uninstall can
      // reverse this edit only when the file still ends with these exact bytes.
      appendedBody = written.slice(trimmed.length);
    } else {
      const prefix = existing.slice(0, lineEnd);
      const merged = `${prefix}${policyBody.endsWith('\n') ? policyBody : `${policyBody}\n`}`;
      fs.writeFileSync(targetFile, merged, 'utf8');
      action = 'upgraded';
    }
  }

  const out = { action, targetFile };
  if (appendedBody !== undefined) out.appendedBody = appendedBody;
  const gi = maybeAppendGitignore(targetDir, gitignore);
  if (gi !== undefined) out.gitignore = gi;
  return out;
}

function parseArgs(argv) {
  const out = { packRoot: null, targetDir: null, gitignore: false, help: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--target' && argv[i + 1]) {
      out.targetDir = path.resolve(argv[++i]);
    } else if (a === '--pack' && argv[i + 1]) {
      out.packRoot = path.resolve(argv[++i]);
    } else if (a === '--gitignore') {
      out.gitignore = true;
    } else if (a === '--help' || a === '-h') {
      out.help = true;
    }
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.targetDir) {
    console.error(`Usage: node scripts/merge-claude-policy.js --target <repo-root> [--pack <agentic-swe-root>] [--gitignore]

Merges pack CLAUDE.md into <repo-root>/CLAUDE.md (delimiter rules match commands/install.md).
  --pack        defaults to the agentic-swe repo containing this script
  --gitignore   append .worklogs/ to .gitignore when missing (explicit opt-in)`);
    process.exit(args.help ? 0 : 1);
  }
  const packRoot = args.packRoot || path.join(__dirname, '..');
  try {
    const r = mergeClaudePolicy({ packRoot, targetDir: args.targetDir, gitignore: args.gitignore });
    console.log(JSON.stringify({ ok: true, ...r }));
  } catch (e) {
    console.error(e.message || String(e));
    process.exit(1);
  }
}

if (require.main === module) {
  main();
} else {
  module.exports = { mergeClaudePolicy, BEGIN_NEEDLE, BEGIN_LINE };
}
