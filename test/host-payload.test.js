'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeHostPayload,
  writeHostDecision,
} = require('../scripts/lib/policy/host-payload.cjs');

describe('host-payload normalizer', () => {
  it('keeps Claude-like payloads for claude-code, cursor, codex, kiro, opencode', () => {
    for (const host of ['claude-code', 'cursor', 'codex', 'kiro', 'opencode']) {
      const n = normalizeHostPayload(host, {
        tool_name: 'Bash',
        tool_input: { command: 'ls' },
        cwd: '/tmp/x',
      });
      assert.equal(n.toolName, 'Bash');
      assert.deepEqual(n.toolInput, { command: 'ls' });
      assert.equal(n.cwd, '/tmp/x');
      assert.deepEqual(n.errors, []);
    }
  });

  it('maps Antigravity run_command / write_to_file / view_file', () => {
    const shell = normalizeHostPayload('antigravity', {
      toolCall: { name: 'run_command', args: { CommandLine: 'rm -rf /', Cwd: '/repo' } },
      workspacePaths: ['/repo'],
    });
    assert.equal(shell.toolName, 'Bash');
    assert.equal(shell.toolInput.command, 'rm -rf /');
    assert.equal(shell.cwd, '/repo');

    const write = normalizeHostPayload('antigravity', {
      toolCall: { name: 'write_to_file', args: { TargetFile: '/repo/a.js' } },
      workspacePaths: ['/repo'],
    });
    assert.equal(write.toolName, 'Write');
    assert.equal(write.toolInput.file_path, '/repo/a.js');

    const read = normalizeHostPayload('antigravity', {
      toolCall: { name: 'view_file', args: { AbsolutePath: '/repo/a.js' } },
      workspacePaths: ['/repo'],
    });
    assert.equal(read.toolName, 'Read');
    assert.equal(read.toolInput.file_path, '/repo/a.js');
  });

  it('maps Windsurf cascade pre_* events', () => {
    const run = normalizeHostPayload('windsurf', {
      agent_action_name: 'pre_run_command',
      tool_info: { command_line: 'npm test', cwd: '/w' },
    });
    assert.equal(run.toolName, 'Bash');
    assert.equal(run.toolInput.command, 'npm test');

    const mcp = normalizeHostPayload('windsurf', {
      agent_action_name: 'pre_mcp_tool_use',
      tool_info: {
        mcp_server_name: 'github',
        mcp_tool_name: 'create_issue',
        mcp_tool_arguments: { title: 'x' },
      },
    });
    assert.equal(mcp.toolName, 'mcp__github__create_issue');
    assert.deepEqual(mcp.toolInput, { title: 'x' });

    const bad = normalizeHostPayload('windsurf', { tool_info: {} });
    assert.equal(bad.toolName, '');
    assert.ok(bad.errors.length > 0);
  });

  it('maps Copilot camelCase and snake_case', () => {
    const a = normalizeHostPayload('copilot', { toolName: 'bash', toolArgs: { command: 'ls' }, cwd: '/c' });
    assert.equal(a.toolName, 'bash');
    assert.deepEqual(a.toolInput, { command: 'ls' });
    const b = normalizeHostPayload('copilot', { tool_name: 'Bash', tool_input: { command: 'ls' }, cwd: '/c' });
    assert.equal(b.toolName, 'Bash');
  });

  it('writes host-specific deny stdout without changing Claude/Codex (no stdout)', () => {
    const chunks = [];
    writeHostDecision('claude-code', 'deny', 'nope', (s) => chunks.push(s));
    assert.deepEqual(chunks, []);

    chunks.length = 0;
    writeHostDecision('cursor', 'deny', 'nope', (s) => chunks.push(s));
    assert.deepEqual(JSON.parse(chunks[0]), {
      permission: 'deny',
      user_message: 'nope',
      agent_message: 'nope',
    });

    chunks.length = 0;
    writeHostDecision('antigravity', 'allow', '', (s) => chunks.push(s));
    assert.deepEqual(JSON.parse(chunks[0]), { decision: 'allow' });

    chunks.length = 0;
    writeHostDecision('copilot', 'deny', 'blocked', (s) => chunks.push(s));
    assert.deepEqual(JSON.parse(chunks[0]), {
      permissionDecision: 'deny',
      permissionDecisionReason: 'blocked',
    });
  });
});
