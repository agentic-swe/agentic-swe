#!/usr/bin/env node
/**
 * Cross-host model tier conformance — verifies capability maps resolve for each host.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { normalizeModelTier, ALLOWED_MODELS } = require('./lib/catalog/parse-frontmatter.cjs');
const { listAgentMarkdownFiles } = require('./lib/catalog/walk-subagents.cjs');
const { extractFrontmatter, parseSimpleFields } = require('./lib/catalog/parse-frontmatter.cjs');

const root = path.join(__dirname, '..');
const HOST_MAPS = [
  'model-map.claude-code.json',
  'model-map.codex.json',
  'model-map.cursor.json',
  'model-map.gemini.json',
  'model-map.opencode.json',
];

function loadHostMap(name) {
  const p = path.join(root, 'config', name);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function main() {
  const errors = [];
  const json = process.argv.includes('--json');

  for (const mapFile of HOST_MAPS) {
    const map = loadHostMap(mapFile);
    if (!map) {
      if (mapFile === 'model-map.claude-code.json' || mapFile === 'model-map.cursor.json') {
        errors.push('missing required config/model-map.claude-code.json');
      }
      continue;
    }
    for (const tier of ['fast', 'balanced', 'heavy', 'frontier']) {
      if (!map.tiers?.[tier]) {
        errors.push(`${mapFile}: missing tier ${tier}`);
      }
    }
  }

  const agents = listAgentMarkdownFiles(path.join(root, 'agents', 'subagents'));
  let legacyCount = 0;
  for (const abs of agents) {
    const raw = fs.readFileSync(abs, 'utf8');
    const ex = extractFrontmatter(raw);
    if (!ex) continue;
    const fm = parseSimpleFields(ex.block);
    const model = String(fm.model || '').trim();
    if (/^(sonnet|opus|haiku)$/.test(model)) legacyCount++;
    const tier = normalizeModelTier(model);
    if (!ALLOWED_MODELS.has(tier)) {
      errors.push(`${path.relative(root, abs)}: invalid model ${model}`);
    }
  }
  if (legacyCount > 0) {
    errors.push(`${legacyCount} agent files still use legacy model names`);
  }

  const claudeMap = loadHostMap('model-map.claude-code.json');
  const codexMap = loadHostMap('model-map.codex.json') || claudeMap;
  if (claudeMap && codexMap) {
    for (const tier of ['fast', 'balanced', 'heavy']) {
      if (claudeMap.tiers[tier] === codexMap.tiers[tier] && tier === 'fast') {
        /* ok if same for fast tier */
      }
    }
  }

  const out = { ok: errors.length === 0, errors, agents_checked: agents.length };
  if (json) console.log(JSON.stringify(out, null, 2));
  else if (out.ok) console.log(`model-conformance: OK (${agents.length} agents, ${HOST_MAPS.filter((f) => fs.existsSync(path.join(root, 'config', f))).length} host maps)`);
  else {
    console.error('model-conformance: FAILED\n' + errors.map((e) => `  - ${e}`).join('\n'));
  }
  process.exit(out.ok ? 0 : 1);
}

main();
