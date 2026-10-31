'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { applyTransition } = require('../scripts/lib/work-engine/engine.cjs');
const { readJournal, verifyWorkJournal } = require('../scripts/lib/work-engine/journal.cjs');

const pluginRoot = path.join(__dirname, '..');
const engine = path.join(pluginRoot, 'scripts', 'work-engine.cjs');
const receipt = path.join(pluginRoot, 'bin', 'agentic-swe.cjs');

function workDirFor(tmp, id) {
  const workDir = path.join(tmp, '.worklogs', id);
  fs.mkdirSync(workDir, { recursive: true });
  const tpl = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'templates', 'state.json'), 'utf8'));
  const now = new Date().toISOString();
  tpl.work_id = id;
  tpl.task = 'journal';
  tpl.current_state = 'initialized';
  tpl.created_at = now;
  tpl.updated_at = now;
  tpl.timeout_at = now;
  tpl.pipeline.track = 'lean';
  tpl.budget.budget_remaining = 20;
  tpl.budget.cost_used = 0;
  tpl.history = [];
  fs.writeFileSync(path.join(workDir, 'state.json'), JSON.stringify(tpl, null, 2));
  return workDir;
}

function transition(workDir, to) {
  const result = applyTransition({ workDir, pluginRoot, to, actor: 'test', skipMuscleMemory: true });
  assert.strictEqual(result.ok, true, result.message || JSON.stringify(result));
  return result;
}

function run(args) {
  return spawnSync(process.execPath, args, { encoding: 'utf8' });
}

describe('transition journal', () => {
  it('chains init, and fsyncs the event before state.json exists', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'awe-journal-init-'));
    const cli = run([engine, 'init', '--id', 'j-init', '--task', 'journal', '--work-root', tmp, '--json']);
    assert.strictEqual(cli.status, 0, cli.stderr);
    const workDir = path.join(tmp, '.worklogs', 'j-init');
    const chain = readJournal(workDir);
    assert.strictEqual(chain.events.length, 1);
    assert.strictEqual(chain.events[0].type, 'init');
    assert.strictEqual(chain.events[0].seq, 1);
    assert.strictEqual(chain.events[0].prev_hash, '0'.repeat(64));
    assert.strictEqual(chain.events[0].state.current_state, 'initialized');
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('rejects a hand-edited current_state on validate and transition', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'awe-journal-edit-'));
    const workDir = workDirFor(tmp, 'j-edit');
    transition(workDir, 'feasibility');
    const statePath = path.join(workDir, 'state.json');
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    state.current_state = 'approval-wait';
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

    const validate = run([engine, 'validate', '--work-dir', workDir, '--json']);
    assert.strictEqual(validate.status, 1);
    assert.strictEqual(JSON.parse(validate.stdout).code, 'INTEGRITY_FAILED');

    const again = applyTransition({ workDir, pluginRoot, to: 'completed', actor: 'test', skipMuscleMemory: true });
    assert.strictEqual(again.ok, false);
    assert.strictEqual(again.code, 'INTEGRITY_FAILED');
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('verify-journal reports the first broken seq for an edit, a delete, and a reorder', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'awe-journal-break-'));
    const workDir = workDirFor(tmp, 'j-break');
    transition(workDir, 'feasibility');
    fs.writeFileSync(path.join(workDir, 'feasibility.md'), '# ok\n');
    transition(workDir, 'lean-track-check');
    fs.writeFileSync(path.join(workDir, 'lean-track-check.md'), '# ok\n');
    transition(workDir, 'lean-track-implementation');
    const file = path.join(workDir, 'journal.jsonl');
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    assert.strictEqual(lines.length, 3);

    const edited = lines.slice();
    edited[0] = edited[0].replace('"feasibility"', '"forged"');
    fs.writeFileSync(file, `${edited.join('\n')}\n`);
    let cli = run([engine, 'verify-journal', '--work-dir', workDir, '--json']);
    assert.strictEqual(cli.status, 1);
    assert.strictEqual(JSON.parse(cli.stdout).seq, 1);

    fs.writeFileSync(file, `${[lines[0], lines[2]].join('\n')}\n`);
    cli = run([engine, 'verify-journal', '--work-dir', workDir, '--json']);
    assert.strictEqual(cli.status, 1);
    assert.strictEqual(JSON.parse(cli.stdout).seq, 3);

    fs.writeFileSync(file, `${[lines[1], lines[0], lines[2]].join('\n')}\n`);
    cli = run([engine, 'verify-journal', '--work-dir', workDir, '--json']);
    assert.strictEqual(cli.status, 1);
    assert.ok(JSON.parse(cli.stdout).seq >= 1);

    fs.writeFileSync(file, `${lines.join('\n')}\n`);
    assert.strictEqual(verifyWorkJournal(workDir).ok, true);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('recovers a corrupt state.json from the journal', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'awe-journal-recover-'));
    const workDir = workDirFor(tmp, 'j-recover');
    transition(workDir, 'feasibility');
    const statePath = path.join(workDir, 'state.json');
    fs.writeFileSync(statePath, '{');
    const cli = run([engine, 'recover', '--work-dir', workDir, '--json']);
    assert.strictEqual(cli.status, 0, cli.stderr + cli.stdout);
    const restored = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    assert.strictEqual(restored.current_state, 'feasibility');
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('migrate writes an unverified genesis event and the receipt says unanchored', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'awe-journal-migrate-'));
    const workDir = workDirFor(tmp, 'j-migrate');
    const migrated = run([engine, 'migrate', '--journal', '--work-dir', workDir, '--json']);
    assert.strictEqual(migrated.status, 0, migrated.stderr);
    const chain = readJournal(workDir);
    assert.strictEqual(chain.events[0].type, 'history.imported');
    assert.strictEqual(chain.events[0].integrity, 'unverified-import');

    const printed = run([receipt, 'receipt', '--work-dir', workDir]);
    assert.strictEqual(printed.status, 0, printed.stderr);
    assert.match(printed.stdout, /\| Integrity \| unanchored \|/);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('receipt reports verified, a history gap, and FAILED at seq', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'awe-journal-receipt-'));
    const workDir = workDirFor(tmp, 'j-receipt');
    transition(workDir, 'feasibility');
    let printed = run([receipt, 'receipt', '--work-dir', workDir]);
    assert.match(printed.stdout, /\| Integrity \| verified \|/);

    const statePath = path.join(workDir, 'state.json');
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    state.history[state.history.length - 1].to = 'lean-track-check';
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
    printed = run([receipt, 'receipt', '--work-dir', workDir]);
    assert.match(printed.stdout, /History gap/);
    assert.match(printed.stdout, /last edge ends at lean-track-check/);

    const file = path.join(workDir, 'journal.jsonl');
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    fs.writeFileSync(file, `${lines[0].replace('"feasibility"', '"forged"')}\n`);
    printed = run([receipt, 'receipt', '--work-dir', workDir]);
    assert.match(printed.stdout, /\| Integrity \| FAILED at seq 1 \|/);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
