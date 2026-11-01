#!/usr/bin/env node
/**
 * Founder control CLI (AE-017). Human-only: every command refuses agent sessions and
 * non-interactive stdin.
 *
 * Usage:
 *   node scripts/founder.cjs status [--project-root dir] [--github] [--json]
 *   node scripts/founder.cjs approve --work-dir <dir> --decision approved|changes_requested [--note "…"] [--head-sha sha]
 *   node scripts/founder.cjs approve --goal-dir <dir> --decision approved|changes_requested [--note "…"]
 */
'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { detectAgentContext } = require('./lib/approval/human-approval.cjs');
const { collectFounderStatus, formatFounderStatus } = require('./lib/founder/status.cjs');

const packRoot = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const out = {};
  const rest = [];
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--github') out.github = true;
    else if (a === '--project-root') out.projectRoot = argv[++i];
    else if (a === '--work-dir') out.workDir = argv[++i];
    else if (a === '--goal-dir') out.goalDir = argv[++i];
    else if (a === '--decision') out.decision = argv[++i];
    else if (a === '--note') out.note = argv[++i];
    else if (a === '--head-sha') out.headSha = argv[++i];
    else if (a === '--plugin-root') out.pluginRoot = argv[++i];
    else if (!a.startsWith('-')) rest.push(a);
  }
  out.command = rest[0];
  return out;
}

function fail(args, message, code, exit = 1) {
  if (args.json) process.stdout.write(`${JSON.stringify({ ok: false, code, message }, null, 2)}\n`);
  else console.error(message);
  process.exit(exit);
}

const HELP = `agentic-swe founder (human-only control interface)

Commands:
  status [--project-root dir] [--github] [--json]
      Goals and dispatch progress; items at approval-wait, goal-approval, gates, and escalations;
      unresolved high/critical review findings; cost per item labeled estimated or provider-reported;
      journal integrity per item. Local files only. --github also checks each approval-wait PR on
      GitHub (read-only token, calls recorded in the item's github-calls.jsonl).
  approve --work-dir <dir> --decision approved|changes_requested [--note "…"] [--head-sha sha]
      Runs \`work approve\` (GitHub verification for github.com PRs; journaled).
  approve --goal-dir <dir> --decision approved|changes_requested [--note "…"]
      Runs \`goal approve\`.

Every command refuses agent sessions and non-interactive stdin.
`;

function githubVerifier(projectRoot, pluginRoot) {
  const { loadGitHubConfig, resolveToken, createGitHubConnector } = require('./lib/github/connector.cjs');
  const { fileCallJournal } = require('./lib/github/call-journal.cjs');
  const { createApprovalService } = require('./lib/github/approval-service.cjs');
  const config = loadGitHubConfig({ pluginRoot, projectRoot });
  const token = resolveToken(config);
  if (!token) return { ok: false, message: `--github needs ${config.token_env[0]} (fine-grained, read-only)` };
  return {
    ok: true,
    verify: async (item) => {
      const connector = createGitHubConnector({ token, journal: fileCallJournal(item.work_dir), config });
      const r = await createApprovalService({ connector, config }).verify({ repo: item.github.repo, pr: item.github.pr });
      return { approved: r.approved, head_sha: r.head_sha || null, reasons: r.reasons };
    },
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const cmd = args.command;
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    console.log(HELP);
    return;
  }
  const refusal = detectAgentContext({ env: process.env, isTTY: Boolean(process.stdin.isTTY) });
  if (refusal) fail(args, `refusing founder ${cmd}: ${refusal}`, 'AGENT_CONTEXT', 3);
  const pluginRoot = args.pluginRoot || packRoot;

  if (cmd === 'status') {
    const projectRoot = path.resolve(args.projectRoot || process.cwd());
    let verifier;
    if (args.github) {
      const v = githubVerifier(projectRoot, pluginRoot);
      if (!v.ok) fail(args, v.message, 'GITHUB_TOKEN_MISSING');
      verifier = v.verify;
    }
    const s = await collectFounderStatus({ projectRoot, verifier });
    if (args.json) process.stdout.write(`${JSON.stringify(s, null, 2)}\n`);
    else console.log(formatFounderStatus(s));
    return;
  }

  if (cmd === 'approve') {
    const inv = approveInvocation(args, pluginRoot);
    if (!inv.ok) fail(args, inv.message, inv.code, 2);
    const res = spawnSync(process.execPath, inv.argv, { stdio: 'inherit' });
    process.exit(res.status == null ? 1 : res.status);
  }

  fail(args, `unknown command: ${cmd}`, 'UNKNOWN_COMMAND', 2);
}

/** argv for the engine `approve` that records (and journals) the decision. */
function approveInvocation(args, pluginRoot) {
  if (!args.decision) return { ok: false, code: 'MISSING_DECISION', message: 'approve requires --decision approved|changes_requested' };
  if (Boolean(args.workDir) === Boolean(args.goalDir)) {
    return { ok: false, code: 'MISSING_TARGET', message: 'approve needs exactly one of --work-dir or --goal-dir' };
  }
  const script = args.workDir ? 'work-engine.cjs' : 'goal-engine.cjs';
  const argv = [path.join(pluginRoot, 'scripts', script), 'approve'];
  argv.push(...(args.workDir ? ['--work-dir', args.workDir] : ['--goal-dir', args.goalDir]), '--decision', args.decision);
  if (args.note) argv.push('--note', args.note);
  if (args.headSha && args.workDir) argv.push('--head-sha', args.headSha);
  if (args.json) argv.push('--json');
  argv.push('--plugin-root', pluginRoot);
  return { ok: true, argv };
}

if (require.main === module) {
  main().catch((e) => {
    console.error(String(e && e.message ? e.message : e));
    process.exit(1);
  });
}

module.exports = { parseArgs, approveInvocation };
