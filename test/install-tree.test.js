'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..');

const ROOT_DIRS = ['commands', 'phases', 'agents', 'templates', 'references'];

describe('plugin layout: pipeline dirs at repository root', () => {
  for (const dir of ROOT_DIRS) {
    it(`${dir}/ exists and is non-empty`, () => {
      const full = path.join(repoRoot, dir);
      assert.ok(fs.existsSync(full), `missing directory: ${dir}/`);
      const entries = fs.readdirSync(full);
      assert.ok(entries.length > 0, `${dir}/ is empty`);
    });
  }

  it('tools/subagent-catalog exists and has markdown', () => {
    const cat = path.join(repoRoot, 'tools', 'subagent-catalog');
    assert.ok(fs.existsSync(cat), 'missing tools/subagent-catalog/');
    const md = fs.readdirSync(cat).filter((f) => f.endsWith('.md'));
    assert.ok(md.length > 0, 'subagent-catalog should contain .md files');
  });

  it('state-machine.json exists at repo root', () => {
    const p = path.join(repoRoot, 'state-machine.json');
    assert.ok(fs.existsSync(p), 'missing state-machine.json');
    assert.doesNotThrow(() => JSON.parse(fs.readFileSync(p, 'utf8')));
  });

  it('.claude-plugin/plugin.json exists and names the plugin', () => {
    const p = path.join(repoRoot, '.claude-plugin', 'plugin.json');
    assert.ok(fs.existsSync(p), 'missing .claude-plugin/plugin.json');
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    assert.strictEqual(j.name, 'agentic-swe');
  });

  it('hooks/hooks.json exists', () => {
    const p = path.join(repoRoot, 'hooks', 'hooks.json');
    assert.ok(fs.existsSync(p), 'missing hooks/hooks.json');
  });

  it('plugin.json uses default commands/agents discovery (no directory overrides)', () => {
    const p = path.join(repoRoot, '.claude-plugin', 'plugin.json');
    const m = JSON.parse(fs.readFileSync(p, 'utf8'));
    assert.strictEqual(
      m.commands,
      undefined,
      'omit commands — Claude 2.1+ Zod rejects some overrides; default ./commands/ is used',
    );
    assert.strictEqual(
      m.agents,
      undefined,
      'omit agents — directory paths in agents[] fail validate (agents: Invalid input); default ./agents/ is used',
    );
    assert.strictEqual(
      m.hooks,
      undefined,
      'omit hooks — Claude 2.1.92 loads hooks/hooks.json automatically; manifest.hooks duplicates it (Hook load failed)',
    );
    assert.strictEqual(m.mcpServers, './mcp-servers.json');
    const mcpPath = path.join(repoRoot, 'mcp-servers.json');
    assert.ok(fs.existsSync(mcpPath), 'missing mcp-servers.json');
    const mcp = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
    assert.ok(mcp && typeof mcp.mcpServers === 'object', 'mcp-servers.json should have mcpServers object');
    assert.strictEqual(m.phases, undefined);
    assert.strictEqual(m.templates, undefined);
    assert.strictEqual(m.references, undefined);
    assert.strictEqual(m.entryPoint, undefined);
  });
});
