'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const pluginRoot = path.join(__dirname, '..');
const hook = path.join(pluginRoot, 'scripts', 'hook-pre-tool-policy.cjs');
const lintScript = path.join(pluginRoot, 'scripts', 'catalog-lint.cjs');
const workEngine = path.join(pluginRoot, 'scripts', 'work-engine.cjs');
const roles = require('../scripts/lib/policy/roles.cjs');
const { AGENT_ENV_MARKERS } = require('../scripts/lib/approval/human-approval.cjs');

function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const k of ['AGENTIC_SWE_WORK_DIR', 'AGENTIC_SWE_POLICY', 'AGENTIC_SWE_POLICY_FAIL_CLOSED', 'AGENTIC_SWE_ROLE', 'AGENTIC_SWE_ROLES_DIR', 'CLAUDE_PROJECT_DIR', 'CURSOR_PROJECT_DIR']) {
    delete env[k];
  }
  return { ...env, ...extra };
}

function runHook(input, env) {
  return spawnSync(process.execPath, [hook], { input: JSON.stringify(input), encoding: 'utf8', env });
}

const bash = (command) => ({ tool_name: 'Bash', tool_input: { command } });
const read = { tool_name: 'Read', tool_input: { file_path: 'src/a.js' } };
const write = { tool_name: 'Write', tool_input: { file_path: 'src/a.js' } };
const shell = bash('npm test');
const spawn = { tool_name: 'Task', tool_input: { prompt: 'x' } };
const mcp = { tool_name: 'mcp__github__get_pull_request', tool_input: {} };
const web = { tool_name: 'WebFetch', tool_input: { url: 'https://example.com' } };

const ROLE_CASES = {
  hypervisor: { allowed: web, denied: null },
  developer: { allowed: write, denied: web },
  'architecture-reviewer': { allowed: read, denied: write },
  'security-reviewer': { allowed: read, denied: shell },
  'adversarial-reviewer': { allowed: read, denied: spawn },
  'git-operations': { allowed: shell, denied: mcp },
  'pr-manager': { allowed: mcp, denied: spawn },
  'goal-verifier': { allowed: shell, denied: write },
};

const PRIVILEGED_CALLS = {
  'github.branch.push': bash('git push origin feat/x'),
  'github.pr.write': bash('gh pr create --fill'),
  'npm.publish': bash('npm publish'),
};

describe('agent roles', () => {
  const loaded = roles.loadRoles();

  it('loads every bundled role without errors', () => {
    assert.deepEqual(loaded.errors, []);
    assert.deepEqual([...loaded.roles.keys()].sort(), Object.keys(ROLE_CASES).sort());
  });

  it('every bundled role validates against the schema', () => {
    for (const role of loaded.roles.values()) assert.deepEqual(roles.validateRole(role), [], role.id);
  });

  it('no role may publish to npm', () => {
    for (const role of loaded.roles.values()) assert.ok(!role.privileged_actions.includes('npm.publish'), role.id);
  });

  it('resolveActor: env role, plugin-prefixed agent_type, unknown agent, main session, no work item', () => {
    const r = loaded.roles;
    assert.equal(roles.resolveActor({ roles: r, env: { AGENTIC_SWE_ROLE: 'developer' }, hasWorkItem: false }).role, 'developer');
    assert.match(roles.resolveActor({ roles: r, env: { AGENTIC_SWE_ROLE: 'nope' } }).error, /not a role/);
    assert.equal(roles.resolveActor({ roles: r, env: {}, agentType: 'agentic-swe:developer-agent' }).role, 'developer');
    assert.equal(roles.resolveActor({ roles: r, env: {}, agentType: 'security-reviewer' }).role, 'security-reviewer');
    const unknown = roles.resolveActor({ roles: r, env: {}, agentType: 'some-other-agent', hasWorkItem: true });
    assert.equal(unknown.role, null);
    assert.equal(unknown.agentType, 'some-other-agent');
    assert.equal(roles.resolveActor({ roles: r, env: {}, hasWorkItem: true }).role, 'hypervisor');
    assert.equal(roles.resolveActor({ roles: r, env: {}, hasWorkItem: false }).role, null);
  });

  describe('privilegedActions detection', () => {
    const cases = [
      ['git push origin main', ['github.branch.push']],
      ['git -C /repo push', ['github.branch.push']],
      ['git -c "credential.helper=!f() { echo x; }; f" push https://github.com/a/b.git HEAD:x', ['github.branch.push']],
      ['git -c "credential.helper=!f() { echo x; }; f" push --dry-run https://github.com/a/b.git HEAD:x', []],
      ['git push --dry-run origin x && git push origin x', ['github.branch.push']],
      ['git status; git log', []],
      ['gh pr merge 3 --squash', ['github.pr.write']],
      ['gh --repo a/b pr comment 3 -b hi', ['github.pr.write']],
      ['gh -R a/b pr comment 3 -b hi', ['github.pr.write']],
      ['gh pr view 3', []],
      ['gh pr update-branch 3', ['github.pr.write']],
      ['gh api -X DELETE repos/a/b/git/refs/heads/x', ['github.branch.push']],
      ['gh api repos/a/b/pulls -f title=t', ['github.pr.write']],
      ['gh api repos/a/b/pulls', []],
      ['gh api -X GET repos/a/b/pulls -f state=open', []],
      ['gh api --method=PUT repos/a/b/contents/f', ['github.branch.push']],
      ['npm publish --access public', ['npm.publish']],
      ['yarn npm publish', ['npm.publish']],
      ['npm run publish-docs', []],
    ];
    for (const [command, want] of cases) {
      it(command, () => assert.deepEqual(roles.privilegedActions('Bash', { command }), want));
    }
    it('MCP and git tool names', () => {
      assert.deepEqual(roles.privilegedActions('mcp__github__push_files', {}), ['github.branch.push']);
      assert.deepEqual(roles.privilegedActions('mcp__github__create_pull_request', {}), ['github.pr.write']);
      assert.deepEqual(roles.privilegedActions('mcp__github__merge_pull_request', {}), ['github.pr.write']);
      assert.deepEqual(roles.privilegedActions('mcp__github__get_pull_request_diff', {}), []);
      assert.deepEqual(roles.privilegedActions('git_push', {}), ['github.branch.push']);
      assert.deepEqual(roles.privilegedActions('pull_request_create', {}), ['github.pr.write']);
    });
  });

  it('npm.publish is denied for every role even with an authorization record', () => {
    for (const role of loaded.roles.values()) {
      const v = roles.evaluateRoleCall({
        roles: loaded.roles,
        actor: { role: role.id, agentType: null },
        toolName: 'Bash',
        toolInput: { command: 'npm publish' },
        authorized: new Set(['npm.publish']),
      });
      assert.equal(v.decision, 'deny', role.id);
      const rule = roles.toolAllowed(role, 'Bash') ? 'privileged[npm.publish]' : `role[${role.id}].tools`;
      assert.equal(v.rule, rule, role.id);
    }
  });

  describe('pre-tool hook', () => {
    let repo;
    let workDir;
    beforeEach(() => {
      repo = fs.mkdtempSync(path.join(os.tmpdir(), 'roles-hook-'));
      workDir = path.join(repo, '.worklogs', 'w1');
      fs.mkdirSync(workDir, { recursive: true });
      fs.writeFileSync(path.join(workDir, 'state.json'), JSON.stringify({ work_id: 'w1', current_state: 'implementation', pipeline: { track: 'standard' } }));
      fs.writeFileSync(path.join(workDir, 'audit.log'), '# audit\n');
    });
    afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

    const env = (extra) => cleanEnv({ AGENTIC_SWE_WORK_DIR: workDir, ...extra });
    const asRole = (role, call) => runHook({ ...call, cwd: repo }, env({ AGENTIC_SWE_ROLE: role }));
    const grant = (...actions) => fs.writeFileSync(
      path.join(workDir, 'authorization-record.json'),
      JSON.stringify({ grants: actions.map((action) => ({ action, actor: 'user:founder@example.com', at: '2026-01-01T00:00:00Z' })) })
    );

    for (const [role, { allowed, denied }] of Object.entries(ROLE_CASES)) {
      it(`${role}: allows ${allowed.tool_name}`, () => {
        const r = asRole(role, allowed);
        assert.equal(r.status, 0, r.stderr);
      });
      if (denied) {
        it(`${role}: denies ${denied.tool_name}`, () => {
          const r = asRole(role, denied);
          assert.equal(r.status, 2, r.stderr);
          assert.match(r.stderr, new RegExp(`role\\[${role}\\]\\.tools`));
          assert.match(fs.readFileSync(path.join(workDir, 'audit.log'), 'utf8'), new RegExp(`decision=deny state=implementation rule=role\\[${role}\\]\\.tools`));
        });
      }
    }

    it('maps a plugin-scoped agent_type from the host to its role', () => {
      const r = runHook({ ...web, agent_type: 'agentic-swe:architect-reviewer', cwd: repo }, env());
      assert.equal(r.status, 2);
      assert.match(r.stderr, /role\[architecture-reviewer\]\.tools/);
    });

    for (const [action, call] of Object.entries(PRIVILEGED_CALLS)) {
      it(`${action} is denied for every role without an authorization record`, () => {
        for (const role of Object.keys(ROLE_CASES)) {
          const r = asRole(role, call);
          assert.equal(r.status, 2, `${role}: ${r.stderr}`);
        }
      });
    }

    it('push and PR writes pass only for roles that list them, and only with a record', () => {
      const push = PRIVILEGED_CALLS['github.branch.push'];
      const pr = PRIVILEGED_CALLS['github.pr.write'];
      assert.match(asRole('git-operations', push).stderr, /needs a human authorization record/);
      grant('github.branch.push', 'github.pr.write');
      assert.equal(asRole('git-operations', push).status, 0);
      assert.equal(asRole('hypervisor', push).status, 0);
      assert.equal(asRole('pr-manager', pr).status, 0);
      assert.equal(asRole('hypervisor', pr).status, 0);
      assert.match(asRole('git-operations', pr).stderr, /role git-operations may not perform github\.pr\.write/);
      assert.match(asRole('pr-manager', push).stderr, /role pr-manager may not perform github\.branch\.push/);
      assert.match(asRole('developer', push).stderr, /role developer may not perform github\.branch\.push/);
    });

    it('the main session (no agent_type) is the hypervisor while a work item is active', () => {
      const r = runHook({ ...PRIVILEGED_CALLS['github.branch.push'], cwd: repo }, env());
      assert.equal(r.status, 2);
      assert.match(r.stderr, /privileged\[github\.branch\.push\]/);
      grant('github.branch.push');
      assert.equal(runHook({ ...PRIVILEGED_CALLS['github.branch.push'], cwd: repo }, env()).status, 0);
    });

    it('an agent with no role keeps its tools but gets no privileged actions', () => {
      grant('github.branch.push');
      assert.equal(runHook({ ...web, agent_type: 'some-plugin:helper', cwd: repo }, env()).status, 0);
      const r = runHook({ ...PRIVILEGED_CALLS['github.branch.push'], agent_type: 'some-plugin:helper', cwd: repo }, env());
      assert.equal(r.status, 2);
      assert.match(r.stderr, /agent some-plugin:helper \(no role in config\/roles\)/);
    });

    it('ignores grants whose actor is not a user', () => {
      fs.writeFileSync(
        path.join(workDir, 'authorization-record.json'),
        JSON.stringify({ grants: [{ action: 'github.branch.push', actor: 'agent:developer', at: 'x' }] })
      );
      assert.equal(asRole('git-operations', PRIVILEGED_CALLS['github.branch.push']).status, 2);
    });

    it('does not check roles with no work item and no agent identity', () => {
      fs.rmSync(path.join(repo, '.worklogs'), { recursive: true, force: true });
      const r = runHook({ ...PRIVILEGED_CALLS['github.branch.push'], cwd: repo }, cleanEnv());
      assert.equal(r.status, 0, r.stderr);
    });

    it('an unknown AGENTIC_SWE_ROLE is a hook error (fail-closed on rigorous)', () => {
      fs.writeFileSync(path.join(workDir, 'state.json'), JSON.stringify({ work_id: 'w1', current_state: 'implementation', pipeline: { track: 'rigorous' } }));
      const r = asRole('nope', read);
      assert.equal(r.status, 2);
      assert.match(r.stderr, /AGENTIC_SWE_ROLE "nope" is not a role/);
    });

    it('privileged actions stay denied when a role error fails open (lean track)', () => {
      fs.writeFileSync(path.join(workDir, 'state.json'), JSON.stringify({ work_id: 'w1', current_state: 'implementation', pipeline: { track: 'lean' } }));
      grant('github.branch.push');
      const push = PRIVILEGED_CALLS['github.branch.push'];
      const unknown = asRole('nope', push);
      assert.equal(unknown.status, 2, unknown.stderr);
      assert.match(unknown.stderr, /agent nope \(no role in config\/roles\) may not perform github\.branch\.push/);
      assert.equal(asRole('nope', read).status, 0);

      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roles-dir-'));
      fs.cpSync(path.join(pluginRoot, 'config', 'roles'), dir, { recursive: true });
      fs.rmSync(path.join(dir, 'hypervisor.json'));
      const r = runHook({ ...push, cwd: repo }, env({ AGENTIC_SWE_ROLES_DIR: dir }));
      fs.rmSync(dir, { recursive: true, force: true });
      assert.equal(r.status, 2, r.stderr);
      assert.match(r.stderr, /privileged\[github\.branch\.push\]/);
    });

    it('an invalid role file is a hook error', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roles-dir-'));
      fs.cpSync(path.join(pluginRoot, 'config', 'roles'), dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'developer.json'), JSON.stringify({ id: 'developer' }));
      const r = runHook({ ...read, cwd: repo }, env({ AGENTIC_SWE_ROLES_DIR: dir, AGENTIC_SWE_POLICY_FAIL_CLOSED: '1' }));
      fs.rmSync(dir, { recursive: true, force: true });
      assert.equal(r.status, 2);
      assert.match(r.stderr, /role developer\.json is invalid/);
    });

    it('baseline policy protects authorization-record.json from agent writes', () => {
      const edit = runHook({ tool_name: 'Edit', tool_input: { file_path: '.worklogs/w1/authorization-record.json' }, cwd: repo }, env());
      assert.equal(edit.status, 2);
      assert.match(edit.stderr, /protected_paths\[baseline-authorization-record\]/);
      const sh = runHook({ ...bash('echo {} > .worklogs/w1/authorization-record.json'), cwd: repo }, env());
      assert.equal(sh.status, 2);
      assert.match(sh.stderr, /baseline-integrity-files-shell/);
    });
  });

  describe('recordAuthorization', () => {
    let workDir;
    beforeEach(() => {
      workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'roles-auth-'));
    });
    afterEach(() => fs.rmSync(workDir, { recursive: true, force: true }));
    const identity = { actor: 'user:founder@example.com' };

    it('grants, revokes and audits', () => {
      assert.equal(roles.recordAuthorization({ workDir, action: 'github.pr.write', identity, note: 'PR #1' }).ok, true);
      assert.deepEqual([...roles.readAuthorizations(workDir).actions], ['github.pr.write']);
      assert.equal(roles.recordAuthorization({ workDir, action: 'github.pr.write', identity, revoke: true }).ok, true);
      assert.deepEqual([...roles.readAuthorizations(workDir).actions], []);
      const audit = fs.readFileSync(path.join(workDir, 'audit.log'), 'utf8');
      assert.match(audit, /actor=user:founder@example\.com action=authorization_granted privileged=github\.pr\.write note="PR #1"/);
      assert.match(audit, /action=authorization_revoked privileged=github\.pr\.write/);
    });

    it('rejects unknown actions and non-user identities', () => {
      assert.equal(roles.recordAuthorization({ workDir, action: 'deploy', identity }).code, 'BAD_ACTION');
      assert.equal(roles.recordAuthorization({ workDir, action: 'npm.publish', identity: { actor: 'agent:x' } }).code, 'NO_IDENTITY');
    });
  });

  it('work authorize refuses an agent session', () => {
    const r = spawnSync(process.execPath, [workEngine, 'authorize', '--work-dir', os.tmpdir(), '--action', 'github.branch.push', '--json'], {
      encoding: 'utf8',
      env: cleanEnv({ [AGENT_ENV_MARKERS[0]]: '1' }),
    });
    assert.equal(r.status, 3);
    assert.match(r.stdout, /AGENT_CONTEXT/);
  });

  describe('catalog-lint role checks', () => {
    let dir;
    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roles-lint-'));
      fs.cpSync(path.join(pluginRoot, 'config', 'roles'), dir, { recursive: true });
    });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
    const lint = () => spawnSync(process.execPath, [lintScript], { cwd: pluginRoot, encoding: 'utf8', env: cleanEnv({ AGENTIC_SWE_ROLES_DIR: dir }) });
    const edit = (id, fn) => {
      const p = path.join(dir, `${id}.json`);
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      fn(j);
      fs.writeFileSync(p, JSON.stringify(j));
    };

    it('passes on the bundled roles', () => {
      const r = lint();
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /8 roles/);
    });

    const bad = [
      ['schema violation', () => edit('developer', (j) => { j.tools = []; }), /role developer\.json is invalid/],
      ['unknown privileged action', () => edit('developer', (j) => { j.privileged_actions = ['deploy']; }), /role developer\.json is invalid/],
      ['id does not match file', () => edit('developer', (j) => { j.id = 'dev'; }), /the file must be dev\.json/],
      ['missing agent file', () => edit('developer', (j) => { j.agents = ['agents/nope.md']; }), /agents\/nope\.md does not exist/],
      ['agent name not in agent_types', () => edit('developer', (j) => { j.agent_types = ['someone-else']; }), /is named "developer-agent", which is not in agent_types/],
      ['unknown escalation role', () => edit('developer', (j) => { j.escalation.to = 'nobody'; }), /references unknown role "nobody"/],
      ['duplicate agent_type', () => edit('goal-verifier', (j) => { j.agent_types.push('developer-agent'); }), /agent_type "developer-agent" is also claimed/],
      ['no hypervisor', () => fs.rmSync(path.join(dir, 'hypervisor.json')), /no hypervisor role/],
    ];
    for (const [name, mutate, want] of bad) {
      it(`fails on ${name}`, () => {
        mutate();
        const r = lint();
        assert.equal(r.status, 1);
        assert.match(r.stderr, want);
      });
    }
  });
});
