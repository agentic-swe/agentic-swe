'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  evaluateToolCall,
  extractCommand,
  extractTargetPaths,
  summarizeInput,
} = require('../scripts/lib/policy/runtime.cjs');
const { mergePolicies, resolvePolicy, resolvePolicyChecked } = require('../scripts/lib/policy/merge.cjs');

const pluginRoot = path.join(__dirname, '..');
const policy = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'policy-runtime', 'policy.json'), 'utf8')
);

const bash = (command) => ({ toolName: 'Bash', toolInput: { command } });

describe('policy runtime evaluateToolCall', () => {
  it('denies a banned tool glob', () => {
    const r = evaluateToolCall({ policy, toolName: 'mcp__danger__drop_db', toolInput: {}, state: 'implementation' });
    assert.equal(r.decision, 'deny');
    assert.match(r.reason, /Unreviewed MCP server/);
    assert.equal(r.rule, 'banned_tools[1]');
  });

  it('treats a banned_tools entry with spaces as a command prefix', () => {
    assert.equal(evaluateToolCall({ policy, ...bash('git push --force origin main'), state: 'implementation' }).decision, 'deny');
    assert.equal(evaluateToolCall({ policy, ...bash('cd repo && git push --force'), state: 'implementation' }).decision, 'deny');
    assert.equal(evaluateToolCall({ policy, ...bash('git push origin work/x'), state: 'implementation' }).decision, 'allow');
  });

  it('scopes banned_tools to a state when context names a state', () => {
    assert.equal(evaluateToolCall({ policy, toolName: 'WebFetch', toolInput: {}, state: 'implementation' }).decision, 'deny');
    assert.equal(evaluateToolCall({ policy, toolName: 'WebFetch', toolInput: {}, state: 'design' }).decision, 'allow');
  });

  it('applies banned_commands regexes, honoring states', () => {
    assert.equal(evaluateToolCall({ policy, ...bash('sudo rm -rf /'), state: 'design' }).decision, 'deny');
    assert.equal(evaluateToolCall({ policy, ...bash('rm -rf ./build'), state: 'design' }).decision, 'allow');
    const pub = evaluateToolCall({ policy, ...bash('npm publish --access public'), state: 'validation' });
    assert.equal(pub.decision, 'deny');
    assert.equal(pub.rule, 'banned_commands[1]');
    assert.equal(evaluateToolCall({ policy, ...bash('npm publish'), state: 'design' }).decision, 'allow');
  });

  it('skips an invalid regex and reports a warning', () => {
    const r = evaluateToolCall({ policy, ...bash('echo hi'), state: 'design' });
    assert.equal(r.decision, 'allow');
    assert.ok(r.warnings.some((w) => /banned_commands\[2\]/.test(w)));
  });

  it('enforces the per-phase allowlist only for listed states', () => {
    const denied = evaluateToolCall({ policy, toolName: 'Write', toolInput: { file_path: 'a.js' }, state: 'feasibility' });
    assert.equal(denied.decision, 'deny');
    assert.equal(denied.rule, 'phase_tool_allowlist.feasibility');
    assert.equal(evaluateToolCall({ policy, toolName: 'mcp__github__get_pr', toolInput: {}, state: 'feasibility' }).decision, 'allow');
    assert.equal(evaluateToolCall({ policy, toolName: 'Write', toolInput: {}, state: 'implementation' }).decision, 'allow');
    assert.equal(evaluateToolCall({ policy, toolName: 'Write', toolInput: {}, state: null }).decision, 'allow');
  });

  it('allows everything under an empty policy', () => {
    assert.equal(evaluateToolCall({ policy: {}, ...bash('rm -rf /'), state: 'implementation' }).decision, 'allow');
  });
});

describe('policy runtime helpers', () => {
  it('extracts shell commands from string and argv inputs', () => {
    assert.equal(extractCommand('Bash', { command: 'ls -la' }), 'ls -la');
    assert.equal(extractCommand('shell', { command: ['bash', '-lc', 'git status'] }), 'bash -lc git status');
    assert.equal(extractCommand('Read', { file_path: 'x' }), null);
  });

  it('redacts secrets and truncates the audit summary', () => {
    const s = summarizeInput('Bash', { command: `curl -H "token: ghp_${'a'.repeat(30)}" ${'x'.repeat(400)}` });
    assert.ok(!s.includes('ghp_'), s);
    assert.match(s, /\[REDACTED\]/);
    assert.ok(s.length <= 161, String(s.length));
    assert.equal(summarizeInput('Edit', { file_path: 'src/a.js', old_string: 'x', new_string: 'y' }), 'file_path=src/a.js');
  });
});

describe('policy merge for runtime keys', () => {
  it('concatenates banned_commands and intersects allowlists per state', () => {
    const merged = mergePolicies(
      {},
      { banned_commands: [{ pattern: 'a', reason: 'r' }], phase_tool_allowlist: { design: ['Read', 'Grep', 'Write'] } },
      { banned_commands: [{ pattern: 'b', reason: 'o' }], phase_tool_allowlist: { design: ['Read', 'Write'], feasibility: ['Read'] } }
    );
    assert.deepEqual(merged.banned_commands.map((c) => c.pattern), ['a', 'b']);
    assert.deepEqual(merged.phase_tool_allowlist, { design: ['Read', 'Write'], feasibility: ['Read'] });
  });

  it('resolvePolicy loads the pack default from an explicit pack root', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'asi02-repo-'));
    try {
      fs.mkdirSync(path.join(repo, '.agentic-swe'));
      fs.writeFileSync(
        path.join(repo, '.agentic-swe', 'policy.json'),
        JSON.stringify({ banned_commands: [{ pattern: 'x', reason: 'y' }] })
      );
      const p = resolvePolicy(repo, pluginRoot);
      assert.equal(p.version, '1.0');
      assert.deepEqual(p.banned_commands.at(-1), { pattern: 'x', reason: 'y' });
      assert.ok(p.banned_commands.slice(0, -1).every((c) => c.id.startsWith('baseline-')));
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it('does not evaluate glob or regex patterns longer than 512 characters', () => {
    const long = 'a'.repeat(513);
    const banned = evaluateToolCall({
      policy: { banned_tools: [{ tool: long, reason: 'too long' }] },
      toolName: 'Bash',
      toolInput: {},
    });
    assert.equal(banned.decision, 'allow');
    assert.match(banned.warnings.join('\n'), /exceeds 512/);
    const command = evaluateToolCall({
      policy: { banned_commands: [{ pattern: long }] },
      ...bash('npm test'),
    });
    assert.equal(command.decision, 'allow');
    assert.match(command.warnings.join('\n'), /exceeds 512/);
  });
});

describe('protected_paths and rule ids', () => {
  const pol = {
    banned_commands: [{ id: 'no-curl', pattern: '\\bcurl\\b', reason: 'no network' }],
    protected_paths: [{ id: 'secrets', pattern: '**/secrets/**', reason: 'secret store' }],
  };

  it('reports the rule id instead of the index', () => {
    assert.equal(evaluateToolCall({ policy: pol, ...bash('curl x') }).rule, 'banned_commands[no-curl]');
  });

  it('extracts edit targets from path keys, edits arrays and apply_patch headers', () => {
    assert.deepEqual(extractTargetPaths('Write', { file_path: 'a' }), ['a']);
    assert.deepEqual(extractTargetPaths('MultiEdit', { edits: [{ file_path: 'b' }], path: 'c' }), ['c', 'b']);
    assert.deepEqual(
      extractTargetPaths('apply_patch', { command: '*** Begin Patch\n*** Add File: x/y\n*** Update File: z\n*** Move to: w\n*** End Patch' }),
      ['x/y', 'z', 'w']
    );
    assert.deepEqual(extractTargetPaths('Read', { file_path: 'a' }), []);
    assert.deepEqual(extractTargetPaths('Bash', { command: 'echo' }), []);
  });

  it('denies edits to protected paths given as absolute, relative or Windows paths', () => {
    for (const p of ['/r/secrets/k', 'secrets/k', './secrets/k', '../up/secrets/k', 'C:\\r\\secrets\\k']) {
      const r = evaluateToolCall({ policy: pol, toolName: 'Edit', toolInput: { file_path: p } });
      assert.equal(r.decision, 'deny', p);
      assert.equal(r.rule, 'protected_paths[secrets]');
    }
    assert.equal(evaluateToolCall({ policy: pol, toolName: 'Edit', toolInput: { file_path: 'src/secrets.js' } }).decision, 'allow');
    assert.equal(evaluateToolCall({ policy: pol, toolName: 'Read', toolInput: { file_path: 'secrets/k' } }).decision, 'allow');
  });

  it('resolvePolicyChecked reports unreadable and schema-invalid sources', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'asi02-checked-'));
    try {
      fs.mkdirSync(path.join(repo, '.agentic-swe'));
      assert.deepEqual(resolvePolicyChecked(repo, pluginRoot).errors, []);
      fs.writeFileSync(path.join(repo, '.agentic-swe', 'policy.json'), '{');
      assert.match(resolvePolicyChecked(repo, pluginRoot).errors.join(), /repo policy .* is unreadable/);
      fs.writeFileSync(path.join(repo, '.agentic-swe', 'policy.json'), JSON.stringify({ protected_paths: [{ pattern: 'x' }] }));
      const r = resolvePolicyChecked(repo, pluginRoot);
      assert.match(r.errors.join(), /must have required property 'reason'/);
      assert.ok(r.policy.banned_commands.length > 0, 'pack baseline still applies');
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});
