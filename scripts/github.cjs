#!/usr/bin/env node
/**
 * GitHub connector CLI (AE-015). Read-only commands; every call is recorded in
 * <work-dir or .worklogs>/github-calls.jsonl.
 *
 * Usage:
 *   node scripts/github.cjs permissions [--json]
 *   node scripts/github.cjs issue --repo owner/name --number N [--work-dir dir] [--json]
 *   node scripts/github.cjs pr --repo owner/name --number N [--work-dir dir] [--json]
 *   node scripts/github.cjs reviews --repo owner/name --number N [--work-dir dir] [--json]
 *   node scripts/github.cjs checks --repo owner/name --sha SHA [--work-dir dir] [--json]
 *   node scripts/github.cjs verify --repo owner/name --number N [--head-sha SHA] [--work-dir dir] [--json]
 */
'use strict';

const path = require('node:path');
const { loadGitHubConfig, resolveToken, createGitHubConnector } = require('./lib/github/connector.cjs');
const { fileCallJournal } = require('./lib/github/call-journal.cjs');
const { createApprovalService } = require('./lib/github/approval-service.cjs');

function parseArgs(argv) {
  const out = {};
  const rest = [];
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--repo') out.repo = argv[++i];
    else if (a === '--number') out.number = Number(argv[++i]);
    else if (a === '--sha') out.sha = argv[++i];
    else if (a === '--head-sha') out.headSha = argv[++i];
    else if (a === '--work-dir') out.workDir = argv[++i];
    else if (a === '--plugin-root') out.pluginRoot = argv[++i];
    else if (!a.startsWith('-')) rest.push(a);
  }
  out.command = rest[0];
  return out;
}

function print(obj) {
  process.stdout.write(`${JSON.stringify(obj, null, 2)}\n`);
}

function fail(args, msg, code, exit = 1) {
  if (args.json) process.stdout.write(`${JSON.stringify({ ok: false, code, message: msg }, null, 2)}\n`);
  else console.error(msg);
  process.exit(exit);
}

const HELP = `agentic-swe github (read-only GitHub connector)

Commands:
  permissions                                   Declared token permissions and the write flag
  issue   --repo owner/name --number N          Issue metadata
  pr      --repo owner/name --number N          Pull request metadata
  reviews --repo owner/name --number N          Pull request reviews
  checks  --repo owner/name --sha SHA           Check runs for a commit
  verify  --repo owner/name --number N [--head-sha SHA]
      ApprovalService.verify: code-owner approval on the head SHA, not dismissed, required checks green.

Token: AGENTIC_SWE_GITHUB_TOKEN (or GITHUB_TOKEN, GH_TOKEN), fine-grained and read-only.
Writes (branch push, PR creation, comments, check runs) return DENIED_UNAUTHORIZED unless
authorization.github_write is true in .agentic-swe/github.json.
Every call is appended to github-calls.jsonl in --work-dir (default .worklogs/).
`;

async function main() {
  const args = parseArgs(process.argv);
  const cmd = args.command;
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    console.log(HELP);
    return;
  }
  const projectRoot = process.cwd();
  const config = loadGitHubConfig({ pluginRoot: args.pluginRoot, projectRoot });
  if (cmd === 'permissions') {
    print({ ok: true, permissions: config.permissions, github_write: config.authorization.github_write });
    return;
  }
  if (!args.repo) fail(args, `${cmd} requires --repo owner/name`, 'MISSING_REPO', 2);
  const token = resolveToken(config);
  if (!token) fail(args, `set ${config.token_env[0]} to a fine-grained read-only token`, 'GITHUB_TOKEN_MISSING');
  const journal = fileCallJournal(path.resolve(args.workDir || path.join(projectRoot, '.worklogs')));
  const gh = createGitHubConnector({ token, journal, config });

  let r;
  if (cmd === 'issue') r = await gh.getIssue(args.repo, args.number);
  else if (cmd === 'pr') r = await gh.getPull(args.repo, args.number);
  else if (cmd === 'reviews') r = await gh.listReviews(args.repo, args.number);
  else if (cmd === 'checks') r = await gh.listCheckRuns(args.repo, args.sha);
  else if (cmd === 'verify') {
    r = await createApprovalService({ connector: gh, config }).verify({ repo: args.repo, pr: args.number, head_sha: args.headSha });
    print(r);
    process.exit(r.approved ? 0 : 1);
  } else fail(args, `unknown command: ${cmd}`, 'UNKNOWN_COMMAND', 2);

  if (!r.ok) fail(args, r.message, r.code);
  print(r.data);
}

main().catch((e) => {
  console.error(String(e && e.message ? e.message : e));
  process.exit(1);
});
