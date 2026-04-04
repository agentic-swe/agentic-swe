'use strict';

/**
 * Automated multi-platform wiring checks (manifests, paths, versions, hook targets).
 * These do not launch Cursor, Codex, OpenCode, or Gemini — only repo layout and CLI validate when available.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const { pathToFileURL } = require('node:url');

const repoRoot = path.join(__dirname, '..');
const pluginCursorDir = path.join(repoRoot, '.cursor-plugin');

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function countMdUnder(dir) {
  let n = 0;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, ent.name);
      if (ent.isDirectory()) stack.push(full);
      else if (ent.isFile() && ent.name.endsWith('.md')) n += 1;
    }
  }
  return n;
}

function resolveFromCursorPlugin(relativePath) {
  return path.normalize(path.join(pluginCursorDir, relativePath));
}

/** Run once at load; skip validate test if `claude` is not on PATH. */
function claudePluginValidateResult() {
  return spawnSync('claude', ['plugin', 'validate', repoRoot], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
}

const _validateOnce = claudePluginValidateResult();
const skipClaudePluginValidate = Boolean(_validateOnce.error && _validateOnce.error.code === 'ENOENT');

describe('multi-platform stubs: Claude Code', () => {
  it('plugin.json, marketplace plugin entry, and package.json share the same version', () => {
    const pkg = readJson(path.join(repoRoot, 'package.json'));
    const plugin = readJson(path.join(repoRoot, '.claude-plugin', 'plugin.json'));
    const market = readJson(path.join(repoRoot, '.claude-plugin', 'marketplace.json'));
    assert.strictEqual(plugin.version, pkg.version, '.claude-plugin/plugin.json version');
    assert.ok(Array.isArray(market.plugins) && market.plugins.length > 0);
    assert.strictEqual(market.plugins[0].version, pkg.version, 'marketplace.json plugins[0].version');
    assert.strictEqual(market.plugins[0].name, 'agentic-swe');
    assert.strictEqual(market.plugins[0].source, './');
    assert.ok(typeof market.plugins[0].repository === 'string' && market.plugins[0].repository.includes('github'));
  });

  it('hooks/hooks.json SessionStart commands reference hooks/session-start and file exists', () => {
    const j = readJson(path.join(repoRoot, 'hooks', 'hooks.json'));
    const sessionScript = path.join(repoRoot, 'hooks', 'session-start');
    assert.ok(fs.existsSync(sessionScript), 'hooks/session-start missing');
    assert.ok(fs.statSync(sessionScript).size > 20, 'hooks/session-start should be non-trivial');
    const blocks = j.hooks?.SessionStart;
    assert.ok(Array.isArray(blocks), 'hooks.hooks.SessionStart should be an array');
    let sawSessionStart = false;
    for (const block of blocks) {
      for (const h of block.hooks || []) {
        if (h.type === 'command' && typeof h.command === 'string') {
          assert.ok(
            h.command.includes('session-start'),
            `expected session-start in command: ${h.command}`,
          );
          sawSessionStart = true;
        }
      }
    }
    assert.ok(sawSessionStart, 'no SessionStart command hook found');
  });

  it('session-start references exist (CLAUDE.md, session-routing-hint)', () => {
    assert.ok(fs.existsSync(path.join(repoRoot, 'CLAUDE.md')));
    assert.ok(fs.existsSync(path.join(repoRoot, 'references', 'session-routing-hint.md')));
  });

  it(
    'claude plugin validate when Claude CLI is on PATH',
    { skip: skipClaudePluginValidate },
    () => {
      assert.strictEqual(
        _validateOnce.status,
        0,
        _validateOnce.stderr || _validateOnce.stdout || 'claude plugin validate failed',
      );
    },
  );
});

describe('multi-platform stubs: Cursor plugin', () => {
  it('.cursor-plugin/plugin.json parses and paths exist from repo root', () => {
    const p = path.join(pluginCursorDir, 'plugin.json');
    assert.ok(fs.existsSync(p), 'missing .cursor-plugin/plugin.json');
    const m = readJson(p);
    assert.strictEqual(m.name, 'agentic-swe');
    assert.ok(m.version, 'cursor plugin.json should include version');
    const pkg = readJson(path.join(repoRoot, 'package.json'));
    assert.strictEqual(m.version, pkg.version, 'cursor plugin version should match package.json');

    const commandsDir = resolveFromCursorPlugin(m.commands);
    assert.ok(fs.existsSync(commandsDir), `commands path missing: ${m.commands} -> ${commandsDir}`);
    assert.ok(fs.statSync(commandsDir).isDirectory());

    const agentsDir = resolveFromCursorPlugin(m.agents);
    assert.ok(fs.existsSync(agentsDir), `agents path missing: ${m.agents} -> ${agentsDir}`);
    assert.ok(fs.statSync(agentsDir).isDirectory());

    const hooksFile = resolveFromCursorPlugin(m.hooks);
    assert.ok(fs.existsSync(hooksFile), `hooks file missing: ${m.hooks} -> ${hooksFile}`);
  });

  it('commands/ and agents/ expose markdown (Cursor discovers .md)', () => {
    const m = readJson(path.join(pluginCursorDir, 'plugin.json'));
    const commandsDir = resolveFromCursorPlugin(m.commands);
    const agentsDir = resolveFromCursorPlugin(m.agents);
    assert.ok(countMdUnder(commandsDir) >= 5, 'commands/ should contain multiple .md files');
    assert.ok(countMdUnder(agentsDir) >= 5, 'agents/ should contain multiple .md files');
  });

  it('hooks/hooks-cursor.json: every hook resolves an existing command script', () => {
    const p = path.join(repoRoot, 'hooks', 'hooks-cursor.json');
    assert.ok(fs.existsSync(p), 'missing hooks/hooks-cursor.json');
    const j = readJson(p);
    assert.ok(Array.isArray(j.hooks) && j.hooks.length > 0);
    for (const hook of j.hooks) {
      assert.ok(typeof hook.event === 'string' && hook.event.length > 0);
      assert.ok(typeof hook.command === 'string');
      assert.ok(typeof hook.description === 'string');
      const rel = hook.command.replace(/^\.\//, '');
      const target = path.join(repoRoot, rel);
      assert.ok(fs.existsSync(target), `hook command missing: ${hook.command} -> ${target}`);
    }
  });
});

describe('multi-platform stubs: Gemini CLI', () => {
  it('gemini-extension.json parses, versions align, GEMINI.md is substantial', () => {
    const p = path.join(repoRoot, 'gemini-extension.json');
    assert.ok(fs.existsSync(p), 'missing gemini-extension.json');
    const j = readJson(p);
    assert.strictEqual(j.name, 'agentic-swe');
    const pkg = readJson(path.join(repoRoot, 'package.json'));
    assert.strictEqual(j.version, pkg.version, 'gemini-extension.json version should match package.json');
    assert.ok(j.description && j.description.length > 20);
    assert.ok(j.contextFileName, 'contextFileName should be set');

    const gem = path.join(repoRoot, j.contextFileName || 'GEMINI.md');
    assert.ok(fs.existsSync(gem), `missing ${j.contextFileName}`);
    const body = fs.readFileSync(gem, 'utf8').trim();
    assert.ok(body.length > 100, 'GEMINI.md should have substantial content');
    assert.ok(/hypervisor|CLAUDE|pipeline/i.test(body), 'GEMINI.md should reference orchestration/policy');
  });
});

describe('multi-platform stubs: Codex', () => {
  it('.codex/INSTALL.md and AGENTS.md exist and INSTALL covers setup', () => {
    const install = path.join(repoRoot, '.codex', 'INSTALL.md');
    assert.ok(fs.existsSync(install), 'missing .codex/INSTALL.md');
    const installBody = fs.readFileSync(install, 'utf8');
    assert.ok(installBody.length > 200, '.codex/INSTALL.md should be substantial');
    assert.ok(/AGENTS/i.test(installBody), 'INSTALL should mention AGENTS');
    assert.ok(/CLAUDE/i.test(installBody), 'INSTALL should mention CLAUDE');

    const agents = path.join(repoRoot, 'AGENTS.md');
    assert.ok(fs.existsSync(agents), 'missing AGENTS.md');
    assert.ok(fs.readFileSync(agents, 'utf8').trim().length > 50, 'AGENTS.md should be non-trivial');
  });
});

describe('multi-platform stubs: OpenCode', () => {
  it('.opencode/INSTALL.md exists and is substantial', () => {
    const p = path.join(repoRoot, '.opencode', 'INSTALL.md');
    assert.ok(fs.existsSync(p), 'missing .opencode/INSTALL.md');
    assert.ok(fs.readFileSync(p, 'utf8').trim().length > 100);
  });

  it('.opencode/plugins/agentic-swe.js passes node --check', () => {
    const p = path.join(repoRoot, '.opencode', 'plugins', 'agentic-swe.js');
    assert.ok(fs.existsSync(p), 'missing .opencode/plugins/agentic-swe.js');
    execSync(`node --check "${p}"`, { stdio: 'pipe' });
  });

  it('OpenCode plugin ESM loads and exports config + experimental.chat transform', async () => {
    const p = path.join(repoRoot, '.opencode', 'plugins', 'agentic-swe.js');
    const url = pathToFileURL(p).href;
    const mod = await import(url);
    assert.strictEqual(typeof mod.config, 'function');
    assert.ok(mod.experimental?.chat?.messages?.transform, 'experimental.chat.messages.transform missing');
    const out = mod.config({});
    assert.ok(out.paths?.commands && out.paths?.phases, 'config should set paths.commands and paths.phases');
    assert.ok(fs.existsSync(out.paths.commands), 'resolved commands path should exist');
    assert.ok(fs.existsSync(out.paths.phases), 'resolved phases path should exist');
  });
});

describe('multi-platform stubs: npm package files[]', () => {
  const required = [
    '.cursor-plugin/',
    '.codex/',
    '.opencode/',
    'gemini-extension.json',
    'hooks/',
    '.claude-plugin/',
  ];

  it('package.json files includes all host bundle paths', () => {
    const pkgPath = path.join(repoRoot, 'package.json');
    const pkg = readJson(pkgPath);
    assert.ok(Array.isArray(pkg.files), 'package.json should define files[]');
    for (const entry of required) {
      assert.ok(
        pkg.files.includes(entry),
        `package.json files[] should include "${entry}" (for tarball / consumers)`,
      );
    }
  });
});
