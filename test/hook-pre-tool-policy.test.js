'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const pluginRoot = path.join(__dirname, '..');
const hook = path.join(pluginRoot, 'scripts', 'hook-pre-tool-policy.cjs');
const fixturePolicy = path.join(__dirname, 'fixtures', 'policy-runtime', 'policy.json');

function cleanEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.AGENTIC_SWE_WORK_DIR;
  delete env.AGENTIC_SWE_POLICY;
  delete env.AGENTIC_SWE_POLICY_FAIL_CLOSED;
  delete env.CLAUDE_PROJECT_DIR;
  return { ...env, ...extra };
}

function runHook(input, env) {
  return spawnSync(process.execPath, [hook], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    encoding: 'utf8',
    env,
  });
}

describe('PreToolUse policy hook', () => {
  let repo;
  let workDir;
  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'asi02-hook-'));
    fs.mkdirSync(path.join(repo, '.agentic-swe'));
    fs.copyFileSync(fixturePolicy, path.join(repo, '.agentic-swe', 'policy.json'));
    workDir = path.join(repo, '.worklogs', 'w1');
    fs.mkdirSync(workDir, { recursive: true });
    fs.writeFileSync(path.join(workDir, 'state.json'), JSON.stringify({ work_id: 'w1', current_state: 'feasibility' }));
    fs.writeFileSync(path.join(workDir, 'audit.log'), '# audit\n');
  });
  afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

  it('denies a disallowed tool with exit 2 and logs the decision', () => {
    const r = runHook(
      { hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: 'src/a.js' }, cwd: repo },
      cleanEnv({ AGENTIC_SWE_WORK_DIR: workDir })
    );
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /phase_tool_allowlist\.feasibility/);
    const audit = fs.readFileSync(path.join(workDir, 'audit.log'), 'utf8');
    assert.match(audit, /actor=agent action=tool_call tool=Write decision=deny state=feasibility rule=phase_tool_allowlist\.feasibility input="file_path=src\/a\.js"/);
  });

  it('allows a permitted call with exit 0 and logs it', () => {
    const r = runHook(
      { tool_name: 'Bash', tool_input: { command: 'git status' }, cwd: repo },
      cleanEnv({ AGENTIC_SWE_WORK_DIR: workDir })
    );
    assert.equal(r.status, 0, r.stderr);
    assert.match(fs.readFileSync(path.join(workDir, 'audit.log'), 'utf8'), /tool=Bash decision=allow state=feasibility input="git status"/);
  });

  it('discovers the active work item from cwd when the env var is unset', () => {
    const r = runHook({ tool_name: 'Bash', tool_input: { command: 'rm -rf /' }, cwd: repo }, cleanEnv());
    assert.equal(r.status, 2);
    assert.match(fs.readFileSync(path.join(workDir, 'audit.log'), 'utf8'), /decision=deny state=feasibility rule=banned_commands\[0\]/);
  });

  it('still enforces repo policy without a work item, and writes no audit file', () => {
    fs.rmSync(path.join(repo, '.worklogs'), { recursive: true, force: true });
    const denied = runHook({ tool_name: 'mcp__danger__x', tool_input: {}, cwd: repo }, cleanEnv());
    assert.equal(denied.status, 2);
    const allowed = runHook({ tool_name: 'Write', tool_input: {}, cwd: repo }, cleanEnv());
    assert.equal(allowed.status, 0);
    assert.ok(!fs.existsSync(path.join(repo, '.worklogs')));
  });

  it('fails open on malformed input unless fail-closed is set', () => {
    const open = runHook('not json', cleanEnv({ AGENTIC_SWE_WORK_DIR: workDir }));
    assert.equal(open.status, 0);
    assert.match(open.stderr, /policy hook error/);
    assert.match(fs.readFileSync(path.join(workDir, 'audit.log'), 'utf8'), /action=tool_call_hook_error/);
    const closed = runHook('not json', cleanEnv({ AGENTIC_SWE_WORK_DIR: workDir, AGENTIC_SWE_POLICY_FAIL_CLOSED: '1' }));
    assert.equal(closed.status, 2);
  });

  it('is registered as a blocking PreToolUse hook in hooks/hooks.json', () => {
    const j = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'hooks', 'hooks.json'), 'utf8'));
    const entries = j.hooks.PreToolUse || [];
    const cmds = entries.flatMap((e) => (e.hooks || []).map((h) => h));
    const ours = cmds.find((h) => /hook-pre-tool-policy\.cjs/.test(h.command));
    assert.ok(ours, 'PreToolUse policy hook missing');
    assert.notEqual(ours.async, true, 'policy hook must block');
    assert.ok(fs.existsSync(hook));
  });
});
