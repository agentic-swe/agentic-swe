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

function runHook(input, env, args = []) {
  return spawnSync(process.execPath, [hook, ...args], {
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
    writeState({ track: 'standard' });
    fs.writeFileSync(path.join(workDir, 'audit.log'), '# audit\n');
  });
  afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

  function writeState({ track, state = 'feasibility' } = {}) {
    const s = { work_id: 'w1', current_state: state };
    if (track) s.pipeline = { track };
    fs.writeFileSync(path.join(workDir, 'state.json'), JSON.stringify(s));
  }
  const audit = () => fs.readFileSync(path.join(workDir, 'audit.log'), 'utf8');
  const withWork = (extra = {}) => cleanEnv({ AGENTIC_SWE_WORK_DIR: workDir, ...extra });

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
    assert.match(fs.readFileSync(path.join(workDir, 'audit.log'), 'utf8'), /decision=deny state=feasibility rule=banned_commands\[baseline-rm-root\]/);
  });

  it('still enforces repo policy without a work item, and writes no audit file', () => {
    fs.rmSync(path.join(repo, '.worklogs'), { recursive: true, force: true });
    const denied = runHook({ tool_name: 'mcp__danger__x', tool_input: {}, cwd: repo }, cleanEnv());
    assert.equal(denied.status, 2);
    const allowed = runHook({ tool_name: 'Write', tool_input: {}, cwd: repo }, cleanEnv());
    assert.equal(allowed.status, 0);
    assert.ok(!fs.existsSync(path.join(repo, '.worklogs')));
  });

  it('denies on malformed stdin when the track is rigorous or missing', () => {
    writeState({ track: 'rigorous' });
    const rigorous = runHook('not json', withWork());
    assert.equal(rigorous.status, 2, rigorous.stderr);
    assert.match(rigorous.stderr, /fail-closed: track is rigorous/);
    assert.match(audit(), /action=tool_call_hook_error tool=unknown decision=deny mode=fail-closed/);
    writeState({});
    const missing = runHook('not json', withWork());
    assert.equal(missing.status, 2);
    assert.match(missing.stderr, /fail-closed: track is missing/);
  });

  it('warns and allows on malformed stdin in lean/standard unless runtime.json fails closed', () => {
    for (const track of ['lean', 'standard']) {
      writeState({ track });
      const open = runHook('not json', withWork());
      assert.equal(open.status, 0, `${track}: ${open.stderr}`);
      assert.match(open.stderr, /policy hook error \(fail-open/);
    }
    assert.match(audit(), /action=tool_call_hook_error tool=unknown decision=allow mode=fail-open/);
    fs.writeFileSync(path.join(repo, '.agentic-swe', 'runtime.json'), JSON.stringify({ policy: { fail_closed: true } }));
    const r = runHook('{}', withWork({ CLAUDE_PROJECT_DIR: repo }));
    assert.equal(r.status, 2);
    assert.match(r.stderr, /runtime\.json policy\.fail_closed/);
  });

  it('denies a missing tool_name in rigorous', () => {
    writeState({ track: 'rigorous' });
    const r = runHook({ tool_input: { command: 'ls' }, cwd: repo }, withWork());
    assert.equal(r.status, 2);
    assert.match(r.stderr, /no tool_name/);
  });

  it('AGENTIC_SWE_POLICY_FAIL_CLOSED only tightens', () => {
    writeState({ track: 'standard' });
    assert.equal(runHook('not json', withWork({ AGENTIC_SWE_POLICY_FAIL_CLOSED: '1' })).status, 2);
    writeState({ track: 'rigorous' });
    for (const v of ['0', 'false', '']) {
      assert.equal(runHook('not json', withWork({ AGENTIC_SWE_POLICY_FAIL_CLOSED: v })).status, 2, `value ${JSON.stringify(v)}`);
    }
  });

  it('allows with a warning on malformed stdin when there is no work item', () => {
    fs.rmSync(path.join(repo, '.worklogs'), { recursive: true, force: true });
    const r = spawnSync(process.execPath, [hook], { input: 'not json', encoding: 'utf8', cwd: repo, env: cleanEnv() });
    assert.equal(r.status, 0);
    assert.match(r.stderr, /fail-open: no active work item/);
  });

  it('denies every call in rigorous when a policy file is unreadable, allows with a warning in standard', () => {
    fs.writeFileSync(path.join(repo, '.agentic-swe', 'policy.json'), '{ not json');
    const call = { tool_name: 'Bash', tool_input: { command: 'git status' }, cwd: repo };
    writeState({ track: 'rigorous' });
    const denied = runHook(call, withWork());
    assert.equal(denied.status, 2);
    assert.match(denied.stderr, /repo policy .* is unreadable/);
    writeState({ track: 'standard' });
    const allowed = runHook(call, withWork());
    assert.equal(allowed.status, 0);
    assert.match(allowed.stderr, /fail-open/);
  });

  it('denies every call in rigorous when the policy fails schema validation', () => {
    fs.writeFileSync(path.join(repo, '.agentic-swe', 'policy.json'), JSON.stringify({ banned_tools: 'WebFetch', unknown_field: 1 }));
    writeState({ track: 'rigorous' });
    const r = runHook({ tool_name: 'Read', tool_input: { file_path: 'a' }, cwd: repo }, withWork());
    assert.equal(r.status, 2);
    assert.match(r.stderr, /repo policy .* is invalid: .*banned_tools must be array/);
  });

  it('treats a missing AGENTIC_SWE_POLICY file as an error', () => {
    writeState({ track: 'rigorous' });
    const r = runHook(
      { tool_name: 'Read', tool_input: {}, cwd: repo },
      withWork({ AGENTIC_SWE_POLICY: path.join(repo, 'nope.json') })
    );
    assert.equal(r.status, 2);
    assert.match(r.stderr, /org policy .* does not exist/);
  });

  it('keeps enforcing valid policy sources while another is broken', () => {
    fs.writeFileSync(path.join(repo, '.agentic-swe', 'policy.json'), '{ not json');
    writeState({ track: 'standard' });
    const r = runHook({ tool_name: 'Bash', tool_input: { command: 'npm publish' }, cwd: repo }, withWork());
    assert.equal(r.status, 2);
    assert.match(r.stderr, /baseline-npm-publish/);
  });

  describe('baseline policy (no repo policy)', () => {
    beforeEach(() => {
      fs.rmSync(path.join(repo, '.agentic-swe', 'policy.json'));
      fs.writeFileSync(
        path.join(workDir, 'authorization-record.json'),
        JSON.stringify({ grants: [{ action: 'github.branch.push', actor: 'user:test@example.com', at: '2026-01-01T00:00:00Z' }] })
      );
    });
    const bash = (command) => ({ tool_name: 'Bash', tool_input: { command } });
    const cases = [
      ['force-push to main', () => bash('git push --force origin main'), 'banned_commands\\[baseline-force-push-protected\\]'],
      ['npm publish', () => bash('npm publish --access public'), 'banned_commands\\[baseline-npm-publish\\]'],
      ['rm -rf /', () => bash('rm -rf /'), 'banned_commands\\[baseline-rm-root\\]'],
      ['shell append to journal', () => bash('echo {} >> .worklogs/w1/journal.jsonl'), 'banned_commands\\[baseline-integrity-files-shell\\]'],
      ['shell overwrite of approval record', () => bash('cp /tmp/a .worklogs/w1/approval-record.json'), 'banned_commands\\[baseline-integrity-files-shell\\]'],
      ['Write to journal', () => ({ tool_name: 'Write', tool_input: { file_path: path.join(repo, '.worklogs', 'w1', 'journal.jsonl') } }), 'protected_paths\\[baseline-journal\\]'],
      ['Edit of approval record', () => ({ tool_name: 'Edit', tool_input: { file_path: '.worklogs/w1/approval-record.json' } }), 'protected_paths\\[baseline-approval-record\\]'],
      ['apply_patch to goal journal', () => ({ tool_name: 'apply_patch', tool_input: { command: '*** Begin Patch\n*** Update File: .worklogs/goals/g/journal.jsonl\n*** End Patch' } }), 'protected_paths\\[baseline-journal\\]'],
    ];
    for (const [name, call, rule] of cases) {
      it(`denies ${name}`, () => {
        const r = runHook({ ...call(), cwd: repo }, withWork());
        assert.equal(r.status, 2, r.stderr);
        assert.match(r.stderr, new RegExp(rule));
      });
    }
    const allowed = [
      bash('git push origin main'),
      bash('git push --force origin feature/x'),
      bash('npm test'),
      bash('rm -rf ./dist'),
      bash('cat .worklogs/w1/journal.jsonl'),
      { tool_name: 'Read', tool_input: { file_path: '.worklogs/w1/journal.jsonl' } },
      { tool_name: 'Write', tool_input: { file_path: '.worklogs/w1/notes.md' } },
    ];
    for (const call of allowed) {
      it(`allows ${call.tool_name} ${JSON.stringify(call.tool_input)}`, () => {
        const r = runHook({ ...call, cwd: repo }, withWork());
        assert.equal(r.status, 0, r.stderr);
      });
    }
  });

  describe('--host cursor', () => {
    beforeEach(() => writeState({ track: 'standard', state: 'implementation' }));
    it('prints permission allow JSON on allow', () => {
      const r = runHook({ tool_name: 'Shell', tool_input: { command: 'git status' }, workspace_roots: [repo] }, withWork(), ['--host', 'cursor']);
      assert.equal(r.status, 0, r.stderr);
      assert.deepEqual(JSON.parse(r.stdout), { permission: 'allow' });
    });

    it('prints permission deny JSON and exits 2 on deny', () => {
      const r = runHook({ tool_name: 'Shell', tool_input: { command: 'rm -rf /' }, workspace_roots: [repo] }, withWork(), ['--host', 'cursor']);
      assert.equal(r.status, 2);
      const out = JSON.parse(r.stdout);
      assert.equal(out.permission, 'deny');
      assert.match(out.agent_message, /baseline-rm-root/);
      assert.equal(out.user_message, out.agent_message);
    });

    it('still prints allow JSON when a hook error fails open', () => {
      writeState({ track: 'lean' });
      const r = runHook('not json', withWork(), ['--host', 'cursor']);
      assert.equal(r.status, 0);
      assert.deepEqual(JSON.parse(r.stdout), { permission: 'allow' });
    });

    it('resolves the project from workspace_roots when cwd is absent', () => {
      const r = runHook({ tool_name: 'mcp__danger__x', tool_input: {}, workspace_roots: [repo] }, cleanEnv(), ['--host', 'cursor']);
      assert.equal(r.status, 2);
      assert.match(audit(), /tool=mcp__danger__x decision=deny/);
    });
  });

  it('is registered as a preToolUse hook in hooks/hooks-cursor.json', () => {
    const j = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'hooks', 'hooks-cursor.json'), 'utf8'));
    const ours = (j.hooks.preToolUse || []).find((h) => /hook-pre-tool-policy\.cjs --host cursor/.test(h.command));
    assert.ok(ours, 'Cursor preToolUse policy hook missing');
    assert.equal(ours.matcher, undefined, 'policy hook must see every tool');
  });

  it('is registered as a PreToolUse hook for every tool in the Codex plugin', () => {
    const j = JSON.parse(fs.readFileSync(path.join(pluginRoot, '.codex-plugin', 'hooks', 'hooks.json'), 'utf8'));
    const group = (j.hooks.PreToolUse || []).find((g) => (g.hooks || []).some((h) => /hook-pre-tool-policy\.cjs/.test(h.command)));
    assert.ok(group, 'Codex PreToolUse policy hook missing');
    assert.equal(group.matcher, '*');
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
