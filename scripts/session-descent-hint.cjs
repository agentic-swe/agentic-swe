#!/usr/bin/env node
/**
 * Emit markdown hint when an L0 procedure may replay before LLM delegation.
 * Used by hooks/session-start. Opt out: AGENTIC_SWE_DESCENT_HINT=0
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { discoverActiveWorkDir } = require('./lib/work-engine/discover-workdir.cjs');
const { loadStore } = require('./lib/descent/promotion.cjs');
const { buildFingerprint } = require('./lib/descent/fingerprint.cjs');
const { extractDeclaredFiles } = require('./lib/scope/diff-scope-check.cjs');
const { findOverlappingEvaluatedProcedure } = require('./lib/descent/overlap-procedure.cjs');

function parseArgs(argv) {
  const args = argv.slice(2);
  let projectRoot = process.cwd();
  let pluginRoot = path.join(__dirname, '..');
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--project-root' && args[i + 1]) {
      projectRoot = path.resolve(args[++i]);
      continue;
    }
    if (args[i] === '--plugin-root' && args[i + 1]) {
      pluginRoot = path.resolve(args[++i]);
      continue;
    }
  }
  return { projectRoot, pluginRoot };
}

function findL0Match(projectRoot, verifyCommand, files) {
  const data = loadStore(projectRoot);
  if (files?.length && verifyCommand) {
    const fp = buildFingerprint({
      files,
      verifyCommand,
      failureSignature: '',
    });
    const rec = data.procedures.find((p) => p.fingerprint === fp && p.tier === 'L0');
    if (rec) return rec;
  }
  const norm = String(verifyCommand || '').trim();
  for (const rec of data.procedures) {
    if (rec.tier !== 'L0') continue;
    const verify = rec.procedure?.verify?.[0]?.command || rec.procedure?.actions?.[0]?.command;
    if (verify && verify.trim() === norm) return rec;
  }
  return null;
}

function main() {
  const v = process.env.AGENTIC_SWE_DESCENT_HINT;
  if (v === '0' || v === 'false' || v === 'off') return;

  const { projectRoot, pluginRoot } = parseArgs(process.argv);
  const storeRoot = fs.existsSync(path.join(projectRoot, '.agentic-swe', 'procedures.json'))
    ? projectRoot
    : fs.existsSync(path.join(pluginRoot, '.agentic-swe', 'procedures.json'))
      ? pluginRoot
      : projectRoot;

  let workDir = process.env.AGENTIC_SWE_WORK_DIR
    ? path.resolve(process.env.AGENTIC_SWE_WORK_DIR)
    : discoverActiveWorkDir(projectRoot);
  if (!workDir || !fs.existsSync(path.join(workDir, 'state.json'))) return;

  let state;
  try {
    state = JSON.parse(fs.readFileSync(path.join(workDir, 'state.json'), 'utf8'));
  } catch {
    return;
  }

  const phase = state.current_state || '';
  if (!['implementation', 'validation', 'lean-track-implementation'].includes(phase)) return;

  const wid = path.basename(workDir);
  const verify = state.metrics?.verify_command || 'npm test';

  if (state.metrics?.skip_llm_exploration === true) {
    process.stdout.write(
      [
        '### Descent ladder (engine skip_llm_exploration)',
        '',
        `- **Work item:** \`${wid}\` — **phase:** \`${phase}\` — **tier:** \`${state.metrics.descent_tier || '?'}\``,
        '- Muscle memory already hit on implementation entry. Do not re-delegate a frontier pass unless verify fails.',
      ].join('\n') + '\n'
    );
    return;
  }

  const designPath = path.join(workDir, 'design.md');
  const implPath = path.join(workDir, 'implementation.md');
  const declared =
    (fs.existsSync(designPath) && extractDeclaredFiles(designPath)) ||
    (fs.existsSync(implPath) && extractDeclaredFiles(implPath)) ||
    null;
  const declaredFiles = declared && declared.size ? [...declared].sort() : [];
  const rec = findL0Match(storeRoot, verify, declaredFiles.length ? declaredFiles : [wid]);
  const overlap = declaredFiles.length
    ? findOverlappingEvaluatedProcedure(storeRoot, declaredFiles)
    : null;
  if (!rec && !overlap) return;

  const filesFlag = declaredFiles.length ? ` --files "${declaredFiles.join(',')}"` : '';
  const block = rec
    ? [
        '### Descent ladder (L0 available)',
        '',
        `- **Work item:** \`${wid}\` — **phase:** \`${phase}\``,
        `- **L0 procedure** matches verify \`${verify}\` (fingerprint \`${rec.fingerprint.slice(0, 12)}…\`).`,
        `- Before LLM delegation, run: \`node scripts/work-engine.cjs descent-try --work-dir ${workDir} --verify "${verify}"${filesFlag}\``,
        '- On **L0 HIT**, record replay in `implementation.md` and skip redundant exploration. On **ESCALATE**, proceed with normal delegation.',
      ]
    : [
        '### Descent ladder (team overlap)',
        '',
        `- **Work item:** \`${wid}\` — **phase:** \`${phase}\``,
        `- Evaluated **${overlap.procedure?._meta?.source || 'team'}** procedure overlaps \`${declaredFiles[0]}\`.`,
        `- Replay verify \`${overlap.procedure?.verify?.[0]?.command || ''}\` before a frontier pass.`,
      ];
  process.stdout.write(`${block.join('\n')}\n`);
}

main();
