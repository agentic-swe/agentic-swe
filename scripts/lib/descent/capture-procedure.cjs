'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { buildFingerprint } = require('./fingerprint.cjs');
const { promoteOrDemote } = require('./promotion.cjs');
const { extractDeclaredFiles } = require('../scope/diff-scope-check.cjs');

/**
 * @param {string} content validation-results.md body
 */
function isValidationApproved(content) {
  if (/classification:\s*`?approved`?/i.test(content)) return true;
  if (/\*\*Classification\*\*:\s*approved/i.test(content)) return true;
  if (/## Verdict[\s\S]{0,600}\bapproved\b/i.test(content)) return true;
  if (/## Verdict[\s\S]{0,400}\*\*Approved\*\*/i.test(content)) return true;
  if (/\bStatus:\s*PASS\b/i.test(content) && /pr-creation/i.test(content)) return true;
  if (/## Verdict[\s\S]{0,500}\*\*PASS\*\*/i.test(content)) return true;
  if (/\*\*PASS\*\*[\s\S]{0,200}pr-creation/i.test(content)) return true;
  if (/verdict[\s\S]{0,300}\*\*`?approved`?\*\*/i.test(content)) return true;
  return false;
}

/**
 * Extract runnable verify commands from validation artifact.
 * @param {string} content
 * @returns {string[]}
 */
function extractVerifyCommands(content) {
  const cmds = new Set();
  const fenced = content.matchAll(/```(?:bash|sh|shell|text)?\n([\s\S]*?)```/g);
  for (const m of fenced) {
    for (const line of m[1].split('\n')) {
      const t = line.trim();
      if (/^(npm|node|pnpm|yarn|npx)\b/.test(t) && t.length < 200) cmds.add(t);
    }
  }
  const inline = content.matchAll(/`((?:npm|node|pnpm|yarn|npx)[^`]{2,120})`/g);
  for (const m of inline) cmds.add(m[1].trim());
  return [...cmds];
}

/**
 * Pick primary verify command from validation + state.
 * @param {{ validationContent: string, state: object, implementationContent?: string }} opts
 */
function resolveVerifyCommand(opts) {
  if (opts.state?.metrics?.verify_command) {
    return String(opts.state.metrics.verify_command).trim();
  }
  const fromValidation = extractVerifyCommands(opts.validationContent || '');
  if (fromValidation.length) {
    const preferred = fromValidation.find((c) => /npm test|npm run verify|npm run test/.test(c));
    return preferred || fromValidation[0];
  }
  if (opts.implementationContent) {
    const fromImpl = extractVerifyCommands(opts.implementationContent);
    if (fromImpl.length) return fromImpl[0];
  }
  return 'npm test';
}

/**
 * Capture an L1/L0 procedure from an approved work item.
 * @param {{ workDir: string, projectRoot: string, storeRoot?: string, autoL0?: boolean }} opts
 */
function captureProcedureFromWork(opts) {
  const workDir = path.resolve(opts.workDir);
  const projectRoot = path.resolve(opts.projectRoot);
  const storeRoot = path.resolve(opts.storeRoot || projectRoot);
  const workId = path.basename(workDir);

  const validationPath = path.join(workDir, 'validation-results.md');
  if (!fs.existsSync(validationPath)) {
    return { ok: false, reason: 'validation-results.md missing' };
  }
  const validationContent = fs.readFileSync(validationPath, 'utf8');
  if (!isValidationApproved(validationContent)) {
    return { ok: false, reason: 'validation not approved' };
  }

  const statePath = path.join(workDir, 'state.json');
  let state = {};
  if (fs.existsSync(statePath)) {
    try {
      state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    } catch {
      /* ignore */
    }
  }

  const implPath = path.join(workDir, 'implementation.md');
  const implementationContent = fs.existsSync(implPath)
    ? fs.readFileSync(implPath, 'utf8')
    : '';

  let verifyCommand = resolveVerifyCommand({ validationContent, state, implementationContent });
  const declared = new Set();
  for (const mdName of ['implementation.md', 'design.md']) {
    const extracted = extractDeclaredFiles(path.join(workDir, mdName));
    if (extracted) for (const f of extracted) declared.add(f);
  }
  const files =
    declared.size > 0 ? [...declared].sort().slice(0, 24) : [workId];

  if (opts.preferIsolatedTest) {
    const isolated = isolatedTestCommand(files, projectRoot);
    if (isolated) verifyCommand = isolated;
  }

  const fingerprint = buildFingerprint({
    files,
    verifyCommand,
    failureSignature: '',
  });

  const cwd = state.pipeline?.worktree_path
    ? path.resolve(projectRoot, state.pipeline.worktree_path)
    : projectRoot;

  const actions = [];
  for (const f of files.slice(0, 8)) {
    if (!f || f === workId) continue;
    if (fs.existsSync(path.join(projectRoot, f))) {
      actions.push({ type: 'READ_FILE', path: f });
    }
  }

  const procedure = {
    preconditions: [],
    actions,
    verify: [{ type: 'RUN', command: verifyCommand, cwd }],
    _meta: {
      workId,
      captured_at: new Date().toISOString(),
      source: opts.source || 'validation-approved',
    },
  };

  const autoL0 =
    opts.autoL0 ||
    process.env.AGENTIC_SWE_DESCENT_AUTO_L0 === '1' ||
    state.pipeline?.descent_auto_l0 === true;

  const r = promoteOrDemote({
    projectRoot: storeRoot,
    fingerprint,
    procedure,
    evalPassed: true,
    humanApproved: autoL0,
    successCapture: !autoL0,
  });

  try {
    const { appendLocalEvent } = require('../sync/git-sync.cjs');
    appendLocalEvent({
      projectRoot,
      event: {
        kind: 'procedure-capture',
        label: `${workId}:${verifyCommand.slice(0, 80)}`,
        scope: 'team',
        fingerprint,
        tier: r.record.tier,
      },
    });
  } catch {
    /* optional team sync */
  }

  if (opts.writeState !== false && state.metrics?.verify_command !== verifyCommand) {
    state.metrics = state.metrics || {};
    state.metrics.verify_command = verifyCommand;
    state.metrics.descent_fingerprint = fingerprint;
    state.metrics.descent_tier = r.record.tier;
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');
  }

  return {
    ok: true,
    fingerprint,
    verifyCommand,
    tier: r.record.tier,
    success_count: r.record.success_count || 0,
    files,
    read_actions: actions.length,
  };
}

/**
 * Isolated `node --test` when implementation declared test files exist on disk.
 * Avoids fingerprinting whole-repo `npm test` as muscle memory for a scoped /work item.
 */
function isolatedTestCommand(files, projectRoot) {
  const tests = [...new Set(files || [])].filter((f) => /\.(test|spec)\.(cjs|mjs|js)$/i.test(f));
  if (!tests.length) return null;
  const existing = tests.filter((f) => fs.existsSync(path.join(projectRoot, f)));
  if (!existing.length) return null;
  return `node --test ${existing.slice(0, 8).join(' ')}`;
}

module.exports = {
  isValidationApproved,
  extractVerifyCommands,
  resolveVerifyCommand,
  isolatedTestCommand,
  captureProcedureFromWork,
};
