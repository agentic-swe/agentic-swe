#!/usr/bin/env node
'use strict';

/**
 * Generate bench/corpus/ tasks: oracle checks, synthesized version-sync drift, mined test stubs.
 */
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../..');
const CORPUS_ROOT = path.join(REPO_ROOT, 'bench/corpus');

function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(obj, null, 2)}\n`);
}

function baseScoring(command, cwd = '.') {
  return {
    task_pass: {
      weight: 0.4,
      method: 'run_command',
      command,
      cwd,
      full_credit_exit_code: 0,
    },
    cost_efficiency: { weight: 0.2, method: 'cost_vs_budget', cost_budget_usd: 0, default_score: 1.0 },
    cross_model: { weight: 0.2, method: 'artifact_presence', artifact: 'n/a', default_score: 1.0 },
    gate_respect: { weight: 0.2, method: 'transition_chain', default_score: 1.0 },
  };
}

function writeOracleTask(id, title, description, command, cwdRel = '../../..') {
  const dir = path.join(CORPUS_ROOT, id);
  writeJson(path.join(dir, 'corpus.json'), { kind: 'oracle', class: 'docs-sync' });
  writeJson(path.join(dir, 'task.json'), {
    id,
    title,
    description,
    expected_track: 'lean',
    acceptance_tests: [command],
    corpus_class: 'oracle',
  });
  writeJson(path.join(dir, 'scoring.json'), baseScoring(command, cwdRel));
  writeJson(path.join(dir, 'expected', 'patterns.json'), { required_patterns: [] });
}

function writeVersionSyncTask(id, driftVersion) {
  const dir = path.join(CORPUS_ROOT, id);
  const repoDir = path.join(dir, 'repo');
  fs.mkdirSync(repoDir, { recursive: true });

  const canonical = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')).version;

  const files = [
    { path: 'package.json', field: 'version' },
    { path: '.claude-plugin/plugin.json', field: 'version' },
    { path: '.cursor-plugin/plugin.json', field: 'version' },
    { path: 'gemini-extension.json', field: 'version' },
  ];

  for (const f of files) {
    const src = path.join(REPO_ROOT, f.path);
    if (!fs.existsSync(src)) continue;
    const dest = path.join(repoDir, f.path);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const data = JSON.parse(fs.readFileSync(src, 'utf8'));
    if (f.path === 'package.json') {
      data.version = driftVersion;
    } else {
      data.version = canonical;
    }
    fs.writeFileSync(dest, `${JSON.stringify(data, null, 2)}\n`);
  }

  const marketplaceSrc = path.join(REPO_ROOT, '.claude-plugin/marketplace.json');
  if (fs.existsSync(marketplaceSrc)) {
    const dest = path.join(repoDir, '.claude-plugin/marketplace.json');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const data = JSON.parse(fs.readFileSync(marketplaceSrc, 'utf8'));
    if (data.plugins?.[0]) data.plugins[0].version = canonical;
    fs.writeFileSync(dest, `${JSON.stringify(data, null, 2)}\n`);
  }

  writeJson(path.join(dir, 'repo/.version-bump.json'), JSON.parse(fs.readFileSync(path.join(REPO_ROOT, '.version-bump.json'), 'utf8')));

  const checkScript = `#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
CANON=$(jq -r '.version' "$ROOT/package.json")
for f in .claude-plugin/plugin.json .cursor-plugin/plugin.json gemini-extension.json; do
  v=$(jq -r '.version' "$ROOT/$f")
  if [ "$v" != "$CANON" ]; then exit 1; fi
done
mpv=$(jq -r '.plugins[0].version' "$ROOT/.claude-plugin/marketplace.json" 2>/dev/null || echo "")
if [ -n "$mpv" ] && [ "$mpv" != "$CANON" ]; then exit 1; fi
exit 0
`;
  fs.writeFileSync(path.join(repoDir, 'check-sync.sh'), checkScript);
  fs.chmodSync(path.join(repoDir, 'check-sync.sh'), 0o755);

  writeJson(path.join(dir, 'corpus.json'), { kind: 'synthesized', class: 'version-sync', drift_version: driftVersion });
  writeJson(path.join(dir, 'task.json'), {
    id,
    title: `Sync manifest versions to package.json (${driftVersion} → ${canonical})`,
    description: 'Fix version drift across plugin manifests to match package.json.',
    expected_track: 'lean',
    acceptance_tests: ['bash check-sync.sh'],
    corpus_class: 'version-sync',
    fix_hint: `Set all manifest version fields to ${canonical}`,
  });
  writeJson(path.join(dir, 'scoring.json'), baseScoring('bash check-sync.sh', 'repo'));
  writeJson(path.join(dir, 'expected', 'patterns.json'), { required_patterns: [] });
}

function writeMinedScriptTask(id, title, verifyCommand, testFileName, testContent) {
  const dir = path.join(CORPUS_ROOT, id);
  const repoDir = path.join(dir, 'repo');
  fs.mkdirSync(path.join(repoDir, 'test'), { recursive: true });
  fs.writeFileSync(path.join(repoDir, 'test', testFileName), testContent);
  writeJson(path.join(repoDir, 'package.json'), {
    name: `bench-corpus-${id}`,
    private: true,
    type: 'module',
    scripts: { test: `node test/${testFileName}` },
  });

  writeJson(path.join(dir, 'corpus.json'), { kind: 'mined', class: 'fail-to-pass' });
  writeJson(path.join(dir, 'task.json'), {
    id,
    title,
    description: title,
    expected_track: 'lean',
    acceptance_tests: [verifyCommand],
    corpus_class: 'mined',
  });
  writeJson(path.join(dir, 'scoring.json'), baseScoring(verifyCommand, 'repo'));
  writeJson(path.join(dir, 'expected', 'patterns.json'), { required_patterns: [] });
}

function writeMinedTestTask(id, title, testRelPath, testContent) {
  writeMinedScriptTask(id, title, 'npm test', path.basename(testRelPath), testContent);
}

function main() {
  if (fs.existsSync(CORPUS_ROOT)) {
    for (const name of fs.readdirSync(CORPUS_ROOT)) {
      const p = path.join(CORPUS_ROOT, name);
      if (fs.statSync(p).isDirectory()) fs.rmSync(p, { recursive: true, force: true });
    }
  }
  fs.mkdirSync(CORPUS_ROOT, { recursive: true });

  const oracleTasks = [
    ['oracle-version-check', 'Version manifest sync', 'bash scripts/bump-version.sh check'],
    ['oracle-catalog-lint', 'Catalog lint clean', 'node scripts/catalog-lint.cjs'],
    ['oracle-verify-sanity', 'Pack verify sanity', 'node scripts/verify-sanity.js'],
    ['oracle-catalog-counts', 'Catalog counts in sync', 'node scripts/render-catalog-counts.cjs --check'],
    ['oracle-state-machine', 'State machine JSON test', 'node --test test/state-machine-json.test.js'],
    ['oracle-claude-consistency', 'CLAUDE.md consistency', 'node --test test/claude-md-consistency.test.js'],
    ['oracle-references', 'References integrity', 'node --test test/references-integrity.test.js'],
    ['oracle-readme-badge', 'README version badge', 'node --test test/readme-version-badge.test.js'],
    ['oracle-work-engine-schema', 'Work engine schema', 'node --test test/work-engine-schema.test.js'],
    ['oracle-goal-engine', 'Goal engine tests', 'node --test test/goal-engine.test.js'],
    ['oracle-memory-config', 'Memory config schema', 'node --test test/memory-config.test.js'],
    ['oracle-bench-tasks', 'Bench tasks validate', 'node --test test/bench-tasks.test.js'],
    ['oracle-install-tree', 'Install tree test', 'node --test test/install-tree.test.js'],
    ['oracle-phase-anatomy', 'Phase anatomy lint', 'node --test test/phase-anatomy.test.js'],
    ['oracle-owai', 'OWAI conformance', 'node --test test/owai-conformance.test.js'],
  ];

  for (const [id, title, cmd] of oracleTasks) {
    writeOracleTask(id, title, title, cmd);
  }

  writeVersionSyncTask('ritual-version-sync-a', '9.9.9');
  writeVersionSyncTask('ritual-version-sync-b', '0.0.0-dev');
  writeVersionSyncTask('ritual-version-sync-c', '99.0.0');

  const passingTest = `import assert from 'node:assert/strict';
assert.equal(1 + 1, 2);
console.log('ok');
`;
  writeMinedTestTask('mined-trivial-pass', 'Trivial passing test', 'pass.test.js', passingTest);

  const smokeTest = `import assert from 'node:assert/strict';
assert.ok(true, 'smoke');
console.log('smoke ok');
`;
  writeMinedScriptTask(
    'mined-smoke-pass',
    'Smoke check passing',
    'node test/smoke.test.js',
    'smoke.test.js',
    smokeTest
  );

  const checkTest = `import assert from 'node:assert/strict';
assert.equal(typeof process.version, 'string');
console.log('check ok');
`;
  writeMinedScriptTask(
    'mined-check-pass',
    'Environment check passing',
    'node test/check.test.js',
    'check.test.js',
    checkTest
  );

  const failTest = `import assert from 'node:assert/strict';
assert.equal(1 + 1, 3);
`;
  writeMinedTestTask('mined-trivial-fail', 'Trivial failing test (negative control)', 'fail.test.js', failTest);

  writeJson(path.join(CORPUS_ROOT, 'README.md'), {
    generated: true,
    oracle_count: oracleTasks.length,
    ritual_count: 3,
    mined_count: 4,
  });

  const total = fs.readdirSync(CORPUS_ROOT).filter((n) => fs.statSync(path.join(CORPUS_ROOT, n)).isDirectory()).length;
  console.log(`Generated ${total} corpus tasks under ${CORPUS_ROOT}`);
}

main();
