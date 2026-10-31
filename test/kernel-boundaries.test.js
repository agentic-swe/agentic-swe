'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { decideTransition } = require('../scripts/lib/work-engine/decide.cjs');
const { applyTransition } = require('../scripts/lib/work-engine/engine.cjs');
const { DEFAULT_POST_TRANSITION_HOOKS } = require('../scripts/lib/work-engine/post-transition.cjs');

const pluginRoot = path.join(__dirname, '..');
const scriptsDir = path.join(pluginRoot, 'scripts');
const libDir = path.join(scriptsDir, 'lib');
const kernelDir = path.join(libDir, 'work-engine');

function listCjs(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listCjs(p));
    else if (/\.c?js$/.test(entry.name)) out.push(p);
  }
  return out;
}

function relativeRequires(file) {
  const src = fs.readFileSync(file, 'utf8');
  const found = [];
  for (const m of src.matchAll(/require\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)) {
    found.push(path.resolve(path.dirname(file), m[1]));
  }
  return found;
}

describe('kernel dependency boundaries', () => {
  it('work-engine imports nothing from memory, descent, or skills', () => {
    const forbidden = ['memory', 'descent', 'skills'].map((d) => path.join(libDir, d) + path.sep);
    const violations = [];
    for (const file of listCjs(kernelDir)) {
      for (const target of relativeRequires(file)) {
        if (forbidden.some((prefix) => target.startsWith(prefix))) {
          violations.push(`${path.relative(pluginRoot, file)} -> ${path.relative(pluginRoot, target)}`);
        }
      }
    }
    assert.deepStrictEqual(violations, []);
  });

  it('library modules do not require top-level CLI scripts', () => {
    const violations = [];
    for (const file of listCjs(libDir)) {
      for (const target of relativeRequires(file)) {
        if (path.dirname(target) === scriptsDir) {
          violations.push(`${path.relative(pluginRoot, file)} -> ${path.relative(pluginRoot, target)}`);
        }
      }
    }
    assert.deepStrictEqual(violations, []);
  });
});

describe('decideTransition', () => {
  const base = () => ({
    work_id: 'w',
    current_state: 'feasibility',
    pipeline: { track: 'lean' },
    budget: { budget_remaining: 5 },
    history: [],
  });

  it('returns the next state without mutating the input', () => {
    const state = base();
    const before = JSON.stringify(state);
    const { next, entry } = decideTransition({
      state,
      from: 'feasibility',
      to: 'lean-track-check',
      now: '2026-01-01T00:00:00.000Z',
      actor: 'test',
      reason: 'r',
      evidence_refs: ['feasibility.md'],
    });
    assert.strictEqual(JSON.stringify(state), before);
    assert.strictEqual(next.current_state, 'lean-track-check');
    assert.strictEqual(next.updated_at, '2026-01-01T00:00:00.000Z');
    assert.strictEqual(next.budget.budget_remaining, 4);
    assert.deepStrictEqual(entry, {
      at: '2026-01-01T00:00:00.000Z',
      actor: 'test',
      from: 'feasibility',
      to: 'lean-track-check',
      reason: 'r',
      evidence_refs: ['feasibility.md'],
    });
    assert.deepStrictEqual(next.history, [entry]);
  });

  it('is deterministic for the same input', () => {
    const input = { state: base(), from: 'feasibility', to: 'lean-track-check', now: '2026-01-01T00:00:00.000Z' };
    assert.deepStrictEqual(decideTransition(input), decideTransition(input));
  });

  it('honours decrementIterationBudget=false, track, acceptance, and tests_passed', () => {
    const { next } = decideTransition({
      state: base(),
      from: 'validation',
      to: 'pr-creation',
      now: '2026-01-01T00:00:00.000Z',
      decrementIterationBudget: false,
      setPipelineTrack: 'standard',
      acceptanceCommand: 'npm test',
      testsPassed: true,
    });
    assert.strictEqual(next.budget.budget_remaining, 5);
    assert.strictEqual(next.pipeline.track, 'standard');
    assert.strictEqual(next.pipeline.acceptance_command, 'npm test');
    assert.strictEqual(next.metrics.tests_passed, true);
  });

  it('does not touch the filesystem', () => {
    const originals = {};
    const calls = [];
    for (const fn of ['writeFileSync', 'readFileSync', 'renameSync', 'mkdirSync']) {
      originals[fn] = fs[fn];
      fs[fn] = (...args) => {
        calls.push(fn);
        return originals[fn].apply(fs, args);
      };
    }
    try {
      decideTransition({ state: base(), from: 'feasibility', to: 'lean-track-check', now: '2026-01-01T00:00:00.000Z' });
    } finally {
      Object.assign(fs, originals);
    }
    assert.deepStrictEqual(calls, []);
  });
});

describe('post-transition hooks', () => {
  function fixture() {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'awe-hooks-'));
    const workDir = path.join(tmp, 'demo-work');
    fs.mkdirSync(workDir, { recursive: true });
    const tpl = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'templates', 'state.json'), 'utf8'));
    tpl.work_id = 'demo-work';
    tpl.task = 'test';
    tpl.pipeline.track = 'lean';
    tpl.current_state = 'initialized';
    tpl.budget.budget_remaining = 20;
    tpl.budget.cost_used = 0;
    fs.writeFileSync(path.join(workDir, 'state.json'), JSON.stringify(tpl, null, 2));
    const log = path.join(tmp, 'hook.log');
    const hook = path.join(tmp, 'record-hook.cjs');
    fs.writeFileSync(
      hook,
      `module.exports.afterTransition = (ctx) => require('fs').appendFileSync(${JSON.stringify(log)}, ctx.from + '>' + ctx.to + '\\n');\n`
    );
    const broken = path.join(tmp, 'broken-hook.cjs');
    fs.writeFileSync(broken, "module.exports.afterTransition = () => { throw new Error('boom'); };\n");
    return { tmp, workDir, log, hook, broken };
  }

  it('defaults to the muscle-memory hook', () => {
    assert.deepStrictEqual(DEFAULT_POST_TRANSITION_HOOKS, ['scripts/lib/post-transition/muscle-memory.cjs']);
    const mod = require(path.join(pluginRoot, DEFAULT_POST_TRANSITION_HOOKS[0]));
    assert.strictEqual(typeof mod.afterTransition, 'function');
  });

  it('runs configured hooks after the state write', () => {
    const f = fixture();
    const r = applyTransition({ workDir: f.workDir, pluginRoot, to: 'feasibility', actor: 'test', postTransitionHooks: [f.hook] });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.strictEqual(fs.readFileSync(f.log, 'utf8'), 'initialized>feasibility\n');
    fs.rmSync(f.tmp, { recursive: true, force: true });
  });

  it('skipMuscleMemory disables hooks', () => {
    const f = fixture();
    const r = applyTransition({
      workDir: f.workDir,
      pluginRoot,
      to: 'feasibility',
      actor: 'test',
      postTransitionHooks: [f.hook],
      skipMuscleMemory: true,
    });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.strictEqual(fs.existsSync(f.log), false);
    fs.rmSync(f.tmp, { recursive: true, force: true });
  });

  it('reports a failing hook without undoing the transition', () => {
    const f = fixture();
    const r = applyTransition({
      workDir: f.workDir,
      pluginRoot,
      to: 'feasibility',
      actor: 'test',
      postTransitionHooks: [f.broken, f.hook],
    });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.strictEqual(r.state.current_state, 'feasibility');
    assert.deepStrictEqual(r.post_transition_errors, [{ hook: f.broken, message: 'boom' }]);
    assert.strictEqual(fs.readFileSync(f.log, 'utf8'), 'initialized>feasibility\n');
    fs.rmSync(f.tmp, { recursive: true, force: true });
  });
});
