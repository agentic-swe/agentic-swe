#!/usr/bin/env node
/**
 * Headless goal-loop engine CLI (first slice). Same rules as scripts/lib/work-engine/goal.cjs.
 * Outer twin of work-engine.cjs. Goals live under .worklogs/goals/<id>/.
 *
 * Usage:
 *   node scripts/goal-engine.cjs init --id <id> --objective "…" [--work-root <dir>] [--plugin-root <pack>] [--json]
 *   node scripts/goal-engine.cjs validate --goal-dir .worklogs/goals/<id> [--json]
 *   node scripts/goal-engine.cjs transition --goal-dir <dir> --to <state> --actor <id> [--from <state>] [--reason str] [--evidence a,b] [--dry-run] [--json]
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { getDefaultPluginRoot } = require('./lib/work-engine/engine.cjs');
const {
  loadGoal,
  loadGoalEdges,
  applyGoalTransition,
  validateGoalShape,
} = require('./lib/work-engine/goal.cjs');

function parseArgs(argv) {
  const out = { flags: {} };
  const rest = [];
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--goal-dir') out.goalDir = argv[++i];
    else if (a === '--plugin-root') out.pluginRoot = argv[++i];
    else if (a === '--work-root') out.workRoot = argv[++i];
    else if (a === '--id') out.id = argv[++i];
    else if (a === '--objective') out.objective = argv[++i];
    else if (a === '--to') out.to = argv[++i];
    else if (a === '--from') out.from = argv[++i];
    else if (a === '--actor') out.actor = argv[++i];
    else if (a === '--reason') out.reason = argv[++i];
    else if (a === '--evidence') out.evidence = argv[++i];
    else if (!a.startsWith('-')) rest.push(a);
  }
  out.command = rest[0];
  return out;
}

function printJson(obj) {
  process.stdout.write(`${JSON.stringify(obj, null, 2)}\n`);
}

function fail(msg, code, extra) {
  const payload = { ok: false, message: msg, code, ...extra };
  if (process.argv.includes('--json')) printJson(payload);
  else console.error(payload.message);
  process.exit(code || 1);
}

function main() {
  const args = parseArgs(process.argv);
  const pluginRoot = args.pluginRoot || getDefaultPluginRoot();
  const cmd = args.command;

  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    console.log(`agentic-swe goal-engine (outer goal loop)

Commands:
  init --id <id> --objective "…" [--work-root <dir>] [--plugin-root <pack>] [--json]
  validate --goal-dir .worklogs/goals/<id> [--plugin-root <pack>] [--json]
  transition --goal-dir <dir> --to <state> --actor <id> [--from …] [--reason …] [--evidence a,b] [--dry-run] [--json]

Canonical edges: goal-state-machine.json. State template: templates/goal.json.
`);
    process.exit(0);
  }

  if (cmd === 'init') {
    if (!args.id) fail('init requires --id', 2);
    const workRoot = path.resolve(args.workRoot || process.cwd());
    const goalDir = path.join(workRoot, '.worklogs', 'goals', args.id);
    if (fs.existsSync(goalDir)) fail(`goal dir already exists: ${goalDir}`, 2);
    fs.mkdirSync(goalDir, { recursive: true });
    const tpl = path.join(pluginRoot, 'templates', 'goal.json');
    const auditTpl = path.join(pluginRoot, 'templates', 'audit.log');
    const nowIso = new Date().toISOString();
    let raw = fs.readFileSync(tpl, 'utf8');
    raw = raw
      .replace('<goal-id>', args.id)
      .replace('<goal statement>', args.objective != null ? String(args.objective) : '')
      .replace(/<ISO-8601 timestamp>/g, nowIso);
    const goal = JSON.parse(raw);
    goal.created_at = nowIso;
    goal.updated_at = nowIso;
    fs.writeFileSync(path.join(goalDir, 'goal.json'), `${JSON.stringify(goal, null, 2)}\n`);
    if (fs.existsSync(auditTpl)) fs.copyFileSync(auditTpl, path.join(goalDir, 'audit.log'));
    const out = { ok: true, goalDir, id: args.id };
    if (args.json) printJson(out);
    else console.log(goalDir);
    return;
  }

  if (!args.goalDir) fail('missing --goal-dir', 2);
  const goalDir = path.resolve(args.goalDir);

  if (cmd === 'validate') {
    const loaded = loadGoal(goalDir);
    if (!loaded.ok) {
      if (args.json) printJson(loaded);
      else fail(loaded.message, 1, loaded);
      process.exit(1);
    }
    const { edges, terminal } = loadGoalEdges(pluginRoot);
    const states = new Set();
    for (const key of edges) {
      const [from, to] = key.split('\0');
      states.add(from);
      states.add(to);
    }
    const cur = loaded.goal.current_state;
    if (!states.has(cur) && !terminal.has(cur)) {
      fail(`current_state "${cur}" is not a known goal state`, 1);
    }
    const shape = validateGoalShape(loaded.goal);
    const out = { ok: shape.ok, verdict: shape.ok ? 'VALID' : 'INVALID', current_state: cur, errors: shape.errors };
    if (args.json) printJson(out);
    else console.log(out.verdict, cur, shape.errors.join('; ') || '');
    process.exit(shape.ok ? 0 : 1);
  }

  if (cmd === 'transition') {
    if (!args.to) fail('transition requires --to', 2);
    if (!args.actor) fail('transition requires --actor', 2);
    const evidence_refs = args.evidence
      ? args.evidence.split(',').map((s) => s.trim()).filter(Boolean)
      : [];
    const r = applyGoalTransition({
      goalDir,
      pluginRoot,
      to: args.to,
      from: args.from,
      actor: args.actor,
      reason: args.reason,
      evidence_refs,
      dryRun: args.dryRun,
    });
    if (!r.ok) {
      if (args.json) printJson(r);
      else fail(r.message || 'transition failed', 1, r);
      process.exit(1);
    }
    const out = { ok: true, current_state: r.dryRun ? r.to : r.goal.current_state, dryRun: !!r.dryRun };
    if (args.json) printJson(out);
    else console.log('OK', out.current_state, r.dryRun ? '(dry-run)' : '');
    return;
  }

  fail(`unknown command: ${cmd}`, 2);
}

main();
