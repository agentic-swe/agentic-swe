#!/usr/bin/env node
/**
 * Work dispatcher CLI (AE-014). Same rules as scripts/lib/dispatch/dispatcher.cjs.
 *
 * Usage:
 *   node scripts/dispatch.cjs enqueue --goal-dir <dir> --id <item> --type <type> --title "…" [--depends-on a,b] [--paths a,b] [--task "…"] --actor <id> [--json]
 *   node scripts/dispatch.cjs approve --goal-dir <dir> --item a,b [--note "…"] [--json]
 *   node scripts/dispatch.cjs plan --goal-dir <dir> (--dry-run | --actor <id>) [--json]
 *   node scripts/dispatch.cjs status --goal-dir <dir> [--json]
 *   node scripts/dispatch.cjs start --goal-dir <dir> --actor <id> [--item <id>] [--json]
 *   node scripts/dispatch.cjs resume --goal-dir <dir> --item <id> --actor <id> [--json]
 */
'use strict';

const path = require('node:path');
const { getDefaultPluginRoot } = require('./lib/work-engine/engine.cjs');
const dispatcher = require('./lib/dispatch/dispatcher.cjs');

function parseArgs(argv) {
  const out = {};
  const rest = [];
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--goal-dir') out.goalDir = argv[++i];
    else if (a === '--plugin-root') out.pluginRoot = argv[++i];
    else if (a === '--actor') out.actor = argv[++i];
    else if (a === '--item') out.item = argv[++i];
    else if (a === '--id') out.id = argv[++i];
    else if (a === '--type') out.type = argv[++i];
    else if (a === '--title') out.title = argv[++i];
    else if (a === '--task') out.task = argv[++i];
    else if (a === '--depends-on') out.dependsOn = argv[++i];
    else if (a === '--paths') out.paths = argv[++i];
    else if (a === '--note') out.note = argv[++i];
    else if (!a.startsWith('-')) rest.push(a);
  }
  out.command = rest[0];
  return out;
}

function splitList(s) {
  return s ? String(s).split(',').map((x) => x.trim()).filter(Boolean) : [];
}

function printJson(obj) {
  process.stdout.write(`${JSON.stringify(obj, null, 2)}\n`);
}

function fail(msg, code, extra) {
  const payload = { ok: false, message: msg, code, ...extra };
  if (process.argv.includes('--json')) printJson(payload);
  else console.error(payload.message);
  process.exit(typeof code === 'number' ? code : 1);
}

function finish(args, r, line) {
  const { goal, ...out } = r;
  if (!r.ok) {
    if (args.json) printJson(out);
    else console.error(`${r.code || 'ERROR'}: ${r.message}`);
    process.exit(1);
  }
  if (args.json) printJson(out);
  else console.log(line(out));
}

const HELP = `agentic-swe dispatch (work dispatcher)

Commands:
  enqueue --goal-dir <dir> --id <item> --type <type> --title "…" [--depends-on a,b] [--paths a,b] [--task "…"] --actor <id>
      Append an item to goal.json discovery.queue. Types: ${Object.keys(dispatcher.WORK_TYPES).join(', ')}.
  approve --goal-dir <dir> --item a,b [--note "…"]
      Human-only. Only approved items are planned; editing an item voids its approval.
  plan --goal-dir <dir> (--dry-run | --actor <id>)
      Route approved items to role + track and order them by depends_on. --dry-run writes nothing.
  status --goal-dir <dir>
      Read-only: each planned child is pending/blocked/ready/active/interrupted/completed/failed/escalated.
  start --goal-dir <dir> --actor <id> [--item <id>]
      Create the next ready child work item (goal must be in goal-execute). Refused while a
      predecessor is not completed or another child is still open.
  resume --goal-dir <dir> --item <id> --actor <id>
      Rebuild an interrupted child's state.json from its journal; predecessors are untouched.

Every decision, including refusals, is a dispatch.* event in the goal journal.
`;

function main() {
  const args = parseArgs(process.argv);
  const pluginRoot = args.pluginRoot || getDefaultPluginRoot();
  const cmd = args.command;
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    console.log(HELP);
    process.exit(0);
  }
  if (!args.goalDir) fail('missing --goal-dir', 2);
  const goalDir = path.resolve(args.goalDir);

  if (cmd === 'plan') {
    const r = dispatcher.plan({ goalDir, pluginRoot, actor: args.actor, dryRun: args.dryRun });
    return finish(args, r, (o) => {
      const lines = o.order.map((id) => {
        const n = o.nodes.find((x) => x.id === id);
        const deps = n.depends_on.length ? ` after ${n.depends_on.join(', ')}` : '';
        return `  ${id} → ${n.track} / ${n.role}${n.reviewers.length ? ` + ${n.reviewers.join(', ')}` : ''}${deps}`;
      });
      const skipped = o.skipped.map((s) => `  skipped ${s.id}: ${s.reason}`);
      return [`OK plan${o.dryRun ? ' (dry-run, nothing written)' : ''}`, ...lines, ...skipped].join('\n');
    });
  }

  if (cmd === 'status') {
    const r = dispatcher.status({ goalDir });
    return finish(args, r, (o) => [
      `goal: ${o.goal_state}`,
      ...o.nodes.map((n) => `  ${n.id} [${n.status}]${n.current_state ? ` ${n.current_state}` : ''}${n.waiting_on ? ` waiting on ${n.waiting_on.join(', ')}` : ''}`),
    ].join('\n'));
  }

  if (cmd === 'start') {
    const r = dispatcher.start({ goalDir, pluginRoot, actor: args.actor, item: args.item });
    return finish(args, r, (o) => `OK started ${o.item} → ${o.workDir} (${o.track} / ${o.role})`);
  }

  if (cmd === 'resume') {
    const r = dispatcher.resume({ goalDir, actor: args.actor, item: args.item });
    return finish(args, r, (o) => `OK resumed ${o.item} at ${o.current_state}${o.recovered ? ' (state.json rebuilt from journal)' : ''}`);
  }

  if (cmd === 'enqueue') {
    const r = dispatcher.enqueue({
      goalDir,
      actor: args.actor,
      id: args.id,
      type: args.type,
      title: args.title,
      task: args.task,
      dependsOn: splitList(args.dependsOn),
      paths: splitList(args.paths),
    });
    return finish(args, r, (o) => `OK queued ${o.item.id} (${o.item.type})`);
  }

  if (cmd === 'approve') {
    const { detectAgentContext, resolveUserIdentity } = require('./lib/approval/human-approval.cjs');
    const refusal = detectAgentContext({ env: process.env, isTTY: Boolean(process.stdin.isTTY) });
    if (refusal) fail(`refusing approval: ${refusal}`, 3, { code: 'AGENT_CONTEXT' });
    const items = splitList(args.item);
    if (!items.length) fail('approve requires --item a,b', 2);
    const identity = resolveUserIdentity({ cwd: process.cwd() });
    if (!identity) fail('cannot resolve your identity (set git user.email)', 1, { code: 'NO_IDENTITY' });
    const readline = require('node:readline/promises');
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    rl.question(`Type "${items.join(',')}" to approve these items for dispatch: `)
      .then((typed) => {
        rl.close();
        if (typed.trim() !== items.join(',')) {
          fail('confirmation did not match; nothing recorded', 1, { code: 'NOT_CONFIRMED' });
        }
        const r = dispatcher.approveItems({ goalDir, items, identity, note: args.note });
        finish(args, r, (o) => `OK approved ${o.items.join(', ')} by ${identity.actor}`);
      })
      .catch((e) => fail(String(e && e.message ? e.message : e), 1));
    return undefined;
  }

  return fail(`unknown command: ${cmd}`, 2);
}

main();
