#!/usr/bin/env node
/**
 * Regenerate .claude-plugin/plugin.json "agents" and "commands" as arrays of
 * explicit .md paths. Claude Code's manifest validator rejects directory
 * strings for "agents" (see anthropics/claude-code#21598).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PLUGIN_JSON = path.join(ROOT, '.claude-plugin', 'plugin.json');

function walkMarkdownFiles(relDir) {
  const abs = path.join(ROOT, relDir);
  const out = [];
  function walk(d) {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.name.endsWith('.md')) {
        out.push('./' + path.relative(ROOT, p).split(path.sep).join('/'));
      }
    }
  }
  walk(abs);
  return out.sort();
}

function main() {
  const plugin = JSON.parse(fs.readFileSync(PLUGIN_JSON, 'utf8'));
  plugin.agents = walkMarkdownFiles('.claude/agents');
  plugin.commands = walkMarkdownFiles('.claude/commands');
  fs.writeFileSync(PLUGIN_JSON, JSON.stringify(plugin, null, 2) + '\n', 'utf8');
  console.error(
    `sync-claude-plugin-manifest: wrote ${plugin.agents.length} agents, ${plugin.commands.length} commands → ${path.relative(ROOT, PLUGIN_JSON)}`,
  );
}

main();
